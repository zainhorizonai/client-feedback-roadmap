import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Field } from './ui'

interface Props {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  hint?: string
  error?: string
  autoFocus?: boolean
  required?: boolean
}

/** A password box with a Show/Hide control. Uses the right autocomplete value so password managers behave. */
export function PasswordField({ label, value, onChange, autoComplete, hint, error, autoFocus, required }: Props) {
  const [shown, setShown] = useState(false)
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(wiring) => (
        <div className="relative">
          <input
            {...wiring}
            type={shown ? 'text' : 'password'}
            className="input pr-16"
            value={value}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-pressed={shown}
            className="absolute right-1 top-1/2 flex min-h-9 -translate-y-1/2 items-center gap-1 rounded-control px-2 text-sm font-semibold text-muted hover:text-ink"
          >
            {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            {shown ? 'Hide' : 'Show'}<span className="sr-only"> {label.toLowerCase()}</span>
          </button>
        </div>
      )}
    </Field>
  )
}

/** The same rules the server applies, shown as a checklist so nobody has to guess. */
export function passwordChecks(password: string, email: string, confirm?: string) {
  const name = email.split('@')[0].toLowerCase()
  const checks = [
    { ok: password.length >= 10, text: 'At least 10 characters' },
    { ok: !(name.length >= 4 && password.toLowerCase().includes(name)), text: 'Does not contain your email name' },
  ]
  if (confirm !== undefined) checks.push({ ok: password.length > 0 && password === confirm, text: 'Both boxes match' })
  return checks
}

export function PasswordRules({ password, email, confirm }: { password: string; email: string; confirm?: string }) {
  return (
    <ul className="mt-1 space-y-1 text-sm" aria-label="Password rules">
      {passwordChecks(password, email, confirm).map((c) => (
        <li key={c.text} className={c.ok ? 'text-[var(--seam-success-fg)]' : 'text-muted'}>
          <span aria-hidden="true">{c.ok ? '✓' : '•'}</span> {c.text}<span className="sr-only">{c.ok ? ' (done)' : ' (not yet)'}</span>
        </li>
      ))}
    </ul>
  )
}
