import path from 'node:path'

const env = process.env

// On Vercel the public URL is derived from the deployment when APP_URL is not set.
function resolveAppUrl(): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, '')
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`
  return 'http://localhost:5173'
}

const appUrl = resolveAppUrl()

export const config = {
  port: Number(env.PORT ?? 8787),
  appUrl,
  onVercel: !!env.VERCEL,
  /** Postgres connection string. Unset in local dev, where an embedded Postgres (PGlite) is used instead. */
  databaseUrl: env.DATABASE_URL ?? env.POSTGRES_URL ?? '',
  /** Tests run the embedded database in memory. */
  memoryDb: env.DB_IN_MEMORY === '1',
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  /** Set by the Vercel Blob integration. Unset in local dev, where videos are stored on disk. */
  blobToken: env.BLOB_READ_WRITE_TOKEN ?? '',
  cronSecret: env.CRON_SECRET ?? '',
  adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  emailProvider: (env.EMAIL_PROVIDER ?? 'console') as 'console' | 'resend',
  resendKey: env.RESEND_API_KEY ?? '',
  emailFrom: env.EMAIL_FROM ?? 'Feedback Portal <onboarding@resend.dev>',
  maxVideoBytes: Number(env.MAX_VIDEO_MB ?? 500) * 1024 * 1024,
  isProd: env.NODE_ENV === 'production',
  secureCookies: appUrl.startsWith('https://'),
}
