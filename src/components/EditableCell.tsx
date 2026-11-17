import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'

interface Props {
  value: string
  label: string
  onSave: (next: string) => Promise<boolean>
  multiline?: boolean
  placeholder?: string
  required?: boolean
  className?: string
}

/**
 * Inline edit. Single line: Enter saves, Escape cancels. Multi-line: explicit Save and Cancel.
 * The pending state stays inside the cell. If saving fails the draft is kept and a retry sits beside it.
 */
export function EditableCell({ value, label, onSave, multiline, placeholder = 'Add', required, className = '' }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const refocus = useRef(false)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => { if (editing) field.current?.focus() }, [editing])
  // After the editor closes, return keyboard focus to the cell's button.
  useEffect(() => { if (!editing && refocus.current) { refocus.current = false; trigger.current?.focus() } }, [editing])

  function close() { refocus.current = true; setFailed(false); setEditing(false) }

  async function save() {
    const next = draft.trim()
    if (required && !next) { setFailed(true); return }
    if (next === value) { close(); return }
    setPending(true)
    setFailed(false)
    const ok = await onSave(next)
    setPending(false)
    if (ok) close()
    else setFailed(true) // keep the draft so nothing is lost
  }

  if (!editing) {
    return (
      <button
        ref={trigger}
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${label}: ${value || 'empty'}`}
        className={`block w-full rounded-control px-2 py-1.5 text-left hover:bg-subtle/60 ${value ? '' : 'text-muted'} ${className}`}
      >
        <span className="line-clamp-2 break-words">{value || placeholder}</span>
      </button>
    )
  }

  const shared = {
    ref: field,
    value: draft,
    'aria-label': label,
    'aria-invalid': failed || undefined,
    // readOnly, not disabled: a disabled box drops keyboard focus, so Escape and Retry would stop working after a failed save.
    readOnly: pending,
    'aria-busy': pending || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
    className: 'input !min-h-9 w-full',
  }

  return (
    <div className="min-w-[14rem]">
      {multiline ? (
        <textarea {...shared} rows={4} onKeyDown={(e) => { if (e.key === 'Escape') close() }} />
      ) : (
        <input
          {...shared}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } else if (e.key === 'Escape') close() }}
          onBlur={() => { if (draft.trim() !== value && !pending && !failed) save() }}
        />
      )}
      {multiline && (
        <div className="mt-1.5 flex gap-2">
          <Button onClick={save} pending={pending} className="!min-h-9">Save</Button>
          <Button variant="secondary" onClick={close} disabled={pending} className="!min-h-9">Cancel</Button>
        </div>
      )}
      {failed && (
        <p role="alert" className="mt-1 flex items-center gap-2 text-sm font-medium text-[var(--seam-error-fg)]">
          {required && !draft.trim() ? 'This cannot be empty.' : 'Not saved.'}
          {!(required && !draft.trim()) && <button type="button" className="underline" onClick={save}>Retry</button>}
          <button type="button" className="underline" onClick={close}>Cancel</button>
        </p>
      )}
    </div>
  )
}
