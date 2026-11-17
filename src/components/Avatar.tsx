export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function Avatar({ name, size = 'md', tone = 'dark' }: { name: string; size?: 'md' | 'lg'; tone?: 'dark' | 'light' }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${tone === 'dark' ? 'bg-forest text-cream' : 'bg-cream text-forest'} ${size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-sm'}`}>
      {initials(name)}
    </span>
  )
}
