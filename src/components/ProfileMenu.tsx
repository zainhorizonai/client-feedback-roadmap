import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, LogOut, UserRound } from 'lucide-react'
import { useAuth } from '../lib/auth'

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-forest font-semibold text-cream ${size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-sm'}`}>
      {initials(name)}
    </span>
  )
}

interface Props {
  /** Clients with several projects can switch here as well as in the header. */
  projects?: { id: string; name: string }[]
  selectedId?: string
  onSelect?: (id: string) => void
  pending?: Record<string, number>
}

/** Top-right profile: initials, name, and a menu with the person's details, projects, account and sign out. */
export function ProfileMenu({ projects = [], selectedId, onSelect, pending = {} }: Props) {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    items()[0]?.focus()
    const onDown = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); button.current?.focus(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const list = items()
      const i = list.indexOf(document.activeElement as HTMLElement)
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!user) return null
  const item = 'flex min-h-11 w-full items-center gap-2 rounded-control px-3 text-left font-semibold no-underline hover:bg-subtle md:min-h-9'

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${user.name}`}
        className="flex min-h-11 items-center gap-2 rounded-control pl-1 pr-2 hover:bg-subtle md:min-h-10"
      >
        <Avatar name={user.name} />
        <span className="hidden max-w-[10rem] truncate font-semibold md:inline">{user.name}</span>
        <ChevronDown className="hidden h-4 w-4 text-muted md:block" aria-hidden="true" />
      </button>

      {open && (
        <div id={menuId} ref={menu} role="menu" aria-label="Account" className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-card border border-line bg-surface p-2 shadow-xl">
          <div className="flex items-center gap-3 px-3 py-3">
            <Avatar name={user.name} size="lg" />
            <div className="min-w-0">
              <p className="break-words font-semibold">{user.name}</p>
              <p className="break-all text-sm text-muted">{user.email}</p>
              <p className="text-sm text-muted">{user.role === 'admin' ? 'Team member' : 'Client'}</p>
            </div>
          </div>

          {projects.length > 1 && (
            <div className="border-t border-line py-2" role="group" aria-label="Your projects">
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Your projects</p>
              {projects.map((p) => (
                <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === selectedId} onClick={() => { onSelect?.(p.id); setOpen(false); button.current?.focus() }} className={item}>
                  <span className="flex h-4 w-4 items-center justify-center">{p.id === selectedId && <Check className="h-4 w-4 text-action" aria-hidden="true" />}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {pending[p.id] ? <span className="rounded-full bg-canvas px-2 text-sm font-medium text-muted">{pending[p.id]} pending</span> : null}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-line pt-2">
            <Link to="/account" role="menuitem" onClick={() => setOpen(false)} className={item}><UserRound className="h-4 w-4" aria-hidden="true" />Account and password</Link>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); signOut() }} className={item}><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</button>
          </div>
        </div>
      )}
    </div>
  )
}
