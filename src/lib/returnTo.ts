// After signing in, return people to the page they asked for. Only same-site paths are ever used.
const KEY = 'seam.returnTo'

// The page someone was on when they signed out on purpose. It is not somewhere to return to, however many
// times the screen re-renders. Visiting any other page ends this.
let signedOutAt: string | null = null

export function forgetReturnPath() {
  signedOutAt = window.location.pathname + window.location.search
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

export function rememberReturnPath(path: string) {
  if (path === signedOutAt) return
  signedOutAt = null
  try {
    // The sign-in screens themselves are never somewhere to come back to.
    if (path !== '/' && !path.startsWith('/auth') && !path.startsWith('/forgot')) localStorage.setItem(KEY, path)
  } catch { /* ignore */ }
}

export function takeReturnPath(): string | null {
  try {
    const p = localStorage.getItem(KEY)
    localStorage.removeItem(KEY)
    return p && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/auth') && !p.startsWith('/forgot') ? p : null
  } catch { return null }
}
