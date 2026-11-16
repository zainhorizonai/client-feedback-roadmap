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
const { all, one, run } = await import('../db.js')
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
  /** First time for an address: set a password through the emailed link. After that: plain email and password. */
  async signIn(email: string) {
    const known = PASSWORDS.get(email)
    if (known) return this.json('POST', '/api/auth/login', { email, password: known })
    const f = await this.json('POST', '/api/auth/forgot', { email })
    assert.ok(f.data.devLink, 'expected a dev link for ' + email)
    const token = new URL(f.data.devLink).searchParams.get('token')
    const r = await this.json('POST', '/api/auth/reset', { token, password: TEST_PASSWORD })
    if (r.status === 200) PASSWORDS.set(email, TEST_PASSWORD)
    return r
  }
}

const TEST_PASSWORD = 'correct-horse-battery-9'
const PASSWORDS = new Map<string, string>()
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
    const r = await new Client().json('POST', '/api/auth/forgot', { email: 'nobody@nowhere.com' })
    assert.equal(r.status, 200)
    assert.equal(r.data.devLink, undefined)
  })

  it('has no magic-link sign-in any more', async () => {
    assert.equal((await new Client().json('POST', '/api/auth/request', { email: 'jane@acme.com' })).status, 404)
    assert.equal((await new Client().json('POST', '/api/auth/verify', { token: 'x' })).status, 404)
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
    assert.ok(texts.includes('Verified by client'))
    assert.ok(texts.some((t) => t.includes('Still broken: still fails')))
    assert.ok(fixed.data.report.history.some((h: Json) => h.kind === 'status' && h.from === 'Ready to verify' && h.to === 'Resolved'), 'transition stored with old and new value')
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

  it('rate limits password-reset emails per address', async () => {
    const c = new Client()
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await c.json('POST', '/api/auth/forgot', { email: 'sam@globex.com' })).status)
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

describe('skipped password requests are visible to the admin', () => {
  it('notes a request for an unknown address in the setup check, without telling the requester', async () => {
    const c = new Client()
    const r = await c.json('POST', '/api/auth/forgot', { email: 'typo-address@x.com' })
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
    assert.ok(mails.some((m) => /^New report from Acme · BUG-\d+/.test(m.subject) && m.to.includes('admin@test.com') && /No video bug/.test(m.text)), 'admin emailed')
    assert.ok(mails.some((m) => /^We received your report · BUG-\d+/.test(m.subject) && m.to.includes('jane@acme.com')), 'client got a receipt')
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

  it('gives each type its own id prefix, and sends features and questions (only) to the roadmap', async () => {
    const feat = await jane.json('POST', '/api/reports', { title: 'Dark mode', kind: 'Feature request', withVideo: false })
    assert.equal(feat.data.report.kind, 'Feature request')
    assert.match(feat.data.report.id, /^REQ-\d{4}$/)
    const q = await jane.json('POST', '/api/reports', { title: 'How?', kind: 'Question', withVideo: false })
    assert.match(q.data.report.id, /^Q-\d{4}$/)
    const uat = await jane.json('POST', '/api/reports', { title: 'Found', kind: 'UAT finding', withVideo: false })
    assert.match(uat.data.report.id, /^UAT-\d{4}$/)
    const nums = [feat, q, uat].map((x) => Number(x.data.report.id.split('-')[1]))
    assert.equal(new Set(nums).size, 3, 'numbers are unique across types')
    assert.equal((await jane.json('POST', '/api/reports', { title: 'x', kind: 'Rant', withVideo: false })).status, 400)
    const onBoard = ((await jane.json('GET', '/api/roadmap')).data.items as Json[])
    const has = (id: string) => onBoard.some((i) => (i.reportIds as string[]).includes(id))
    assert.ok(has(feat.data.report.id), 'a feature request is on the roadmap')
    assert.ok(has(q.data.report.id), 'a question is on the roadmap')
    assert.equal(has(uat.data.report.id), false, 'UAT findings stay in the fix list')
    assert.equal(onBoard.find((i) => (i.reportIds as string[]).includes(feat.data.report.id))?.state, 'Under review')
  })

  it('walks Needs client input, emailing the client, and skips email for Triaging', async () => {
    const id = ((await jane.json('POST', '/api/reports', { title: 'Needs info', withVideo: false })).data.report as Json).id
    mails.length = 0
    await admin.json('PATCH', `/api/reports/${id}`, { status: 'Triaging' })
    assert.equal(mails.length, 0, 'Triaging sends no default email')
    const r = await admin.json('PATCH', `/api/reports/${id}`, { status: 'Needs client input' })
    assert.equal(r.status, 200)
    assert.ok(mails.some((m) => m.subject === `${id} is Needs client input` && m.to.includes('jane@acme.com')))
    mails.length = 0
    await admin.json('PATCH', `/api/reports/${id}`, { status: 'Resolved' })
    assert.ok(mails.some((m) => m.subject === `${id} is Resolved`))
    const hist = ((await admin.json('GET', `/api/reports/${id}`)).data.report.history) as Json[]
    assert.ok(hist.some((h) => h.kind === 'outcome' && h.text === 'Closed by admin'))
    const reopened = await admin.json('PATCH', `/api/reports/${id}`, { status: 'In progress' })
    assert.equal(reopened.data.report.resolvedAt, undefined, 'reopening clears the resolved date')
    assert.ok(reopened.data.report.history.some((h: Json) => h.text === 'Closed by admin'), 'earlier closure stays in history')
  })

  it('manages roadmap items as admin only, and publishing is always explicit', async () => {
    assert.equal((await jane.json('POST', '/api/admin/roadmap', { clientId: acme, title: 'x' })).status, 403)
    assert.equal((await admin.json('POST', '/api/admin/roadmap', { clientId: 'nope', title: 'x' })).status, 404)
    assert.equal((await admin.json('POST', '/api/admin/roadmap', { clientId: acme, title: '' })).status, 400)
    assert.equal((await admin.json('POST', '/api/admin/roadmap', { clientId: acme, title: 'x', state: 'Someday' })).status, 400)
    const made = await admin.json('POST', '/api/admin/roadmap', { clientId: acme, title: 'Checkout reliability', description: 'Public text', state: 'In progress', targetWindow: 'Q1' })
    assert.equal(made.status, 201)
    assert.match(made.data.item.id, /^RM-\d{4}$/)
    assert.equal(made.data.item.published, false, 'not published unless asked')
    assert.equal(((await jane.json('GET', '/api/roadmap')).data.items as Json[]).some((i) => i.id === made.data.item.id), false, 'hidden from the client until published')
    assert.equal((await jane.json('GET', '/api/roadmap')).status, 200)
  })

  it('shows clients only published items from their own project, with no private detail', async () => {
    const a = (await admin.json('POST', '/api/admin/roadmap', { clientId: acme, title: 'Acme public', description: 'for Acme', state: 'Planned', published: true, clientUpdate: 'Starting soon' })).data.item
    const g = (await admin.json('POST', '/api/admin/roadmap', { clientId: globex, title: 'Globex public', state: 'Planned', published: true })).data.item
    const mine = (await jane.json('GET', '/api/roadmap')).data.items as Json[]
    assert.ok(mine.some((i) => i.id === a.id))
    assert.equal(mine.some((i) => i.id === g.id), false, 'never another project')
    const item = mine.find((i) => i.id === a.id)!
    assert.equal(item.clientUpdate, 'Starting soon')
    for (const hidden of ['reports', 'published', 'clientName', 'reporterEmail', 'notes']) assert.equal(hidden in item, false, `${hidden} must not reach clients`)
    assert.equal((await sam.json('GET', '/api/roadmap')).data.items.some((i: Json) => i.id === a.id), false)
    // Admins see everything and can filter by project.
    const all = (await admin.json('GET', '/api/roadmap')).data.items as Json[]
    assert.ok(all.some((i) => i.id === a.id) && all.some((i) => i.id === g.id))
    const onlyGlobex = (await admin.json('GET', `/api/roadmap?clientId=${globex}`)).data.items as Json[]
    assert.ok(onlyGlobex.every((i) => i.clientId === globex))
  })

  it('links reports to an item without exposing them, and moving the item never changes a report', async () => {
    const r1 = ((await jane.json('POST', '/api/reports', { title: 'Checkout A', withVideo: false })).data.report as Json).id
    const r2 = ((await jane.json('POST', '/api/reports', { title: 'Checkout B', withVideo: false })).data.report as Json).id
    const other = ((await sam.json('POST', '/api/reports', { title: 'Globex bug', withVideo: false })).data.report as Json).id
    const item = (await admin.json('POST', '/api/admin/roadmap', { clientId: acme, title: 'Checkout work', state: 'Planned', published: true, reportIds: [r1, r2] })).data.item
    assert.deepEqual((item.reports as Json[]).map((x) => x.id).sort(), [r1, r2].sort())

    assert.equal((await admin.json('PATCH', `/api/admin/roadmap/${item.id}`, { reportIds: [other] })).status, 400, 'cannot link another project\'s report')
    assert.equal((await admin.json('PATCH', `/api/admin/roadmap/${item.id}`, { reportIds: ['BUG-0001"; DROP'] })).status, 400)

    const seen = ((await jane.json('GET', '/api/roadmap')).data.items as Json[]).find((i) => i.id === item.id)!
    assert.equal(seen.linkedCount, 2)
    assert.equal('reports' in seen, false)

    await admin.json('PATCH', `/api/admin/roadmap/${item.id}`, { state: 'Done' })
    const rep = (await admin.json('GET', `/api/reports/${r1}`)).data.report
    assert.equal(rep.status, 'New', 'Done on the item does not resolve its reports')
    assert.deepEqual((rep.roadmapItems as Json[]).map((x) => x.id), [item.id], 'drawer shows related roadmap work to admins')
    const clientView = (await jane.json('GET', `/api/reports/${r1}`)).data.report
    assert.equal('roadmapItems' in clientView, false, 'clients never see roadmap links on a report')

    // Updating, unlinking, unpublishing and deleting
    const upd = await admin.json('PATCH', `/api/admin/roadmap/${item.id}`, { reportIds: [r1], published: false, targetWindow: 'Q2', clientUpdate: 'Shipped' })
    assert.equal(upd.data.item.reports.length, 1)
    assert.equal(((await jane.json('GET', '/api/roadmap')).data.items as Json[]).some((i) => i.id === item.id), false, 'unpublished again')
    assert.equal((await jane.json('PATCH', `/api/admin/roadmap/${item.id}`, { state: 'Done' })).status, 403)
    assert.equal((await admin.json('DELETE', `/api/admin/roadmap/${item.id}`)).status, 200)
    assert.equal((await admin.json('GET', `/api/reports/${r1}`)).status, 200, 'deleting an item leaves its reports')
  })

  it('does not email anyone when roadmap items change', async () => {
    mails.length = 0
    const it = (await admin.json('POST', '/api/admin/roadmap', { clientId: acme, title: 'Quiet change', published: true })).data.item
    await admin.json('PATCH', `/api/admin/roadmap/${it.id}`, { state: 'Done', clientUpdate: 'x' })
    assert.equal(mails.length, 0, 'only followers are emailed, and following is not built')
  })

  it('cleans up', async () => {
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    setMailTransportForTests(null)
    config.emailProvider = 'console'
    config.smtpUser = ''
  })
})

describe('upgrade from the earlier roadmap model', () => {
  it('turns old report roadmap stages into published, linked roadmap items exactly once', async () => {
    const { migrateLegacyRoadmap, all, one, run, batch } = await import('../db.js')
    const driver = {
      query: async (t: string, p: (string | number | null)[]) => (await all(t, ...p)) as Record<string, unknown>[],
      batch: async (b: [string, (string | null)[]][]) => batch(b),
    }
    const admin = new Client()
    await admin.signIn('admin@test.com')
    const client = (await one<{ id: string }>("SELECT id FROM clients WHERE name = 'Acme'"))!.id
    const jane = (await one<{ id: string }>("SELECT id FROM users WHERE email = 'jane@acme.com'"))!.id
    await run(
      `INSERT INTO reports (id, seq, created_at, client_id, reporter_id, title, description, kind, roadmap_stage, submitted_at)
       VALUES ('REQ-9001', 9001, '2026-01-01T00:00:00.000Z', $1, $2, 'Legacy request', 'old text', 'Feature request', 'Planned', '2026-01-01T00:00:00.000Z')`,
      client, jane,
    )
    await migrateLegacyRoadmap(driver)
    const item = await one<{ id: string; state: string; published: number; title: string }>(
      "SELECT i.* FROM roadmap_items i JOIN roadmap_links l ON l.item_id = i.id WHERE l.report_id = 'REQ-9001'",
    )
    assert.equal(item?.title, 'Legacy request')
    assert.equal(item?.state, 'Planned')
    assert.equal(item?.published, 1, 'clients could already see it, so it stays visible')
    assert.equal((await one<{ roadmap_stage: string | null }>("SELECT roadmap_stage FROM reports WHERE id = 'REQ-9001'"))?.roadmap_stage, null)

    const before = (await all('SELECT id FROM roadmap_items')).length
    await migrateLegacyRoadmap(driver)
    assert.equal((await all('SELECT id FROM roadmap_items')).length, before, 'running again changes nothing')
  })
})

describe('several projects, approvals and client moves', () => {
  const admin = new Client()
  const jane = new Client()
  const sam = new Client()
  let acme = ''
  let globex = ''
  let third = ''

  before(async () => {
    await run('DELETE FROM rate_hits')
    await admin.signIn('admin@test.com')
    const clients = (await admin.json('GET', '/api/admin/clients')).data.clients as Json[]
    acme = clients.find((c) => c.name === 'Acme')!.id
    globex = clients.find((c) => c.name === 'Globex')!.id
    third = (await admin.json('POST', '/api/admin/clients', { name: 'Third' })).data.client.id
    await jane.signIn('jane@acme.com')
    await sam.signIn('sam@globex.com')
  })

  it('adds an existing client to a second project and keeps one sign-in', async () => {
    assert.equal(((await jane.json('GET', '/api/me')).data.user.projects as Json[]).length, 1)
    const r = await admin.json('POST', `/api/admin/clients/${globex}/users`, { email: 'jane@acme.com', name: 'ignored' })
    assert.equal(r.status, 201)
    assert.equal(r.data.addedToExisting, true)
    assert.equal(r.data.user.name, 'Jane', 'keeps her own name')
    const me = (await jane.json('GET', '/api/me')).data.user
    assert.deepEqual((me.projects as Json[]).map((p) => p.name).sort(), ['Acme', 'Globex'])
    assert.equal((await admin.json('POST', `/api/admin/clients/${globex}/users`, { email: 'jane@acme.com', name: 'x' })).status, 409, 'cannot add twice')
    assert.equal((await admin.json('POST', `/api/admin/clients/${acme}/users`, { email: 'admin@test.com', name: 'x' })).status, 409, 'cannot add a team member')
    const listed = ((await admin.json('GET', '/api/admin/clients')).data.clients as Json[]).find((c) => c.id === globex)!
    assert.ok((listed.users as Json[]).some((u) => u.email === 'jane@acme.com'))
  })

  it('makes her choose a project when she has several, and only one of hers', async () => {
    assert.equal((await jane.json('POST', '/api/reports', { title: 'Which one?', withVideo: false })).status, 400)
    assert.equal((await jane.json('POST', '/api/reports', { title: 'Not mine', clientId: third, withVideo: false })).status, 400)
    const ok = await jane.json('POST', '/api/reports', { title: 'For Globex', clientId: globex, withVideo: false })
    assert.equal(ok.status, 201)
    assert.equal(ok.data.report.clientId, globex)
    const inAcme = await jane.json('POST', '/api/reports', { title: 'For Acme', clientId: acme, withVideo: false })
    assert.equal(inAcme.data.report.clientId, acme)
  })

  it('shows her both projects and keeps every other client out', async () => {
    const mine = ((await jane.json('GET', '/api/reports')).data.reports as Json[])
    assert.ok(mine.some((r) => r.clientId === acme) && mine.some((r) => r.clientId === globex))
    const globexReport = mine.find((r) => r.clientId === globex)!.id
    assert.equal((await jane.json('GET', `/api/reports/${globexReport}`)).status, 200)
    // sam is only in Globex: he sees Globex, never Acme
    const sams = ((await sam.json('GET', '/api/reports')).data.reports as Json[])
    assert.ok(sams.every((r) => r.clientId === globex))
    const acmeReport = mine.find((r) => r.clientId === acme)!.id
    assert.equal((await sam.json('GET', `/api/reports/${acmeReport}`)).status, 404)
    // and nobody sees a project they are not in
    const third1 = ((await admin.json('POST', '/api/admin/roadmap', { clientId: third, title: 'Secret', published: true })).data.item)
    assert.equal(((await jane.json('GET', '/api/roadmap')).data.items as Json[]).some((i) => i.id === third1.id), false)
    assert.equal((await jane.json('PATCH', `/api/roadmap/${third1.id}`, { state: 'Done' })).status, 404)
  })

  it('lets a client move cards on their own roadmap, records it, and tells the team', async () => {
    const mails: Json[] = []
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    config.emailProvider = 'smtp'; config.smtpUser = 'sender@gmail.com'
    setMailTransportForTests({ sendMail: async (m) => { mails.push(m); return {} } })
    try {
      const rep = (await jane.json('POST', '/api/reports', { title: 'Offline mode', kind: 'Feature request', clientId: acme, withVideo: false })).data.report
      const item = ((await jane.json('GET', '/api/roadmap')).data.items as Json[]).find((i) => (i.reportIds as string[]).includes(rep.id))!
      mails.length = 0
      const moved = await jane.json('PATCH', `/api/roadmap/${item.id}`, { state: 'Planned' })
      assert.equal(moved.status, 200)
      assert.equal(moved.data.item.state, 'Planned')
      assert.equal(moved.data.item.lastMove.by, 'client')
      assert.match(moved.data.item.lastMove.text, /Under review to Planned/)
      assert.ok(mails.some((m) => /moved "Offline mode" to Planned/.test(m.subject) && m.to.includes('admin@test.com')), 'admin emailed')
      mails.length = 0
      await jane.json('PATCH', `/api/roadmap/${item.id}`, { state: 'Planned' })
      assert.equal(mails.length, 0, 'moving to the same stage changes nothing')

      assert.equal((await jane.json('PATCH', `/api/roadmap/${item.id}`, { state: 'Someday' })).status, 400)
      assert.equal((await sam.json('PATCH', `/api/roadmap/${item.id}`, { state: 'Done' })).status, 404, 'another project cannot')
      assert.equal((await admin.json('PATCH', `/api/roadmap/${item.id}`, { state: 'Done' })).status, 403, 'admins use their own route')
      const seen = ((await admin.json('GET', '/api/roadmap')).data.items as Json[]).find((i) => i.id === item.id)!
      assert.equal(seen.lastMove.by, 'client')

      // and when the team moves it, that is recorded as the team
      const byAdmin = await admin.json('PATCH', `/api/admin/roadmap/${item.id}`, { state: 'In progress' })
      assert.equal(byAdmin.data.item.lastMove.by, 'admin')
    } finally {
      setMailTransportForTests(null); config.emailProvider = 'console'; config.smtpUser = ''
    }
  })

  it('lets a client approve any item as done', async () => {
    const bug = (await jane.json('POST', '/api/reports', { title: 'Approve me', clientId: acme, withVideo: false })).data.report.id
    // not waiting for verification: closed by the client
    const closed = await jane.json('POST', `/api/reports/${bug}/approve`, { note: 'No longer needed' })
    assert.equal(closed.status, 200)
    assert.equal(closed.data.report.status, 'Resolved')
    assert.ok(closed.data.report.resolvedAt)
    assert.ok(closed.data.report.history.some((h: Json) => h.kind === 'outcome' && h.text === 'Closed by client: No longer needed'))
    assert.ok(closed.data.report.history.some((h: Json) => h.kind === 'status' && h.to === 'Resolved'))
    assert.equal((await jane.json('POST', `/api/reports/${bug}/approve`, {})).status, 409, 'already done')

    // waiting for verification: verified by the client
    const fix = (await jane.json('POST', '/api/reports', { title: 'Verify me', clientId: acme, withVideo: false })).data.report.id
    await admin.json('PATCH', `/api/reports/${fix}`, { status: 'Ready to verify' })
    const verified = await jane.json('POST', `/api/reports/${fix}/approve`, {})
    assert.ok(verified.data.report.history.some((h: Json) => h.text === 'Verified by client'))

    assert.equal((await sam.json('POST', `/api/reports/${fix}/approve`, {})).status, 404, 'another project cannot approve it')
    assert.equal((await admin.json('POST', `/api/reports/${fix}/approve`, {})).status, 403, 'only clients approve')
  })

  it('finishes a feature request\'s roadmap card when its client approves it, but not a shared card', async () => {
    const solo = (await jane.json('POST', '/api/reports', { title: 'Solo feature', kind: 'Feature request', clientId: acme, withVideo: false })).data.report
    const soloItem = ((await jane.json('GET', '/api/roadmap')).data.items as Json[]).find((i) => (i.reportIds as string[]).includes(solo.id))!
    await jane.json('POST', `/api/reports/${solo.id}/approve`, {})
    const after = ((await jane.json('GET', '/api/roadmap')).data.items as Json[]).find((i) => i.id === soloItem.id)!
    assert.equal(after.state, 'Done')
    assert.match(after.lastMove.text, /approved by the client/)

    const a = (await jane.json('POST', '/api/reports', { title: 'Shared A', kind: 'Feature request', clientId: acme, withVideo: false })).data.report.id
    const b = (await jane.json('POST', '/api/reports', { title: 'Shared B', kind: 'Feature request', clientId: acme, withVideo: false })).data.report.id
    const shared = (await admin.json('POST', '/api/admin/roadmap', { clientId: acme, title: 'Shared work', state: 'In progress', published: true, reportIds: [a, b] })).data.item
    await jane.json('POST', `/api/reports/${a}/approve`, {})
    const kept = ((await jane.json('GET', '/api/roadmap')).data.items as Json[]).find((i) => i.id === shared.id)!
    assert.equal(kept.state, 'In progress', 'a card covering several requests stays put')
  })

  it('puts a feature request on the roadmap only once its video has uploaded', async () => {
    const created = await jane.json('POST', '/api/reports', { title: 'Feature with video', kind: 'Feature request', clientId: acme })
    const id = created.data.report.id
    const before = ((await jane.json('GET', '/api/roadmap')).data.items as Json[]).some((i) => (i.reportIds as string[]).includes(id))
    assert.equal(before, false, 'not before the upload finishes')
    assert.equal((await upload(jane, id)).status, 200)
    assert.equal(((await jane.json('GET', '/api/roadmap')).data.items as Json[]).some((i) => (i.reportIds as string[]).includes(id)), true)
  })
})

describe('older requests reach the roadmap once', () => {
  it('backfills existing feature requests and does not bring back a deleted card', async () => {
    const { backfillRoadmapForRequests, all, one, run, batch } = await import('../db.js')
    const driver = {
      query: async (t: string, p: (string | number | null)[]) => (await all(t, ...p)) as Record<string, unknown>[],
      batch: async (b: [string, (string | null)[]][]) => batch(b),
    }
    const client = (await one<{ id: string }>("SELECT id FROM clients WHERE name = 'Acme'"))!.id
    const jane = (await one<{ id: string }>("SELECT id FROM users WHERE email = 'jane@acme.com'"))!.id
    await run(
      `INSERT INTO reports (id, seq, created_at, client_id, reporter_id, title, description, kind, submitted_at)
       VALUES ('REQ-9100', 9100, '2026-02-01T00:00:00.000Z', $1, $2, 'Old request', 'from before', 'Feature request', '2026-02-01T00:00:00.000Z')`,
      client, jane,
    )
    await backfillRoadmapForRequests(driver)
    const item = await one<{ id: string; state: string; published: number }>("SELECT i.* FROM roadmap_items i JOIN roadmap_links l ON l.item_id = i.id WHERE l.report_id = 'REQ-9100'")
    assert.equal(item?.state, 'Under review')
    assert.equal(item?.published, 1)
    assert.equal((await one<{ roadmap_auto: number }>("SELECT roadmap_auto FROM reports WHERE id = 'REQ-9100'"))?.roadmap_auto, 1)

    const count = (await all("SELECT id FROM roadmap_items")).length
    await backfillRoadmapForRequests(driver)
    assert.equal((await all("SELECT id FROM roadmap_items")).length, count, 'running again adds nothing')

    await run('DELETE FROM roadmap_items WHERE id = $1', item!.id)
    await backfillRoadmapForRequests(driver)
    assert.equal((await all("SELECT l.item_id FROM roadmap_links l WHERE l.report_id = 'REQ-9100'")).length, 0, 'a deleted card stays deleted')
  })
})

describe('email and password accounts', () => {
  const admin = new Client()
  let acme = ''
  const mails: Json[] = []
  /** The newest set-password link sent to an address, read from the captured email like a person would. */
  const mailToken = (email: string) => {
    const m = [...mails].reverse().find((x) => x.to.includes(email) && /set-password\?token=/.test(x.text))
    assert.ok(m, 'expected a password email for ' + email)
    return /token=([^&\s]+)/.exec(m.text)![1]
  }

  before(async () => {
    await run('DELETE FROM rate_hits')
    await admin.signIn('admin@test.com')
    const clients = (await admin.json('GET', '/api/admin/clients')).data.clients as Json[]
    acme = clients.find((c) => c.name === 'Acme')!.id
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    config.emailProvider = 'smtp'
    config.smtpUser = 'sender@gmail.com'
    setMailTransportForTests({ sendMail: async (m) => { mails.push(m); return {} } })
  })

  const invite = async (email: string) => (await admin.json('POST', `/api/admin/clients/${acme}/users`, { email, name: 'New Person' })).data

  it('invites someone with a set-password link, not a sign-in link', async () => {
    mails.length = 0
    const r = await invite('newbie@acme.com')
    assert.equal(r.emailSent, true)
    const mail = mails.find((m) => m.to.includes('newbie@acme.com'))!
    assert.equal(mail.subject, 'Set your SEAM password')
    assert.match(mail.text, /\/auth\/set-password\?token=/)
    assert.match(mail.text, /invited to Acme/)
    const row = await one<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE email = 'newbie@acme.com'")
    assert.equal(row?.password_hash, null, 'no password until they choose one')
  })

  it('cannot sign in before a password exists, and does not say why', async () => {
    const c = new Client()
    const none = await c.json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: 'whatever-password-1' })
    assert.equal(none.status, 401)
    assert.equal(none.data.error, 'Email or password is incorrect.')
    const unknown = await c.json('POST', '/api/auth/login', { email: 'ghost@acme.com', password: 'whatever-password-1' })
    assert.equal(unknown.status, 401)
    assert.equal(unknown.data.error, none.data.error, 'the same message for an unknown address')
    assert.equal(c.cookie, '', 'no session cookie')
  })

  it('checks a link without using it, then sets the password once and signs in', async () => {
    const c = new Client()
    await c.json('POST', '/api/auth/forgot', { email: 'newbie@acme.com' })
    const token = mailToken('newbie@acme.com')
    const info = await c.json('POST', '/api/auth/reset/check', { token })
    assert.equal(info.status, 200)
    assert.equal(info.data.purpose, 'invite')
    assert.equal(info.data.email, 'newbie@acme.com')
    assert.equal((await c.json('POST', '/api/auth/reset/check', { token })).status, 200, 'checking does not spend it')

    assert.equal((await c.json('POST', '/api/auth/reset', { token, password: 'short' })).status, 400)
    assert.equal((await c.json('POST', '/api/auth/reset', { token, password: 'password1234' })).data.error, 'That password is too common. Choose something harder to guess.')
    assert.equal((await c.json('POST', '/api/auth/reset', { token, password: 'newbie-is-my-name-1' })).status, 400, 'rejects a password containing the email name')
    assert.equal((await c.json('POST', '/api/auth/reset', { token, password: 'a-much-better-passphrase' })).status, 200)
    assert.ok(c.cookie.includes('sid='), 'signed in straight away')
    assert.equal((await c.json('GET', '/api/me')).data.user.email, 'newbie@acme.com')
    assert.equal((await new Client().json('POST', '/api/auth/reset', { token, password: 'another-good-passphrase' })).status, 400, 'a link works once')
    assert.equal((await new Client().json('POST', '/api/auth/reset/check', { token })).status, 400)
  })

  it('stores only a salted hash, never the password', async () => {
    const row = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'newbie@acme.com'")
    assert.match(row!.password_hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    assert.equal(row!.password_hash.includes('a-much-better-passphrase'), false)
    const other = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'jane@acme.com'")
    assert.notEqual(row!.password_hash, other!.password_hash)
  })

  it('signs in with email and password, ignoring email case', async () => {
    const c = new Client()
    assert.equal((await c.json('POST', '/api/auth/login', { email: 'NewBie@Acme.com', password: 'a-much-better-passphrase' })).status, 200)
    assert.equal((await c.json('GET', '/api/reports')).status, 200)
    assert.equal((await new Client().json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: 'a-much-better-passphrasE' })).status, 401, 'case-sensitive password')
    assert.equal((await new Client().json('POST', '/api/auth/login', { email: 'newbie@acme.com' })).status, 400)
  })

  it('locks sign-in after repeated wrong passwords, even for the right one', async () => {
    await invite('lockme@acme.com')
    await new Client().json('POST', '/api/auth/forgot', { email: 'lockme@acme.com' })
    await new Client().json('POST', '/api/auth/reset', { token: mailToken('lockme@acme.com'), password: 'lock-me-passphrase-1' })
    const c = new Client()
    for (let i = 0; i < 8; i++) assert.equal((await c.json('POST', '/api/auth/login', { email: 'lockme@acme.com', password: 'wrong-' + i + '-password' })).status, 401)
    const locked = await c.json('POST', '/api/auth/login', { email: 'lockme@acme.com', password: 'lock-me-passphrase-1' })
    assert.equal(locked.status, 429)
    assert.equal((await new Client().json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: 'a-much-better-passphrase' })).status, 200, 'other people are not affected')
  })

  it('resets a forgotten password: old password stops, other sessions end', async () => {
    const phone = new Client()
    await phone.json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: 'a-much-better-passphrase' })
    assert.equal((await phone.json('GET', '/api/me')).data.user.email, 'newbie@acme.com')

    const c = new Client()
    await c.json('POST', '/api/auth/forgot', { email: 'newbie@acme.com' })
    const token = mailToken('newbie@acme.com')
    assert.equal((await c.json('POST', '/api/auth/reset/check', { token })).data.purpose, 'reset', 'a person with a password gets a reset, not an invitation')
    mails.length = 0
    assert.equal((await c.json('POST', '/api/auth/reset', { token, password: 'second-passphrase-here' })).status, 200)
    assert.equal((await phone.json('GET', '/api/me')).data.user, null, 'the other device is signed out')
    assert.equal((await new Client().json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: 'a-much-better-passphrase' })).status, 401, 'old password no longer works')
    assert.equal((await new Client().json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: 'second-passphrase-here' })).status, 200)
    assert.ok(mails.some((m) => m.subject === 'Your SEAM password was changed' && m.to.includes('newbie@acme.com')), 'told about the change')
    PASSWORDS.set('newbie@acme.com', 'second-passphrase-here')
  })

  it('a newer link replaces an older one', async () => {
    const c = new Client()
    await c.json('POST', '/api/auth/forgot', { email: 'jane@acme.com' })
    const first = mailToken('jane@acme.com')
    await c.json('POST', '/api/auth/forgot', { email: 'jane@acme.com' })
    const second = mailToken('jane@acme.com')
    assert.equal((await c.json('POST', '/api/auth/reset/check', { token: first })).status, 400)
    assert.equal((await c.json('POST', '/api/auth/reset/check', { token: second })).status, 200)
    await c.json('POST', '/api/auth/reset', { token: second, password: TEST_PASSWORD }) // keep Jane's test password
  })

  it('changes a password when signed in, and ends the other sessions', async () => {
    const here = new Client()
    const there = new Client()
    const pw = 'second-passphrase-here'
    await here.json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: pw })
    await there.json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: pw })

    assert.equal((await new Client().json('POST', '/api/auth/password', { current: pw, next: 'a-third-passphrase-1' })).status, 401, 'must be signed in')
    assert.equal((await here.json('POST', '/api/auth/password', { current: 'wrong-current-pw-1', next: 'a-third-passphrase-1' })).status, 400)
    assert.equal((await here.json('POST', '/api/auth/password', { current: pw, next: 'short' })).status, 400)
    assert.equal((await here.json('POST', '/api/auth/password', { current: pw, next: pw })).status, 400, 'not the same one')
    assert.equal((await here.json('POST', '/api/auth/password', { current: pw, next: 'a-third-passphrase-1' })).status, 200)

    assert.equal((await here.json('GET', '/api/me')).data.user.email, 'newbie@acme.com', 'this device stays signed in')
    assert.equal((await there.json('GET', '/api/me')).data.user, null, 'the other device is signed out')
    assert.equal((await new Client().json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: pw })).status, 401)
    assert.equal((await new Client().json('POST', '/api/auth/login', { email: 'newbie@acme.com', password: 'a-third-passphrase-1' })).status, 200)
  })

  it('lets an admin send a password link, and shows who has set one', async () => {
    const jane = new Client()
    await jane.signIn('jane@acme.com')
    const list = ((await admin.json('GET', '/api/admin/clients')).data.clients as Json[]).find((c) => c.id === acme)!.users as Json[]
    const fresh = list.find((u) => u.email === 'lockme@acme.com')!
    assert.equal(fresh.hasPassword, true)
    await run("INSERT INTO users (id, email, name, role, client_id, created_at) VALUES ('u-nopass', 'nopass@acme.com', 'No Pass', 'client', $1, '2026-01-01T00:00:00.000Z')", acme)
    await run("INSERT INTO memberships (user_id, client_id) VALUES ('u-nopass', $1)", acme)
    const after = ((await admin.json('GET', '/api/admin/clients')).data.clients as Json[]).find((c) => c.id === acme)!.users as Json[]
    assert.equal(after.find((u) => u.email === 'nopass@acme.com')!.hasPassword, false)

    mails.length = 0
    const sent = await admin.json('POST', '/api/admin/users/u-nopass/password-link')
    assert.equal(sent.data.emailSent, true)
    assert.equal(sent.data.hadPassword, false)
    assert.ok(mails.some((m) => m.subject === 'Set your SEAM password' && m.to.includes('nopass@acme.com')))
    assert.equal((await jane.json('POST', '/api/admin/users/u-nopass/password-link')).status, 403)
    assert.equal((await admin.json('POST', '/api/admin/users/nobody/password-link')).status, 404)
  })

  it('applies one set of password rules', async () => {
    const { passwordProblem } = await import('../auth.js')
    assert.equal(passwordProblem('long-enough-passphrase', 'a@b.com'), null)
    assert.match(passwordProblem('short', 'a@b.com')!, /at least 10/)
    assert.match(passwordProblem('x'.repeat(129), 'a@b.com')!, /128/)
    assert.match(passwordProblem('aaaaaaaaaaaa', 'a@b.com')!, /repeated/)
    assert.match(passwordProblem('Password123', 'a@b.com') ?? 'ok', /ok|common/) // 11 chars; fine or common
    assert.match(passwordProblem('zainreza-1998-x', 'zainreza@gmail.com')!, /email name/)
    assert.equal(passwordProblem('ab-1234567-cd', 'ab@x.com'), null, 'short email names are not matched')
  })

  it('cleans up', async () => {
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    setMailTransportForTests(null)
    config.emailProvider = 'console'
    config.smtpUser = ''
  })
})

describe('reopening and editing a ticket', () => {
  const admin = new Client()
  const jane = new Client()
  const sam = new Client()
  let acme = ''
  const mails: Json[] = []

  before(async () => {
    await run('DELETE FROM rate_hits')
    await admin.signIn('admin@test.com')
    acme = ((await admin.json('GET', '/api/admin/clients')).data.clients as Json[]).find((c) => c.name === 'Acme')!.id
    await jane.signIn('jane@acme.com')
    await sam.signIn('sam@globex.com')
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    config.emailProvider = 'smtp'; config.smtpUser = 'sender@gmail.com'
    setMailTransportForTests({ sendMail: async (m) => { mails.push(m); return {} } })
  })

  it('lets a client reopen something that is done, back into the team\'s inbox', async () => {
    const id = (await jane.json('POST', '/api/reports', { title: 'Came back', clientId: acme, withVideo: false })).data.report.id
    assert.equal((await jane.json('POST', `/api/reports/${id}/reopen`, {})).status, 409, 'only done items can be reopened')
    await jane.json('POST', `/api/reports/${id}/approve`, {})
    mails.length = 0
    const r = await jane.json('POST', `/api/reports/${id}/reopen`, { note: 'Still happens on Firefox' })
    assert.equal(r.status, 200)
    assert.equal(r.data.report.status, 'New')
    assert.equal(r.data.report.resolvedAt, undefined, 'the resolved date is cleared')
    const h = r.data.report.history as Json[]
    assert.ok(h.some((x) => x.kind === 'outcome' && x.text === 'Reopened by client: Still happens on Firefox'))
    assert.ok(h.some((x) => x.text === 'Closed by client'), 'the earlier closure stays in the history')
    assert.ok(h.some((x) => x.kind === 'status' && x.from === 'Resolved' && x.to === 'New'))
    assert.ok(mails.some((m) => m.subject === `${id} · Reopened by client` && m.to.includes('admin@test.com')))
    const inbox = ((await admin.json('GET', '/api/reports')).data.reports as Json[]).find((x) => x.id === id)!
    assert.equal(inbox.status, 'New')
    // closed again later, the new resolved date is recorded
    await jane.json('POST', `/api/reports/${id}/approve`, {})
    assert.ok(((await jane.json('GET', `/api/reports/${id}`)).data.report).resolvedAt)
  })

  it('only the client\'s own project can reopen, and admins use their status menu', async () => {
    const id = (await jane.json('POST', '/api/reports', { title: 'Not yours to reopen', clientId: acme, withVideo: false })).data.report.id
    await jane.json('POST', `/api/reports/${id}/approve`, {})
    assert.equal((await sam.json('POST', `/api/reports/${id}/reopen`, {})).status, 404)
    assert.equal((await admin.json('POST', `/api/reports/${id}/reopen`, {})).status, 403)
  })

  it('brings a request\'s roadmap card back out of Done when it is reopened', async () => {
    const rep = (await jane.json('POST', '/api/reports', { title: 'Reopen card', kind: 'Feature request', clientId: acme, withVideo: false })).data.report
    await jane.json('POST', `/api/reports/${rep.id}/approve`, {})
    const card = (id: string) => ((jane.json('GET', '/api/roadmap')) as Promise<{ data: Json }>).then((r) => (r.data.items as Json[]).find((i) => (i.reportIds as string[]).includes(id))!)
    assert.equal((await card(rep.id)).state, 'Done')
    await jane.json('POST', `/api/reports/${rep.id}/reopen`, {})
    const after = await card(rep.id)
    assert.equal(after.state, 'Under review')
    assert.match(after.lastMove.text, /reopened by the client/)
  })

  it('lets a client add to their own ticket and tells the team', async () => {
    const id = (await jane.json('POST', '/api/reports', { title: 'Short title', description: 'First words', clientId: acme, withVideo: false })).data.report.id
    mails.length = 0
    const r = await jane.json('PATCH', `/api/reports/${id}/details`, { title: 'A much clearer title', description: 'First words, and now the steps to repeat it', pageUrl: 'https://app.acme.com/checkout' })
    assert.equal(r.status, 200)
    assert.equal(r.data.report.title, 'A much clearer title')
    assert.equal(r.data.report.description, 'First words, and now the steps to repeat it')
    assert.equal(r.data.report.pageUrl, 'https://app.acme.com/checkout')
    assert.ok((r.data.report.history as Json[]).some((h) => h.kind === 'edit' && /Updated the title and description and page or link/.test(h.text)))
    assert.ok(mails.some((m) => /Updated by Acme/.test(m.subject) && m.to.includes('admin@test.com')))
    mails.length = 0
    await jane.json('PATCH', `/api/reports/${id}/details`, { description: 'First words, and now the steps to repeat it' })
    assert.equal(mails.length, 0, 'no change, no email')
    assert.equal((await jane.json('PATCH', `/api/reports/${id}/details`, { title: '   ' })).status, 400)
    assert.equal((await jane.json('PATCH', `/api/reports/${id}/details`, { description: 'x'.repeat(4001) })).status, 400)
  })

  it('keeps an editable ticket private to its project, and still editable after it is done', async () => {
    const id = (await jane.json('POST', '/api/reports', { title: 'Edit me', clientId: acme, withVideo: false })).data.report.id
    assert.equal((await sam.json('PATCH', `/api/reports/${id}/details`, { description: 'hijack' })).status, 404)
    assert.equal((await admin.json('PATCH', `/api/reports/${id}/details`, { description: 'x' })).status, 403, 'admins edit through their own route')
    await jane.json('POST', `/api/reports/${id}/approve`, {})
    assert.equal((await jane.json('PATCH', `/api/reports/${id}/details`, { description: 'Added after it was closed' })).status, 200)
  })

  it('keeps a request\'s roadmap card in step with its edited words', async () => {
    const rep = (await jane.json('POST', '/api/reports', { title: 'Old card title', description: 'old', kind: 'Feature request', clientId: acme, withVideo: false })).data.report
    await jane.json('PATCH', `/api/reports/${rep.id}/details`, { title: 'New card title', description: 'new words' })
    const card = ((await jane.json('GET', '/api/roadmap')).data.items as Json[]).find((i) => (i.reportIds as string[]).includes(rep.id))!
    assert.equal(card.title, 'New card title')
    assert.equal(card.description, 'new words')
  })

  it('cleans up', async () => {
    const { config } = await import('../config.js')
    const { setMailTransportForTests } = await import('../email.js')
    setMailTransportForTests(null); config.emailProvider = 'console'; config.smtpUser = ''
  })
})
