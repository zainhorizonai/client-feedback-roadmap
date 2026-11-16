import { config } from './config.js'

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

export async function sendEmail(mail: Mail): Promise<void> {
  const to = Array.isArray(mail.to) ? mail.to : [mail.to]
  if (to.length === 0) return
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
 * Callers must await this. On serverless the function is frozen once the response is sent,
 * so a fire-and-forget email can be lost.
 */
export async function sendQuietly(mail: Mail): Promise<void> {
  try {
    await sendEmail(mail)
  } catch (e) {
    console.error('[email] failed:', e instanceof Error ? e.message : e)
  }
}
