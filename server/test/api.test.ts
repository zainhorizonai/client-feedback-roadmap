import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { before, describe, it } from 'node:test'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-test-'))
process.env.ADMIN_EMAILS = 'admin@test.com'
process.env.EMAIL_PROVIDER = 'console'
process.env.MAX_VIDEO_MB = '1'
process.env.DB_IN_MEMORY = '1'
process.env.CRON_SECRET = 'test-cron-secret'
delete process.env.DATABASE_URL
delete process.env.BLOB_READ_WRITE_TOKEN
process.env.APP_URL = 'http://localhost:5173'
delete process.env.NODE_ENV

const { app } = await import('../app.js')
const { ensureAdmins } = await import('../auth.js')
const { setStorageForTests, getStorage } = await import('../storage.js')
const { all, run } = await import('../db.js')
await ensureAdmins()

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

// ---------- Vercel Blob mode, with a fake driver standing in for the Blob service ----------

describe('Blob upload mode', () => {
  const admin = new Client()
  const jane = new Client()
  const sam = new Client()
  const store = new Map<string, { size: number; mime: string }>()
  const issued: { reportId: string; body: unknown }[] = []
  let original: ReturnType<typeof getStorage>
  let id = ''

  before(async () => {
    original = getStorage()
    setStorageForTests({
      mode: 'blob',
      uploadFlow: 'presigned',
      async clientUpload(_req, body, reportId) {
        issued.push({ reportId, body })
        return { type: 'blob.generate-client-token', clientToken: 'fake-token' }
      },
      async inspect(pathname) { return store.get(pathname) ?? null },
      async serve(pathname) {
        return new Response(null, { status: 302, headers: { Location: `https://blob.test/signed/${pathname}?sig=abc` } })
      },
    })
    await admin.signIn('admin@test.com')
    const clients = (await admin.json('GET', '/api/admin/clients')).data.clients as Json[]
    assert.ok(clients.length >= 2)
    await jane.signIn('jane@acme.com')
    await sam.signIn('sam@globex.com')
    const created = await jane.json('POST', '/api/reports', { title: 'Blob report' })
    assert.equal(created.data.upload.mode, 'blob')
    assert.equal(created.data.upload.flow, 'presigned')
    id = created.data.report.id
  })

  it('tells the browser to upload directly and refuses the server-upload route', async () => {
    assert.equal((await upload(jane, id)).status, 404)
  })

  it('issues upload tokens only to the owner of an unfinished report', async () => {
    const body = { type: 'blob.generate-client-token', payload: { pathname: `reports/${id}/video.webm` } }
    assert.equal((await new Client().json('POST', `/api/reports/${id}/blob-token`, body)).status, 401)
    assert.equal((await sam.json('POST', `/api/reports/${id}/blob-token`, body)).status, 404)
    assert.equal((await admin.json('POST', `/api/reports/${id}/blob-token`, body)).status, 403)
    const ok = await jane.json('POST', `/api/reports/${id}/blob-token`, body)
    assert.equal(ok.status, 200)
    assert.equal(ok.data.clientToken, 'fake-token')
    assert.equal(issued.at(-1)?.reportId, id)
  })

  it('refuses to complete an upload that does not exist or belongs elsewhere', async () => {
    assert.equal((await jane.json('POST', `/api/reports/${id}/video/complete`, { pathname: `reports/${id}/missing.webm` })).status, 400)
    store.set('reports/BUG-9999/video.webm', { size: 100, mime: 'video/webm' })
    assert.equal((await jane.json('POST', `/api/reports/${id}/video/complete`, { pathname: 'reports/BUG-9999/video.webm' })).status, 400)
    assert.equal((await jane.json('POST', `/api/reports/${id}/video/complete`, { pathname: `reports/${id}/../BUG-9999/video.webm` })).status, 400)
    assert.equal((await jane.json('POST', `/api/reports/${id}/video/complete`, {})).status, 400)
  })

  it('rejects wrong types and oversized files', async () => {
    store.set(`reports/${id}/a.webm`, { size: 100, mime: 'text/html' })
    assert.equal((await jane.json('POST', `/api/reports/${id}/video/complete`, { pathname: `reports/${id}/a.webm` })).status, 415)
    store.set(`reports/${id}/b.webm`, { size: 5 * 1024 * 1024, mime: 'video/webm' })
    assert.equal((await jane.json('POST', `/api/reports/${id}/video/complete`, { pathname: `reports/${id}/b.webm` })).status, 413)
    store.set(`reports/${id}/c.webm`, { size: 0, mime: 'video/webm' })
    assert.equal((await jane.json('POST', `/api/reports/${id}/video/complete`, { pathname: `reports/${id}/c.webm` })).status, 400)
  })

  it('completes once, hides drafts until then, and notifies', async () => {
    assert.equal((await jane.json('GET', '/api/reports')).data.reports.filter((r: Json) => r.id === id).length, 0)
    const path = `reports/${id}/video-xyz.webm`
    store.set(path, { size: 4096, mime: 'video/webm' })
    const done = await jane.json('POST', `/api/reports/${id}/video/complete`, { pathname: path })
    assert.equal(done.status, 200)
    assert.equal(done.data.report.hasVideo, true)
    assert.equal(done.data.report.history[0].text, 'Report submitted')
    assert.equal((await jane.json('POST', `/api/reports/${id}/video/complete`, { pathname: path })).status, 409)
    assert.equal((await admin.json('GET', '/api/reports')).data.reports.some((r: Json) => r.id === id), true)
  })

  it('redirects playback to a signed link, only for people allowed to see the report', async () => {
    const res = await jane.req('GET', `/api/reports/${id}/video`)
    assert.equal(res.status, 302)
    assert.match(res.headers.get('location') ?? '', /^https:\/\/blob\.test\/signed\/reports\//)
    assert.equal(res.headers.get('cache-control'), 'private, no-store')
    assert.equal((await admin.req('GET', `/api/reports/${id}/video`)).status, 302)
    assert.equal((await sam.req('GET', `/api/reports/${id}/video`)).status, 404)
    assert.equal((await new Client().req('GET', `/api/reports/${id}/video`)).status, 401)
  })

  it('restores the local driver afterwards', () => {
    setStorageForTests(original)
    assert.equal(getStorage().mode, 'server')
  })
})

describe('housekeeping and limits', () => {
  it('runs the cron job only with the secret', async () => {
    const c = new Client()
    assert.equal((await c.req('GET', '/api/cron/housekeeping')).status, 404)
    assert.equal((await c.req('GET', '/api/cron/housekeeping', undefined, { authorization: 'Bearer wrong' })).status, 404)
    assert.equal((await c.req('GET', '/api/cron/housekeeping', undefined, { authorization: 'Bearer test-cron-secret' })).status, 200)
  })

  it('removes stale drafts but keeps submitted reports', async () => {
    const jane = new Client()
    await jane.signIn('jane@acme.com')
    const draft = (await jane.json('POST', '/api/reports', { title: 'abandoned' })).data.report.id
    await run("UPDATE reports SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = $1", draft)
    const before = (await all('SELECT id FROM reports')).length
    await new Client().req('GET', '/api/cron/housekeeping', undefined, { authorization: 'Bearer test-cron-secret' })
    const after = await all<{ id: string }>('SELECT id FROM reports')
    assert.equal(after.length, before - 1)
    assert.equal(after.some((r) => r.id === draft), false)
  })

  it('rate limits sign-in requests per email across requests', async () => {
    const c = new Client()
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) statuses.push((await c.json('POST', '/api/auth/request', { email: 'sam@globex.com' })).status)
    assert.equal(statuses[0], 200)
    assert.equal(statuses.at(-1), 429)
  })

  it('numbers reports sequentially even when created at the same time', async () => {
    const c = new Client()
    await c.signIn('jane@acme.com')
    const made = await Promise.all(Array.from({ length: 5 }, (_, i) => c.json('POST', '/api/reports', { title: `parallel ${i}` })))
    const ids = made.map((m) => m.data.report?.id)
    assert.ok(ids.every(Boolean), JSON.stringify(made.map((m) => m.data)))
    assert.equal(new Set(ids).size, 5)
  })
})

describe('setup helpers', () => {
  it('finds database and blob variables even when Vercel adds a prefix', async () => {
    const { pickDatabaseUrl, pickBlobToken } = await import('../config.js')
    assert.equal(pickDatabaseUrl({ DATABASE_URL: 'a', STORAGE_DATABASE_URL: 'b' })?.value, 'a')
    assert.deepEqual(pickDatabaseUrl({ STORAGE_DATABASE_URL: 'b', STORAGE_POSTGRES_URL: 'c' }), { name: 'STORAGE_DATABASE_URL', value: 'b' })
    assert.deepEqual(pickDatabaseUrl({ POSTGRES_URL: 'p' }), { name: 'POSTGRES_URL', value: 'p' })
    assert.equal(pickDatabaseUrl({ STORAGE_DATABASE_URL_UNPOOLED: 'x' }), null)
    assert.deepEqual(pickBlobToken({ MY_BLOB_READ_WRITE_TOKEN: 't' }), { name: 'MY_BLOB_READ_WRITE_TOKEN', value: 't' })
    assert.equal(pickBlobToken({}), null)
  })

  it('serves the setup check only with the secret and never leaks it', async () => {
    const c = new Client()
    assert.equal((await c.req('GET', '/api/health/deep')).status, 404)
    assert.equal((await c.req('GET', '/api/health/deep?key=wrong')).status, 404)
    const ok = await c.json('GET', '/api/health/deep?key=test-cron-secret')
    assert.equal(ok.status, 200)
    assert.equal(ok.data.database, 'ok')
    assert.equal(ok.data.adminEmails, 1)
    assert.equal(JSON.stringify(ok.data).includes('test-cron-secret'), false)
  })
})

describe('SMTP email (Gmail)', () => {
  it('sends through the SMTP transport, and reports failure without throwing', async () => {
    const { config } = await import('../config.js')
    const { sendEmail, sendQuietly, setMailTransportForTests } = await import('../email.js')
    const sent: Json[] = []
    const prev = { provider: config.emailProvider, user: config.smtpUser }
    config.emailProvider = 'smtp'
    config.smtpUser = 'sender@gmail.com'
    try {
      setMailTransportForTests({ sendMail: async (m) => { sent.push(m); return {} } })
      await sendEmail({ to: ['a@x.com', 'b@x.com'], subject: 'Hello', text: 't', html: '<p>t</p>' })
      assert.equal(sent.length, 1)
      assert.deepEqual(sent[0].to, ['a@x.com', 'b@x.com'])
      assert.equal(sent[0].subject, 'Hello')
      assert.match(sent[0].from, /sender@gmail\.com/)

      assert.equal(await sendQuietly({ to: 'a@x.com', subject: 's', text: 't', html: 't' }), true)
      setMailTransportForTests({ sendMail: async () => { throw new Error('Invalid login') } })
      assert.equal(await sendQuietly({ to: 'a@x.com', subject: 's', text: 't', html: 't' }), false)
    } finally {
      setMailTransportForTests(null)
      config.emailProvider = prev.provider
      config.smtpUser = prev.user
    }
  })

  it('tells the admin when an invitation email could not be sent', async () => {
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    const admin = new Client()
    await admin.signIn('admin@test.com')
    const cl = (await admin.json('POST', '/api/admin/clients', { name: 'Mail test' })).data.client.id
    const prev = config.emailProvider
    config.emailProvider = 'smtp'
    config.smtpUser = 'sender@gmail.com'
    try {
      setMailTransportForTests({ sendMail: async () => { throw new Error('nope') } })
      const bad = await admin.json('POST', `/api/admin/clients/${cl}/users`, { email: 'fail@x.com', name: 'F' })
      assert.equal(bad.status, 201)
      assert.equal(bad.data.emailSent, false)
      setMailTransportForTests({ sendMail: async () => ({}) })
      const good = await admin.json('POST', `/api/admin/clients/${cl}/users`, { email: 'ok@x.com', name: 'O' })
      assert.equal(good.data.emailSent, true)
    } finally {
      setMailTransportForTests(null)
      config.emailProvider = prev
      config.smtpUser = ''
    }
  })
})

describe('email diagnostics', () => {
  it('records sends and failures and shows them in the setup check', async () => {
    const { config } = await import('../config.js')
    const { sendQuietly, setMailTransportForTests } = await import('../email.js')
    const prev = config.emailProvider
    config.emailProvider = 'smtp'
    config.smtpUser = 'sender@gmail.com'
    const c = new Client()
    try {
      setMailTransportForTests({ sendMail: async () => { throw new Error('535 Username and Password not accepted') } })
      await sendQuietly({ to: 'who@x.com', subject: 'Diag failure', text: 't', html: 't' })
      setMailTransportForTests({ sendMail: async () => ({}) })
      await sendQuietly({ to: 'who@x.com', subject: 'Diag success', text: 't', html: 't' })

      const r = await c.json('GET', '/api/health/deep?key=test-cron-secret')
      const rows = r.data.recentEmails as Json[]
      const fail = rows.find((e) => e.subject === 'Diag failure')
      const good = rows.find((e) => e.subject === 'Diag success')
      assert.equal(fail?.sent, false)
      assert.match(fail?.error, /535 Username and Password/)
      assert.equal(good?.sent, true)
    } finally {
      setMailTransportForTests(null)
      config.emailProvider = prev
      config.smtpUser = ''
    }
  })

  it('sends a test email on request, only to known people, and shows the real error', async () => {
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    const sent: Json[] = []
    const prev = config.emailProvider
    config.emailProvider = 'smtp'
    config.smtpUser = 'sender@gmail.com'
    const c = new Client()
    try {
      setMailTransportForTests({ sendMail: async (m) => { sent.push(m); return {} } })
      const ok = await c.json('GET', '/api/health/deep?key=test-cron-secret&sendTo=admin@test.com')
      assert.equal(ok.data.testEmail.sent, true)
      assert.equal(sent.length, 1)

      const stranger = await c.json('GET', '/api/health/deep?key=test-cron-secret&sendTo=stranger@evil.com')
      assert.equal(stranger.data.testEmail.sent, false)
      assert.equal(sent.length, 1, 'must not email unknown addresses')

      setMailTransportForTests({ sendMail: async () => { throw new Error('Connection timeout') } })
      const bad = await c.json('GET', '/api/health/deep?key=test-cron-secret&sendTo=admin@test.com')
      assert.equal(bad.data.testEmail.sent, false)
      assert.match(bad.data.testEmail.error, /Connection timeout/)

      assert.equal((await c.json('GET', '/api/health/deep?key=wrong&sendTo=admin@test.com')).status, 404)
    } finally {
      setMailTransportForTests(null)
      config.emailProvider = prev
      config.smtpUser = ''
    }
  })
})

describe('skipped sign-in requests are visible to the admin', () => {
  it('notes a request for an unknown address in the setup check, without telling the requester', async () => {
    const c = new Client()
    const r = await c.json('POST', '/api/auth/request', { email: 'typo-address@x.com' })
    assert.equal(r.status, 200)
    assert.equal(r.data.devLink, undefined)
    assert.equal(JSON.stringify(r.data).includes('no account'), false)
    const diag = await new Client().json('GET', '/api/health/deep?key=test-cron-secret')
    const note = (diag.data.recentEmails as Json[]).find((e) => e.to === 'typo-address@x.com')
    assert.equal(note?.sent, false)
    assert.match(note?.error, /no account for this address/)
  })
})

describe('optional video, item types and the roadmap', () => {
  const admin = new Client()
  const jane = new Client()
  const sam = new Client()
  let acme = ''
  let globex = ''
  const mails: Json[] = []

  before(async () => {
    await run('DELETE FROM rate_hits') // earlier tests used up the sign-in allowance
    await admin.signIn('admin@test.com')
    const clients = (await admin.json('GET', '/api/admin/clients')).data.clients as Json[]
    acme = clients.find((c) => c.name === 'Acme')!.id
    globex = clients.find((c) => c.name === 'Globex')!.id
    await jane.signIn('jane@acme.com')
    await sam.signIn('sam@globex.com')
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    config.emailProvider = 'smtp'
    config.smtpUser = 'sender@gmail.com'
    setMailTransportForTests({ sendMail: async (m) => { mails.push(m); return {} } })
  })

  it('submits a report without a video straight away', async () => {
    const r = await jane.json('POST', '/api/reports', { title: 'No video bug', description: 'text only', withVideo: false })
    assert.equal(r.status, 201)
    assert.equal(r.data.upload, undefined)
    assert.equal(r.data.report.hasVideo, false)
    assert.equal(r.data.report.kind, 'Bug')
    assert.equal(r.data.report.history[0].text, 'Report submitted')
    const mine = (await jane.json('GET', '/api/reports')).data.reports as Json[]
    assert.ok(mine.some((x) => x.id === r.data.report.id), 'visible to the client at once')
    assert.ok(((await admin.json('GET', '/api/reports')).data.reports as Json[]).some((x) => x.id === r.data.report.id), 'visible to the admin')
    assert.ok(mails.some((m) => /No video bug/.test(m.subject) && m.to.includes('admin@test.com')), 'admin emailed')
    assert.ok(mails.some((m) => /We received/.test(m.subject) && m.to.includes('jane@acme.com')), 'client got a receipt')
  })

  it('cannot attach a video to a report that was already submitted', async () => {
    const id = ((await jane.json('POST', '/api/reports', { title: 'Done already', withVideo: false })).data.report as Json).id
    assert.equal((await upload(jane, id)).status, 409)
    assert.equal((await jane.json('DELETE', `/api/reports/${id}`)).status, 409)
  })

  it('still hides reports whose video has not finished uploading', async () => {
    const created = await jane.json('POST', '/api/reports', { title: 'Waiting for video' })
    assert.ok(created.data.upload, 'video flow still returns upload info')
    const list = (await jane.json('GET', '/api/reports')).data.reports as Json[]
    assert.equal(list.some((x) => x.id === created.data.report.id), false)
  })

  it('puts feature requests on the roadmap as Under review, and bugs off it', async () => {
    const feat = await jane.json('POST', '/api/reports', { title: 'Dark mode', kind: 'Feature request', withVideo: false })
    assert.equal(feat.data.report.kind, 'Feature request')
    assert.equal(feat.data.report.roadmapStage, 'Under review')
    assert.match(feat.data.report.id, /^REQ-\d{4}$/)
    const q = await jane.json('POST', '/api/reports', { title: 'How?', kind: 'Question', withVideo: false })
    assert.match(q.data.report.id, /^Q-\d{4}$/)
    const uat = await jane.json('POST', '/api/reports', { title: 'Found', kind: 'UAT finding', withVideo: false })
    assert.match(uat.data.report.id, /^UAT-\d{4}$/)
    const nums = [feat, q, uat].map((x) => Number(x.data.report.id.split('-')[1]))
    assert.equal(new Set(nums).size, 3, 'numbers are unique across types')
    const bug = await jane.json('POST', '/api/reports', { title: 'A bug', withVideo: false })
    assert.equal(bug.data.report.roadmapStage, undefined)
    assert.equal((await jane.json('POST', '/api/reports', { title: 'x', kind: 'Rant', withVideo: false })).status, 400)
  })

  it('lets only admins move items on the roadmap, notifies the client, and logs it', async () => {
    const id = ((await jane.json('POST', '/api/reports', { title: 'Export to CSV', kind: 'Feature request', withVideo: false })).data.report as Json).id
    assert.equal((await jane.json('PATCH', `/api/reports/${id}`, { roadmapStage: 'Done' })).status, 403)
    assert.equal((await admin.json('PATCH', `/api/reports/${id}`, { roadmapStage: 'Someday' })).status, 400)
    mails.length = 0
    const moved = await admin.json('PATCH', `/api/reports/${id}`, { roadmapStage: 'Planned' })
    assert.equal(moved.data.report.roadmapStage, 'Planned')
    assert.ok(moved.data.report.history.some((h: Json) => /Under review to Planned/.test(h.text)))
    assert.ok(mails.some((m) => /Planned/.test(m.subject) && m.to.includes('jane@acme.com')))
    const off = await admin.json('PATCH', `/api/reports/${id}`, { roadmapStage: null })
    assert.equal(off.data.report.roadmapStage, undefined)
  })

  it('lets an admin add a roadmap item for a client, visible only to that client', async () => {
    mails.length = 0
    const made = await admin.json('POST', '/api/admin/items', { clientId: acme, title: 'Mobile app', description: 'Q2', roadmapStage: 'In progress' })
    assert.equal(made.status, 201)
    const id = made.data.report.id
    assert.equal(made.data.report.kind, 'Feature request')
    assert.equal(made.data.report.roadmapStage, 'In progress')
    assert.equal(made.data.report.hasVideo, false)
    assert.ok(((await jane.json('GET', '/api/reports')).data.reports as Json[]).some((x) => x.id === id))
    assert.equal(((await sam.json('GET', '/api/reports')).data.reports as Json[]).some((x) => x.id === id), false)
    assert.equal((await sam.json('GET', `/api/reports/${id}`)).status, 404)
    assert.ok(mails.some((m) => /Mobile app/.test(m.subject) && m.to.includes('jane@acme.com')), 'client users emailed, not the admin')
    assert.equal(mails.some((m) => m.to.includes('admin@test.com') && /Mobile app/.test(m.subject)), false)
  })

  it('refuses item creation by clients and for unknown clients', async () => {
    assert.equal((await jane.json('POST', '/api/admin/items', { clientId: acme, title: 'x' })).status, 403)
    assert.equal((await admin.json('POST', '/api/admin/items', { clientId: 'nope', title: 'x' })).status, 404)
    assert.equal((await admin.json('POST', '/api/admin/items', { clientId: globex, title: '' })).status, 400)
  })

  it('emails the client team when the admin replies on a team-created item', async () => {
    const id = ((await admin.json('POST', '/api/admin/items', { clientId: acme, title: 'Reports module' })).data.report as Json).id
    mails.length = 0
    await admin.json('POST', `/api/reports/${id}/replies`, { text: 'Scoping this now' })
    assert.ok(mails.some((m) => /New reply/.test(m.subject) && m.to.includes('jane@acme.com')))
    assert.equal(mails.some((m) => m.to.includes('admin@test.com')), false, 'never emails the admin about their own reply')
  })

  it('cleans up', async () => {
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    setMailTransportForTests(null)
    config.emailProvider = 'console'
    config.smtpUser = ''
  })
})
