import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

export function openDb(): Database.Database {
  const dbPath =
    process.env.TIPSHARE_DB ?? path.join(os.homedir(), ".tipshare", "tipshare.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function checkpoint(
  db: Database.Database,
  mode: "PASSIVE" | "TRUNCATE" = "PASSIVE"
): void {
  db.pragma(`wal_checkpoint(${mode})`);
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function backfillUuids(db: Database.Database, table: string): void {
  const update = db.prepare(`UPDATE ${table} SET uuid = ? WHERE id = ?`);
  const rows = db
    .prepare(`SELECT id FROM ${table} WHERE uuid IS NULL`)
    .all() as Array<{ id: number }>;
  for (const row of rows) update.run(randomUUID(), row.id);
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      slug        TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tips (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid          TEXT,
      topic_slug    TEXT NOT NULL REFERENCES topics(slug) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      summary       TEXT NOT NULL DEFAULT '',
      problem       TEXT NOT NULL DEFAULT '',
      solution      TEXT NOT NULL,
      gotchas       TEXT NOT NULL DEFAULT '[]',
      artifact_name TEXT,
      artifact_code TEXT,
      author        TEXT NOT NULL DEFAULT 'agent',
      supersedes    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS outcomes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid       TEXT,
      tip_id     INTEGER NOT NULL REFERENCES tips(id) ON DELETE CASCADE,
      author     TEXT NOT NULL DEFAULT 'agent',
      worked     INTEGER NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      author           TEXT NOT NULL,
      topic_slug       TEXT NOT NULL REFERENCES topics(slug) ON DELETE CASCADE,
      last_seen_tip_id INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (author, topic_slug)
    );

    CREATE INDEX IF NOT EXISTS idx_tips_topic ON tips(topic_slug);
    CREATE INDEX IF NOT EXISTS idx_outcomes_tip ON outcomes(tip_id);
  `);

  ensureColumn(db, "tips", "uuid", "uuid TEXT");
  ensureColumn(db, "tips", "supersedes", "supersedes TEXT");
  ensureColumn(db, "outcomes", "uuid", "uuid TEXT");

  backfillUuids(db, "tips");
  backfillUuids(db, "outcomes");

  db.exec(`
    DELETE FROM outcomes WHERE id NOT IN (
      SELECT MAX(id) FROM outcomes GROUP BY tip_id, author
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tips_uuid ON tips(uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outcomes_uuid ON outcomes(uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outcomes_author_tip ON outcomes(tip_id, author);
    CREATE INDEX IF NOT EXISTS idx_tips_supersedes ON tips(supersedes);
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS tips_fts USING fts5(
      title, summary, problem, solution,
      content='tips', content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS tips_fts_ai AFTER INSERT ON tips BEGIN
      INSERT INTO tips_fts(rowid, title, summary, problem, solution)
      VALUES (new.id, new.title, new.summary, new.problem, new.solution);
    END;

    CREATE TRIGGER IF NOT EXISTS tips_fts_ad AFTER DELETE ON tips BEGIN
      INSERT INTO tips_fts(tips_fts, rowid, title, summary, problem, solution)
      VALUES ('delete', old.id, old.title, old.summary, old.problem, old.solution);
    END;

    CREATE TRIGGER IF NOT EXISTS tips_fts_au AFTER UPDATE ON tips BEGIN
      INSERT INTO tips_fts(tips_fts, rowid, title, summary, problem, solution)
      VALUES ('delete', old.id, old.title, old.summary, old.problem, old.solution);
      INSERT INTO tips_fts(rowid, title, summary, problem, solution)
      VALUES (new.id, new.title, new.summary, new.problem, new.solution);
    END;
  `);
}