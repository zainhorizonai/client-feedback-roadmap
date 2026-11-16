import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { notify } from './toast'
import type { ClientOrg } from './types'

const KEY = 'seam.project'

interface ProjectCtx {
  projects: ClientOrg[]
  /** '' means all projects. */
  selectedId: string
  selected: ClientOrg | null
  select: (id: string) => void
  reload: () => Promise<void>
  loaded: boolean
}

const Ctx = createContext<ProjectCtx | null>(null)

/** Admin only: the project selector that scopes the Inbox, Tracker and Roadmap. */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ClientOrg[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState(() => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } })

  const reload = useCallback(async () => {
    try { setProjects((await api.get<{ clients: ClientOrg[] }>('/api/admin/clients')).clients) }
    catch (e) { notify(e instanceof ApiError ? e.message : 'Could not load projects', 'error') }
    finally { setLoaded(true) }
  }, [])
  useEffect(() => { reload() }, [reload])

  const select = useCallback((id: string) => {
    setSelectedId(id)
    try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
  }, [])

  // A saved project can disappear. Fall back to all projects.
  const selected = projects.find((p) => p.id === selectedId) ?? null
  const value = useMemo(() => ({ projects, selectedId: selected ? selectedId : '', selected, select, reload, loaded }), [projects, selected, selectedId, select, reload, loaded])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProject(): ProjectCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProject outside ProjectProvider')
  return v
}
