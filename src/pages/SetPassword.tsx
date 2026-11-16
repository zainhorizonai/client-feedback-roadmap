import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, type PasswordLink } from '../lib/auth'
import { ApiError } from '../lib/api'
import { takeReturnPath } from '../lib/returnTo'
import { AuthLayout } from '../components/AuthLayout'
import { PasswordField, PasswordRules, passwordChecks } from '../components/PasswordField'
import { Button, ButtonLink, Skeleton } from '../components/ui'

/**
 * Where the emailed link lands. The link is checked on arrival, but only spent when the form is submitted, so
 * email scanners that open it cannot use it up.
 */
export function SetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { checkLink, setPassword } = useAuth()
  const nav = useNavigate()
  const [link, setLink] = useState<PasswordLink | null>(null)
  const [problem, setProblem] = useState('')
  const [checking, setChecking] = useState(!!token)
  const [password, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    checkLink(token)
      .then(setLink)
      .catch((e) => setProblem(e instanceof ApiError ? e.message : 'We could not check this link. Try again.'))
      .finally(() => setChecking(false))
  }, [token, checkLink])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!link || busy) return
    setBusy(true)
    setError('')
    try {
      await setPassword(token, password)
      nav(takeReturnPath() ?? '/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save that. Check your connection and try again.')
      setBusy(false)
    }
  }

  if (checking) return <AuthLayout><Skeleton rows={3} /></AuthLayout>

  if (!token || !link) {
    return (
      <AuthLayout>
        <div className="text-center" aria-live="polite">
          <h1 className="font-semibold">This link will not work</h1>
          <p className="mt-2 text-muted">{!token ? 'The link is incomplete.' : problem}</p>
          <ButtonLink to="/forgot" className="mt-4 w-full">Get a new link</ButtonLink>
          <p className="mt-4"><Link to="/" className="font-semibold">Back to sign in</Link></p>
        </div>
      </AuthLayout>
    )
  }

  const invite = link.purpose === 'invite'
  const valid = passwordChecks(password, link.email, confirm).every((c) => c.ok)

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate>
        <h1 className="font-semibold">{invite ? 'Set your password' : 'Choose a new password'}</h1>
        <p className="mb-4 mt-1 text-muted">{invite ? `Welcome, ${link.name}. ` : ''}This is for <strong className="text-ink">{link.email}</strong>.</p>
        {/* Gives password managers the account name to save the password against. */}
        <input type="email" value={link.email} autoComplete="username" readOnly hidden aria-hidden="true" tabIndex={-1} />
        <div className="space-y-4">
          <PasswordField label="New password" value={password} onChange={setPw} autoComplete="new-password" autoFocus required />
          <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" required />
        </div>
        <PasswordRules password={password} email={link.email} confirm={confirm} />
        {error && <p role="alert" className="mt-3 rounded-control bg-[var(--seam-error-bg)] px-3 py-2 font-medium text-[var(--seam-error-fg)]">{error}</p>}
        <Button type="submit" pending={busy} disabled={!valid} className="mt-4 w-full">{invite ? 'Set password and sign in' : 'Save password and sign in'}</Button>
      </form>
    </AuthLayout>
  )
}
