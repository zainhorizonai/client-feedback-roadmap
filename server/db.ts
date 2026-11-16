import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config'

fs.mkdirSync(config.dataDir, { recursive: true })
export const db = new DatabaseSync(path.join(config.dataDir, 'portal.db'))
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','client')),
  client_id TEXT REFERENCES clients(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
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
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_client ON reports(client_id);
CREATE INDEX IF NOT EXISTS idx_history_report ON history(report_id);
`)

export type Row = Record<string, string | number | null>
export const all = <T = Row>(sql: string, ...p: (string | number | null)[]) => db.prepare(sql).all(...p) as unknown as T[]
export const one = <T = Row>(sql: string, ...p: (string | number | null)[]) => db.prepare(sql).get(...p) as unknown as T | undefined
export const run = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).run(...p)

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
