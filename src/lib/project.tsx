import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import { notify } from './toast'
import type { ClientOrg } from './types'

const KEY = 'seam.projects'

interface ProjectCtx {
  projects: ClientOrg[]
  /** The projects the admin has chosen to look at. Empty means all of them. */
  selectedIds: string[]
  /** What is shown, as a short phrase: "All projects", a name, or "3 of 5 projects". */
  label: string
  /** Exactly one project is chosen, which some views need (a client preview, a default for new items). */
  single: ClientOrg | null
  isAll: boolean
  /** Whether something in this project should be shown. */
  matches: (clientId: string) => boolean
  toggle: (id: string) => void
  only: (id: string) => void
  showAll: () => void
  reload: () => Promise<void>
  loaded: boolean
}

const Ctx = createContext<ProjectCtx | null>(null)

function readSaved(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? JSON.parse(raw) : []
    // Older versions saved a single id as plain text.
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : typeof v === 'string' && v ? [v] : []
  } catch {
    try { const old = localStorage.getItem(KEY); return old ? [old] : [] } catch { return [] }
  }
}

/** Admin only: which projects to look at. It scopes the Inbox, Tracker and Roadmap, and is remembered. */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ClientOrg[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState<string[]>(readSaved)

  const reload = useCallback(async () => {
    try { setProjects((await api.get<{ clients: ClientOrg[] }>('/api/admin/clients')).clients) }
    catch (e) { notify(e instanceof ApiError ? e.message : 'Could not load projects', 'error') }
    finally { setLoaded(true) }
  }, [])
  useEffect(() => { reload() }, [reload])

  const persist = useCallback((ids: string[]) => {
    setSaved(ids)
    try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch { /* ignore */ }
  }, [])

  // Projects can be deleted. Anything chosen that no longer exists is dropped, and choosing every one means "all".
  const known = useMemo(() => new Set(projects.map((p) => p.id)), [projects])
  const selectedIds = useMemo(() => {
    const ids = loaded ? saved.filter((id) => known.has(id)) : saved
    return loaded && ids.length === projects.length ? [] : ids
  }, [saved, known, loaded, projects.length])

  const value = useMemo<ProjectCtx>(() => {
    const chosen = projects.filter((p) => selectedIds.includes(p.id))
    const set = new Set(selectedIds)
    return {
      projects,
      selectedIds,
      label: selectedIds.length === 0 ? 'All projects' : chosen.length === 1 ? chosen[0].name : `${chosen.length} of ${projects.length} projects`,
      single: chosen.length === 1 ? chosen[0] : null,
      isAll: selectedIds.length === 0,
      matches: (id) => set.size === 0 || set.has(id),
      toggle: (id) => {
        const current = selectedIds.length === 0 ? projects.map((p) => p.id) : selectedIds
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
        // Unticking the last one would show nothing at all, so go back to everything instead.
        persist(next.length === 0 || next.length === projects.length ? [] : next)
      },
      only: (id) => persist([id]),
      showAll: () => persist([]),
      reload,
      loaded,
    }
  }, [projects, selectedIds, persist, reload, loaded])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProject(): ProjectCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useProject outside ProjectProvider')
  return v
}
