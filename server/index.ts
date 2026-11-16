import { serve } from '@hono/node-server'
import { app } from './app'
import { ensureAdmins } from './auth'
import { config } from './config'
import { all, run } from './db'

ensureAdmins()

function housekeeping() {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString()
  for (const d of all<{ id: string }>('SELECT id FROM reports WHERE video_path IS NULL AND created_at < ?', cutoff)) {
    run('DELETE FROM reports WHERE id = ?', d.id)
  }
  run('DELETE FROM login_tokens WHERE expires_at < ?', Date.now())
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now())
}
housekeeping()
setInterval(housekeeping, 3600_000).unref()

if (config.isProd && config.emailProvider === 'console') console.warn('WARNING: EMAIL_PROVIDER=console in production, emails are only logged.')
if (config.adminEmails.length === 0) console.warn('WARNING: ADMIN_EMAILS is empty, nobody can sign in as admin.')

serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`API listening on http://localhost:${i.port}`))
