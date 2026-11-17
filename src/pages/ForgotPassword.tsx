import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { AuthLayout } from '../components/AuthLayout'
import { Button, Field } from '../components/ui'

const WAIT = 30

/** One screen for "I forgot it" and "I am new and need to set one". The answer never says whether the address has an account. */
export function ForgotPassword() {
  const { forgot } = useAuth()
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

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await forgot(email.trim())
      setDevLink(r.devLink)
      setSent(true)
      setWait(WAIT)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      {sent ? (
        <div className="text-center" aria-live="polite">
          <Mail className="mx-auto h-9 w-9 text-primary" aria-hidden="true" />
          <h1 className="mt-3 font-semibold">Check your email</h1>
          <p className="mt-2 text-muted">If <strong className="text-ink">{email}</strong> has an account, we sent a link to set your password. It works once.</p>
          {devLink && <a href={devLink} className="mt-4 block text-sm font-semibold underline">Open the link (local development only)</a>}
          <div className="mt-5 flex flex-col gap-2">
            <Button variant="secondary" onClick={() => submit()} pending={busy} disabled={wait > 0}>{wait > 0 ? `Send again in ${wait}s` : 'Send the link again'}</Button>
            <Button variant="tertiary" onClick={() => setSent(false)}>Use a different email</Button>
          </div>
          {error && <p role="alert" className="mt-3 text-sm font-medium text-[var(--seam-error-fg)]">{error}</p>}
          <p className="mt-4"><Link to="/" className="font-semibold">Back to sign in</Link></p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <h1 className="font-semibold">Set or reset your password</h1>
          <p className="mb-4 mt-1 text-muted">Enter your email and we will send you a link to choose a password.</p>
          <Field label="Email" required error={error}>
            <input type="email" className="input" value={email} autoFocus autoComplete="username" inputMode="email" autoCapitalize="none" onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </Field>
          <Button type="submit" pending={busy} disabled={!email.trim()} className="mt-4 w-full">Send link</Button>
          <p className="mt-4 text-center"><Link to="/" className="font-semibold">Back to sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  )
}
