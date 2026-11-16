import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { btnPrimary } from '../components/ui'

/** Landing page for the emailed link. The token is exchanged with a POST so mail scanners that prefetch links cannot burn it. */
export function Verify() {
  const [params] = useSearchParams()
  const { verify } = useAuth()
  const nav = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice; the token is single use
    started.current = true
    const token = params.get('token')
    if (!token) { setError('This sign-in link is incomplete.'); return }
    verify(token)
      .then(() => nav('/', { replace: true }))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Something went wrong'))
  }, [params, verify, nav])

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold">Could not sign you in</h1>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
            <Link to="/" className={`${btnPrimary} mt-4`}>Request a new link</Link>
          </>
        ) : (
          <p className="text-slate-600">Signing you in…</p>
        )}
      </div>
    </div>
  )
}
