import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { notify } from '../lib/toast'
import { Avatar } from '../components/Avatar'
import { PasswordField, PasswordRules, passwordChecks } from '../components/PasswordField'
import { Button, PageHeader } from '../components/ui'

export function Account() {
  const { user, changePassword, setNotify } = useAuth()
  const [savingNotify, setSavingNotify] = useState(false)
  // Shown straight away; put back if the server says no.
  const [mode, setMode] = useState<'instant' | 'digest' | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const valid = !!current && passwordChecks(next, user.email, confirm).every((c) => c.ok)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await changePassword(current, next)
      setCurrent(''); setNext(''); setConfirm('')
      notify('Password changed. You were signed out of your other devices.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not change your password. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Account" />
      <section aria-labelledby="profile-h" className="mb-6 flex items-center gap-4 rounded-card border border-line bg-surface p-4">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0">
          <h2 id="profile-h" className="break-words font-semibold">{user.name}</h2>
          <p className="break-all text-muted">{user.email}</p>
          <p className="mt-1 text-sm text-muted">{user.role === 'admin' ? 'Team member' : `Client${user.projects.length ? ` · ${user.projects.map((p) => p.name).join(', ')}` : ''}`}</p>
        </div>
      </section>

      <section aria-labelledby="mail-h" className="mb-6 rounded-card border border-line bg-surface p-4">
        <h2 id="mail-h" className="font-semibold">Email about updates</h2>
        <p className="mb-3 mt-1 text-muted">Sign-in and password emails always arrive straight away.</p>
        <fieldset disabled={savingNotify} className="space-y-2">
          <legend className="sr-only">How often should we email you about updates?</legend>
          {([['instant', 'As they happen', 'One email for each update.'], ['digest', 'One summary a day', 'Everything from the day in a single email.']] as const).map(([m, label, hint]) => (
            <label key={m} className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 ${(mode ?? user.notify) === m ? 'border-primary ring-1 ring-primary' : 'border-line'}`}>
              <input type="radio" name="notify" className="mt-1 h-4 w-4 accent-[var(--seam-primary)]" checked={(mode ?? user.notify) === m}
                onChange={async () => { setMode(m); setSavingNotify(true); try { await setNotify(m); notify(m === 'digest' ? 'You will get one summary a day.' : 'You will get updates as they happen.') } catch { notify('We could not save that. Try again.', 'error') } setMode(null); setSavingNotify(false) }} />
              <span><span className="font-semibold">{label}</span><span className="block text-sm text-muted">{hint}</span></span>
            </label>
          ))}
        </fieldset>
      </section>

      <section aria-labelledby="pw-h" className="rounded-card border border-line bg-surface p-4">
        <h2 id="pw-h" className="font-semibold">Change your password</h2>
        <p className="mb-4 mt-1 text-muted">Changing it signs you out of your other devices.</p>
        <form onSubmit={submit} noValidate className="space-y-4">
          <input type="email" value={user.email} autoComplete="username" readOnly hidden aria-hidden="true" tabIndex={-1} />
          <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" required />
          <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" required />
          <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" required />
          <PasswordRules password={next} email={user.email} confirm={confirm} />
          {error && <p role="alert" className="rounded-control bg-[var(--seam-error-bg)] px-3 py-2 font-medium text-[var(--seam-error-fg)]">{error}</p>}
          <Button type="submit" pending={busy} disabled={!valid}>Change password</Button>
        </form>
      </section>
    </div>
  )
}
