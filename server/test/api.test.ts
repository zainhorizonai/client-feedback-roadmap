import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { before, describe, it } from 'node:test'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-test-'))
process.env.ADMIN_EMAILS = 'admin@test.com'
process.env.EMAIL_PROVIDER = 'console'
process.env.MAX_VIDEO_MB = '1'
process.env.APP_URL = 'http://localhost:5173'
delete process.env.NODE_ENV

const { app } = await import('../app')
const { ensureAdmins } = await import('../auth')
ensureAdmins()

type Json = Record<string, any>
class Client {
  cookie = ''
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = { method, headers: { ...headers } }
    if (this.cookie) (init.headers as Record<string, string>).cookie = this.cookie
    if (body !== undefined && !(body instanceof Uint8Array)) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    } else if (body instanceof Uint8Array) init.body = body as BodyInit
    const res = await app.request(url, init)
    const set = res.headers.getSetCookie?.() ?? []
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ')
    return res
  }
  async json(method: string, url: string, body?: unknown): Promise<{ status: number; data: Json }> {
    const res = await this.req(method, url, body)
    return { status: res.status, data: (await res.json().catch(() => ({}))) as Json }
  }
  async signIn(email: string) {
    const r = await this.json('POST', '/api/auth/request', { email })
    assert.ok(r.data.devLink, 'expected a dev link')
    const token = new URL(r.data.devLink).searchParams.get('token')
    return this.json('POST', '/api/auth/verify', { token })
  }
}

const VIDEO = new Uint8Array(Array.from({ length: 5000 }, (_, i) => i % 251))
const upload = (c: Client, id: string, body: Uint8Array = VIDEO, type = 'video/webm') =>
  c.req('PUT', `/api/reports/${id}/video`, body, { 'content-type': type })

describe('portal API', () => {
  const admin = new Client()
  const jane = new Client()
  const sam = new Client()
  let acmeId = ''
  let globexId = ''
  let reportId = ''

  before(async () => {
    assert.equal((await admin.signIn('admin@test.com')).status, 200)
    acmeId = (await admin.json('POST', '/api/admin/clients', { name: 'Acme' })).data.client.id
    globexId = (await admin.json('POST', '/api/admin/clients', { name: 'Globex' })).data.client.id
    assert.equal((await admin.json('POST', `/api/admin/clients/${acmeId}/users`, { email: 'jane@acme.com', name: 'Jane' })).status, 201)
    assert.equal((await admin.json('POST', `/api/admin/clients/${globexId}/users`, { email: 'sam@globex.com', name: 'Sam' })).status, 201)
    assert.equal((await jane.signIn('jane@acme.com')).status, 200)
    assert.equal((await sam.signIn('sam@globex.com')).status, 200)
  })

  it('requires sign-in', async () => {
    assert.equal((await new Client().json('GET', '/api/reports')).status, 401)
  })

  it('does not reveal unknown emails and gives no link', async () => {
    const r = await new Client().json('POST', '/api/auth/request', { email: 'nobody@nowhere.com' })
    assert.equal(r.status, 200)
    assert.equal(r.data.devLink, undefined)
  })

  it('magic links are single use', async () => {
    const c = new Client()
    const r = await c.json('POST', '/api/auth/request', { email: 'jane@acme.com' })
    const token = new URL(r.data.devLink).searchParams.get('token')
    assert.equal((await c.json('POST', '/api/auth/verify', { token })).status, 200)
    assert.equal((await new Client().json('POST', '/api/auth/verify', { token })).status, 400)
  })

  it('clients cannot use admin routes', async () => {
    assert.equal((await jane.json('GET', '/api/admin/clients')).status, 403)
    assert.equal((await jane.json('POST', '/api/admin/clients', { name: 'x' })).status, 403)
  })

  it('blocks cross-origin writes', async () => {
    const res = await jane.req('POST', '/api/reports', { title: 'x' }, { origin: 'https://evil.example' })
    assert.equal(res.status, 403)
  })

  it('hides a report until its video is uploaded', async () => {
    const created = await jane.json('POST', '/api/reports', { title: 'Save button does nothing', description: 'd', severity: 'High' })
    assert.equal(created.status, 201)
    reportId = created.data.report.id
    assert.match(reportId, /^BUG-\d{4}$/)
    assert.equal((await jane.json('GET', '/api/reports')).data.reports.length, 0)
    assert.equal((await admin.json('GET', '/api/reports')).data.reports.length, 0)
  })

  it('rejects bad uploads', async () => {
    assert.equal((await upload(jane, reportId, VIDEO, 'text/html')).status, 415)
    assert.equal((await upload(jane, reportId, new Uint8Array(2 * 1024 * 1024))).status, 413)
    assert.equal((await upload(sam, reportId)).status, 404)
  })

  it('stores the video and shows the report to both sides', async () => {
    assert.equal((await upload(jane, reportId)).status, 200)
    assert.equal((await upload(jane, reportId)).status, 409)
    const mine = (await jane.json('GET', '/api/reports')).data.reports
    assert.equal(mine.length, 1)
    assert.equal(mine[0].hasVideo, true)
    assert.equal(mine[0].history[0].text, 'Report submitted')
    assert.equal((await admin.json('GET', '/api/reports')).data.reports.length, 1)
  })

  it('streams the video with range support', async () => {
    const full = await jane.req('GET', `/api/reports/${reportId}/video`)
    assert.equal(full.status, 200)
    assert.deepEqual(new Uint8Array(await full.arrayBuffer()), VIDEO)
    const part = await jane.req('GET', `/api/reports/${reportId}/video`, undefined, { range: 'bytes=100-199' })
    assert.equal(part.status, 206)
    assert.equal(part.headers.get('content-range'), 'bytes 100-199/5000')
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), VIDEO.slice(100, 200))
    assert.equal((await jane.req('GET', `/api/reports/${reportId}/video`, undefined, { range: 'bytes=9000-' })).status, 416)
  })

  it('keeps clients isolated from each other', async () => {
    assert.equal((await sam.json('GET', `/api/reports/${reportId}`)).status, 404)
    assert.equal((await sam.req('GET', `/api/reports/${reportId}/video`)).status, 404)
    assert.equal((await sam.json('GET', '/api/reports')).data.reports.length, 0)
    assert.equal((await sam.json('POST', `/api/reports/${reportId}/comments`, { text: 'hi' })).status, 404)
  })

  it('never exposes internal notes to clients', async () => {
    const patched = await admin.json('PATCH', `/api/reports/${reportId}`, { notes: 'secret root cause', severity: 'Blocker' })
    assert.equal(patched.data.report.notes, 'secret root cause')
    const mine = (await jane.json('GET', `/api/reports/${reportId}`)).data.report
    assert.equal('notes' in mine, false)
    assert.equal(mine.severity, 'Blocker')
    assert.equal(JSON.stringify((await jane.json('GET', '/api/reports')).data).includes('secret'), false)
  })

  it('validates admin edits', async () => {
    assert.equal((await admin.json('PATCH', `/api/reports/${reportId}`, { resolutionUrl: 'javascript:alert(1)' })).status, 400)
    assert.equal((await admin.json('PATCH', `/api/reports/${reportId}`, { status: 'Nope' })).status, 400)
    assert.equal((await admin.json('PATCH', `/api/reports/${reportId}`, { title: '   ' })).status, 400)
    assert.equal((await jane.json('PATCH', `/api/reports/${reportId}`, { status: 'Resolved' })).status, 403)
  })

  it('runs the resolution workflow with history', async () => {
    assert.equal((await jane.json('POST', `/api/reports/${reportId}/confirm`, { fixed: true })).status, 409)
    await admin.json('PATCH', `/api/reports/${reportId}`, { status: 'In progress' })
    assert.equal((await admin.json('POST', `/api/reports/${reportId}/replies`, { text: 'Working on it' })).status, 200)
    await admin.json('PATCH', `/api/reports/${reportId}`, { status: 'Ready to verify', resolutionUrl: 'https://example.com/fix' })

    const broken = await jane.json('POST', `/api/reports/${reportId}/confirm`, { fixed: false, note: 'still fails' })
    assert.equal(broken.data.report.status, 'In progress')
    assert.equal(broken.data.report.resolvedAt, undefined)

    await admin.json('PATCH', `/api/reports/${reportId}`, { status: 'Ready to verify' })
    const fixed = await jane.json('POST', `/api/reports/${reportId}/confirm`, { fixed: true })
    assert.equal(fixed.data.report.status, 'Resolved')
    assert.ok(fixed.data.report.resolvedAt)

    const texts: string[] = fixed.data.report.history.map((h: Json) => h.text)
    assert.ok(texts.includes('Working on it'))
    assert.ok(texts.includes('Client confirmed the fix'))
    assert.ok(texts.some((t) => t.includes('still broken: still fails') || t.includes('still broken')))
  })

  it('lets clients comment and admins see it', async () => {
    const r = await jane.json('POST', `/api/reports/${reportId}/comments`, { text: 'Thanks!' })
    assert.equal(r.status, 200)
    const hist = (await admin.json('GET', `/api/reports/${reportId}`)).data.report.history
    assert.equal(hist.at(-1).text, 'Thanks!')
    assert.equal(hist.at(-1).by, 'client')
  })

  it('lets a client discard a failed draft but not a submitted report', async () => {
    const draft = (await jane.json('POST', '/api/reports', { title: 'draft' })).data.report.id
    assert.equal((await jane.json('DELETE', `/api/reports/${draft}`)).status, 200)
    assert.equal((await jane.json('DELETE', `/api/reports/${reportId}`)).status, 409)
  })

  it('logs out', async () => {
    assert.equal((await jane.json('POST', '/api/auth/logout')).status, 200)
    assert.equal((await jane.json('GET', '/api/reports')).status, 401)
  })
})
