import path from 'node:path'

const env = process.env

type Env = Record<string, string | undefined>

/**
 * Vercel's Storage dialog can add a custom prefix to the variables it creates (for example
 * STORAGE_DATABASE_URL). Accept the standard name first, then any prefixed variant.
 */
export function pickEnv(e: Env, names: string[]): { name: string; value: string } | null {
  for (const n of names) if (e[n]) return { name: n, value: e[n]! }
  for (const n of names) {
    const hit = Object.keys(e).sort().find((k) => k.endsWith(`_${n}`) && e[k])
    if (hit) return { name: hit, value: e[hit]! }
  }
  return null
}

export const pickDatabaseUrl = (e: Env) => pickEnv(e, ['DATABASE_URL', 'POSTGRES_URL'])
export const pickBlobToken = (e: Env) => pickEnv(e, ['BLOB_READ_WRITE_TOKEN'])

const dbVar = pickDatabaseUrl(env)
const blobVar = pickBlobToken(env)
// Newer Blob stores authenticate with a store id and Vercel's OIDC identity instead of a read-write token.
const blobStoreVar = pickEnv(env, ['BLOB_STORE_ID'])
const blobWebhookVar = pickEnv(env, ['BLOB_WEBHOOK_PUBLIC_KEY'])

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
  databaseUrl: dbVar?.value ?? '',
  databaseEnvName: dbVar?.name ?? '',
  /** Tests run the embedded database in memory. */
  memoryDb: env.DB_IN_MEMORY === '1',
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  /** Set by the Vercel Blob integration. Unset in local dev, where videos are stored on disk. */
  blobToken: blobVar?.value ?? '',
  blobEnvName: blobVar?.name ?? '',
  blobStoreId: blobStoreVar?.value ?? '',
  blobWebhookKey: blobWebhookVar?.value ?? '',
  cronSecret: env.CRON_SECRET ?? '',
  // ADMIN_EMAIL (singular) is accepted too, since it is an easy slip.
  adminEmails: (env.ADMIN_EMAILS ?? env.ADMIN_EMAIL ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  emailProvider: (env.EMAIL_PROVIDER ?? 'console') as 'console' | 'resend',
  resendKey: env.RESEND_API_KEY ?? '',
  emailFrom: env.EMAIL_FROM ?? 'Feedback Portal <onboarding@resend.dev>',
  maxVideoBytes: Number(env.MAX_VIDEO_MB ?? 500) * 1024 * 1024,
  isProd: env.NODE_ENV === 'production',
  secureCookies: appUrl.startsWith('https://'),
}
