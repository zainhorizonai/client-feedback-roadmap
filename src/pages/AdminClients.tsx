import { useCallback, useEffect, useState } from 'react'
import { Building2, Plus, UserPlus } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { notify } from '../lib/toast'
import type { ClientOrg } from '../lib/types'
import { btnPrimary, btnSecondary, inputCls } from '../components/ui'

export function AdminClients() {
  const [clients, setClients] = useState<ClientOrg[] | null>(null)
  const [name, setName] = useState('')
  const [inviting, setInviting] = useState<string | null>(null)
  const [uName, setUName] = useState('')
  const [uEmail, setUEmail] = useState('')

  const load = useCallback(async () => {
    try { setClients((await api.get<{ clients: ClientOrg[] }>('/api/admin/clients')).clients) }
    catch (e) { notify(e instanceof ApiError ? e.message : 'Could not load clients', 'error') }
  }, [])
  useEffect(() => { load() }, [load])

  async function addClient(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.post('/api/admin/clients', { name })
      setName('')
      await load()
    } catch (err) { notify(err instanceof ApiError ? err.message : 'Failed', 'error') }
  }

  async function invite(e: React.FormEvent, clientId: string) {
    e.preventDefault()
    try {
      await api.post(`/api/admin/clients/${clientId}/users`, { name: uName, email: uEmail })
      notify(`Invitation sent to ${uEmail}.`)
      setUName(''); setUEmail(''); setInviting(null)
      await load()
    } catch (err) { notify(err instanceof ApiError ? err.message : 'Failed', 'error') }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">Clients</h1>
      <p className="mt-1 text-sm text-slate-600">Each client only ever sees their own reports. Invited people sign in with their email.</p>

      <form onSubmit={addClient} className="mt-6 flex gap-2">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="New client name" className={inputCls} />
        <button className={btnPrimary} type="submit"><Plus className="h-4 w-4" /> Add client</button>
      </form>

      <div className="mt-6 space-y-4">
        {clients === null && <p className="text-sm text-slate-500">Loading…</p>}
        {clients?.length === 0 && <p className="text-sm text-slate-500">No clients yet. Add one above, then invite their lead.</p>}
        {clients?.map((c) => (
          <section key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-slate-400" /> {c.name}</h2>
              <button className={btnSecondary} onClick={() => setInviting(inviting === c.id ? null : c.id)}><UserPlus className="h-4 w-4" /> Invite person</button>
            </div>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {c.users.length === 0 && <li className="py-2 text-slate-500">No one invited yet.</li>}
              {c.users.map((u) => (
                <li key={u.id} className="flex justify-between py-2"><span className="font-medium">{u.name}</span><span className="text-slate-500">{u.email}</span></li>
              ))}
            </ul>
            {inviting === c.id && (
              <form onSubmit={(e) => invite(e, c.id)} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input required value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Full name" className={inputCls} />
                <input required type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="email@client.com" className={inputCls} />
                <button className={btnPrimary} type="submit">Send invite</button>
              </form>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
