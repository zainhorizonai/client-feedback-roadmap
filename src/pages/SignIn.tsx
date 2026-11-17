import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { takeReturnPath } from '../lib/returnTo'
import { AuthLayout } from '../components/AuthLayout'
import { PasswordField } from '../components/PasswordField'
import { Button, Field } from '../components/ui'

export function SignIn() {
  const { signIn } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    // The button is always ready. Missing details get a plain message, not a dead button.
    if (!email.trim() || !password) { setError(!email.trim() ? 'Enter your email address.' : 'Enter your password.'); return }
    setBusy(true)
    setError('')
    try {
      await signIn(email.trim(), password)
      // Take them to the page they were headed for before they were asked to sign in.
      nav(takeReturnPath() ?? '/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not sign you in. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate>
        <h1 className="font-semibold">Sign in</h1>
        <div className="mt-4 space-y-4">
          <Field label="Email" required>
            <input type="email" className="input" value={email} autoFocus autoComplete="username" inputMode="email" autoCapitalize="none" onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </Field>
          <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" required />
        </div>
        {error && <p role="alert" className="mt-3 rounded-control bg-[var(--seam-error-bg)] px-3 py-2 font-medium text-[var(--seam-error-fg)]">{error}</p>}
        <Button type="submit" pending={busy} className="mt-4 w-full">Sign in</Button>
        <p className="mt-4 text-center"><Link to="/forgot" className="font-semibold">Forgot your password?</Link></p>
      </form>
      <p className="mt-5 border-t border-line pt-4 text-center text-sm text-muted">First time here? Your invitation email has a link to set your password.</p>
    </AuthLayout>
  )
}
