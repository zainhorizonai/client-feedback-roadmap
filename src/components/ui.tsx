import { cloneElement, forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Loader2, VideoOff, X } from 'lucide-react'
import type { Kind, RoadmapState, Severity, Status } from '../lib/types'

// ---------- Button ----------

type Variant = 'primary' | 'secondary' | 'tertiary' | 'danger'
const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-full px-5 font-semibold no-underline select-none ' +
  'min-h-11 md:min-h-9 disabled:cursor-not-allowed disabled:opacity-55'
const BUTTON_VARIANT: Record<Variant, string> = {
  primary: 'bg-action text-on-action hover:bg-action-hover',
  secondary: 'border border-control bg-surface text-ink hover:bg-subtle',
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
export const SeverityBadge = ({ severity }: { severity: Severity }) => <span className={`badge ${SEVERITY_TONE[severity]}`}>{severity}</span>
const STAGE_TONE: Record<RoadmapState, string> = { 'Under review': 'badge-neutral', Planned: 'badge-info', 'In progress': 'badge-warning', Done: 'badge-success' }
export const StageBadge = ({ stage }: { stage: RoadmapState }) => <span className={`badge ${STAGE_TONE[stage]}`}>{stage}</span>
export const KindTag = ({ kind }: { kind: Kind }) => (
  <span className="inline-block rounded-control border border-line bg-surface px-2 py-0.5 text-[.8125rem] leading-5 text-muted">{kind}</span>
)

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
  return (
    <figure className="m-0">
      {src ? (
        <video key={src} src={src} controls preload="metadata" playsInline aria-label={title} className="aspect-video w-full rounded-card bg-forest" />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-card bg-forest text-cream/80">
          <VideoOff className="h-7 w-7" aria-hidden="true" />
          <p>No video was added.</p>
        </div>
      )}
      {summary && <figcaption className="mt-2 text-sm text-muted">{summary}</figcaption>}
    </figure>
  )
}

// ---------- Drawer: labelled dialog, traps focus, returns it on close ----------

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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
    // the browser moves focus to the page body, and keys would otherwise stop reaching the drawer.
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
      // Give focus back to the control that opened the drawer.
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-[var(--seam-surface-solid)] shadow-2xl outline-none md:w-[min(100%,var(--seam-drawer-width))] md:rounded-l-[1.75rem] md:border-l md:border-line"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-4 md:px-6">
          <h2 id={titleId} className="min-w-0 break-words font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-subtle hover:text-ink md:h-9 md:w-9">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">{children}</div>
      </div>
    </div>
  )
}
