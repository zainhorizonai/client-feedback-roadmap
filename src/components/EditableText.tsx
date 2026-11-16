import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  className?: string
}

/** Click-to-edit cell. Enter or blur saves, Escape cancels. */
export function EditableText({ value, onSave, placeholder = '—', className = '' }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => { if (editing) ref.current?.select() }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onSave(draft)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className="w-full rounded border border-brand-500 bg-white px-1.5 py-1 text-sm outline-none ring-2 ring-brand-100"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={`block w-full truncate rounded px-1.5 py-1 text-left text-sm hover:bg-slate-100 ${value ? '' : 'text-slate-400'} ${className}`}
    >
      {value || placeholder}
    </button>
  )
}
