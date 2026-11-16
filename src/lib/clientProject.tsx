import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './auth'

interface Ctx {
  projects: { id: string; name: string }[]
  selectedId: string
  select: (id: string) => void
}
const Ctx = createContext<Ctx | null>(null)

/** Client side: which of their projects they are looking at. Remembered per person on this device. */
export function ClientProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const projects = user?.projects ?? []
  const key = `seam.client.project.${user?.id ?? ''}`
  const [saved, setSaved] = useState(() => { try { return localStorage.getItem(key) ?? '' } catch { return '' } })
  // A saved project can disappear (removed from it). Fall back to their first one.
  const selectedId = projects.some((p) => p.id === saved) ? saved : projects[0]?.id ?? ''
  const select = useCallback((id: string) => {
    setSaved(id)
    try { localStorage.setItem(key, id) } catch { /* ignore */ }
  }, [key])
  const value = useMemo(() => ({ projects, selectedId, select }), [projects, selectedId, select])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useClientProject(): Ctx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useClientProject outside ClientProjectProvider')
  return v
}
