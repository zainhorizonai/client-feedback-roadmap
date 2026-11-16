// After signing in, return people to the page they asked for. Only same-site paths are ever used.
const KEY = 'seam.returnTo'

export function rememberReturnPath(path: string) {
  try {
    if (path !== '/' && !path.startsWith('/auth')) localStorage.setItem(KEY, path)
  } catch { /* ignore */ }
}

export function takeReturnPath(): string | null {
  try {
    const p = localStorage.getItem(KEY)
    localStorage.removeItem(KEY)
    return p && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/auth') ? p : null
  } catch { return null }
}
