import crypto from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { config } from './config'
import { one, run } from './db'
import { escapeHtml, layout, sendQuietly } from './email'

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

/** Tiny in-memory limiter. Good enough for one instance; use Redis if you scale out. */
const hits = new Map<string, number[]>()
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  recent.push(now)
  hits.set(key, recent)
  return recent.length > max
}

export const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local'

export function ensureAdmins() {
  for (const email of config.adminEmails) {
    if (!one('SELECT id FROM users WHERE email = ?', email)) {
      run("INSERT INTO users (id, email, name, role, client_id, created_at) VALUES (?, ?, ?, 'admin', NULL, ?)", crypto.randomUUID(), email, email.split('@')[0], new Date().toISOString())
    }
  }
}

/** Creates a one-time sign-in token and emails the link. Returns the link only outside production. */
export function requestLogin(email: string): string | null {
  const user = one<{ id: string; name: string }>('SELECT id, name FROM users WHERE email = ?', email)
  if (!user) return null // do not reveal whether the address exists
  const token = randomToken()
  run('INSERT INTO login_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), user.id, Date.now() + TOKEN_TTL_MS)
  const link = `${config.appUrl}/auth/verify?token=${token}`
  sendQuietly({
    to: email,
    subject: 'Your sign-in link',
    text: `Hi ${user.name},\n\nUse this link to sign in (valid for 15 minutes, one use):\n${link}\n\nIf you did not ask for this, ignore this email.`,
    html: layout('Sign in', `<p>Hi ${escapeHtml(user.name)}, use the button below to sign in. The link works once and expires in 15 minutes.</p>`, { label: 'Sign in', url: link }),
  })
  return link
}

export function verifyLogin(c: Context, token: string): AuthUser | null {
  const row = one<{ user_id: string; expires_at: number; used_at: number | null }>('SELECT user_id, expires_at, used_at FROM login_tokens WHERE token_hash = ?', sha256(token))
  if (!row || row.used_at || row.expires_at < Date.now()) return null
  run('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?', Date.now(), sha256(token))
  const sid = randomToken()
  run('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(sid), row.user_id, Date.now() + SESSION_TTL_MS)
  setCookie(c, COOKIE, sid, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
  return loadUser(row.user_id)
}

export function logout(c: Context) {
  const sid = getCookie(c, COOKIE)
  if (sid) run('DELETE FROM sessions WHERE id_hash = ?', sha256(sid))
  deleteCookie(c, COOKIE, { path: '/' })
}

function loadUser(id: string): AuthUser | null {
  const u = one<{ id: string; email: string; name: string; role: 'admin' | 'client'; client_id: string | null; client_name: string | null }>(
    'SELECT u.id, u.email, u.name, u.role, u.client_id, c.name AS client_name FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.id = ?',
    id,
  )
  return u ? { id: u.id, email: u.email, name: u.name, role: u.role, clientId: u.client_id, clientName: u.client_name } : null
}

export const withUser: MiddlewareHandler<{ Variables: { user: AuthUser | null } }> = async (c, next) => {
  let user: AuthUser | null = null
  const sid = getCookie(c, COOKIE)
  if (sid) {
    const s = one<{ user_id: string; expires_at: number }>('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?', sha256(sid))
    if (s && s.expires_at > Date.now()) user = loadUser(s.user_id)
    else if (s) run('DELETE FROM sessions WHERE id_hash = ?', sha256(sid))
  }
  c.set('user', user)
  await next()
}
