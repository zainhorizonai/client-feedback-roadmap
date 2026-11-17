import { cloneElement, forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, type LinkProps } from 'react-router-dom'
import { Check, ChevronDown, Loader2, VideoOff, X } from 'lucide-react'
import { CLIENT_STATUS, SEVERITIES, STATUSES, type Kind, type RoadmapState, type Severity, type Status } from '../lib/types'

// ---------- Button ----------

type Variant = 'primary' | 'secondary' | 'tertiary' | 'danger'
const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-control px-4 font-semibold no-underline select-none ' +
  'min-h-11 md:min-h-9 disabled:cursor-not-allowed disabled:opacity-55'
const BUTTON_VARIANT: Record<Variant, string> = {
  primary: 'bg-action text-on-action hover:bg-action-hover',
  secondary: 'border border-control bg-surface text-ink hover:bg-canvas',
  tertiary: 'px-2 text-ink underline-offset-4 hover:underline',
  danger: 'border border-control bg-surface text-[var(--seam-error-fg)] hover:bg-[var(--seam-error-bg)]',
}
export const buttonClass = (variant: Variant = 'primary', extra = '') => `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${extra}`

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** Shows a spinner, disables the button and announces busy state. */
  pending?: boolean
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', pending, disabled, className = '', children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || pending} aria-busy={pending || undefined} className={buttonClass(variant, className)} {...rest}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
})

export function ButtonLink({ variant = 'primary', className = '', ...rest }: LinkProps & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...rest} />
}

// ---------- Badges: a text label always travels with the colour ----------

const STATUS_TONE: Record<Status, string> = {
  New: 'badge-neutral',
  Triaging: 'badge-info',
  'In progress': 'badge-info',
  'Needs client input': 'badge-warning',
  'Ready to verify': 'badge-verify',
  Resolved: 'badge-success',
}
const SEVERITY_TONE: Record<Severity, string> = { Low: 'badge-neutral', Medium: 'badge-warning', High: 'badge-error', Blocker: 'badge-error' }

export const StatusBadge = ({ status }: { status: Status }) => <span className={`badge ${STATUS_TONE[status]}`}>{status}</span>
/** The same status in the words clients see. */
export const ClientStatusBadge = ({ status }: { status: Status }) => <span className={`badge ${STATUS_TONE[status]}`}>{CLIENT_STATUS[status]}</span>
export const SeverityBadge = ({ severity }: { severity: Severity }) => <span className={`badge ${SEVERITY_TONE[severity]}`}>{severity}</span>
const STAGE_TONE: Record<RoadmapState, string> = { 'Under review': 'badge-neutral', Planned: 'badge-info', 'In progress': 'badge-warning', Done: 'badge-success' }
export const StageBadge = ({ stage }: { stage: RoadmapState }) => <span className={`badge ${STAGE_TONE[stage]}`}>{stage}</span>
export const KindTag = ({ kind }: { kind: Kind }) => (
  <span className="inline-block rounded-control border border-line bg-surface px-2 py-0.5 text-[.8125rem] leading-5 text-muted">{kind}</span>
)

// ---------- Pill select: a coloured label you click to change, instead of a form dropdown ----------

interface PillSelectProps<T extends string> {
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  /** Spoken name, for example "Status of ACME-4". */
  label: string
  /** The badge colour class for a value. */
  tone: (v: T) => string
  size?: 'sm' | 'md'
}

export function PillSelect<T extends string>({ value, options, onChange, label, tone, size = 'sm' }: PillSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ x: number; y: number; up: boolean } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()

  function toggle() {
    if (open) { setOpen(false); return }
    const r = button.current!.getBoundingClientRect()
    // Open upward near the bottom of the window. Placed from the window, so a scrolling table never clips it.
    const up = window.innerHeight - r.bottom < options.length * 40 + 24
    setAt({ x: r.left, y: up ? r.top - 6 : r.bottom + 6, up })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    ;(items().find((x) => x.getAttribute('aria-selected') === 'true') ?? items()[0])?.focus()
    const close = (focusButton: boolean) => { setOpen(false); if (focusButton) button.current?.focus() }
    // Capture phase, and stopped there, so Escape closes only this menu and not the dialog behind it.
    const onKey = (e: KeyboardEvent) => {
      if (!list.current?.contains(document.activeElement) && document.activeElement !== button.current) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation()
        const list_ = items(); const i = list_.indexOf(document.activeElement as HTMLElement)
        list_[(i + (e.key === 'ArrowDown' ? 1 : -1) + list_.length) % list_.length]?.focus()
      } else if (e.key === 'Tab') close(false)
    }
    const onDown = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(false) }
    const onMove = () => close(false)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  const pick = (v: T) => { setOpen(false); button.current?.focus(); if (v !== value) onChange(v) }

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${label}: ${value}. Change`}
        className={`badge ${tone(value)} cursor-pointer gap-1.5 transition-shadow hover:shadow-[0_0_0_2px_var(--seam-border-control)] ${size === 'md' ? '!px-3 !py-1.5 !text-base' : 'min-h-8 !px-2.5'}`}
      >
        {value}<ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
      </button>
      {open && at && createPortal(
        <ul
          ref={list} id={id} role="listbox" aria-label={label}
          // The menu is drawn outside the table, but React still passes clicks up to the row. Stop it, or choosing a
          // status would also open the ticket.
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: Math.min(at.x, window.innerWidth - 232), top: at.up ? undefined : at.y, bottom: at.up ? window.innerHeight - at.y : undefined }}
          className="z-50 w-56 rounded-card border border-line bg-surface p-1.5 shadow-xl"
        >
          {options.map((o) => (
            <li key={o} role="option" aria-selected={o === value} tabIndex={-1} onClick={() => pick(o)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(o) } }}
              className="flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-control px-2 hover:bg-canvas focus:bg-canvas">
              <span className={`badge ${tone(o)}`}>{o}</span>{o === value && <Check className="h-4 w-4 text-muted" aria-label="Selected" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}

export const StatusSelect = ({ value, onChange, label, size }: { value: Status; onChange: (v: Status) => void; label: string; size?: 'sm' | 'md' }) =>
  <PillSelect value={value} options={STATUSES} onChange={onChange} label={label} size={size} tone={(v) => STATUS_TONE[v]} />
export const SeveritySelect = ({ value, onChange, label, size }: { value: Severity; onChange: (v: Severity) => void; label: string; size?: 'sm' | 'md' }) =>
  <PillSelect value={value} options={SEVERITIES} onChange={onChange} label={label} size={size} tone={(v) => SEVERITY_TONE[v]} />

/** One property in a ticket's side panel: a quiet label, and a value that looks like text until you point at it. */
export function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-11 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-sm text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// ---------- Formatting ----------

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** Identifiers and timestamps use the monospace face so columns line up. */
export const Mono = ({ children, className = '' }: { children: ReactNode; className?: string }) => <span className={`font-mono tabular-nums ${className}`}>{children}</span>

// ---------- Field: persistent label, hint, required marker, local error ----------

/**
 * A form field: a persistent label tied to the control by id, an optional hint, a required marker and a local error.
 * The control is passed in as the only child and receives the id and the description links.
 */
type FieldProps = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }

export function Field({ label, hint, required, error, children, className = '' }: { label: string; hint?: string; required?: boolean; error?: string; children: ReactElement<Record<string, unknown>> | ((p: FieldProps) => ReactElement); className?: string }) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  const describedBy = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined
  const wiring: FieldProps = { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined }
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-semibold">
        {label}
        {required && <span aria-hidden="true" className="text-[var(--seam-error-fg)]"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {hint && <p id={hintId} className="mb-1.5 text-sm text-muted">{hint}</p>}
      {/* A function child lets a field that wraps its input (a password box with a Show button) put the id on the input itself. */}
      {typeof children === 'function' ? children(wiring) : cloneElement(children, { ...wiring, 'aria-invalid': wiring['aria-invalid'] ?? children.props['aria-invalid'] })}
      {error && <p id={errId} role="alert" className="mt-1 text-sm font-medium text-[var(--seam-error-fg)]">{error}</p>}
    </div>
  )
}

// ---------- Page furniture ----------

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-muted">{eyebrow}</p>}
        <h1 className="font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-control bg-surface px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 flex justify-center text-muted" aria-hidden="true">{icon}</div>}
      <h2 className="font-semibold">{title}</h2>
      {children && <p className="mx-auto mt-1 max-w-md text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/** Placeholder rows that match the final layout. Motion stops when the user prefers reduced motion. */
export function Skeleton({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-12 animate-pulse rounded-control bg-subtle/70" />)}
      <span className="sr-only">Loading</span>
    </div>
  )
}

/** The stepped seam from the logo, used sparingly as a brand divider on sign-in and email headers. */
export function SeamDivider({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 12" role="presentation" aria-hidden="true" className={`h-3 w-full ${className}`} preserveAspectRatio="none">
      <path d="M0 10H24V6H48V2H72V6H96V10H120" fill="none" stroke="var(--seam-terracotta)" strokeWidth="2.5" strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// ---------- Video: native controls, never autoplay ----------

export function VideoEvidence({ src, title = 'Video', summary }: { src?: string | null; title?: string; summary?: string }) {
  const video = useRef<HTMLVideoElement>(null)
  // A timestamp in a note ("[1:23]") asks the video to jump there.
  useEffect(() => {
    const seek = (e: Event) => {
      const v = video.current
      const t = (e as CustomEvent<number>).detail
      if (!v || !Number.isFinite(t)) return
      v.currentTime = t
      v.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      void v.play().catch(() => { /* the browser may need a tap first */ })
    }
    window.addEventListener('seam:seek', seek)
    return () => window.removeEventListener('seam:seek', seek)
  }, [])
  return (
    <figure className="m-0">
      {src ? (
        <video ref={video} key={src} src={src} controls preload="metadata" playsInline aria-label={title} className="aspect-video w-full rounded-card bg-forest" />
      ) : (
        // No video: a slim note, not a big empty player, so the useful content stays near the top.
        <div className="flex items-center gap-2 rounded-control border border-line bg-canvas px-3 py-2.5 text-muted">
          <VideoOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p>No video was added.</p>
        </div>
      )}
      {summary && <figcaption className="mt-2 text-sm text-muted">{summary}</figcaption>}
    </figure>
  )
}

// ---------- Modal: a large centred dialog (like a task view). Labelled, traps focus, returns it on close ----------

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Small line above the title, such as the ID and project. */
  eyebrow?: ReactNode
  /** Buttons or badges shown beside the close button. */
  actions?: ReactNode
  /** md for short forms; xl for a full task view that uses ModalSplit. */
  size?: 'md' | 'xl'
}

export function Modal({ title, onClose, children, eyebrow, actions, size = 'md' }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()

    // Listen on the document, not the panel: when a focused button disables itself (for example while saving)
    // the browser moves focus to the page body, and keys would otherwise stop reaching the dialog.
    function onKey(e: KeyboardEvent) {
      const el = panel.current
      if (!el) return
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return }
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
      if (items.length === 0) { e.preventDefault(); el.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = active ? el.contains(active) : false
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
      else if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      // Give focus back to the control that opened the dialog.
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  const big = size === 'xl'
  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center md:items-center md:p-6">
      <div className="absolute inset-0 bg-forest/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex w-full flex-col overflow-hidden bg-surface shadow-2xl outline-none md:rounded-[1rem] ${big ? 'h-[100dvh] md:h-[min(90vh,60rem)] md:max-w-6xl' : 'h-[100dvh] md:h-auto md:max-h-[90vh] md:max-w-xl'}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 md:px-6 md:py-4">
          <div className="min-w-0">
            {eyebrow && <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">{eyebrow}</div>}
            <h2 id={titleId} className="min-w-0 break-words text-xl font-semibold leading-snug">{title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-canvas hover:text-ink md:h-9 md:w-9">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {/* Short forms scroll as one. A full task view scrolls its two columns separately on wide screens. */}
        <div className={`min-h-0 flex-1 overflow-y-auto ${big ? 'lg:overflow-hidden' : 'px-4 py-5 md:px-6'}`}>{children}</div>
      </div>
    </div>
  )
}

/** The task-view layout: the conversation and evidence on the left, the facts and controls on the right. */
export function ModalSplit({ main, side, sideFirstOnPhone = false }: { main: ReactNode; side: ReactNode; sideFirstOnPhone?: boolean }) {
  // On a phone the columns stack. When the side holds the thing a person must act on (their status, a question
  // for them), it goes first so it is the first thing they see.
  return (
    <div className="flex flex-col lg:grid lg:h-full lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className={`px-4 py-5 md:px-8 lg:order-none lg:overflow-y-auto ${sideFirstOnPhone ? 'order-2' : ''}`}>{main}</div>
      <aside aria-label="Details" className={`bg-canvas/60 px-4 py-5 md:px-6 lg:order-none lg:overflow-y-auto lg:border-l lg:border-t-0 ${sideFirstOnPhone ? 'order-1 border-b border-line lg:border-b-0' : 'border-t border-line'}`}>{side}</aside>
    </div>
  )
}

/** A titled group inside a modal column. */
export function Block({ title, children, tone = 'plain', hint }: { title: string; children: ReactNode; tone?: 'plain' | 'private'; hint?: ReactNode }) {
  return (
    <section className={`mt-6 first:mt-0 ${tone === 'private' ? 'rounded-card border border-dashed border-control bg-subtle/50 p-4' : ''}`}>
      <h3 className="mb-1.5 font-semibold">{title}</h3>
      {hint && <p className="mb-2 text-sm text-muted">{hint}</p>}
      {children}
    </section>
  )
}

/** Big number tiles used at the top of both the client and admin pages. */
export function StatTile({ label, hint, value, active, onClick }: { label: string; hint?: string; value: ReactNode; active?: boolean; onClick?: () => void }) {
  const cls = `rounded-card border p-4 text-left ${active ? 'border-forest bg-surface ring-2 ring-forest' : 'border-line bg-surface'} ${onClick ? 'hover:border-control' : ''}`
  const inner = (<><span className="block text-3xl font-semibold tabular-nums">{value}</span><span className="block font-semibold">{label}</span>{hint && <span className="block text-sm text-muted">{hint}</span>}</>)
  return onClick ? <button type="button" onClick={onClick} aria-pressed={!!active} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>
}

/** A small set of mutually exclusive buttons, used for view and type switches. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-control border border-control bg-surface p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={value === o.id} className={`min-h-10 rounded-[.25rem] px-3 font-semibold md:min-h-8 ${value === o.id ? 'bg-forest text-cream' : 'text-ink hover:bg-canvas'}`}>{o.label}</button>
      ))}
    </div>
  )
}
