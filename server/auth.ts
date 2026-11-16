import crypto from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { config } from './config.js'
import { one, run } from './db.js'
import { escapeHtml, layout, sendQuietly } from './email.js'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'client'
  clientId: string | null
  clientName: string | null
}

const COOKIE = 'sid'
const TOKEN_TTL_MS = 15 * 60 * 1000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const randomToken = () => crypto.randomBytes(32).toString('base64url')
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString()

/** Sliding-window limiter backed by the database, so it holds across serverless instances. */
export async function rateLimited(key: string, max: number, windowMs: number): Promise<boolean> {
  await run('INSERT INTO rate_hits (key, at) VALUES ($1, $2)', key, iso())
  const row = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM rate_hits WHERE key = $1 AND at > $2', key, iso(-windowMs))
  return (row?.n ?? 0) > max
}

export const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local'

async function ensureAdminUser(email: string) {
  await run(
    "INSERT INTO users (id, email, name, role, client_id, created_at) VALUES ($1, $2, $3, 'admin', NULL, $4) ON CONFLICT (email) DO NOTHING",
    crypto.randomUUID(), email, email.split('@')[0], iso(),
  )
}

export async function ensureAdmins() {
  for (const email of config.adminEmails) await ensureAdminUser(email)
}

/** Creates a one-time sign-in token and emails the link. Returns the link only so local dev can show it. */
export async function requestLogin(email: string): Promise<string | null> {
  // Addresses listed in ADMIN_EMAILS become admins the first time they ask to sign in.
  if (config.adminEmails.includes(email)) await ensureAdminUser(email)
  const user = await one<{ id: string; name: string }>('SELECT id, name FROM users WHERE email = $1', email)
  if (!user) return null // do not reveal whether the address exists
  const token = randomToken()
  await run('INSERT INTO login_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', sha256(token), user.id, iso(TOKEN_TTL_MS))
  const link = `${config.appUrl}/auth/verify?token=${token}`
  await sendQuietly({
    to: email,
    subject: 'Your sign-in link',
    text: `Hi ${user.name},\n\nUse this link to sign in (valid for 15 minutes, one use):\n${link}\n\nIf you did not ask for this, ignore this email.`,
    html: layout('Sign in', `<p>Hi ${escapeHtml(user.name)}, use the button below to sign in. The link works once and expires in 15 minutes.</p>`, { label: 'Sign in', url: link }),
  })
  return link
}

export async function verifyLogin(c: Context, token: string): Promise<AuthUser | null> {
  // One atomic statement: only the first caller can claim a token, so it is single use even under races.
  const claimed = await one<{ user_id: string }>(
    'UPDATE login_tokens SET used_at = $1 WHERE token_hash = $2 AND used_at IS NULL AND expires_at > $1 RETURNING user_id',
    iso(), sha256(token),
  )
  if (!claimed) return null
  const sid = randomToken()
  await run('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, $3)', sha256(sid), claimed.user_id, iso(SESSION_TTL_MS))
  setCookie(c, COOKIE, sid, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
  return loadUserBySession(sid)
}

export async function logout(c: Context) {
  const sid = getCookie(c, COOKIE)
  if (sid) await run('DELETE FROM sessions WHERE id_hash = $1', sha256(sid))
  deleteCookie(c, COOKIE, { path: '/' })
}

async function loadUserBySession(sid: string): Promise<AuthUser | null> {
  const u = await one<{ id: string; email: string; name: string; role: 'admin' | 'client'; client_id: string | null; client_name: string | null }>(
    `SELECT u.id, u.email, u.name, u.role, u.client_id, c.name AS client_name
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN clients c ON c.id = u.client_id
      WHERE s.id_hash = $1 AND s.expires_at > $2`,
    sha256(sid), iso(),
  )
  return u ? { id: u.id, email: u.email, name: u.name, role: u.role, clientId: u.client_id, clientName: u.client_name } : null
}

export const withUser: MiddlewareHandler<{ Variables: { user: AuthUser | null } }> = async (c, next) => {
  const sid = getCookie(c, COOKIE)
  c.set('user', sid ? await loadUserBySession(sid) : null)
  await next()
}
