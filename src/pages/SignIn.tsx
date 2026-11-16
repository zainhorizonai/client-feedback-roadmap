import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { Button, Field, SeamDivider } from '../components/ui'

const RESEND_WAIT = 30

export function SignIn() {
  const { requestLink } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  async function request(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await requestLink(email.trim())
      setDevLink(r.devLink)
      setSent(true)
      setWait(RESEND_WAIT)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/brand/seam-logo.svg" alt="SEAM" className="mx-auto h-12 w-auto" />
          <p className="mt-3 text-muted">From client feedback to what ships.</p>
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
          <SeamDivider />
          <div className="p-6">
            {sent ? (
              <div className="text-center" aria-live="polite">
                <Mail className="mx-auto h-9 w-9 text-action" aria-hidden="true" />
                <h1 className="mt-3 font-semibold">Check your email</h1>
                <p className="mt-2 text-muted">If <strong className="text-ink">{email}</strong> has access, we sent a sign-in link. It works once and expires in 15 minutes.</p>
                {devLink && <a href={devLink} className="mt-4 block text-sm font-semibold underline">Open the sign-in link (local development only)</a>}
                <div className="mt-5 flex flex-col gap-2">
                  <Button variant="secondary" onClick={() => request()} pending={busy} disabled={wait > 0}>{wait > 0 ? `Send again in ${wait}s` : 'Send the link again'}</Button>
                  <Button variant="tertiary" onClick={() => setSent(false)}>Use a different email</Button>
                </div>
                {error && <p role="alert" className="mt-3 text-sm font-medium text-[var(--seam-error-fg)]">{error}</p>}
              </div>
            ) : (
              <form onSubmit={request} noValidate>
                <h1 className="font-semibold">Sign in</h1>
                <p className="mb-4 mt-1 text-muted">Enter your email and we will send you a link. No password needed.</p>
                <Field label="Email" required error={error}>
                  <input type="email" required autoFocus autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} className="input" placeholder="you@company.com" />
                </Field>
                <Button type="submit" pending={busy} disabled={!email.trim()} className="mt-4 w-full">Send sign-in link</Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
