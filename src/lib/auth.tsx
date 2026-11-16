import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { resetStore } from './store'
import type { User } from './types'

interface Auth {
  user: User | null
  loading: boolean
  /** Asks the server to email a sign-in link. devLink is only returned in local development. */
  requestLink: (email: string) => Promise<{ devLink?: string }>
  verify: (token: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ user: User | null }>('/api/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const requestLink = useCallback((email: string) => api.post<{ devLink?: string }>('/api/auth/request', { email }), [])
  const verify = useCallback(async (token: string) => {
    const r = await api.post<{ user: User }>('/api/auth/verify', { token })
    setUser(r.user)
  }, [])
  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {})
    resetStore()
    setUser(null)
  }, [])

  return <Ctx.Provider value={{ user, loading, requestLink, verify, signOut }}>{children}</Ctx.Provider>
}

export function useAuth(): Auth {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
