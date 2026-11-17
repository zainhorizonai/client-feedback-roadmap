import { useEffect, useId, useRef, useState } from 'react'
import { Building2, ChevronDown } from 'lucide-react'
import { useProject } from '../lib/project'

/**
 * Tick the projects you want to see. Everything in the Inbox, Tracker and Roadmap follows it.
 * With nothing ticked you see them all.
 */
export function ProjectFilter({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { projects, selectedIds, isAll, label, toggle, only, showAll } = useProject()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>('input, button')?.focus()
    const onDown = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const shown = projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
  const dark = tone === 'dark'

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`flex min-h-11 w-full items-center gap-2 rounded-full border px-4 text-left font-semibold md:min-h-9 ${dark ? 'border-white/30 bg-black text-cream' : 'border-control bg-surface text-ink'}`}
      >
        <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate"><span className="sr-only">Projects: </span>{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>

      {open && (
        <div id={panelId} ref={panel} role="dialog" aria-label="Choose projects to show" className="absolute left-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-[var(--seam-surface-solid)] p-3 text-ink shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold">Show these projects</p>
            <button type="button" onClick={showAll} disabled={isAll} className="text-sm font-semibold underline disabled:cursor-default disabled:no-underline disabled:opacity-50">Show all</button>
          </div>
          {projects.length > 6 && <input className="input mb-2" type="search" aria-label="Find a project" placeholder="Find a project" value={q} onChange={(e) => setQ(e.target.value)} />}
          {projects.length === 0 ? <p className="py-3 text-sm text-muted">No projects yet.</p> : (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {shown.map((p) => {
                const on = isAll || selectedIds.includes(p.id)
                return (
                  <li key={p.id} className="flex items-center gap-1 rounded-control hover:bg-subtle">
                    <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 px-2">
                      <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="h-4 w-4 shrink-0 accent-white" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.openCount ? <span className="shrink-0 text-sm text-muted">{p.openCount} open</span> : null}
                    </label>
                    <button type="button" onClick={() => only(p.id)} className="mr-1 min-h-9 rounded-control px-2 text-sm font-semibold underline" aria-label={`Show only ${p.name}`}>Only</button>
                  </li>
                )
              })}
              {shown.length === 0 && <li className="py-3 text-center text-sm text-muted">No project matches.</li>}
            </ul>
          )}
          <p className="mt-2 border-t border-line pt-2 text-xs text-muted">With none unticked you see everything. Your choice is remembered.</p>
        </div>
      )}
    </div>
  )
}

/** The chosen projects as removable chips, so it is always clear what is being shown. */
export function ProjectChips() {
  const { projects, selectedIds, toggle, showAll, isAll } = useProject()
  if (isAll) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Projects shown">
      <span className="text-sm text-muted">Showing</span>
      {projects.filter((p) => selectedIds.includes(p.id)).map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-black py-1 pl-3 pr-1 text-sm font-semibold text-cream">
          {p.name}
          <button type="button" onClick={() => toggle(p.id)} aria-label={`Stop showing ${p.name}`} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-cream/20">×</button>
        </span>
      ))}
      <button type="button" onClick={showAll} className="text-sm font-semibold underline">Show all projects</button>
    </div>
  )
}
