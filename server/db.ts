import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

// One small query interface over two Postgres drivers:
//  - Neon (serverless Postgres over HTTP) when DATABASE_URL is set, e.g. on Vercel.
//  - PGlite (Postgres compiled to WASM, runs in-process) for local dev and tests.
// All SQL is plain Postgres, so what you test locally is what runs in production.

type Param = string | number | null
type Rows = Record<string, unknown>[]
interface Driver {
  query(text: string, params: Param[]): Promise<Rows>
  /** Runs statements as one atomic transaction. */
  batch(stmts: [string, Param[]][]): Promise<void>
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','client')),
    client_id TEXT REFERENCES clients(id),
    created_at TEXT NOT NULL
  )`,
  // Timestamps are ISO-8601 UTC text, which sorts and compares correctly as text.
  `CREATE TABLE IF NOT EXISTS login_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    client_id TEXT NOT NULL REFERENCES clients(id),
    reporter_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    page_url TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'Medium',
    status TEXT NOT NULL DEFAULT 'New',
    notes TEXT NOT NULL DEFAULT '',
    resolution_url TEXT NOT NULL DEFAULT '',
    video_path TEXT,
    video_mime TEXT,
    video_size INTEGER,
    resolved_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS history (
    id SERIAL PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    by TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL
  )`,
  // Rate limiting must live in the database: serverless instances do not share memory.
  `CREATE TABLE IF NOT EXISTS rate_hits (
    key TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_reports_client ON reports(client_id)',
  'CREATE INDEX IF NOT EXISTS idx_history_report ON history(report_id)',
  'CREATE INDEX IF NOT EXISTS idx_rate_hits ON rate_hits(key, at)',
]

async function createDriver(): Promise<Driver> {
  if (config.databaseUrl) {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(config.databaseUrl)
    return {
      query: async (text, params) => (await sql.query(text, params)) as Rows,
      batch: async (stmts) => { await sql.transaction(stmts.map(([t, p]) => sql.query(t, p))) },
    }
  }
  if (config.onVercel) throw new Error('DATABASE_URL is not set. Add a Neon Postgres database to this Vercel project.')

  const { PGlite } = await import('@electric-sql/pglite')
  let dir: string | undefined
  if (!config.memoryDb) {
    fs.mkdirSync(config.dataDir, { recursive: true })
    dir = path.join(config.dataDir, 'pgdata')
  }
  const pg = new PGlite(dir)
  await pg.waitReady
  return {
    query: async (text, params) => (await pg.query(text, params)).rows as Rows,
    batch: async (stmts) => {
      await pg.transaction(async (tx) => { for (const [t, p] of stmts) await tx.query(t, p) })
    },
  }
}

async function init(): Promise<Driver> {
  const d = await createDriver()
  try {
    await d.batch(SCHEMA.map((s) => [s, []]))
  } catch {
    // Two cold starts can race on CREATE TABLE IF NOT EXISTS. One retry settles it.
    await d.batch(SCHEMA.map((s) => [s, []]))
  }
  return d
}

let driver: Promise<Driver> | null = null
const ready = () => (driver ??= init().catch((e) => { driver = null; throw e }))

export async function all<T = Record<string, any>>(text: string, ...params: Param[]): Promise<T[]> {
  return (await (await ready()).query(text, params)) as T[]
}
export async function one<T = Record<string, any>>(text: string, ...params: Param[]): Promise<T | undefined> {
  return (await all<T>(text, ...params))[0]
}
export async function run(text: string, ...params: Param[]): Promise<void> {
  await all(text, ...params)
}
export async function batch(stmts: [string, Param[]][]): Promise<void> {
  await (await ready()).batch(stmts)
}

export const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; message?: string }
  return x?.code === '23505' || /duplicate key|unique constraint/i.test(x?.message ?? '')
}
