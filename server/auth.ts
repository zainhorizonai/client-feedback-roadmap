import crypto from 'node:crypto'
import { promisify } from 'node:util'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { config } from './config.js'
import { one, run } from './db.js'
import { escapeHtml, layout, logEmailEvent, sendQuietly } from './email.js'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'client'
  /** The client's first project. Kept so single-project code keeps working. */
  clientId: string | null
  clientName: string | null
  /** Every project this person belongs to. Empty for admins, who can see them all. */
  projects: { id: string; name: string }[]
}

const COOKIE = 'sid'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** An invitation link stays valid for a week. A reset link for an hour. */
const TOKEN_TTL_MS = { invite: 7 * 24 * 3600_000, reset: 3600_000 } as const
export type TokenPurpose = keyof typeof TOKEN_TTL_MS

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const randomToken = () => crypto.randomBytes(32).toString('base64url')
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString()

// ---------- passwords ----------

// scrypt ships with Node, so there is nothing native to install on Vercel. N=16384 uses about 16 MB.
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>
const KDF = { N: 16384, r: 8, p: 1 }

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(password, salt, 32, KDF)
  return ['scrypt', KDF.N, KDF.r, KDF.p, salt.toString('base64'), key.toString('base64')].join('$')
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

// When an address has no account we still do the same amount of work, so response time does not reveal it.
let dummyHash: Promise<string> | null = null
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex')))

const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd123', '1234567890', '12345678901', 'qwertyuiop', 'qwerty12345', 'letmein1234', 'iloveyou123', 'welcome1234', 'administrator'])

/** The one rule set, used for setting, resetting and changing a password. Returns a message, or null if it is fine. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.'
  if (password.length > 128) return 'Use 128 characters or fewer.'
  if (/^(.)\1+$/.test(password)) return 'Use more than one repeated character.'
  if (COMMON.has(password.toLowerCase())) return 'That password is too common. Choose something harder to guess.'
  const name = email.split('@')[0].toLowerCase()
  if (name.length >= 4 && password.toLowerCase().includes(name)) return 'Do not include your email name in your password.'
  return null
}

// ---------- rate limits ----------

/** Sliding-window limiter backed by the database, so it holds across serverless instances. */
export async function rateLimited(key: string, max: number, windowMs: number): Promise<boolean> {
  await run('INSERT INTO rate_hits (key, at) VALUES ($1, $2)', key, iso())
  const row = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM rate_hits WHERE key = $1 AND at > $2', key, iso(-windowMs))
  return (row?.n ?? 0) > max
}

/** Only failures are counted, so signing in correctly never uses up the allowance. */
export async function tooManyFailures(key: string, max: number, windowMs: number): Promise<boolean> {
  const row = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM rate_hits WHERE key = $1 AND at > $2', key, iso(-windowMs))
  return (row?.n ?? 0) >= max
}
export const recordFailure = (key: string) => run('INSERT INTO rate_hits (key, at) VALUES ($1, $2)', key, iso())

export const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local'

// ---------- accounts ----------

async function ensureAdminUser(email: string) {
  await run(
    "INSERT INTO users (id, email, name, role, client_id, created_at) VALUES ($1, $2, $3, 'admin', NULL, $4) ON CONFLICT (email) DO NOTHING",
    crypto.randomUUID(), email, email.split('@')[0], iso(),
  )
}

export async function ensureAdmins() {
  for (const email of config.adminEmails) await ensureAdminUser(email)
}

async function startSession(c: Context, userId: string): Promise<AuthUser | null> {
  const sid = randomToken()
  await run('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, $3)', sha256(sid), userId, iso(SESSION_TTL_MS))
  setCookie(c, COOKIE, sid, { httpOnly: true, sameSite: 'Lax', secure: config.secureCookies, path: '/', maxAge: SESSION_TTL_MS / 1000 })
  return loadUserBySession(sid)
}

/** Email and password sign-in. Null for a wrong password, an unknown address, or an account with no password yet. */
export async function login(c: Context, email: string, password: string): Promise<AuthUser | null> {
  const u = await one<{ id: string; password_hash: string | null }>('SELECT id, password_hash FROM users WHERE email = $1 AND removed_at IS NULL', email)
  const ok = await verifyPassword(password, u?.password_hash ?? (await getDummyHash()))
  if (!u || !u.password_hash || !ok) return null
  return startSession(c, u.id)
}

export async function logout(c: Context) {
  const sid = getCookie(c, COOKIE)
  if (sid) await run('DELETE FROM sessions WHERE id_hash = $1', sha256(sid))
  deleteCookie(c, COOKIE, { path: '/' })
}

// ---------- set and reset a password by email ----------

const passwordLink = (token: string, purpose: TokenPurpose) => `${config.appUrl}/auth/set-password?token=${token}&purpose=${purpose}`

/**
 * Emails a link to set a password (first time) or reset it. Any earlier unused link for the person stops working.
 * Returns the link so local development can show it, and whether the email was sent.
 */
export async function sendPasswordEmail(user: { id: string; email: string; name: string }, purpose: TokenPurpose, project?: string): Promise<{ link: string; sent: boolean }> {
  await run('DELETE FROM login_tokens WHERE user_id = $1 AND used_at IS NULL', user.id)
  const token = randomToken()
  await run('INSERT INTO login_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, $4)', sha256(token), user.id, purpose, iso(TOKEN_TTL_MS[purpose]))
  const link = passwordLink(token, purpose)
  const invite = purpose === 'invite'
  const days = TOKEN_TTL_MS.invite / 86400_000
  const intro = invite
    ? `${project ? `You have been invited to ${project} on SEAM. ` : 'Your SEAM account is ready. '}Set a password to sign in.`
    : 'We got a request to reset your SEAM password.'
  const valid = invite ? `The link works once and lasts ${days} days.` : 'The link works once and lasts one hour. If you did not ask for this, you can ignore this email.'
  const sent = await sendQuietly({
    to: user.email,
    subject: invite ? 'Set your SEAM password' : 'Reset your SEAM password',
    text: `Hi ${user.name},\n\n${intro}\n${link}\n\n${valid}`,
    html: layout(invite ? 'Set your password' : 'Reset your password', `<p>Hi ${escapeHtml(user.name)},</p><p>${escapeHtml(intro)}</p><p style="color:#536254;font-size:13px">${escapeHtml(valid)}</p>`, { label: invite ? 'Set password' : 'Reset password', url: link }),
  })
  return { link, sent }
}

/** "Set it or reset it": works for first-time setup and forgotten passwords. Same answer whether or not the address exists. */
export async function requestPasswordEmail(email: string): Promise<string | null> {
  // Addresses listed in ADMIN_EMAILS become admins the first time they ask.
  if (config.adminEmails.includes(email)) await ensureAdminUser(email)
  const user = await one<{ id: string; email: string; name: string; password_hash: string | null }>('SELECT id, email, name, password_hash FROM users WHERE email = $1 AND removed_at IS NULL', email)
  if (!user) {
    await logEmailEvent([email], 'Password link requested', 'Nothing sent: no account for this address. It is not in ADMIN_EMAILS and has not been invited.')
    return null
  }
  return (await sendPasswordEmail(user, user.password_hash ? 'reset' : 'invite')).link
}

/** What a link is for, without using it up. Lets the page say "expired" before asking for a password. */
export async function checkPasswordToken(token: string): Promise<{ purpose: TokenPurpose; email: string; name: string } | null> {
  const t = await one<{ purpose: TokenPurpose; email: string; name: string }>(
    `SELECT t.purpose, u.email, u.name FROM login_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > $2 AND t.purpose IN ('invite', 'reset') AND u.removed_at IS NULL`,
    sha256(token), iso(),
  )
  return t ?? null
}

/**
 * Sets the password with a link, then signs the person in. The link is only spent here, when the form is submitted,
 * so mail scanners that open it cannot use it up. Every other session for the account is ended.
 */
export async function resetPassword(c: Context, token: string, password: string): Promise<AuthUser | null> {
  const info = await checkPasswordToken(token)
  if (!info) return null
  const hash = await hashPassword(password) // slow on purpose, so do it before claiming and never leave a claimed token unused
  // One atomic statement: only the first submission can claim a link, even under races.
  const claimed = await one<{ user_id: string; purpose: TokenPurpose }>(
    "UPDATE login_tokens SET used_at = $1 WHERE token_hash = $2 AND used_at IS NULL AND expires_at > $1 AND purpose IN ('invite', 'reset') RETURNING user_id, purpose",
    iso(), sha256(token),
  )
  if (!claimed) return null
  await run('UPDATE users SET password_hash = $1, password_changed_at = $2 WHERE id = $3', hash, iso(), claimed.user_id)
  await run('DELETE FROM sessions WHERE user_id = $1', claimed.user_id)
  if (claimed.purpose === 'reset') await notifyPasswordChanged(info)
  return startSession(c, claimed.user_id)
}

/** Change it while signed in. Needs the current password, and signs out every other device. */
export async function changePassword(c: Context, user: AuthUser, current: string, next: string): Promise<boolean> {
  const u = await one<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = $1', user.id)
  if (!u?.password_hash || !(await verifyPassword(current, u.password_hash))) return false
  await run('UPDATE users SET password_hash = $1, password_changed_at = $2 WHERE id = $3', await hashPassword(next), iso(), user.id)
  const sid = getCookie(c, COOKIE)
  await run('DELETE FROM sessions WHERE user_id = $1 AND id_hash <> $2', user.id, sid ? sha256(sid) : '')
  await notifyPasswordChanged(user)
  return true
}

const notifyPasswordChanged = (u: { email: string; name: string }) =>
  sendQuietly({
    to: u.email,
    subject: 'Your SEAM password was changed',
    text: `Hi ${u.name},\n\nThe password for your SEAM account was just changed. If this was you, there is nothing to do. If it was not, reset your password now: ${config.appUrl}/forgot`,
    html: layout('Your password was changed', `<p>Hi ${escapeHtml(u.name)}, the password for your SEAM account was just changed.</p><p>If this was you, there is nothing to do. If it was not, reset your password straight away.</p>`, { label: 'Reset password', url: `${config.appUrl}/forgot` }),
  })

// ---------- sessions ----------

async function loadUserBySession(sid: string): Promise<AuthUser | null> {
  const u = await one<{ id: string; email: string; name: string; role: 'admin' | 'client'; projects: unknown }>(
    `SELECT u.id, u.email, u.name, u.role,
            COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
                        FROM memberships m JOIN clients c ON c.id = m.client_id WHERE m.user_id = u.id), '[]'::json) AS projects
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = $1 AND s.expires_at > $2 AND u.removed_at IS NULL`,
    sha256(sid), iso(),
  )
  if (!u) return null
  // Some drivers hand back json already parsed, others as text.
  const raw = typeof u.projects === 'string' ? JSON.parse(u.projects) : u.projects
  const projects = (Array.isArray(raw) ? raw : []) as { id: string; name: string }[]
  return { id: u.id, email: u.email, name: u.name, role: u.role, clientId: projects[0]?.id ?? null, clientName: projects[0]?.name ?? null, projects }
}

export const withUser: MiddlewareHandler<{ Variables: { user: AuthUser | null } }> = async (c, next) => {
  const sid = getCookie(c, COOKIE)
  c.set('user', sid ? await loadUserBySession(sid) : null)
  await next()
}
