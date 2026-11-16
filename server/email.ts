import { config } from './config.js'
import { run } from './db.js'

interface Mail { to: string | string[]; subject: string; text: string; html: string }

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Wraps a message body and optional button in a plain branded layout. */
export function layout(heading: string, bodyHtml: string, button?: { label: string; url: string }) {
  const btn = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#2755e0;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : ''
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(heading)}</h2>${bodyHtml}${btn}
<p style="color:#64748b;font-size:12px;margin-top:32px">Feedback Portal</p></div>`
}

interface MailTransport { sendMail(m: { from: string; to: string[]; subject: string; text: string; html: string }): Promise<unknown> }
let smtpTransport: MailTransport | null = null

async function getSmtp(): Promise<MailTransport> {
  if (!smtpTransport) {
    if (!config.smtpUser || !config.smtpPass) throw new Error('EMAIL_PROVIDER=smtp but SMTP_USER or SMTP_PASS is not set')
    const nodemailer = await import('nodemailer')
    smtpTransport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: { user: config.smtpUser, pass: config.smtpPass },
      // Fail fast so a bad setting cannot hang a request until the function times out.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  }
  return smtpTransport
}

/** Tests swap in a fake transport. */
export function setMailTransportForTests(t: MailTransport | null) {
  smtpTransport = t
}

export async function sendEmail(mail: Mail): Promise<void> {
  const to = Array.isArray(mail.to) ? mail.to : [mail.to]
  if (to.length === 0) return
  if (config.emailProvider === 'smtp') {
    // Gmail always sends as the signed-in account, whatever the From says, so default to that account.
    const from = process.env.EMAIL_FROM ?? `Feedback Portal <${config.smtpUser}>`
    await (await getSmtp()).sendMail({ from, to, subject: mail.subject, text: mail.text, html: mail.html })
    return
  }
  if (config.emailProvider === 'resend') {
    if (!config.resendKey) throw new Error('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set')
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.emailFrom, to, subject: mail.subject, text: mail.text, html: mail.html }),
    })
    if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`)
    return
  }
  console.log(`\n[email:console] to=${to.join(', ')}\n  subject: ${mail.subject}\n  ${mail.text.replace(/\n/g, '\n  ')}\n`)
}

/**
 * Sends and swallows errors: a failed email must never fail the request that triggered it.
 * Returns whether it was sent, so callers that can tell the user (like invites) do.
 * Callers must await this. On serverless the function is frozen once the response is sent,
 * so a fire-and-forget email can be lost.
 */
export async function sendQuietly(mail: Mail): Promise<boolean> {
  let error = ''
  try {
    await sendEmail(mail)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    console.error('[email] failed:', error)
  }
  await logEmail(mail, error)
  return !error
}

/** Records the outcome. Never throws: logging must not break the request. */
async function logEmail(mail: Mail, error: string) {
  try {
    const to = (Array.isArray(mail.to) ? mail.to : [mail.to]).join(', ')
    await run(
      'INSERT INTO email_log (at, to_addr, subject, ok, error) VALUES ($1, $2, $3, $4, $5)',
      new Date().toISOString(), to.slice(0, 300), mail.subject.slice(0, 200), error ? 0 : 1, error.replace(/\S+:\/\/\S+/g, '[url]').slice(0, 400),
    )
  } catch (e) {
    console.error('[email] could not write the email log:', e instanceof Error ? e.message : e)
  }
}
