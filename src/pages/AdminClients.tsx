import { useState } from 'react'
import { Building2, Plus, UserPlus } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useProject } from '../lib/project'
import { notify } from '../lib/toast'
import { Button, EmptyState, Field, PageHeader, Skeleton } from '../components/ui'

export function AdminClients() {
  const { projects, reload, loaded } = useProject()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)
  const [uName, setUName] = useState('')
  const [uEmail, setUEmail] = useState('')
  const [sending, setSending] = useState(false)

  async function addProject(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    try { await api.post('/api/admin/clients', { name }); setName(''); await reload(); notify('Project added.') }
    catch (err) { notify(err instanceof ApiError ? err.message : 'Could not add the project', 'error') }
    finally { setAdding(false) }
  }

  async function invite(e: React.FormEvent, clientId: string) {
    e.preventDefault()
    setSending(true)
    try {
      const r = await api.post<{ emailSent?: boolean; addedToExisting?: boolean }>(`/api/admin/clients/${clientId}/users`, { name: uName, email: uEmail })
      if (r.addedToExisting) notify(`${uEmail} already had an account, so they now have access to this project too.`)
      else if (r.emailSent === false) notify(`${uEmail} was added, but the invitation email could not be sent. They can still sign in from the sign-in page.`, 'error')
      else notify(`Invitation sent to ${uEmail}.`)
      setUName(''); setUEmail(''); setInviting(null)
      await reload()
    } catch (err) { notify(err instanceof ApiError ? err.message : 'Could not send the invitation', 'error') }
    finally { setSending(false) }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Projects and people" subtitle="Each project only ever sees its own reports and published roadmap items. Invited people sign in with their email." />

      <form onSubmit={addProject} className="mb-6 flex flex-wrap items-end gap-2">
        <Field label="New project" className="min-w-[14rem] flex-1"><input required className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Project or client name" /></Field>
        <Button type="submit" pending={adding} disabled={!name.trim()}><Plus className="h-4 w-4" aria-hidden="true" />Add project</Button>
      </form>

      {!loaded ? <Skeleton rows={3} /> : projects.length === 0 ? (
        <EmptyState icon={<Building2 className="h-9 w-9" />} title="No projects yet">Add a project above, then invite the people who will send you feedback.</EmptyState>
      ) : (
        <div className="space-y-4">
          {projects.map((p) => (
            <section key={p.id} aria-labelledby={`p-${p.id}`} className="rounded-card border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id={`p-${p.id}`} className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-muted" aria-hidden="true" />{p.name}</h2>
                <Button variant="secondary" onClick={() => setInviting(inviting === p.id ? null : p.id)} aria-expanded={inviting === p.id}><UserPlus className="h-4 w-4" aria-hidden="true" />Invite person</Button>
              </div>
              <ul className="mt-3 divide-y divide-line">
                {p.users.length === 0 && <li className="py-2 text-muted">No one invited yet.</li>}
                {p.users.map((u) => <li key={u.id} className="flex flex-wrap justify-between gap-x-4 py-2"><span className="font-semibold">{u.name}</span><span className="break-all text-muted">{u.email}</span></li>)}
              </ul>
              {inviting === p.id && (
                <form onSubmit={(e) => invite(e, p.id)} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <Field label="Full name" required><input required className="input" value={uName} onChange={(e) => setUName(e.target.value)} autoFocus /></Field>
                  <Field label="Email" required><input required type="email" className="input" value={uEmail} onChange={(e) => setUEmail(e.target.value)} /></Field>
                  <Button type="submit" pending={sending}>Send invitation</Button>
                </form>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
