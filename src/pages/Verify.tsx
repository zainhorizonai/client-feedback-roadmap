import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { Button, ButtonLink, SeamDivider } from '../components/ui'
import { takeReturnPath } from '../lib/returnTo'

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
      nav(takeReturnPath() ?? '/', { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <img src="/brand/seam-logo.svg" alt="SEAM" className="mx-auto mb-8 h-12 w-auto" />
        <div className="overflow-hidden rounded-card border border-line bg-surface text-center shadow-sm">
          <SeamDivider />
          <div className="p-6" aria-live="polite">
            {!token ? (
              <>
                <h1 className="font-semibold">This sign-in link is incomplete</h1>
                <p className="mt-2 text-muted">Request a new link from the sign-in page.</p>
                <ButtonLink to="/" className="mt-4 w-full">Back to sign in</ButtonLink>
              </>
            ) : error ? (
              <>
                <h1 className="font-semibold">That link did not work</h1>
                <p className="mt-2 text-muted">{error}</p>
                <ButtonLink to="/" className="mt-4 w-full">Request a new link</ButtonLink>
              </>
            ) : (
              <>
                <h1 className="font-semibold">Ready to sign in</h1>
                <p className="mt-2 text-muted">Press the button to finish signing in on this device.</p>
                <Button onClick={go} pending={busy} className="mt-4 w-full">Sign in</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
