import { serve } from '@hono/node-server'
import { app, housekeeping } from './app.js'
import { ensureAdmins } from './auth.js'
import { config } from './config.js'

// Local development and plain-Node hosting. On Vercel, api/[...path].ts is the entry point instead.
await ensureAdmins()
await housekeeping()
setInterval(() => housekeeping().catch(console.error), 3600_000).unref()

if (config.isProd && config.emailProvider === 'console') console.warn('WARNING: EMAIL_PROVIDER=console in production, emails are only logged.')
if (config.adminEmails.length === 0) console.warn('WARNING: ADMIN_EMAILS is empty, nobody can sign in as admin.')

serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`API listening on http://localhost:${i.port}`))
