import crypto from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config.js'
import { all, batch, createRoadmapItemForReport, isUniqueViolation, one, ROADMAP_KINDS, run } from './db.js'
import { changePassword, checkPasswordToken, clientIp, login, logout, passwordProblem, rateLimited, recordFailure, requestPasswordEmail, resetPassword, sendPasswordEmail, tooManyFailures, withUser, type AuthUser } from './auth.js'
import { escapeHtml, layout, sendEmail, sendQuietly } from './email.js'
import { blobPrefix, extFor, getStorage, isAllowedMime, normalizeMime, TooLargeError } from './storage.js'

type Env = { Variables: { user: AuthUser | null } }
export const app = new Hono<Env>()

const STATUSES = ['New', 'Triaging', 'In progress', 'Needs client input', 'Ready to verify', 'Resolved'] as const
const SEVERITIES = ['Low', 'Medium', 'High', 'Blocker'] as const
const KINDS = ['Bug', 'UAT finding', 'Feature request', 'Question'] as const
const ROADMAP_STATES = ['Under review', 'Planned', 'In progress', 'Done'] as const
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
  if (u.role !== 'client' || u.projects.length === 0) throw new HttpError(403, 'Clients only')
  return u
}

/** A client can use a project if they belong to it. Admins can use all of them. */
const inProject = (user: AuthUser, clientId: string) => user.role === 'admin' || user.projects.some((p) => p.id === clientId)
const projectArray = (user: AuthUser) => `{${user.projects.map((p) => `"${p.id}"`).join(',')}}`

const maxMb = () => Math.round(config.maxVideoBytes / 1024 / 1024)

// ---------- reports ----------

interface ReportRow {
  id: string; seq: number; created_at: string; client_id: string; client_name: string
  reporter_id: string; reporter_name: string; reporter_email: string
  title: string; description: string; page_url: string; severity: string; status: Status
  notes: string; resolution_url: string; video_path: string | null; video_mime: string | null; resolved_at: string | null
  kind: Kind; roadmap_stage: string | null; roadmap_auto: number; submitted_at: string | null; reporter_role: 'admin' | 'client'
}
interface HistoryRow { report_id: string; at: string; by: string; kind: string; text: string; from_value: string | null; to_value: string | null }
interface LinkedItem { id: string; title: string; state: string }

const REPORT_SELECT = `SELECT r.*, c.name AS client_name, u.name AS reporter_name, u.email AS reporter_email, u.role AS reporter_role
  FROM reports r JOIN clients c ON c.id = r.client_id JOIN users u ON u.id = r.reporter_id`

function serialize(r: ReportRow, user: AuthUser, history: HistoryRow[], items: LinkedItem[] = []) {
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
    // Internal notes and roadmap links never leave the server for clients.
    ...(user.role === 'admin' ? { notes: r.notes, roadmapItems: items } : {}),
    resolutionUrl: r.resolution_url,
    hasVideo: !!r.video_path,
    resolvedAt: r.resolved_at ?? undefined,
    history: history.map(({ at, by, kind, text, from_value, to_value }) => ({ at, by, kind, text, from: from_value ?? undefined, to: to_value ?? undefined })),
  }
}

async function historyFor(ids: string[]): Promise<Map<string, HistoryRow[]>> {
  const map = new Map<string, HistoryRow[]>()
  if (ids.length === 0) return map
  const rows = await all<HistoryRow>(
    `SELECT report_id, at, by, kind, text, from_value, to_value FROM history WHERE report_id = ANY($1::text[]) ORDER BY id`,
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
  if (!inProject(user, r.client_id)) throw new HttpError(404, 'Report not found')
  return r
}

/** Roadmap items each report is linked to. Admin-only: clients never see what is behind a report. */
async function itemsFor(ids: string[]): Promise<Map<string, LinkedItem[]>> {
  const map = new Map<string, LinkedItem[]>()
  if (ids.length === 0) return map
  const rows = await all<LinkedItem & { report_id: string }>(
    `SELECT l.report_id, i.id, i.title, i.state FROM roadmap_links l JOIN roadmap_items i ON i.id = l.item_id
      WHERE l.report_id = ANY($1::text[]) ORDER BY i.seq`,
    `{${ids.map((i) => `"${i}"`).join(',')}}`,
  )
  for (const x of rows) (map.get(x.report_id) ?? map.set(x.report_id, []).get(x.report_id)!).push({ id: x.id, title: x.title, state: x.state })
  return map
}

const withHistory = async (r: ReportRow, user: AuthUser) =>
  serialize(r, user, (await historyFor([r.id])).get(r.id) ?? [], user.role === 'admin' ? (await itemsFor([r.id])).get(r.id) ?? [] : [])

const addHistory = (id: string, by: 'client' | 'admin' | 'system', kind: string, msg: string, from: string | null = null, to: string | null = null) =>
  run('INSERT INTO history (report_id, at, by, kind, text, from_value, to_value) VALUES ($1, $2, $3, $4, $5, $6, $7)', id, now(), by, kind, msg, from, to)

type Stmt = [string, (string | null)[]]
const historyStmt = (id: string, by: string, kind: string, msg: string, from: string | null = null, to: string | null = null): Stmt =>
  ['INSERT INTO history (report_id, at, by, kind, text, from_value, to_value) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, now(), by, kind, msg, from, to]]

async function adminEmails(): Promise<string[]> {
  return (await all<{ email: string }>("SELECT email FROM users WHERE role = 'admin'")).map((a) => a.email)
}

const adminLink = (id: string) => `${config.appUrl}/admin/tracker?report=${id}`
const clientLink = (id: string) => `${config.appUrl}/reports/${id}`

async function mailAdmins(subject: string, lines: string[], id: string, url = adminLink(id), label = 'Open report') {
  await sendQuietly({
    to: await adminEmails(),
    subject,
    text: `${lines.join('\n')}\n\n${url}`,
    html: layout(subject, lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''), { label, url }),
  })
}
/** Whoever sent the item gets the email. Items added by the team go to everyone at that client. */
async function clientRecipients(r: ReportRow): Promise<string[]> {
  if (r.reporter_role === 'client' && (await one('SELECT 1 AS x FROM users WHERE id = $1 AND removed_at IS NULL', r.reporter_id))) return [r.reporter_email]
  return (await all<{ email: string }>("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.client_id = $1 AND u.role = 'client'", r.client_id)).map((u) => u.email)
}
const mailClient = async (r: ReportRow, subject: string, lines: string[]) =>
  sendQuietly({
    to: await clientRecipients(r),
    subject,
    text: `Hello,\n\n${lines.join('\n')}\n\n${clientLink(r.id)}`,
    html: layout(subject, lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''), { label: 'View report', url: clientLink(r.id) }),
  })

/** What each status email says. A status with no entry (New, Triaging) sends nothing. */
const STATUS_EMAIL: Partial<Record<Status, (r: ReportRow) => string[]>> = {
  'In progress': (r) => [`We are working on "${r.title}".`],
  'Needs client input': (r) => [`We need something from you to continue with "${r.title}". Open it to see our question and reply.`],
  'Ready to verify': () => ['The fix is ready. Try it again and tell us if it works.'],
  Resolved: (r) => [`"${r.title}" is resolved. Thanks for helping us get it right.`],
}

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

// The limits come from configuration so the interface never repeats a number that could drift.
app.get('/api/me', (c) => c.json({ user: c.get('user'), limits: { maxVideoMb: maxMb() } }))

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

const WINDOW = 15 * 60_000
const TOO_MANY = 'Too many attempts. Try again in a few minutes.'
const WRONG = 'Email or password is incorrect.'

/** Email and password. Wrong attempts are counted per address and per network, and the message never says which part was wrong. */
app.post('/api/auth/login', async (c) => {
  const body = await json(c)
  const email = text(body.email, 'email', 200, true).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!password || password.length > 256) throw new HttpError(400, 'Enter your password')
  const ipKey = `login-ip:${clientIp(c)}`
  const emailKey = `login-email:${email}`
  if ((await tooManyFailures(ipKey, 40, WINDOW)) || (await tooManyFailures(emailKey, 8, WINDOW))) throw new HttpError(429, TOO_MANY)
  const user = await login(c, email, password)
  if (!user) {
    await recordFailure(ipKey)
    await recordFailure(emailKey)
    throw new HttpError(401, WRONG)
  }
  return c.json({ user })
})

/** First-time setup and forgotten passwords both start here. The answer is the same whether or not the address has an account. */
app.post('/api/auth/forgot', async (c) => {
  const email = text((await json(c)).email, 'email', 200, true).toLowerCase()
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address')
  if ((await rateLimited(`forgot-ip:${clientIp(c)}`, 20, WINDOW)) || (await rateLimited(`forgot-email:${email}`, 3, WINDOW))) throw new HttpError(429, TOO_MANY)
  const link = await requestPasswordEmail(email)
  // The link is only echoed in local development, where email is just printed.
  const devLink = link && !config.isProd && config.emailProvider === 'console' ? link : undefined
  return c.json({ ok: true, devLink })
})

/** Says what a link is for without using it up, so the page can show "expired" before asking for a password. */
app.post('/api/auth/reset/check', async (c) => {
  if (await rateLimited(`token-ip:${clientIp(c)}`, 60, WINDOW)) throw new HttpError(429, TOO_MANY)
  const info = await checkPasswordToken(text((await json(c)).token, 'token', 200, true))
  if (!info) throw new HttpError(400, 'This link has expired or was already used. Ask for a new one.')
  return c.json({ purpose: info.purpose, email: info.email, name: info.name })
})

app.post('/api/auth/reset', async (c) => {
  if (await rateLimited(`reset-ip:${clientIp(c)}`, 30, WINDOW)) throw new HttpError(429, TOO_MANY)
  const body = await json(c)
  const token = text(body.token, 'token', 200, true)
  const password = typeof body.password === 'string' ? body.password : ''
  const info = await checkPasswordToken(token)
  if (!info) throw new HttpError(400, 'This link has expired or was already used. Ask for a new one.')
  const problem = passwordProblem(password, info.email)
  if (problem) throw new HttpError(400, problem)
  const user = await resetPassword(c, token, password)
  if (!user) throw new HttpError(400, 'This link has expired or was already used. Ask for a new one.')
  return c.json({ user })
})

/** Change your own password. Needs the current one, and signs out your other devices. */
app.post('/api/auth/password', async (c) => {
  const user = requireUser(c)
  const body = await json(c)
  const current = typeof body.current === 'string' ? body.current : ''
  const next = typeof body.next === 'string' ? body.next : ''
  const key = `pw-change:${user.id}`
  if (await tooManyFailures(key, 6, WINDOW)) throw new HttpError(429, TOO_MANY)
  const problem = passwordProblem(next, user.email)
  if (problem) throw new HttpError(400, problem)
  if (next === current) throw new HttpError(400, 'Choose a password you have not just used.')
  if (!(await changePassword(c, user, current, next))) {
    await recordFailure(key)
    throw new HttpError(400, 'Your current password is not right.')
  }
  return c.json({ ok: true })
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
    : await all<ReportRow>(`${REPORT_SELECT} WHERE r.submitted_at IS NOT NULL AND r.client_id = ANY($1::text[]) ORDER BY r.seq DESC`, projectArray(user))
  const ids = rows.map((r) => r.id)
  const hist = await historyFor(ids)
  const linked = user.role === 'admin' ? await itemsFor(ids) : new Map<string, LinkedItem[]>()
  return c.json({ reports: rows.map((r) => serialize(r, user, hist.get(r.id) ?? [], linked.get(r.id) ?? [])) })
})

app.get('/api/reports/:id', async (c) => {
  const user = requireUser(c)
  return c.json({ report: await withHistory(await loadReport(user, c.req.param('id')), user) })
})

/** Numbers are sequential (BUG-0001...). Two requests can pick the same next number; the unique
 *  constraint rejects the loser, which simply retries. */
async function insertReport(f: {
  clientId: string; reporterId: string; title: string; description: string; pageUrl: string
  severity: string; kind: Kind; submittedAt: string | null
}): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const row = await one<{ id: string }>(
        `INSERT INTO reports (id, seq, created_at, client_id, reporter_id, title, description, page_url, severity, kind, submitted_at)
         SELECT $10::text || '-' || LPAD(n::text, 4, '0'), n, $1, $2, $3, $4, $5, $6, $7, $8, $9::text
           FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM reports) s
         RETURNING id`,
        now(), f.clientId, f.reporterId, f.title, f.description, f.pageUrl, f.severity, f.kind, f.submittedAt, ID_PREFIX[f.kind],
      )
      if (row) return row.id
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  throw new HttpError(409, 'Could not create the item, please try again')
}

/** Features and questions land on the client's roadmap as soon as they are submitted. */
async function addToRoadmapIfRequest(r: ReportRow) {
  if (!ROADMAP_KINDS.includes(r.kind) || r.roadmap_auto === 1) return
  await createRoadmapItemForReport(
    { query: async (t, p) => (await all(t, ...p)) as Record<string, unknown>[], batch },
    { id: r.id, client_id: r.client_id, title: r.title, description: r.description, created_at: r.created_at },
  )
}

async function announceSubmission(r: ReportRow) {
  await addToRoadmapIfRequest(r)
  const issue = r.kind === 'Bug' || r.kind === 'UAT finding'
  await mailAdmins(`New report from ${r.client_name} · ${r.id}`, [`${r.reporter_name} (${r.client_name}) sent a ${r.kind.toLowerCase()}: ${r.title}`, ...(issue ? [`Severity: ${r.severity}`] : []), r.description], r.id)
  await mailClient(r, `We received your report · ${r.id}`, [`Thanks. We received "${r.title}". We will update you here and by email.`])
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

  // People who belong to several projects say which one this is for. With one project there is nothing to choose.
  const clientId = typeof body.clientId === 'string' && body.clientId ? body.clientId : user.projects.length === 1 ? user.projects[0].id : ''
  if (!user.projects.some((p) => p.id === clientId)) throw new HttpError(400, 'Choose which of your projects this is for')

  const id = await insertReport({
    clientId, reporterId: user.id, title, description, pageUrl, severity, kind,
    submittedAt: withVideo ? null : now(),
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
      // Reopening clears the resolved date. Earlier closures stay in the history.
      set('resolved_at', newStatus === 'Resolved' ? now() : null)
    } else newStatus = null
  }

  if (sets.length) {
    const update: Stmt = [`UPDATE reports SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`, [...vals, r.id]]
    const stmts: Stmt[] = [update]
    if (newStatus) {
      stmts.push(historyStmt(r.id, 'admin', 'status', `Status changed from ${r.status} to ${newStatus}`, r.status, newStatus))
      if (newStatus === 'Resolved') stmts.push(historyStmt(r.id, 'admin', 'outcome', 'Closed by admin'))
    }
    if (stmts.length > 1) await batch(stmts)
    else await run(update[0], ...update[1])
  }
  // Triaging is internal. Every other change the client should know about is emailed once.
  const say = newStatus && STATUS_EMAIL[newStatus]
  if (newStatus && say) await mailClient(r, `${r.id} is ${newStatus}`, say(r))
  return c.json({ report: await withHistory(await loadReport(admin, r.id), admin) })
})

app.post('/api/reports/:id/replies', async (c) => {
  const admin = requireAdmin(c)
  const r = await loadReport(admin, c.req.param('id'))
  const msg = text((await json(c)).text, 'text', 4000, true)
  await addHistory(r.id, 'admin', 'reply', msg)
  await mailClient(r, `New update on ${r.id}`, [`An update on "${r.title}":`, msg])
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
  const to: Status = fixed ? 'Resolved' : 'In progress'
  await batch([
    historyStmt(r.id, 'client', 'status', `Status changed from ${r.status} to ${to}`, r.status, to),
    historyStmt(r.id, 'client', 'outcome', fixed ? 'Verified by client' : `Still broken${note ? `: ${note}` : ''}`),
    fixed
      ? ["UPDATE reports SET status = 'Resolved', resolved_at = $1 WHERE id = $2", [now(), r.id]]
      : ["UPDATE reports SET status = 'In progress', resolved_at = NULL WHERE id = $1", [r.id]],
  ])
  await mailAdmins(`${r.id} · ${fixed ? 'Verified by client' : 'Still broken'}`, [fixed ? `${r.client_name} confirmed the fix for "${r.title}".` : `${r.client_name} says "${r.title}" is still broken.`, ...(note && !fixed ? [note] : [])], r.id)
  return c.json({ report: await withHistory(await loadReport(user, r.id), user) })
})

// A client can approve any of their items as done, not only a fix waiting to be verified.
app.post('/api/reports/:id/approve', async (c) => {
  const user = requireClient(c)
  const r = await loadReport(user, c.req.param('id'))
  if (r.status === 'Resolved') throw new HttpError(409, 'This is already done')
  const note = text((await json(c)).note, 'note', 2000)
  const verified = r.status === 'Ready to verify'
  const outcome = verified ? 'Verified by client' : 'Closed by client'
  // A roadmap item that stands for just this one request is finished too.
  const items = await all<{ id: string; state: string }>(
    `SELECT i.id, i.state FROM roadmap_items i WHERE i.state <> 'Done' AND i.id IN (
       SELECT l.item_id FROM roadmap_links l GROUP BY l.item_id HAVING COUNT(*) = 1 AND MIN(l.report_id) = $1)`,
    r.id,
  )
  await batch([
    historyStmt(r.id, 'client', 'status', `Status changed from ${r.status} to Resolved`, r.status, 'Resolved'),
    historyStmt(r.id, 'client', 'outcome', note ? `${outcome}: ${note}` : outcome),
    ["UPDATE reports SET status = 'Resolved', resolved_at = $1 WHERE id = $2", [now(), r.id]],
    ...items.flatMap((i): Stmt[] => [
      ["UPDATE roadmap_items SET state = 'Done', updated_at = $1 WHERE id = $2", [now(), i.id]],
      ['INSERT INTO roadmap_events (item_id, at, by, text) VALUES ($1, $2, $3, $4)', [i.id, now(), 'client', `Moved from ${i.state} to Done (approved by the client)`]],
    ]),
  ])
  await mailAdmins(`${r.id} · ${outcome}`, [`${r.client_name} approved "${r.title}" as done.`, ...(note ? [note] : [])], r.id)
  return c.json({ report: await withHistory(await loadReport(user, r.id), user) })
})

// A client can bring back something that was closed: it was not really fixed, or they changed their mind.
app.post('/api/reports/:id/reopen', async (c) => {
  const user = requireClient(c)
  const r = await loadReport(user, c.req.param('id'))
  if (r.status !== 'Resolved') throw new HttpError(409, 'Only something that is done can be reopened')
  const note = text((await json(c)).note, 'note', 2000)
  // Back to New, so it lands in the team's Inbox again. A card that stood for just this request leaves Done.
  const items = await all<{ id: string; state: string }>(
    `SELECT i.id, i.state FROM roadmap_items i WHERE i.state = 'Done' AND i.id IN (
       SELECT l.item_id FROM roadmap_links l GROUP BY l.item_id HAVING COUNT(*) = 1 AND MIN(l.report_id) = $1)`,
    r.id,
  )
  await batch([
    historyStmt(r.id, 'client', 'status', 'Status changed from Resolved to New', 'Resolved', 'New'),
    historyStmt(r.id, 'client', 'outcome', note ? `Reopened by client: ${note}` : 'Reopened by client'),
    ["UPDATE reports SET status = 'New', resolved_at = NULL WHERE id = $1", [r.id]],
    ...items.flatMap((i): Stmt[] => [
      ["UPDATE roadmap_items SET state = 'Under review', updated_at = $1 WHERE id = $2", [now(), i.id]],
      ['INSERT INTO roadmap_events (item_id, at, by, text) VALUES ($1, $2, $3, $4)', [i.id, now(), 'client', 'Moved from Done to Under review (reopened by the client)']],
    ]),
  ])
  await mailAdmins(`${r.id} · Reopened by client`, [`${r.client_name} reopened "${r.title}".`, ...(note ? [note] : [])], r.id)
  return c.json({ report: await withHistory(await loadReport(user, r.id), user) })
})

// A client can add to their own ticket after sending it: a better title, more description, a link.
app.patch('/api/reports/:id/details', async (c) => {
  const user = requireClient(c)
  const r = await loadReport(user, c.req.param('id'))
  const body = await json(c)
  const sets: string[] = []
  const vals: string[] = []
  const changed: string[] = []
  const set = (col: string, v: string, label: string) => { vals.push(v); sets.push(`${col} = $${vals.length}`); changed.push(label) }
  if ('title' in body) { const t = text(body.title, 'title', 120, true); if (t !== r.title) set('title', t, 'title') }
  if ('description' in body) { const d = text(body.description, 'description', 4000); if (d !== r.description) set('description', d, 'description') }
  if ('pageUrl' in body) { const u = text(body.pageUrl, 'pageUrl', 500); if (u !== r.page_url) set('page_url', u, 'page or link') }
  if (sets.length) {
    const stmts: Stmt[] = [
      [`UPDATE reports SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`, [...vals, r.id]],
      historyStmt(r.id, 'client', 'edit', `Updated the ${changed.join(' and ')}`),
    ]
    // A roadmap card that stands for just this request shows the same words.
    const t = 'title' in body && changed.includes('title') ? String(body.title).trim() : null
    const d = 'description' in body && changed.includes('description') ? String(body.description).trim() : null
    if (t !== null || d !== null) {
      stmts.push([
        `UPDATE roadmap_items SET title = COALESCE($1, title), description = COALESCE($2, description), updated_at = $3 WHERE id IN (
           SELECT l.item_id FROM roadmap_links l GROUP BY l.item_id HAVING COUNT(*) = 1 AND MIN(l.report_id) = $4)`,
        [t, d, now(), r.id],
      ])
    }
    await batch(stmts)
    await mailAdmins(`${r.id} · Updated by ${r.client_name}`, [`${user.name} updated the ${changed.join(' and ')} of "${r.title}".`], r.id)
  }
  return c.json({ report: await withHistory(await loadReport(user, r.id), user) })
})

// ---------- roadmap items ----------
// Separate from reports. A client only sees items published to their project, with a public description and
// update. Linked reports are never exposed: a client gets at most a count of their own linked reports.

interface ItemRow {
  id: string; seq: number; client_id: string; client_name: string; title: string; description: string
  state: string; target_window: string; client_update: string; published: number; created_at: string; updated_at: string
}
const ITEM_SELECT = 'SELECT i.*, c.name AS client_name FROM roadmap_items i JOIN clients c ON c.id = i.client_id'

async function linkedReports(ids: string[]) {
  const map = new Map<string, { id: string; title: string; status: string; kind: string; submitted: boolean }[]>()
  if (ids.length === 0) return map
  const rows = await all<{ item_id: string; id: string; title: string; status: string; kind: string; submitted_at: string | null }>(
    `SELECT l.item_id, r.id, r.title, r.status, r.kind, r.submitted_at FROM roadmap_links l JOIN reports r ON r.id = l.report_id
      WHERE l.item_id = ANY($1::text[]) ORDER BY r.seq`,
    `{${ids.map((i) => `"${i}"`).join(',')}}`,
  )
  for (const x of rows) (map.get(x.item_id) ?? map.set(x.item_id, []).get(x.item_id)!).push({ id: x.id, title: x.title, status: x.status, kind: x.kind, submitted: !!x.submitted_at })
  return map
}

async function lastMoves(ids: string[]) {
  const map = new Map<string, { by: string; at: string; text: string }>()
  if (ids.length === 0) return map
  const rows = await all<{ item_id: string; at: string; by: string; text: string }>(
    'SELECT DISTINCT ON (item_id) item_id, at, by, text FROM roadmap_events WHERE item_id = ANY($1::text[]) ORDER BY item_id, id DESC',
    `{${ids.map((i) => `"${i}"`).join(',')}}`,
  )
  for (const r of rows) map.set(r.item_id, { by: r.by, at: r.at, text: r.text })
  return map
}

function serializeItem(i: ItemRow, user: AuthUser, links: { id: string; title: string; status: string; kind: string; submitted: boolean }[], moves: Map<string, { by: string; at: string; text: string }> = new Map()) {
  const base = { id: i.id, clientId: i.client_id, title: i.title, description: i.description, state: i.state, targetWindow: i.target_window, clientUpdate: i.client_update, updatedAt: i.updated_at, lastMove: moves.get(i.id) }
  if (user.role === 'admin') {
    return { ...base, clientName: i.client_name, published: i.published === 1, createdAt: i.created_at, reports: links.map(({ id, title, status, kind }) => ({ id, title, status, kind })) }
  }
  // For clients: only a count, and only of reports in their own project that they can already open.
  // Reports in their own project, which they can already open. Lets a card lead to the conversation.
  const open = links.filter((l) => l.submitted)
  return { ...base, linkedCount: open.length, reportIds: open.slice(0, 20).map((l) => l.id) }
}

async function loadItem(user: AuthUser, id: string): Promise<ItemRow> {
  const i = await one<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1`, id)
  if (!i || (user.role === 'client' && (!inProject(user, i.client_id) || i.published !== 1))) throw new HttpError(404, 'Roadmap item not found')
  return i
}

app.get('/api/roadmap', async (c) => {
  const user = requireUser(c)
  const filter = user.role === 'admin' ? (c.req.query('clientId') ?? '') : ''
  const rows = user.role === 'admin'
    ? filter
      ? await all<ItemRow>(`${ITEM_SELECT} WHERE i.client_id = $1 ORDER BY i.seq DESC`, filter)
      : await all<ItemRow>(`${ITEM_SELECT} ORDER BY i.seq DESC`)
    : await all<ItemRow>(`${ITEM_SELECT} WHERE i.client_id = ANY($1::text[]) AND i.published = 1 ORDER BY i.seq DESC`, projectArray(user))
  const ids = rows.map((i) => i.id)
  const links = await linkedReports(ids)
  const moves = await lastMoves(ids)
  return c.json({ items: rows.map((i) => serializeItem(i, user, links.get(i.id) ?? [], moves)) })
})

/** Replaces an item's links. Every report must belong to the item's own project. */
async function linkStatements(itemId: string, clientId: string, reportIds: unknown): Promise<Stmt[]> {
  if (!Array.isArray(reportIds) || reportIds.length > 100 || reportIds.some((x) => typeof x !== 'string')) throw new HttpError(400, 'reportIds must be a list of report ids')
  const ids = [...new Set(reportIds as string[])]
  if (ids.some((i) => !/^[A-Z]+-\d{4,}$/.test(i))) throw new HttpError(400, 'Invalid report id')
  if (ids.length) {
    const ok = await all<{ id: string }>('SELECT id FROM reports WHERE id = ANY($1::text[]) AND client_id = $2', `{${ids.map((i) => `"${i}"`).join(',')}}`, clientId)
    if (ok.length !== ids.length) throw new HttpError(400, 'Some reports were not found in this project')
  }
  return [['DELETE FROM roadmap_links WHERE item_id = $1', [itemId]], ...ids.map((rid): Stmt => ['INSERT INTO roadmap_links (item_id, report_id) VALUES ($1, $2)', [itemId, rid]])]
}

app.post('/api/admin/roadmap', async (c) => {
  requireAdmin(c)
  const body = await json(c)
  const clientId = text(body.clientId, 'clientId', 100, true)
  if (!(await one('SELECT id FROM clients WHERE id = $1', clientId))) throw new HttpError(404, 'Project not found')
  const fields = {
    title: text(body.title, 'title', 120, true),
    description: text(body.description, 'description', 2000),
    state: oneOf(body.state ?? 'Under review', ROADMAP_STATES, 'state'),
    targetWindow: text(body.targetWindow, 'targetWindow', 60),
    clientUpdate: text(body.clientUpdate, 'clientUpdate', 1000),
    published: body.published === true ? 1 : 0, // publishing is always an explicit choice
  }
  const links = body.reportIds === undefined ? [] : await linkStatements('', clientId, body.reportIds)
  let id: string | undefined
  for (let attempt = 0; attempt < 6 && !id; attempt++) {
    try {
      id = (await one<{ id: string }>(
        `INSERT INTO roadmap_items (id, seq, client_id, title, description, state, target_window, client_update, published, created_at, updated_at)
         SELECT 'RM-' || LPAD(n::text, 4, '0'), n, $1, $2, $3, $4, $5, $6, $7, $8, $8 FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM roadmap_items) s
         RETURNING id`,
        clientId, fields.title, fields.description, fields.state, fields.targetWindow, fields.clientUpdate, fields.published, now(),
      ))?.id
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  if (!id) throw new HttpError(409, 'Could not create the roadmap item, please try again')
  const itemId = id
  if (links.length > 1) await batch(links.slice(1).map(([q, p]): Stmt => [q, [itemId, ...p.slice(1)]]))
  const admin = c.get('user')!
  const item = await loadItem(admin, itemId)
  return c.json({ item: serializeItem(item, admin, (await linkedReports([itemId])).get(itemId) ?? [], await lastMoves([itemId])) }, 201)
})

app.patch('/api/admin/roadmap/:id', async (c) => {
  const admin = requireAdmin(c)
  const item = await loadItem(admin, c.req.param('id'))
  const body = await json(c)
  const sets: string[] = []
  const vals: (string | number)[] = []
  const set = (col: string, v: string | number) => { vals.push(v); sets.push(`${col} = $${vals.length}`) }
  if ('title' in body) set('title', text(body.title, 'title', 120, true))
  if ('description' in body) set('description', text(body.description, 'description', 2000))
  let movedTo: string | null = null
  if ('state' in body) {
    const next = oneOf(body.state, ROADMAP_STATES, 'state')
    if (next !== item.state) movedTo = next
    set('state', next)
  }
  if ('targetWindow' in body) set('target_window', text(body.targetWindow, 'targetWindow', 60))
  if ('clientUpdate' in body) set('client_update', text(body.clientUpdate, 'clientUpdate', 1000))
  if ('published' in body) set('published', body.published === true ? 1 : 0)
  const stmts: Stmt[] = []
  if (sets.length) {
    set('updated_at', now())
    stmts.push([`UPDATE roadmap_items SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`, [...vals.map(String), item.id]])
  }
  if (movedTo) stmts.push(['INSERT INTO roadmap_events (item_id, at, by, text) VALUES ($1, $2, $3, $4)', [item.id, now(), 'admin', `Moved from ${item.state} to ${movedTo}`]])
  if ('reportIds' in body) {
    const links = await linkStatements(item.id, item.client_id, body.reportIds)
    stmts.push(...links)
    stmts.push(['UPDATE roadmap_items SET updated_at = $1 WHERE id = $2', [now(), item.id]])
  }
  if (stmts.length) await batch(stmts)
  const fresh = await loadItem(admin, item.id)
  return c.json({ item: serializeItem(fresh, admin, (await linkedReports([item.id])).get(item.id) ?? [], await lastMoves([item.id])) })
})

// A client can rearrange the cards on their own roadmap. Every move is recorded and the team is told.
app.patch('/api/roadmap/:id', async (c) => {
  const user = requireClient(c)
  const item = await loadItem(user, c.req.param('id'))
  const state = oneOf((await json(c)).state, ROADMAP_STATES, 'state')
  if (state !== item.state) {
    await batch([
      ['UPDATE roadmap_items SET state = $1, updated_at = $2 WHERE id = $3', [state, now(), item.id]],
      ['INSERT INTO roadmap_events (item_id, at, by, text) VALUES ($1, $2, $3, $4)', [item.id, now(), 'client', `Moved from ${item.state} to ${state}`]],
    ])
    await mailAdmins(`${item.client_name} moved "${item.title}" to ${state}`, [`${user.name} (${item.client_name}) moved "${item.title}" from ${item.state} to ${state} on their roadmap.`], item.id, `${config.appUrl}/admin/roadmap`, 'Open the roadmap')
  }
  const fresh = await loadItem(user, item.id)
  return c.json({ item: serializeItem(fresh, user, (await linkedReports([item.id])).get(item.id) ?? [], await lastMoves([item.id])) })
})

app.delete('/api/admin/roadmap/:id', async (c) => {
  const admin = requireAdmin(c)
  const item = await loadItem(admin, c.req.param('id'))
  await run('DELETE FROM roadmap_items WHERE id = $1', item.id)
  return c.json({ ok: true })
})

// ---------- admin: clients and their users ----------

app.get('/api/admin/clients', async (c) => {
  requireAdmin(c)
  const clients = await all<{ id: string; name: string; created_at: string }>('SELECT id, name, created_at FROM clients ORDER BY name')
  const users = await all<{ id: string; email: string; name: string; client_id: string; has_password: boolean; created_at: string }>(
    `SELECT u.id, u.email, u.name, m.client_id, (u.password_hash IS NOT NULL) AS has_password, u.created_at
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.role = 'client' AND u.removed_at IS NULL ORDER BY u.name`,
  )
  const reports = await all<{ client_id: string; total: number; open: number }>(
    "SELECT client_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status <> 'Resolved')::int AS open FROM reports WHERE submitted_at IS NOT NULL GROUP BY client_id",
  )
  const items = await all<{ client_id: string; n: number }>('SELECT client_id, COUNT(*)::int AS n FROM roadmap_items GROUP BY client_id')
  return c.json({
    clients: clients.map((cl) => ({
      id: cl.id,
      name: cl.name,
      createdAt: cl.created_at,
      reportCount: reports.find((r) => r.client_id === cl.id)?.total ?? 0,
      openCount: reports.find((r) => r.client_id === cl.id)?.open ?? 0,
      itemCount: items.find((i) => i.client_id === cl.id)?.n ?? 0,
      users: users.filter((u) => u.client_id === cl.id).map((u) => ({ id: u.id, email: u.email, name: u.name, hasPassword: u.has_password === true, invitedAt: u.created_at })),
    })),
  })
})

app.post('/api/admin/clients', async (c) => {
  requireAdmin(c)
  const name = text((await json(c)).name, 'name', 100, true)
  const id = crypto.randomUUID()
  await run('INSERT INTO clients (id, name, created_at) VALUES ($1, $2, $3)', id, name, now())
  return c.json({ client: { id, name, users: [] } }, 201)
})

// Rename a project. Its name is read from here everywhere else, so reports, the roadmap, emails and clients' own
// screens all show the new name straight away. Two projects cannot share a name: they could not be told apart.
app.patch('/api/admin/clients/:id', async (c) => {
  requireAdmin(c)
  const client = await one<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', c.req.param('id'))
  if (!client) throw new HttpError(404, 'Project not found')
  const name = text((await json(c)).name, 'name', 100, true)
  if (await one('SELECT 1 AS x FROM clients WHERE LOWER(name) = LOWER($1) AND id <> $2', name, client.id)) {
    throw new HttpError(409, 'Another project already has that name.')
  }
  if (name !== client.name) await run('UPDATE clients SET name = $1 WHERE id = $2', name, client.id)
  return c.json({ client: { id: client.id, name } })
})

app.post('/api/admin/clients/:id/users', async (c) => {
  requireAdmin(c)
  const client = await one<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', c.req.param('id'))
  if (!client) throw new HttpError(404, 'Client not found')
  const body = await json(c)
  const email = text(body.email, 'email', 200, true).toLowerCase()
  const name = text(body.name, 'name', 100, true)
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address')
  // Someone who already has an account can be added to another project. They keep one sign-in.
  const existing = await one<{ id: string; role: string; name: string; removed_at: string | null }>('SELECT id, role, name, removed_at FROM users WHERE email = $1', email)
  let id: string
  let addedToExisting = false
  if (existing?.removed_at) {
    // Someone who was removed and is invited again starts fresh: new invitation, new password.
    if (existing.role !== 'client') throw new HttpError(409, 'This address belongs to a team member.')
    id = existing.id
    await batch([
      ['UPDATE users SET removed_at = NULL, password_hash = NULL, name = $1, client_id = $2 WHERE id = $3', [name, client.id, id]],
      ['INSERT INTO memberships (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, client.id]],
    ])
    const sent = (await sendPasswordEmail({ id, email, name }, 'invite', client.name)).sent
    return c.json({ user: { id, email, name }, emailSent: sent, addedToExisting: false, reinstated: true }, 201)
  }
  if (existing) {
    if (existing.role !== 'client') throw new HttpError(409, 'This address belongs to a team member.')
    if (await one('SELECT 1 AS x FROM memberships WHERE user_id = $1 AND client_id = $2', existing.id, client.id)) throw new HttpError(409, 'They are already in this project.')
    id = existing.id
    addedToExisting = true
    await run('INSERT INTO memberships (user_id, client_id) VALUES ($1, $2)', id, client.id)
  } else {
    id = crypto.randomUUID()
    await run("INSERT INTO users (id, email, name, role, client_id, created_at) VALUES ($1, $2, $3, 'client', $4, $5)", id, email, name, client.id, now())
    await run('INSERT INTO memberships (user_id, client_id) VALUES ($1, $2)', id, client.id)
  }
  let emailSent: boolean
  if (addedToExisting) {
    // They already have a password. Tell them about the new project and point at the project switcher.
    emailSent = await sendQuietly({
      to: email,
      subject: `You now have access to ${client.name}`,
      text: `Hi ${existing?.name},\n\nYou can now also send reports and see the roadmap for ${client.name}. Use the project menu to switch between your projects.\nSign in: ${config.appUrl}`,
      html: layout(`You now have access to ${client.name}`, `<p>You can now also send reports and see the roadmap for <strong>${escapeHtml(client.name)}</strong>. Use the project menu to switch between your projects.</p>`, { label: 'Open SEAM', url: config.appUrl }),
    })
  } else {
    emailSent = (await sendPasswordEmail({ id, email, name }, 'invite', client.name)).sent
  }
  return c.json({ user: { id, email, name: existing?.name ?? name }, emailSent, addedToExisting }, 201)
})

// Give someone the name you know them by.
app.patch('/api/admin/users/:id', async (c) => {
  requireAdmin(c)
  const name = text((await json(c)).name, 'name', 100, true)
  const u = await one<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = $1 AND role = 'client' AND removed_at IS NULL", c.req.param('id'))
  if (!u) throw new HttpError(404, 'Person not found')
  await run('UPDATE users SET name = $1 WHERE id = $2', name, u.id)
  return c.json({ user: { id: u.id, email: u.email, name } })
})

/**
 * Take someone out of one project, whether or not they ever accepted. If that was their last project, their access
 * ends altogether and every session is signed out. What they reported stays, with their name on it.
 */
app.delete('/api/admin/clients/:clientId/users/:userId', async (c) => {
  requireAdmin(c)
  const { clientId, userId } = c.req.param()
  const m = await one<{ name: string; email: string }>(
    `SELECT u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.client_id = $1 AND m.user_id = $2 AND u.role = 'client' AND u.removed_at IS NULL`,
    clientId, userId,
  )
  if (!m) throw new HttpError(404, 'That person is not in this project')
  const other = await one<{ client_id: string }>('SELECT client_id FROM memberships WHERE user_id = $1 AND client_id <> $2 LIMIT 1', userId, clientId)
  const stmts: Stmt[] = [['DELETE FROM memberships WHERE user_id = $1 AND client_id = $2', [userId, clientId]]]
  if (other) {
    stmts.push(['UPDATE users SET client_id = $1 WHERE id = $2 AND client_id = $3', [other.client_id, userId, clientId]])
  } else {
    stmts.push(
      ['UPDATE users SET removed_at = $1, password_hash = NULL, client_id = NULL WHERE id = $2', [now(), userId]],
      ['DELETE FROM sessions WHERE user_id = $1', [userId]],
      ['DELETE FROM login_tokens WHERE user_id = $1', [userId]],
    )
  }
  await batch(stmts)
  return c.json({ ok: true, accountRemoved: !other })
})

/**
 * Delete a project and everything in it: its reports, history, roadmap and videos. People who belonged only to it
 * lose their access. The name must be typed back exactly, so this cannot happen by accident.
 */
app.post('/api/admin/clients/:id/delete', async (c) => {
  requireAdmin(c)
  const client = await one<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = $1', c.req.param('id'))
  if (!client) throw new HttpError(404, 'Project not found')
  if (text((await json(c)).confirm, 'confirm', 200) !== client.name) throw new HttpError(400, 'Type the project name exactly to confirm.')

  const orphans = (await all<{ id: string }>(
    `SELECT m.user_id AS id FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.client_id = $1 AND u.role = 'client' AND NOT EXISTS (SELECT 1 FROM memberships m2 WHERE m2.user_id = m.user_id AND m2.client_id <> $1)`,
    client.id,
  )).map((o) => o.id)
  const videos = (await all<{ video_path: string }>("SELECT video_path FROM reports WHERE client_id = $1 AND video_path IS NOT NULL AND video_path <> ''", client.id)).map((v) => v.video_path)
  const counts = await one<{ reports: number; items: number }>(
    'SELECT (SELECT COUNT(*)::int FROM reports WHERE client_id = $1) AS reports, (SELECT COUNT(*)::int FROM roadmap_items WHERE client_id = $1) AS items',
    client.id,
  )
  const list = `{${orphans.map((i) => `"${i}"`).join(',')}}`

  await batch([
    // Anyone whose only project this was loses access for good.
    ['UPDATE users SET removed_at = $1, password_hash = NULL WHERE id = ANY($2::text[])', [now(), list]],
    ['DELETE FROM sessions WHERE user_id = ANY($1::text[])', [list]],
    ['DELETE FROM login_tokens WHERE user_id = ANY($1::text[])', [list]],
    ['UPDATE users SET client_id = NULL WHERE client_id = $1', [client.id]],
    ['DELETE FROM roadmap_items WHERE client_id = $1', [client.id]],
    ['DELETE FROM reports WHERE client_id = $1', [client.id]],
    ['DELETE FROM clients WHERE id = $1', [client.id]], // memberships go with it
  ])
  // The records are gone. Now the files, which can fail without harming anything.
  await getStorage().remove(videos).catch((e) => console.error('[storage] could not delete videos:', e instanceof Error ? e.message : e))
  return c.json({ ok: true, deleted: { reports: counts?.reports ?? 0, items: counts?.items ?? 0, people: orphans.length, videos: videos.length } })
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

// Send someone a link to set or reset their password. Useful when an invitation email did not arrive.
app.post('/api/admin/users/:id/password-link', async (c) => {
  requireAdmin(c)
  const u = await one<{ id: string; email: string; name: string; password_hash: string | null }>('SELECT id, email, name, password_hash FROM users WHERE id = $1 AND removed_at IS NULL', c.req.param('id'))
  if (!u) throw new HttpError(404, 'Person not found')
  const { sent } = await sendPasswordEmail(u, u.password_hash ? 'reset' : 'invite')
  return c.json({ emailSent: sent, hadPassword: !!u.password_hash })
})

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

// ---------- self-hosted production: serve the built frontend ----------
// On Vercel the static files are served by Vercel itself, so this only applies to plain Node hosting.

if (config.isProd && !config.onVercel) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}
