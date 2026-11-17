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
  // A short record of every email the app tried to send, so failures can be seen without reading logs.
  `CREATE TABLE IF NOT EXISTS email_log (
    id SERIAL PRIMARY KEY,
    at TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    ok INTEGER NOT NULL,
    error TEXT NOT NULL DEFAULT ''
  )`,
  // Roadmap items are their own records. A client only sees the ones published to their project, and an
  // item can link to several reports without exposing them. Moving an item never changes a report.
  `CREATE TABLE IF NOT EXISTS roadmap_items (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    client_id TEXT NOT NULL REFERENCES clients(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'Under review',
    target_window TEXT NOT NULL DEFAULT '',
    client_update TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS roadmap_links (
    item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, report_id)
  )`,
  // A client can belong to several projects. users.client_id stays as their first project for older rows.
  `CREATE TABLE IF NOT EXISTS memberships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, client_id)
  )`,
  // Who moved a roadmap item, and when: the client's own board is theirs to rearrange, and the team needs to see it.
  `CREATE TABLE IF NOT EXISTS roadmap_events (
    id SERIAL PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    by TEXT NOT NULL,
    text TEXT NOT NULL
  )`,
  // Added after launch. Idempotent, so existing databases upgrade themselves on the next start.
  "INSERT INTO memberships (user_id, client_id) SELECT id, client_id FROM users WHERE role = 'client' AND client_id IS NOT NULL ON CONFLICT DO NOTHING",
  'ALTER TABLE reports ADD COLUMN IF NOT EXISTS roadmap_auto INTEGER NOT NULL DEFAULT 0',
  // Email and password accounts. Links in email now only set or reset a password; they no longer sign anyone in.
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT',
  // Removing a person ends their access but keeps their name on what they reported. Set means removed.
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS removed_at TEXT',
  "ALTER TABLE login_tokens ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'login'",
  'ALTER TABLE history ADD COLUMN IF NOT EXISTS from_value TEXT',
  'ALTER TABLE history ADD COLUMN IF NOT EXISTS to_value TEXT',
  'ALTER TABLE reports ADD COLUMN IF NOT EXISTS submitted_at TEXT',
  "ALTER TABLE reports ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'Bug'",
  'ALTER TABLE reports ADD COLUMN IF NOT EXISTS roadmap_stage TEXT',
  'UPDATE reports SET submitted_at = created_at WHERE submitted_at IS NULL AND video_path IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_reports_client ON reports(client_id)',
  'CREATE INDEX IF NOT EXISTS idx_history_report ON history(report_id)',
  'CREATE INDEX IF NOT EXISTS idx_roadmap_events_item ON roadmap_events(item_id)',
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

/**
 * Earlier versions kept a roadmap stage on the report itself. Turn each into a published roadmap item linked
 * to that report, then clear the old field so this only ever runs once per report.
 */
export async function migrateLegacyRoadmap(d: Pick<Driver, 'query' | 'batch'>) {
  const rows = await d.query(
    'SELECT id, client_id, title, description, roadmap_stage, created_at FROM reports WHERE roadmap_stage IS NOT NULL ORDER BY seq',
    [],
  )
  for (const r of rows) {
    const next = (await d.query('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM roadmap_items', []))[0]?.n as number
    const itemId = `RM-${String(next).padStart(4, '0')}`
    const at = String(r.created_at)
    await d.batch([
      [
        `INSERT INTO roadmap_items (id, seq, client_id, title, description, state, published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)`,
        [itemId, next, String(r.client_id), String(r.title), String(r.description), String(r.roadmap_stage), at],
      ],
      ['INSERT INTO roadmap_links (item_id, report_id) VALUES ($1, $2)', [itemId, String(r.id)]],
      ['UPDATE reports SET roadmap_stage = NULL WHERE id = $1', [String(r.id)]],
    ])
  }
}

type Q = Pick<Driver, 'query' | 'batch'>
export const ROADMAP_KINDS = ['Feature request', 'Question']

/**
 * Features and questions go straight onto the client's roadmap as "Under review", linked to the report so the
 * conversation stays one click away. Done once per report (roadmap_auto), so deleting the item later sticks.
 */
export async function createRoadmapItemForReport(d: Q, r: { id: string; client_id: string; title: string; description: string; created_at: string }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const next = (await d.query('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM roadmap_items', []))[0]?.n as number
    const itemId = `RM-${String(next).padStart(4, '0')}`
    try {
      await d.batch([
        [
          `INSERT INTO roadmap_items (id, seq, client_id, title, description, state, published, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'Under review', 1, $6, $6)`,
          [itemId, next, r.client_id, r.title, r.description, r.created_at],
        ],
        ['INSERT INTO roadmap_links (item_id, report_id) VALUES ($1, $2)', [itemId, r.id]],
        ['INSERT INTO roadmap_events (item_id, at, by, text) VALUES ($1, $2, $3, $4)', [itemId, r.created_at, 'client', 'Added from the request']],
        ['UPDATE reports SET roadmap_auto = 1 WHERE id = $1', [r.id]],
      ])
      return itemId
    } catch (e) {
      if (attempt === 3 || !isUniqueViolation(e)) throw e // another request took that number: try the next one
    }
  }
  return null
}

/** Existing feature requests and questions that never reached a roadmap. Runs once for each. */
export async function backfillRoadmapForRequests(d: Q) {
  const rows = await d.query(
    `SELECT id, client_id, title, description, created_at FROM reports r
      WHERE kind = ANY($1::text[]) AND submitted_at IS NOT NULL AND roadmap_auto = 0
        AND NOT EXISTS (SELECT 1 FROM roadmap_links l WHERE l.report_id = r.id) ORDER BY seq`,
    [`{${ROADMAP_KINDS.map((k) => `"${k}"`).join(',')}}`],
  )
  for (const r of rows) {
    await createRoadmapItemForReport(d, { id: String(r.id), client_id: String(r.client_id), title: String(r.title), description: String(r.description), created_at: String(r.created_at) })
  }
  // Anything already linked by hand counts as handled.
  await d.query(`UPDATE reports SET roadmap_auto = 1 WHERE kind = ANY($1::text[]) AND roadmap_auto = 0 AND submitted_at IS NOT NULL`, [`{${ROADMAP_KINDS.map((k) => `"${k}"`).join(',')}}`])
}

async function init(): Promise<Driver> {
  const d = await createDriver()
  try {
    await d.batch(SCHEMA.map((s) => [s, []]))
  } catch {
    // Two cold starts can race on CREATE TABLE IF NOT EXISTS. One retry settles it.
    await d.batch(SCHEMA.map((s) => [s, []]))
  }
  try {
    await migrateLegacyRoadmap(d)
    await backfillRoadmapForRequests(d)
  } catch (e) {
    // Never block the app. Anything left over is retried on the next start.
    console.error('[db] roadmap migration will retry:', e instanceof Error ? e.message : e)
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
