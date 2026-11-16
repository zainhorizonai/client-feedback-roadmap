import crypto from 'node:crypto'
import { ensureAdmins } from './auth'
import { config } from './config'
import { all, one, run } from './db'

// Dev helper: creates two demo clients with a few reports (no videos). Safe to run twice.
const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString()
ensureAdmins()

function client(name: string) {
  const ex = one<{ id: string }>('SELECT id FROM clients WHERE name = ?', name)
  if (ex) return ex.id
  const id = crypto.randomUUID()
  run('INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)', id, name, ago(30))
  return id
}
function user(email: string, name: string, clientId: string) {
  const ex = one<{ id: string }>('SELECT id FROM users WHERE email = ?', email)
  if (ex) return ex.id
  const id = crypto.randomUUID()
  run("INSERT INTO users (id, email, name, role, client_id, created_at) VALUES (?, ?, ?, 'client', ?, ?)", id, email, name, clientId, ago(30))
  return id
}

const acme = client('Acme Corp')
const globex = client('Globex Ltd')
const jane = user('jane@acme.com', 'Jane Cooper', acme)
const sam = user('sam@globex.com', 'Sam Rivera', globex)

if ((one<{ n: number }>('SELECT COUNT(*) AS n FROM reports')?.n ?? 0) === 0) {
  const rows: [string, string, string, string, string, string, number][] = [
    ['Checkout button does nothing on mobile', acme, jane, 'Blocker', 'Resolved', 'https://app.acme.com/checkout', 6],
    ['Invoice PDF shows wrong total', acme, jane, 'High', 'In progress', 'https://app.acme.com/invoices/2041', 3],
    ['Dashboard filters reset after refresh', globex, sam, 'Low', 'Triaging', 'https://portal.globex.com/dashboard', 2],
    ['Cannot upload files over 5 MB', globex, sam, 'High', 'New', 'https://portal.globex.com/uploads', 1],
  ]
  rows.forEach(([title, c, u, severity, status, url, days], i) => {
    const seq = i + 1
    const id = `BUG-${String(seq).padStart(4, '0')}`
    // video_path '' means "visible, but no video file" so demo rows show in the tracker.
    run(
      "INSERT INTO reports (id, seq, created_at, client_id, reporter_id, title, page_url, severity, status, video_path, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)",
      id, seq, ago(days), c, u, title, url, severity, status, status === 'Resolved' ? ago(days - 1) : null,
    )
    run("INSERT INTO history (report_id, at, by, kind, text) VALUES (?, ?, 'client', 'created', 'Report submitted')", id, ago(days))
  })
}

console.log(`Seeded. Clients: ${all('SELECT id FROM clients').length}. Admins: ${config.adminEmails.join(', ') || '(none, set ADMIN_EMAILS)'}`)
