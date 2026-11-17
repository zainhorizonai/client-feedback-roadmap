import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { forgetReturnPath } from './returnTo'
import { resetRoadmap } from './roadmap'
import { resetStore } from './store'
import type { User } from './types'

export interface PasswordLink { purpose: 'invite' | 'reset'; email: string; name: string }

interface Auth {
  user: User | null
  /** Upload limit, from server configuration. */
  maxVideoMb: number
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  /** Asks for a link to set or reset a password. devLink is only returned in local development. */
  forgot: (email: string) => Promise<{ devLink?: string }>
  /** What a link is for, without using it up. */
  checkLink: (token: string) => Promise<PasswordLink>
  /** Sets the password from a link, and signs in. */
  setPassword: (token: string, password: string) => Promise<void>
  changePassword: (current: string, next: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [maxVideoMb, setMaxVideoMb] = useState(500)

  useEffect(() => {
    api.get<{ user: User | null; limits?: { maxVideoMb: number } }>('/api/me')
      .then((r) => { setUser(r.user); if (r.limits) setMaxVideoMb(r.limits.maxVideoMb) })
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  // Coming back to the tab refreshes who you are and which projects you are in. A renamed project shows its new
  // name, and someone whose access was removed is signed out, without anyone having to reload.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      api.get<{ user: User | null }>('/api/me')
        .then((r) => setUser((prev) => (JSON.stringify(prev) === JSON.stringify(r.user) ? prev : r.user)))
        .catch(() => { /* offline: keep what we have */ })
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setUser((await api.post<{ user: User }>('/api/auth/login', { email, password })).user)
  }, [])
  const forgot = useCallback((email: string) => api.post<{ devLink?: string }>('/api/auth/forgot', { email }), [])
  const checkLink = useCallback((token: string) => api.post<PasswordLink>('/api/auth/reset/check', { token }), [])
  const setPassword = useCallback(async (token: string, password: string) => {
    setUser((await api.post<{ user: User }>('/api/auth/reset', { token, password })).user)
  }, [])
  const changePassword = useCallback(async (current: string, next: string) => {
    await api.post('/api/auth/password', { current, next })
  }, [])
  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {})
    forgetReturnPath()
    resetStore()
    resetRoadmap()
    setUser(null)
  }, [])

  return <Ctx.Provider value={{ user, maxVideoMb, loading, signIn, forgot, checkLink, setPassword, changePassword, signOut }}>{children}</Ctx.Provider>
}

export function useAuth(): Auth {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
