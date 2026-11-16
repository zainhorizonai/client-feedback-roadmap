import crypto from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config.js'
import { all, batch, isUniqueViolation, one, run } from './db.js'
import { clientIp, logout, rateLimited, requestLogin, verifyLogin, withUser, type AuthUser } from './auth.js'
import { escapeHtml, layout, sendEmail, sendQuietly } from './email.js'
import { blobPrefix, extFor, getStorage, isAllowedMime, normalizeMime, TooLargeError } from './storage.js'

type Env = { Variables: { user: AuthUser | null } }
export const app = new Hono<Env>()

const STATUSES = ['New', 'Triaging', 'In progress', 'Ready to verify', 'Resolved'] as const
const SEVERITIES = ['Low', 'Medium', 'High', 'Blocker'] as const
const KINDS = ['Bug', 'UAT finding', 'Feature request', 'Question'] as const
const STAGES = ['Under review', 'Planned', 'In progress', 'Done'] as const
type Status = (typeof STATUSES)[number]
type Kind = (typeof KINDS)[number]
// The number is shared across all types, so BUG-0003 and REQ-0004 can never collide.
const ID_PREFIX: Record<Kind, string> = { Bug: 'BUG', 'UAT finding': 'UAT', 'Feature request': 'REQ', Question: 'Q' }

// ---------- helpers ----------

class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429, message: string) { super(message) }
}

const now = () => new Date().toISOString()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function json(c: Context): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json()
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* fall through */ }
  throw new HttpError(400, 'Invalid JSON body')
}

function text(v: unknown, field: string, max: number, required = false): string {
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, `${field} is required`)
    return ''
  }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`)
  const t = v.trim()
  if (required && !t) throw new HttpError(400, `${field} is required`)
  if (t.length > max) throw new HttpError(400, `${field} is too long (max ${max})`)
  return t
}

function httpUrlOrEmpty(v: unknown, field: string): string {
  const t = text(v, field, 500)
  if (t && !/^https?:\/\/\S+$/i.test(t)) throw new HttpError(400, `${field} must start with http:// or https://`)
  return t
}

function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (typeof v === 'string' && (list as readonly string[]).includes(v)) return v as T
  throw new HttpError(400, `${field} must be one of: ${list.join(', ')}`)
}

function requireUser(c: Context<Env>): AuthUser {
  const u = c.get('user')
  if (!u) throw new HttpError(401, 'Sign in required')
  return u
}
function requireAdmin(c: Context<Env>): AuthUser {
  const u = requireUser(c)
  if (u.role !== 'admin') throw new HttpError(403, 'Admins only')
  return u
}
function requireClient(c: Context<Env>): AuthUser {
  const u = requireUser(c)
  if (u.role !== 'client' || !u.clientId) throw new HttpError(403, 'Clients only')
  return u
}

const maxMb = () => Math.round(config.maxVideoBytes / 1024 / 1024)

// ---------- reports ----------

interface ReportRow {
  id: string; seq: number; created_at: string; client_id: string; client_name: string
  reporter_id: string; reporter_name: string; reporter_email: string
  title: string; description: string; page_url: string; severity: string; status: Status
  notes: string; resolution_url: string; video_path: string | null; video_mime: string | null; resolved_at: string | null
  kind: Kind; roadmap_stage: string | null; submitted_at: string | null; reporter_role: 'admin' | 'client'
}
interface HistoryRow { report_id: string; at: string; by: string; kind: string; text: string }

const REPORT_SELECT = `SELECT r.*, c.name AS client_name, u.name AS reporter_name, u.email AS reporter_email, u.role AS reporter_role
  FROM reports r JOIN clients c ON c.id = r.client_id JOIN users u ON u.id = r.reporter_id`

function serialize(r: ReportRow, user: AuthUser, history: HistoryRow[]) {
  return {
    id: r.id,
    createdAt: r.created_at,
    clientId: r.client_id,
    clientName: r.client_name,
    reporterName: r.reporter_name,
    reporterEmail: r.reporter_email,
    title: r.title,
    description: r.description,
    pageUrl: r.page_url,
    severity: r.severity,
    status: r.status,
    kind: r.kind,
    roadmapStage: r.roadmap_stage ?? undefined,
    // Internal notes never leave the server for clients.
    ...(user.role === 'admin' ? { notes: r.notes } : {}),
    resolutionUrl: r.resolution_url,
    hasVideo: !!r.video_path,
    resolvedAt: r.resolved_at ?? undefined,
    history: history.map(({ at, by, kind, text }) => ({ at, by, kind, text })),
  }
}

async function historyFor(ids: string[]): Promise<Map<string, HistoryRow[]>> {
  const map = new Map<string, HistoryRow[]>()
  if (ids.length === 0) return map
  const rows = await all<HistoryRow>(
    `SELECT report_id, at, by, kind, text FROM history WHERE report_id = ANY($1::text[]) ORDER BY id`,
    // Both Postgres drivers accept an array literal for a text[] parameter.
    `{${ids.map((i) => `"${i}"`).join(',')}}`,
  )
  for (const h of rows) (map.get(h.report_id) ?? map.set(h.report_id, []).get(h.report_id)!).push(h)
  return map
}

/** Loads a report the user may see. Unknown and forbidden both read as 404 so ids cannot be probed. */
async function loadReport(user: AuthUser, id: string): Promise<ReportRow> {
  const r = await one<ReportRow>(`${REPORT_SELECT} WHERE r.id = $1`, id)
  if (!r) throw new HttpError(404, 'Report not found')
  if (user.role === 'client' && r.client_id !== user.clientId) throw new HttpError(404, 'Report not found')
  return r
}

const withHistory = async (r: ReportRow, user: AuthUser) => serialize(r, user, (await historyFor([r.id])).get(r.id) ?? [])

const addHistory = (id: string, by: 'client' | 'admin' | 'system', kind: string, msg: string) =>
  run('INSERT INTO history (report_id, at, by, kind, text) VALUES ($1, $2, $3, $4, $5)', id, now(), by, kind, msg)

async function adminEmails(): Promise<string[]> {
  return (await all<{ email: string }>("SELECT email FROM users WHERE role = 'admin'")).map((a) => a.email)
}

const adminLink = (id: string) => `${config.appUrl}/admin?report=${id}`
const clientLink = (id: string) => `${config.appUrl}/reports/${id}`

async function mailAdmins(subject: string, lines: string[], id: string) {
  await sendQuietly({
    to: await adminEmails(),
    subject,
    text: `${lines.join('\n')}\n\n${adminLink(id)}`,
    html: layout(subject, lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''), { label: 'Open in tracker', url: adminLink(id) }),
  })
}
/** Whoever sent the item gets the email. Items added by the team go to everyone at that client. */
async function clientRecipients(r: ReportRow): Promise<string[]> {
  if (r.reporter_role === 'client') return [r.reporter_email]
  return (await all<{ email: string }>("SELECT email FROM users WHERE role = 'client' AND client_id = $1", r.client_id)).map((u) => u.email)
}
const mailClient = async (r: ReportRow, subject: string, lines: string[]) =>
  sendQuietly({
    to: await clientRecipients(r),
    subject,
    text: `Hello,\n\n${lines.join('\n')}\n\n${clientLink(r.id)}`,
    html: layout(subject, lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''), { label: 'View it', url: clientLink(r.id) }),
  })

// ---------- middleware ----------

app.onError((e, c) => {
  if (e instanceof HttpError) return c.json({ error: e.message }, e.status)
  console.error(e)
  return c.json({ error: 'Something went wrong' }, 500)
})

app.use('/api/*', withUser)

// Reject cross-site writes. SameSite=Lax cookies already block most of this; the Origin check is a second layer.
app.use('/api/*', async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next()
  const origin = c.req.header('origin')
  if (origin) {
    const host = c.req.header('host')
    let ok = origin === new URL(config.appUrl).origin
    try { ok = ok || (!!host && new URL(origin).host === host) } catch { ok = false }
    if (!ok) return c.json({ error: 'Cross-origin request blocked' }, 403)
  }
  return next()
})

// Small JSON bodies only. The local-disk video upload streams and enforces its own limit.
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'PUT' && c.req.path.endsWith('/video')) return next()
  return bodyLimit({ maxSize: 64 * 1024, onError: (ctx) => ctx.json({ error: 'Request too large' }, 413) })(c, next)
})

// ---------- auth ----------

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/me', (c) => c.json({ user: c.get('user') }))

const secretMatches = (given: string, expected: string) =>
  !!expected && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))

/** Strips anything that looks like a URL or host from an error before it is shown. */
const scrub = (e: unknown) => {
  const x = e as { name?: string; code?: string; message?: string }
  const msg = String(x?.message ?? e).replace(/\S+:\/\/\S+/g, '[url]').replace(/\b[\w-]+(\.[\w-]+){2,}\b/g, '[host]').slice(0, 200)
  return [x?.name, x?.code, msg].filter(Boolean).join(' | ')
}

// Setup check for the person deploying. Protected by CRON_SECRET: /api/health/deep?key=<CRON_SECRET>
app.get('/api/health/deep', async (c) => {
  if (!secretMatches(c.req.query('key') ?? '', config.cronSecret)) return c.json({ error: 'Not found' }, 404)
  let database = 'ok'
  try { await one('SELECT 1 AS ok') } catch (e) { database = `error: ${scrub(e)}` }

  // ?sendTo=address sends a real test email right now and shows the result. Only to people already in the system.
  let testEmail: Record<string, unknown> | undefined
  const sendTo = (c.req.query('sendTo') ?? '').trim().toLowerCase()
  if (sendTo) {
    const known = config.adminEmails.includes(sendTo) || !!(await one('SELECT id FROM users WHERE email = $1', sendTo))
    if (!known) testEmail = { to: sendTo, sent: false, error: 'Not an admin or invited user, so no test was sent.' }
    else {
      const started = Date.now()
      try {
        await sendEmail({ to: sendTo, subject: 'Feedback Portal test email', text: 'If you can read this, sending works.', html: '<p>If you can read this, sending works.</p>' })
        testEmail = { to: sendTo, sent: true, ms: Date.now() - started, note: 'Accepted by the mail server. If it is not in the inbox, check spam and quarantine.' }
      } catch (e) {
        testEmail = { to: sendTo, sent: false, ms: Date.now() - started, error: scrub(e) }
      }
    }
  }
  const recentEmails = (await all<{ at: string; to_addr: string; subject: string; ok: number; error: string }>(
    'SELECT at, to_addr, subject, ok, error FROM email_log ORDER BY id DESC LIMIT 10',
  ).catch(() => [])).map((e) => ({ at: e.at, to: e.to_addr, subject: e.subject, sent: e.ok === 1, error: e.error || undefined }))

  return c.json({
    testEmail,
    recentEmails,
    database,
    databaseVariableFound: config.databaseUrl ? config.databaseEnvName : null,
    blobAuth: config.blobToken ? 'token' : config.blobStoreId ? 'store-id (OIDC)' : null,
    blobVariableFound: config.blobToken ? config.blobEnvName : config.blobStoreId ? 'BLOB_STORE_ID' : null,
    blobWebhookKeyFound: !!config.blobWebhookKey,
    onVercel: config.onVercel,
    emailProvider: config.emailProvider,
    resendKeySet: !!config.resendKey,
    emailFrom: config.emailProvider === 'smtp' ? (process.env.EMAIL_FROM ?? `Feedback Portal <${config.smtpUser}>`) : config.emailFrom,
    smtp: config.emailProvider === 'smtp' ? { host: config.smtpHost, port: config.smtpPort, userSet: !!config.smtpUser, passSet: !!config.smtpPass } : undefined,
    adminEmails: config.adminEmails.length,
    cronSecretSet: true,
    appUrl: config.appUrl,
  })
})

app.post('/api/auth/request', async (c) => {
  const body = await json(c)
  const email = text(body.email, 'email', 200, true).toLowerCase()
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address')
  if ((await rateLimited(`req-ip:${clientIp(c)}`, 20, 15 * 60_000)) || (await rateLimited(`req-email:${email}`, 5, 15 * 60_000))) {
    throw new HttpError(429, 'Too many attempts. Try again in a few minutes.')
  }
  const link = await requestLogin(email)
  // The response is identical whether or not the address is known. The link is only echoed in local dev.
  const devLink = link && !config.isProd && config.emailProvider === 'console' ? link : undefined
  return c.json({ ok: true, devLink })
})

app.post('/api/auth/verify', async (c) => {
  if (await rateLimited(`verify-ip:${clientIp(c)}`, 30, 15 * 60_000)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.')
  const body = await json(c)
  const user = await verifyLogin(c, text(body.token, 'token', 200, true))
  if (!user) throw new HttpError(400, 'This sign-in link is invalid or has expired. Request a new one.')
  return c.json({ user })
})

app.post('/api/auth/logout', async (c) => {
  await logout(c)
  return c.json({ ok: true })
})

// ---------- reports ----------

app.get('/api/reports', async (c) => {
  const user = requireUser(c)
  // Reports still waiting for their video to finish uploading are drafts and stay hidden.
  const rows = user.role === 'admin'
    ? await all<ReportRow>(`${REPORT_SELECT} WHERE r.submitted_at IS NOT NULL ORDER BY r.seq DESC`)
    : await all<ReportRow>(`${REPORT_SELECT} WHERE r.submitted_at IS NOT NULL AND r.client_id = $1 ORDER BY r.seq DESC`, user.clientId)
  const hist = await historyFor(rows.map((r) => r.id))
  return c.json({ reports: rows.map((r) => serialize(r, user, hist.get(r.id) ?? [])) })
})

app.get('/api/reports/:id', async (c) => {
  const user = requireUser(c)
  return c.json({ report: await withHistory(await loadReport(user, c.req.param('id')), user) })
})

/** Numbers are sequential (BUG-0001...). Two requests can pick the same next number; the unique
 *  constraint rejects the loser, which simply retries. */
async function insertReport(f: {
  clientId: string; reporterId: string; title: string; description: string; pageUrl: string
  severity: string; kind: Kind; stage: string | null; submittedAt: string | null
}): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const row = await one<{ id: string }>(
        `INSERT INTO reports (id, seq, created_at, client_id, reporter_id, title, description, page_url, severity, kind, roadmap_stage, submitted_at)
         SELECT $11::text || '-' || LPAD(n::text, 4, '0'), n, $1, $2, $3, $4, $5, $6, $7, $8, $9::text, $10::text
           FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM reports) s
         RETURNING id`,
        now(), f.clientId, f.reporterId, f.title, f.description, f.pageUrl, f.severity, f.kind, f.stage, f.submittedAt, ID_PREFIX[f.kind],
      )
      if (row) return row.id
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  throw new HttpError(409, 'Could not create the item, please try again')
}

// Feature requests start on the client's roadmap as "Under review". Everything else starts off it.
const defaultStage = (kind: Kind) => (kind === 'Feature request' ? 'Under review' : null)

async function announceSubmission(r: ReportRow) {
  const what = r.kind === 'Bug' || r.kind === 'UAT finding' ? `${r.severity} ${r.kind.toLowerCase()}` : r.kind.toLowerCase()
  await mailAdmins(`New ${what} from ${r.client_name}: ${r.title}`, [`${r.reporter_name} (${r.client_name}) submitted ${r.id} (${r.kind}).`, ...(r.kind === 'Bug' || r.kind === 'UAT finding' ? [`Severity: ${r.severity}`] : []), r.description], r.id)
  await mailClient(r, `We received your ${r.kind.toLowerCase()} ${r.id}`, [`Thanks, we received "${r.title}" and will update you here and by email.`])
}

app.post('/api/reports', async (c) => {
  const user = requireClient(c)
  const body = await json(c)
  const title = text(body.title, 'title', 120, true)
  const description = text(body.description, 'description', 4000)
  const pageUrl = text(body.pageUrl, 'pageUrl', 500)
  const severity = oneOf(body.severity ?? 'Medium', SEVERITIES, 'severity')
  const kind = oneOf(body.kind ?? 'Bug', KINDS, 'kind')
  // A video is optional. Without one the report is complete straight away; with one it stays a hidden
  // draft until the upload finishes.
  const withVideo = body.withVideo !== false
  const storage = getStorage()

  const id = await insertReport({
    clientId: user.clientId!, reporterId: user.id, title, description, pageUrl, severity, kind,
    stage: defaultStage(kind), submittedAt: withVideo ? null : now(),
  })
  if (!withVideo) {
    await addHistory(id, 'client', 'created', 'Report submitted')
    await announceSubmission(await loadReport(user, id))
  }
  const report = await withHistory(await loadReport(user, id), user)
  return c.json({ report, upload: withVideo ? { mode: storage.mode, flow: storage.uploadFlow } : undefined }, 201)
})

/** Marks a draft as submitted. One atomic statement, so a report can only be finalized once. */
async function finalizeUpload(user: AuthUser, r: ReportRow, storedPath: string, mime: string, size: number) {
  const done = await one(
    `WITH u AS (
       UPDATE reports SET video_path = $2, video_mime = $3, video_size = $4, submitted_at = $5
        WHERE id = $1 AND submitted_at IS NULL RETURNING id)
     INSERT INTO history (report_id, at, by, kind, text)
     SELECT id, $5, 'client', 'created', 'Report submitted' FROM u RETURNING report_id`,
    r.id, storedPath, mime, size, now(),
  )
  if (!done) throw new HttpError(409, 'This report already has a video')

  await announceSubmission(r)
  return withHistory(await loadReport(user, r.id), user)
}

async function ownDraft(c: Context<Env>) {
  const user = requireClient(c)
  const r = await loadReport(user, c.req.param('id')!)
  if (r.reporter_id !== user.id) throw new HttpError(403, 'Only the reporter can upload the video')
  if (r.submitted_at !== null) throw new HttpError(409, 'This report has already been submitted')
  return { user, r }
}

const uploading = new Set<string>()

// Local-disk mode: the API receives the bytes. (On Vercel the browser uploads straight to Blob instead.)
app.put('/api/reports/:id/video', async (c) => {
  const storage = getStorage()
  if (storage.mode !== 'server' || !storage.save) throw new HttpError(404, 'Direct upload is not used here')
  const { user, r } = await ownDraft(c)

  const mime = normalizeMime(c.req.header('content-type'))
  if (!isAllowedMime(mime)) throw new HttpError(415, 'Unsupported video type. Use WebM, MP4 or MOV.')
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > config.maxVideoBytes) throw new HttpError(413, `Video is larger than ${maxMb()} MB`)
  if (!c.req.raw.body) throw new HttpError(400, 'Empty upload')
  if (uploading.has(r.id)) throw new HttpError(409, 'An upload for this report is already in progress')

  uploading.add(r.id)
  let saved: { path: string; size: number }
  try {
    saved = await storage.save(r.id, mime, c.req.raw.body)
  } catch (e) {
    if (e instanceof TooLargeError) throw new HttpError(413, `Video is larger than ${maxMb()} MB`)
    throw new HttpError(400, 'Upload failed or was empty')
  } finally {
    uploading.delete(r.id)
  }
  return c.json({ report: await finalizeUpload(user, r, saved.path, mime, saved.size) })
})

// Blob mode, step 1: the browser asks for a token that lets it upload one video into this report's folder.
app.post('/api/reports/:id/blob-token', async (c) => {
  const storage = getStorage()
  if (storage.mode !== 'blob' || !storage.clientUpload) throw new HttpError(404, 'Blob upload is not enabled')
  const { r } = await ownDraft(c)
  const body = await json(c)
  try {
    return c.json(await storage.clientUpload(c.req.raw, body, r.id))
  } catch (e) {
    console.error('blob token refused:', e instanceof Error ? e.message : e)
    throw new HttpError(400, 'Upload was not allowed')
  }
})

// Blob mode, step 2: the browser says it is done. We verify the blob ourselves before accepting it.
app.post('/api/reports/:id/video/complete', async (c) => {
  const storage = getStorage()
  if (storage.mode !== 'blob' || !storage.inspect) throw new HttpError(404, 'Blob upload is not enabled')
  const { user, r } = await ownDraft(c)
  const pathname = text((await json(c)).pathname, 'pathname', 300, true)
  const ext = pathname.split('.').pop() ?? ''
  if (!pathname.startsWith(blobPrefix(r.id)) || pathname.includes('..') || !pathname.split('/').pop()) throw new HttpError(400, 'That upload does not belong to this report')
  const found = await storage.inspect(pathname)
  if (!found) throw new HttpError(400, 'The video was not found. Please upload it again.')
  if (!isAllowedMime(found.mime) || !extFor(found.mime) || !ext) throw new HttpError(415, 'Unsupported video type. Use WebM, MP4 or MOV.')
  if (found.size > config.maxVideoBytes) throw new HttpError(413, `Video is larger than ${maxMb()} MB`)
  if (found.size === 0) throw new HttpError(400, 'The uploaded video is empty')
  return c.json({ report: await finalizeUpload(user, r, pathname, found.mime, found.size) })
})

app.get('/api/reports/:id/video', async (c) => {
  const user = requireUser(c)
  const r = await loadReport(user, c.req.param('id'))
  if (!r.video_path || !r.video_mime) throw new HttpError(404, 'No video for this report')
  const res = await getStorage().serve(r.video_path, r.video_mime, c.req.header('range'))
  // A redirect carries a signed link. Make sure no shared cache ever keeps it.
  if (res.status >= 300 && res.status < 400) res.headers.set('Cache-Control', 'private, no-store')
  return res
})

// A client can discard a draft whose upload failed.
app.delete('/api/reports/:id', async (c) => {
  const user = requireClient(c)
  const r = await loadReport(user, c.req.param('id'))
  if (r.reporter_id !== user.id) throw new HttpError(403, 'Not your report')
  if (r.submitted_at !== null) throw new HttpError(409, 'Submitted reports cannot be deleted')
  await run('DELETE FROM reports WHERE id = $1', r.id)
  return c.json({ ok: true })
})

app.patch('/api/reports/:id', async (c) => {
  const admin = requireAdmin(c)
  const r = await loadReport(admin, c.req.param('id'))
  const body = await json(c)

  const sets: string[] = []
  const vals: (string | null)[] = []
  const set = (col: string, v: string | null) => { vals.push(v); sets.push(`${col} = $${vals.length}`) }

  if ('title' in body) set('title', text(body.title, 'title', 120, true))
  if ('description' in body) set('description', text(body.description, 'description', 4000))
  if ('pageUrl' in body) set('page_url', text(body.pageUrl, 'pageUrl', 500))
  if ('severity' in body) set('severity', oneOf(body.severity, SEVERITIES, 'severity'))
  if ('kind' in body) set('kind', oneOf(body.kind, KINDS, 'kind'))
  if ('notes' in body) set('notes', text(body.notes, 'notes', 4000))
  if ('resolutionUrl' in body) set('resolution_url', httpUrlOrEmpty(body.resolutionUrl, 'resolutionUrl'))

  let newStatus: Status | null = null
  if ('status' in body) {
    newStatus = oneOf(body.status, STATUSES, 'status')
    if (newStatus !== r.status) {
      set('status', newStatus)
      set('resolved_at', newStatus === 'Resolved' ? now() : null)
    } else newStatus = null
  }

  // roadmapStage: a stage puts the item on the client's roadmap, null takes it off.
  let newStage: string | null | undefined
  if ('roadmapStage' in body) {
    const next = body.roadmapStage === null || body.roadmapStage === '' ? null : oneOf(body.roadmapStage, STAGES, 'roadmapStage')
    if (next !== r.roadmap_stage) { newStage = next; set('roadmap_stage', next) }
  }

  if (sets.length) {
    const update: [string, (string | null)[]] = [`UPDATE reports SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`, [...vals, r.id]]
    const stmts: [string, (string | null)[]][] = [update]
    const log = (msg: string) => stmts.push(['INSERT INTO history (report_id, at, by, kind, text) VALUES ($1, $2, $3, $4, $5)', [r.id, now(), 'admin', 'status', msg]])
    if (newStatus) log(`Status changed from ${r.status} to ${newStatus}`)
    if (newStage !== undefined) log(newStage ? `Roadmap: ${r.roadmap_stage ?? 'not on the roadmap'} to ${newStage}` : 'Removed from the roadmap')
    if (stmts.length > 1) await batch(stmts)
    else await run(update[0], ...update[1])
  }
  if (newStage) {
    await mailClient(r, `${r.id} is now "${newStage}" on your roadmap`, [`"${r.title}" moved to ${newStage} on your roadmap.`])
  }
  if (newStatus) {
    await mailClient(r, `${r.id} is now "${newStatus}"`, [`The status of "${r.title}" changed from ${r.status} to ${newStatus}.`])
  }
  return c.json({ report: await withHistory(await loadReport(admin, r.id), admin) })
})

app.post('/api/reports/:id/replies', async (c) => {
  const admin = requireAdmin(c)
  const r = await loadReport(admin, c.req.param('id'))
  const msg = text((await json(c)).text, 'text', 4000, true)
  await addHistory(r.id, 'admin', 'reply', msg)
  await mailClient(r, `New reply on ${r.id}`, [`Reply about "${r.title}":`, msg])
  return c.json({ report: await withHistory(r, admin) })
})

app.post('/api/reports/:id/comments', async (c) => {
  const user = requireClient(c)
  const r = await loadReport(user, c.req.param('id'))
  const msg = text((await json(c)).text, 'text', 4000, true)
  await addHistory(r.id, 'client', 'comment', msg)
  await mailAdmins(`New comment on ${r.id} from ${r.client_name}`, [`${user.name} commented on "${r.title}":`, msg], r.id)
  return c.json({ report: await withHistory(r, user) })
})

app.post('/api/reports/:id/confirm', async (c) => {
  const user = requireClient(c)
  const r = await loadReport(user, c.req.param('id'))
  if (r.status !== 'Ready to verify') throw new HttpError(409, 'This report is not waiting for your confirmation')
  const body = await json(c)
  const fixed = body.fixed === true
  const note = text(body.note, 'note', 2000)
  const msg = fixed ? 'Client confirmed the fix' : `Client says it is still broken${note ? `: ${note}` : ''}`
  await batch([
    ['INSERT INTO history (report_id, at, by, kind, text) VALUES ($1, $2, $3, $4, $5)', [r.id, now(), 'client', 'confirm', msg]],
    fixed
      ? ["UPDATE reports SET status = 'Resolved', resolved_at = $1 WHERE id = $2", [now(), r.id]]
      : ["UPDATE reports SET status = 'In progress', resolved_at = NULL WHERE id = $1", [r.id]],
  ])
  await mailAdmins(fixed ? `${r.id} confirmed fixed by ${r.client_name}` : `${r.id} is still broken (${r.client_name})`, [msg], r.id)
  return c.json({ report: await withHistory(await loadReport(user, r.id), user) })
})

// ---------- admin: add an item for a client (roadmap, future work) ----------

app.post('/api/admin/items', async (c) => {
  const admin = requireAdmin(c)
  const body = await json(c)
  const clientId = text(body.clientId, 'clientId', 100, true)
  if (!(await one('SELECT id FROM clients WHERE id = $1', clientId))) throw new HttpError(404, 'Client not found')
  const kind = oneOf(body.kind ?? 'Feature request', KINDS, 'kind')
  const stage = body.roadmapStage === null ? null : oneOf(body.roadmapStage ?? 'Planned', STAGES, 'roadmapStage')
  const id = await insertReport({
    clientId, reporterId: admin.id, title: text(body.title, 'title', 120, true), description: text(body.description, 'description', 4000),
    pageUrl: '', severity: 'Medium', kind, stage, submittedAt: now(),
  })
  await addHistory(id, 'admin', 'created', 'Added by the team')
  const r = await loadReport(admin, id)
  if (stage) await mailClient(r, `New on your roadmap: ${r.title}`, [`We added "${r.title}" to your roadmap (${stage}).`])
  return c.json({ report: await withHistory(r, admin) }, 201)
})

// ---------- admin: clients and their users ----------

app.get('/api/admin/clients', async (c) => {
  requireAdmin(c)
  const clients = await all<{ id: string; name: string; created_at: string }>('SELECT id, name, created_at FROM clients ORDER BY name')
  const users = await all<{ id: string; email: string; name: string; client_id: string }>("SELECT id, email, name, client_id FROM users WHERE role = 'client' ORDER BY name")
  return c.json({
    clients: clients.map((cl) => ({ id: cl.id, name: cl.name, createdAt: cl.created_at, users: users.filter((u) => u.client_id === cl.id).map(({ id, email, name }) => ({ id, email, name })) })),
  })
})

app.post('/api/admin/clients', async (c) => {
  requireAdmin(c)
  const name = text((await json(c)).name, 'name', 100, true)
  const id = crypto.randomUUID()
  await run('INSERT INTO clients (id, name, created_at) VALUES ($1, $2, $3)', id, name, now())
  return c.json({ client: { id, name, users: [] } }, 201)
})

app.post('/api/admin/clients/:id/users', async (c) => {
  requireAdmin(c)
  const client = await one<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', c.req.param('id'))
  if (!client) throw new HttpError(404, 'Client not found')
  const body = await json(c)
  const email = text(body.email, 'email', 200, true).toLowerCase()
  const name = text(body.name, 'name', 100, true)
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address')
  if (await one('SELECT id FROM users WHERE email = $1', email)) throw new HttpError(409, 'A user with this email already exists')
  const id = crypto.randomUUID()
  await run("INSERT INTO users (id, email, name, role, client_id, created_at) VALUES ($1, $2, $3, 'client', $4, $5)", id, email, name, client.id, now())
  const emailSent = await sendQuietly({
    to: email,
    subject: `You have been invited to report issues for ${client.name}`,
    text: `Hi ${name},\n\nYou can now send us bug and UAT reports as short videos.\nSign in with your email (no password needed): ${config.appUrl}`,
    html: layout(`Welcome, ${name}`, `<p>You can now send us bug and UAT reports as short videos for <strong>${escapeHtml(client.name)}</strong>. Sign in with your email, no password needed.</p>`, { label: 'Open the portal', url: config.appUrl }),
  })
  return c.json({ user: { id, email, name }, emailSent }, 201)
})

// ---------- scheduled housekeeping (Vercel Cron) ----------

export async function housekeeping() {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString()
  await run('DELETE FROM reports WHERE submitted_at IS NULL AND created_at < $1', cutoff)
  await run('DELETE FROM login_tokens WHERE expires_at < $1', now())
  await run('DELETE FROM sessions WHERE expires_at < $1', now())
  await run('DELETE FROM rate_hits WHERE at < $1', new Date(Date.now() - 3600_000).toISOString())
  await run('DELETE FROM email_log WHERE at < $1', new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
}

app.get('/api/cron/housekeeping', async (c) => {
  // Vercel Cron sends "Authorization: Bearer $CRON_SECRET". Without a secret the endpoint is off.
  const auth = c.req.header('authorization') ?? ''
  const expected = `Bearer ${config.cronSecret}`
  const ok = !!config.cronSecret && auth.length === expected.length && crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  await housekeeping()
  return c.json({ ok: true })
})

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

// ---------- self-hosted production: serve the built frontend ----------
// On Vercel the static files are served by Vercel itself, so this only applies to plain Node hosting.

if (config.isProd && !config.onVercel) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}
