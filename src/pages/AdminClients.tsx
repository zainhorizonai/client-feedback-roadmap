import { useState } from 'react'
import { Building2, MailPlus, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useProject } from '../lib/project'
import { notify } from '../lib/toast'
import type { ClientOrg } from '../lib/types'
import { EditableCell } from '../components/EditableCell'
import { Button, EmptyState, Field, fmtDate, Mono, PageHeader, Skeleton } from '../components/ui'

type Person = ClientOrg['users'][number]

export function AdminClients() {
  const { projects, reload, loaded } = useProject()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)
  const [uName, setUName] = useState('')
  const [uEmail, setUEmail] = useState('')
  const [sending, setSending] = useState(false)
  // Which confirmation is open: removing one person, or deleting a whole project.
  const [removing, setRemoving] = useState<{ projectId: string; personId: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  const fail = (err: unknown, fallback: string) => notify(err instanceof ApiError ? err.message : fallback, 'error')

  async function addProject(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    try { await api.post('/api/admin/clients', { name }); setName(''); await reload(); notify('Project added.') }
    catch (err) { fail(err, 'Could not add the project') }
    finally { setAdding(false) }
  }

  async function invite(e: React.FormEvent, clientId: string) {
    e.preventDefault()
    setSending(true)
    try {
      const r = await api.post<{ emailSent?: boolean; addedToExisting?: boolean; reinstated?: boolean }>(`/api/admin/clients/${clientId}/users`, { name: uName, email: uEmail })
      if (r.addedToExisting) notify(`${uEmail} already had an account, so they now have access to this project too.`)
      else if (r.emailSent === false) notify(`${uEmail} was added, but the invitation email could not be sent. Use Resend invite once email is working.`, 'error')
      else notify(r.reinstated ? `${uEmail} was invited again and will set a new password.` : `Invitation sent to ${uEmail}. They will set their own password.`)
      setUName(''); setUEmail(''); setInviting(null)
      await reload()
    } catch (err) { fail(err, 'Could not send the invitation') }
    finally { setSending(false) }
  }

  async function rename(person: Person, next: string): Promise<boolean> {
    try { await api.patch(`/api/admin/users/${person.id}`, { name: next }); await reload(); notify('Name saved.'); return true }
    catch (err) { fail(err, 'Could not save the name'); return false }
  }

  async function resend(person: Person) {
    try {
      const r = await api.post<{ emailSent?: boolean }>(`/api/admin/users/${person.id}/password-link`)
      if (r.emailSent === false) notify(`The email to ${person.email} could not be sent. Check the email settings.`, 'error')
      else notify(person.hasPassword ? `Reset link sent to ${person.email}.` : `Invitation sent again to ${person.email}.`)
    } catch (err) { fail(err, 'Could not send the email') }
  }

  async function remove(projectId: string, person: Person) {
    setBusy(true)
    try {
      const r = await api.del<{ accountRemoved?: boolean }>(`/api/admin/clients/${projectId}/users/${person.id}`)
      notify(r.accountRemoved ? `${person.name} was removed and can no longer sign in.` : `${person.name} was removed from this project. They keep their other projects.`)
      setRemoving(null)
      await reload()
    } catch (err) { fail(err, 'Could not remove them') }
    finally { setBusy(false) }
  }

  async function deleteProject(p: ClientOrg) {
    setBusy(true)
    try {
      const r = await api.post<{ deleted: { reports: number; items: number; people: number } }>(`/api/admin/clients/${p.id}/delete`, { confirm: typed })
      notify(`${p.name} was deleted, with ${r.deleted.reports} reports and ${r.deleted.items} roadmap cards.`)
      setDeleting(null); setTyped('')
      await reload()
    } catch (err) { fail(err, 'Could not delete the project') }
    finally { setBusy(false) }
  }

  // How many projects someone is in, to tell the admin what removing them will do.
  const projectsOf = (email: string) => projects.filter((p) => p.users.some((u) => u.email === email)).length

  return (
    <div className="max-w-4xl">
      <PageHeader title="Projects and people" subtitle="Give people a name, invite them, send the invitation again, or take their access away. Each person only sees the projects they belong to." />

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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id={`p-${p.id}`} className="flex items-center gap-2 break-words font-semibold"><Building2 className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />{p.name}</h2>
                  <p className="mt-1 text-sm text-muted">{p.reportCount ?? 0} reports · {p.openCount ?? 0} open · {p.itemCount ?? 0} roadmap cards · {p.users.length} {p.users.length === 1 ? 'person' : 'people'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setInviting(inviting === p.id ? null : p.id)} aria-expanded={inviting === p.id}><UserPlus className="h-4 w-4" aria-hidden="true" />Invite person</Button>
                  <Button variant="tertiary" onClick={() => { setDeleting(deleting === p.id ? null : p.id); setTyped('') }} aria-expanded={deleting === p.id}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete project</Button>
                </div>
              </div>

              {deleting === p.id && (
                <div role="alertdialog" aria-labelledby={`del-${p.id}`} className="mt-4 rounded-card border border-[var(--seam-error-fg)]/40 bg-[var(--seam-error-bg)] p-4">
                  <h3 id={`del-${p.id}`} className="font-semibold text-[var(--seam-error-fg)]">Delete {p.name}?</h3>
                  <p className="mt-1">This cannot be undone. It permanently deletes:</p>
                  <ul className="mt-1 list-disc pl-5">
                    <li>{p.reportCount ?? 0} reports, with their videos, notes and history</li>
                    <li>{p.itemCount ?? 0} roadmap cards</li>
                  </ul>
                  <p className="mt-1">{p.users.length === 0 ? 'No one is in this project.' : 'People who only belong to this project lose their access. Anyone in another project keeps that one.'}</p>
                  <p className="mt-1 text-sm">Want a copy first? Use Export current view in the Tracker.</p>
                  <div className="mt-3 max-w-sm">
                    <Field label={`Type ${p.name} to confirm`}><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus /></Field>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="danger" onClick={() => deleteProject(p)} pending={busy} disabled={typed !== p.name}>Delete project</Button>
                    <Button variant="tertiary" onClick={() => { setDeleting(null); setTyped('') }}>Cancel</Button>
                  </div>
                </div>
              )}

              <ul className="mt-3 divide-y divide-line">
                {p.users.length === 0 && <li className="py-3 text-muted">No one has been invited yet.</li>}
                {p.users.map((u) => {
                  const confirming = removing?.projectId === p.id && removing.personId === u.id
                  const others = projectsOf(u.email) - 1
                  return (
                    <li key={u.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0 flex-1 basis-64">
                          <EditableCell value={u.name} label={`name of ${u.email}`} required onSave={(v) => rename(u, v)} className="font-semibold" />
                          <p className="break-all px-2 text-sm text-muted">{u.email}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {u.hasPassword
                            ? <span className="badge badge-success">Accepted</span>
                            : <span className="badge badge-warning">Invited, not accepted{u.invitedAt ? <> · <Mono>{fmtDate(u.invitedAt)}</Mono></> : null}</span>}
                          <Button variant="secondary" onClick={() => resend(u)}><MailPlus className="h-4 w-4" aria-hidden="true" />{u.hasPassword ? 'Send reset link' : 'Resend invite'}</Button>
                          <Button variant="tertiary" onClick={() => setRemoving(confirming ? null : { projectId: p.id, personId: u.id })} aria-expanded={confirming}><UserMinus className="h-4 w-4" aria-hidden="true" />Remove<span className="sr-only"> {u.name} from {p.name}</span></Button>
                        </div>
                      </div>
                      {confirming && (
                        <div role="alertdialog" aria-label={`Remove ${u.name}`} className="mt-3 rounded-card border border-[var(--seam-error-fg)]/40 bg-[var(--seam-error-bg)] p-3">
                          <p className="font-semibold text-[var(--seam-error-fg)]">Remove {u.name} from {p.name}?</p>
                          <p className="mt-1">{others > 0
                            ? `They lose access to ${p.name} only. They keep their ${others} other ${others === 1 ? 'project' : 'projects'}.`
                            : `They will no longer be able to sign in, and any device they are signed in on is signed out. What they reported stays, with their name on it. You can invite them again later.`}{!u.hasPassword && ' They never accepted the invitation, so the link in their email stops working.'}</p>
                          <div className="mt-3 flex gap-2">
                            <Button variant="danger" onClick={() => remove(p.id, u)} pending={busy}>Remove {u.name}</Button>
                            <Button variant="tertiary" onClick={() => setRemoving(null)}>Cancel</Button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>

              {inviting === p.id && (
                <form onSubmit={(e) => invite(e, p.id)} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <Field label="Name" required hint="How you know them."><input required className="input" value={uName} onChange={(e) => setUName(e.target.value)} autoFocus /></Field>
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
