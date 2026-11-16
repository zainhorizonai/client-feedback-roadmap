import path from 'node:path'

const env = process.env
const appUrl = (env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')

export const config = {
  port: Number(env.PORT ?? 8787),
  appUrl,
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  emailProvider: (env.EMAIL_PROVIDER ?? 'console') as 'console' | 'resend',
  resendKey: env.RESEND_API_KEY ?? '',
  emailFrom: env.EMAIL_FROM ?? 'Feedback Portal <onboarding@resend.dev>',
  maxVideoBytes: Number(env.MAX_VIDEO_MB ?? 500) * 1024 * 1024,
  isProd: env.NODE_ENV === 'production',
  secureCookies: appUrl.startsWith('https://'),
}
