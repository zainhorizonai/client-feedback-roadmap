import crypto from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config'
import { all, one, run, tx } from './db'
import { clientIp, logout, rateLimited, requestLogin, verifyLogin, withUser, type AuthUser } from './auth'
import { escapeHtml, layout, sendQuietly } from './email'
import { isAllowedMime, normalizeMime, saveVideo, serveVideo, TooLargeError } from './storage'

type Env = { Variables: { user: AuthUser | null } }
export const app = new Hono<Env>()

const STATUSES = ['New', 'Triaging', 'In progress', 'Ready to verify', 'Resolved'] as const
const SEVERITIES = ['Low', 'Medium', 'High', 'Blocker'] as const
type Status = (typeof STATUSES)[number]

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

// ---------- reports ----------

interface ReportRow {
  id: string; seq: number; created_at: string; client_id: string; client_name: string
  reporter_id: string; reporter_name: string; reporter_email: string
  title: string; description: string; page_url: string; severity: string; status: Status
  notes: string; resolution_url: string; video_path: string | null; resolved_at: string | null
}
interface HistoryRow { report_id: string; at: string; by: string; kind: string; text: string }

const REPORT_SELECT = `SELECT r.*, c.name AS client_name, u.name AS reporter_name, u.email AS reporter_email
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
    // Internal notes never leave the server for clients.
    ...(user.role === 'admin' ? { notes: r.notes } : {}),
    resolutionUrl: r.resolution_url,
    hasVideo: !!r.video_path,
    resolvedAt: r.resolved_at ?? undefined,
    history: history.map(({ at, by, kind, text }) => ({ at, by, kind, text })),
  }
}

function historyFor(ids: string[]): Map<string, HistoryRow[]> {
  const map = new Map<string, HistoryRow[]>()
  if (ids.length === 0) return map
  const rows = all<HistoryRow>(`SELECT report_id, at, by, kind, text FROM history WHERE report_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids)
  for (const h of rows) (map.get(h.report_id) ?? map.set(h.report_id, []).get(h.report_id)!).push(h)
  return map
}

/** Loads a report the user may see. Unknown and forbidden both read as 404 so ids cannot be probed. */
function loadReport(user: AuthUser, id: string): ReportRow {
  const r = one<ReportRow>(`${REPORT_SELECT} WHERE r.id = ?`, id)
  if (!r) throw new HttpError(404, 'Report not found')
  if (user.role === 'client' && r.client_id !== user.clientId) throw new HttpError(404, 'Report not found')
  return r
}

const addHistory = (id: string, by: 'client' | 'admin' | 'system', kind: string, msg: string) =>
  run('INSERT INTO history (report_id, at, by, kind, text) VALUES (?, ?, ?, ?, ?)', id, now(), by, kind, msg)

function adminEmails(): string[] {
  return all<{ email: string }>("SELECT email FROM users WHERE role = 'admin'").map((a) => a.email)
}

const adminLink = (id: string) => `${config.appUrl}/admin?report=${id}`
const clientLink = (id: string) => `${config.appUrl}/reports/${id}`

function mailAdmins(subject: string, lines: string[], id: string) {
  sendQuietly({
    to: adminEmails(),
    subject,
    text: `${lines.join('\n')}\n\n${adminLink(id)}`,
    html: layout(subject, lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(''), { label: 'Open in tracker', url: adminLink(id) }),
  })
}
function mailClient(r: ReportRow, subject: string, lines: string[]) {
  sendQuietly({
    to: r.reporter_email,
    subject,
    text: `Hi ${r.reporter_name},\n\n${lines.join('\n')}\n\n${clientLink(r.id)}`,
    html: layout(subject, `<p>Hi ${escapeHtml(r.reporter_name)},</p>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}`, { label: 'View report', url: clientLink(r.id) }),
  })
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

// Small JSON bodies only. The video upload route streams and enforces its own limit.
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'PUT' && c.req.path.endsWith('/video')) return next()
  return bodyLimit({ maxSize: 64 * 1024, onError: (ctx) => ctx.json({ error: 'Request too large' }, 413) })(c, next)
})

// ---------- auth ----------

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/me', (c) => c.json({ user: c.get('user') }))

app.post('/api/auth/request', async (c) => {
  const body = await json(c)
  const email = text(body.email, 'email', 200, true).toLowerCase()
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address')
  if (rateLimited(`req-ip:${clientIp(c)}`, 20, 15 * 60_000) || rateLimited(`req-email:${email}`, 5, 15 * 60_000)) {
    throw new HttpError(429, 'Too many attempts. Try again in a few minutes.')
  }
  const link = requestLogin(email)
  // The response is identical whether or not the address is known. The link is only echoed in local dev.
  const devLink = link && !config.isProd && config.emailProvider === 'console' ? link : undefined
  return c.json({ ok: true, devLink })
})

app.post('/api/auth/verify', async (c) => {
  if (rateLimited(`verify-ip:${clientIp(c)}`, 30, 15 * 60_000)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.')
  const body = await json(c)
  const user = verifyLogin(c, text(body.token, 'token', 200, true))
  if (!user) throw new HttpError(400, 'This sign-in link is invalid or has expired. Request a new one.')
  return c.json({ user })
})

app.post('/api/auth/logout', (c) => {
  logout(c)
  return c.json({ ok: true })
})

// ---------- reports ----------

app.get('/api/reports', (c) => {
  const user = requireUser(c)
  // Reports with no video yet are unfinished drafts and stay hidden.
  const rows = user.role === 'admin'
    ? all<ReportRow>(`${REPORT_SELECT} WHERE r.video_path IS NOT NULL ORDER BY r.seq DESC`)
    : all<ReportRow>(`${REPORT_SELECT} WHERE r.video_path IS NOT NULL AND r.client_id = ? ORDER BY r.seq DESC`, user.clientId)
  const hist = historyFor(rows.map((r) => r.id))
  return c.json({ reports: rows.map((r) => serialize(r, user, hist.get(r.id) ?? [])) })
})

app.get('/api/reports/:id', (c) => {
  const user = requireUser(c)
  const r = loadReport(user, c.req.param('id'))
  return c.json({ report: serialize(r, user, historyFor([r.id]).get(r.id) ?? []) })
})

app.post('/api/reports', async (c) => {
  const user = requireClient(c)
  const body = await json(c)
  const title = text(body.title, 'title', 120, true)
  const description = text(body.description, 'description', 4000)
  const pageUrl = text(body.pageUrl, 'pageUrl', 500)
  const severity = oneOf(body.severity ?? 'Medium', SEVERITIES, 'severity')

  const id = tx(() => {
    const seq = (one<{ n: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM reports')?.n ?? 1)
    const rid = `BUG-${String(seq).padStart(4, '0')}`
    run(
      'INSERT INTO reports (id, seq, created_at, client_id, reporter_id, title, description, page_url, severity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      rid, seq, now(), user.clientId, user.id, title, description, pageUrl, severity,
    )
    return rid
  })
  const r = loadReport(user, id)
  return c.json({ report: serialize(r, user, []) }, 201)
})

const uploading = new Set<string>()

app.put('/api/reports/:id/video', async (c) => {
  const user = requireClient(c)
  const r = loadReport(user, c.req.param('id'))
  if (r.reporter_id !== user.id) throw new HttpError(403, 'Only the reporter can upload the video')
  if (r.video_path !== null) throw new HttpError(409, 'This report already has a video')

  const mime = normalizeMime(c.req.header('content-type'))
  if (!isAllowedMime(mime)) throw new HttpError(415, 'Unsupported video type. Use WebM, MP4 or MOV.')
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > config.maxVideoBytes) throw new HttpError(413, `Video is larger than ${Math.round(config.maxVideoBytes / 1024 / 1024)} MB`)
  if (!c.req.raw.body) throw new HttpError(400, 'Empty upload')
  if (uploading.has(r.id)) throw new HttpError(409, 'An upload for this report is already in progress')

  uploading.add(r.id)
  let saved: { file: string; size: number }
  try {
    saved = await saveVideo(r.id, mime, c.req.raw.body)
  } catch (e) {
    if (e instanceof TooLargeError) throw new HttpError(413, `Video is larger than ${Math.round(config.maxVideoBytes / 1024 / 1024)} MB`)
    throw new HttpError(400, 'Upload failed or was empty')
  } finally {
    uploading.delete(r.id)
  }

  tx(() => {
    run('UPDATE reports SET video_path = ?, video_mime = ?, video_size = ? WHERE id = ?', saved.file, mime, saved.size, r.id)
    addHistory(r.id, 'client', 'created', 'Report submitted')
  })

  mailAdmins(`New ${r.severity} report from ${r.client_name}: ${r.title}`, [`${r.reporter_name} (${r.client_name}) submitted ${r.id}.`, `Severity: ${r.severity}`, r.description], r.id)
  mailClient(r, `We received your report ${r.id}`, [`Thanks, we received "${r.title}" and will update you here and by email.`])

  const fresh = loadReport(user, r.id)
  return c.json({ report: serialize(fresh, user, historyFor([r.id]).get(r.id) ?? []) })
})

app.get('/api/reports/:id/video', (c) => {
  const user = requireUser(c)
  const r = loadReport(user, c.req.param('id'))
  const v = one<{ video_path: string | null; video_mime: string | null }>('SELECT video_path, video_mime FROM reports WHERE id = ?', r.id)
  if (!v?.video_path || !v.video_mime) throw new HttpError(404, 'No video for this report')
  return serveVideo(v.video_path, v.video_mime, c.req.header('range'))
})

// A client can discard a draft whose upload failed.
app.delete('/api/reports/:id', (c) => {
  const user = requireClient(c)
  const r = loadReport(user, c.req.param('id'))
  if (r.reporter_id !== user.id) throw new HttpError(403, 'Not your report')
  if (r.video_path !== null) throw new HttpError(409, 'Submitted reports cannot be deleted')
  run('DELETE FROM reports WHERE id = ?', r.id)
  return c.json({ ok: true })
})

app.patch('/api/reports/:id', async (c) => {
  const admin = requireAdmin(c)
  const r = loadReport(admin, c.req.param('id'))
  const body = await json(c)

  const sets: string[] = []
  const vals: (string | null)[] = []
  const set = (col: string, v: string | null) => { sets.push(`${col} = ?`); vals.push(v) }

  if ('title' in body) set('title', text(body.title, 'title', 120, true))
  if ('description' in body) set('description', text(body.description, 'description', 4000))
  if ('pageUrl' in body) set('page_url', text(body.pageUrl, 'pageUrl', 500))
  if ('severity' in body) set('severity', oneOf(body.severity, SEVERITIES, 'severity'))
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

  if (sets.length) {
    tx(() => {
      run(`UPDATE reports SET ${sets.join(', ')} WHERE id = ?`, ...vals, r.id)
      if (newStatus) addHistory(r.id, 'admin', 'status', `Status changed from ${r.status} to ${newStatus}`)
    })
  }
  if (newStatus) {
    mailClient(r, `${r.id} is now "${newStatus}"`, [`The status of "${r.title}" changed from ${r.status} to ${newStatus}.`])
  }
  const fresh = loadReport(admin, r.id)
  return c.json({ report: serialize(fresh, admin, historyFor([r.id]).get(r.id) ?? []) })
})

app.post('/api/reports/:id/replies', async (c) => {
  const admin = requireAdmin(c)
  const r = loadReport(admin, c.req.param('id'))
  const msg = text((await json(c)).text, 'text', 4000, true)
  addHistory(r.id, 'admin', 'reply', msg)
  mailClient(r, `New reply on ${r.id}`, [`Reply about "${r.title}":`, msg])
  return c.json({ report: serialize(r, admin, historyFor([r.id]).get(r.id) ?? []) })
})

app.post('/api/reports/:id/comments', async (c) => {
  const user = requireClient(c)
  const r = loadReport(user, c.req.param('id'))
  const msg = text((await json(c)).text, 'text', 4000, true)
  addHistory(r.id, 'client', 'comment', msg)
  mailAdmins(`New comment on ${r.id} from ${r.client_name}`, [`${user.name} commented on "${r.title}":`, msg], r.id)
  return c.json({ report: serialize(r, user, historyFor([r.id]).get(r.id) ?? []) })
})

app.post('/api/reports/:id/confirm', async (c) => {
  const user = requireClient(c)
  const r = loadReport(user, c.req.param('id'))
  if (r.status !== 'Ready to verify') throw new HttpError(409, 'This report is not waiting for your confirmation')
  const body = await json(c)
  const fixed = body.fixed === true
  const note = text(body.note, 'note', 2000)
  const msg = fixed ? 'Client confirmed the fix' : `Client says it is still broken${note ? `: ${note}` : ''}`
  tx(() => {
    addHistory(r.id, 'client', 'confirm', msg)
    if (fixed) run("UPDATE reports SET status = 'Resolved', resolved_at = ? WHERE id = ?", now(), r.id)
    else run("UPDATE reports SET status = 'In progress', resolved_at = NULL WHERE id = ?", r.id)
  })
  mailAdmins(fixed ? `${r.id} confirmed fixed by ${r.client_name}` : `${r.id} is still broken (${r.client_name})`, [msg], r.id)
  const fresh = loadReport(user, r.id)
  return c.json({ report: serialize(fresh, user, historyFor([r.id]).get(r.id) ?? []) })
})

// ---------- admin: clients and their users ----------

app.get('/api/admin/clients', (c) => {
  requireAdmin(c)
  const clients = all<{ id: string; name: string; created_at: string }>('SELECT id, name, created_at FROM clients ORDER BY name')
  const users = all<{ id: string; email: string; name: string; client_id: string }>("SELECT id, email, name, client_id FROM users WHERE role = 'client' ORDER BY name")
  return c.json({
    clients: clients.map((cl) => ({ id: cl.id, name: cl.name, createdAt: cl.created_at, users: users.filter((u) => u.client_id === cl.id).map(({ id, email, name }) => ({ id, email, name })) })),
  })
})

app.post('/api/admin/clients', async (c) => {
  requireAdmin(c)
  const name = text((await json(c)).name, 'name', 100, true)
  const id = crypto.randomUUID()
  run('INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)', id, name, now())
  return c.json({ client: { id, name, users: [] } }, 201)
})

app.post('/api/admin/clients/:id/users', async (c) => {
  requireAdmin(c)
  const client = one<{ id: string; name: string }>('SELECT id, name FROM clients WHERE id = ?', c.req.param('id'))
  if (!client) throw new HttpError(404, 'Client not found')
  const body = await json(c)
  const email = text(body.email, 'email', 200, true).toLowerCase()
  const name = text(body.name, 'name', 100, true)
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address')
  if (one('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'A user with this email already exists')
  const id = crypto.randomUUID()
  run("INSERT INTO users (id, email, name, role, client_id, created_at) VALUES (?, ?, ?, 'client', ?, ?)", id, email, name, client.id, now())
  sendQuietly({
    to: email,
    subject: `You have been invited to report issues for ${client.name}`,
    text: `Hi ${name},\n\nYou can now send us bug and UAT reports as short videos.\nSign in with your email (no password needed): ${config.appUrl}`,
    html: layout(`Welcome, ${name}`, `<p>You can now send us bug and UAT reports as short videos for <strong>${escapeHtml(client.name)}</strong>. Sign in with your email, no password needed.</p>`, { label: 'Open the portal', url: config.appUrl }),
  })
  return c.json({ user: { id, email, name } }, 201)
})

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

// ---------- production: serve the built frontend ----------

if (config.isProd) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}
