import { useState } from 'react'
import { Bug } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { btnPrimary } from '../components/ui'

/**
 * Landing page for the emailed link. The link is only spent when a person presses the button.
 * Email security scanners open links automatically but do not click, so they cannot use up the one-time token.
 */
export function Verify() {
  const [params] = useSearchParams()
  const { verify } = useAuth()
  const nav = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const token = params.get('token')

  async function go() {
    if (!token || busy) return
    setBusy(true)
    setError('')
    try {
      await verify(token)
      nav('/', { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><Bug className="h-5 w-5" /></span>
          Feedback Portal
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {!token ? (
            <>
              <h1 className="text-lg font-semibold">This sign-in link is incomplete</h1>
              <p className="mt-2 text-sm text-slate-600">Request a new link from the sign-in page.</p>
              <Link to="/" className={`${btnPrimary} mt-4 w-full`}>Back to sign in</Link>
            </>
          ) : error ? (
            <>
              <h1 className="text-lg font-semibold">Could not sign you in</h1>
              <p className="mt-2 text-sm text-slate-600">{error}</p>
              <Link to="/" className={`${btnPrimary} mt-4 w-full`}>Request a new link</Link>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold">Ready to sign in</h1>
              <p className="mt-2 text-sm text-slate-600">Press the button to finish signing in on this device.</p>
              <button onClick={go} disabled={busy} className={`${btnPrimary} mt-4 w-full`}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
