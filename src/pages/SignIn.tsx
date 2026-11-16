import { useState } from 'react'
import { Bug, Mail } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { btnPrimary, inputCls } from '../components/ui'

export function SignIn() {
  const { requestLink } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await requestLink(email.trim())
      setDevLink(r.devLink)
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><Bug className="h-5 w-5" /></span>
          Feedback Portal
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Mail className="h-6 w-6" /></div>
              <h1 className="text-lg font-semibold">Check your email</h1>
              <p className="text-sm text-slate-600">
                If <strong>{email}</strong> has access, we sent a sign-in link. It works once and expires in 15 minutes.
              </p>
              {devLink && (
                <a href={devLink} className={`${btnPrimary} w-full`}>Open sign-in link (local dev only)</a>
              )}
              <button className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setSent(false)}>Use a different email</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h1 className="text-lg font-semibold">Sign in</h1>
                <p className="mt-1 text-sm text-slate-600">Enter your email and we will send you a link. No password needed.</p>
              </div>
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={inputCls} />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>{busy ? 'Sending…' : 'Send me a link'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
