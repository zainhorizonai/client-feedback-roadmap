import crypto from 'node:crypto'
import { ensureAdmins, hashPassword } from './auth.js'
import { config } from './config.js'
import { all, one, run } from './db.js'

// Dev helper: creates two demo clients with a few reports (no videos). Safe to run twice.
const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString()
await ensureAdmins()

async function client(name: string) {
  const ex = await one<{ id: string }>('SELECT id FROM clients WHERE name = $1', name)
  if (ex) return ex.id
  const id = crypto.randomUUID()
  await run('INSERT INTO clients (id, name, created_at) VALUES ($1, $2, $3)', id, name, ago(30))
  return id
}
async function user(email: string, name: string, clientId: string) {
  const ex = await one<{ id: string }>('SELECT id FROM users WHERE email = $1', email)
  if (ex) return ex.id
  const id = crypto.randomUUID()
  await run("INSERT INTO users (id, email, name, role, client_id, created_at) VALUES ($1, $2, $3, 'client', $4, $5)", id, email, name, clientId, ago(30))
  await run('INSERT INTO memberships (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', id, clientId)
  return id
}

const acme = await client('Acme Corp')
const globex = await client('Globex Ltd')
const jane = await user('jane@acme.com', 'Jane Cooper', acme)
const sam = await user('sam@globex.com', 'Sam Rivera', globex)

if (((await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM reports'))?.n ?? 0) === 0) {
  const rows: [string, string, string, string, string, string, number][] = [
    ['Checkout button does nothing on mobile', acme, jane, 'Blocker', 'Resolved', 'https://app.acme.com/checkout', 6],
    ['Invoice PDF shows wrong total', acme, jane, 'High', 'In progress', 'https://app.acme.com/invoices/2041', 3],
    ['Dashboard filters reset after refresh', globex, sam, 'Low', 'Triaging', 'https://portal.globex.com/dashboard', 2],
    ['Cannot upload files over 5 MB', globex, sam, 'High', 'New', 'https://portal.globex.com/uploads', 1],
  ]
  let seq = 0
  for (const [title, c, u, severity, status, url, days] of rows) {
    seq++
    const id = `BUG-${String(seq).padStart(4, '0')}`
    // video_path '' means "visible, but no video file" so demo rows show in the tracker.
    await run(
      "INSERT INTO reports (id, seq, created_at, client_id, reporter_id, title, page_url, severity, status, video_path, submitted_at, resolved_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '', $3, $10)",
      id, seq, ago(days), c, u, title, url, severity, status, status === 'Resolved' ? ago(days - 1) : null,
    )
    await run("INSERT INTO history (report_id, at, by, kind, text) VALUES ($1, $2, 'client', 'created', 'Report submitted')", id, ago(days))
  }
}

console.log(`Seeded. Clients: ${(await all('SELECT id FROM clients')).length}. Admins: ${config.adminEmails.join(', ') || '(none, set ADMIN_EMAILS)'}`)

// Demo sign-ins for local development only. Never set passwords like this in production.
if (config.isProd) {
  console.log('Production: no demo passwords were set.')
} else {
  const demo = process.env.SEED_PASSWORD ?? 'seam-demo-1234'
  const hash = await hashPassword(demo)
  const emails = [...config.adminEmails, 'jane@acme.com', 'sam@globex.com']
  for (const email of emails) await run('UPDATE users SET password_hash = $1 WHERE email = $2 AND password_hash IS NULL', hash, email)
  console.log(`Demo password for ${emails.join(', ')}: ${demo}`)
}
