import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface Topic {
  slug: string;
  name: string;
  description: string;
  created_at: string;
}

export interface Tip {
  id: number;
  uuid: string;
  topic_slug: string;
  title: string;
  summary: string;
  problem: string;
  solution: string;
  gotchas: string[];
  artifact_name: string | null;
  artifact_code: string | null;
  author: string;
  created_at: string;
  supersedes: string | null;
  superseded_by_ids: number[];
  confirmations: number;
  rejections: number;
  confidence: number;
}

export interface TipSummary {
  id: number;
  uuid: string;
  topic_slug: string;
  title: string;
  summary: string;
  author: string;
  created_at: string;
  supersedes: string | null;
  superseded_by: number;
  confirmations: number;
  rejections: number;
  confidence: number;
}

const OUTCOME_JOIN = `
  LEFT JOIN (
    SELECT tip_id,
      SUM(CASE WHEN worked = 1 THEN 1 ELSE 0 END) AS confirmations,
      SUM(CASE WHEN worked = 0 THEN 1 ELSE 0 END) AS rejections
    FROM outcomes GROUP BY tip_id
  ) c ON c.tip_id = t.id
`;

const TIP_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM tips s WHERE s.supersedes = t.uuid) AS superseded_by,
    COALESCE(c.confirmations, 0) AS confirmations,
    COALESCE(c.rejections, 0) AS rejections,
    COALESCE(c.confirmations, 0) - COALESCE(c.rejections, 0) AS confidence
  FROM tips t
  ${OUTCOME_JOIN}
`;

const SUMMARY_SELECT = `
  SELECT t.id, t.uuid, t.topic_slug, t.title, t.summary, t.author, t.created_at, t.supersedes,
    (SELECT COUNT(*) FROM tips s WHERE s.supersedes = t.uuid) AS superseded_by,
    COALESCE(c.confirmations, 0) AS confirmations,
    COALESCE(c.rejections, 0) AS rejections,
    COALESCE(c.confirmations, 0) - COALESCE(c.rejections, 0) AS confidence
  FROM tips t
  ${OUTCOME_JOIN}
`;

function serializeTip(
  row: Record<string, unknown>,
  superseded_by_ids: number[] = []
): Tip {
  let gotchas: string[] = [];
  try {
    const parsed = JSON.parse(String(row.gotchas ?? "[]"));
    if (Array.isArray(parsed)) gotchas = parsed.map(String);
  } catch {
    gotchas = [];
  }
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    topic_slug: String(row.topic_slug),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    problem: String(row.problem ?? ""),
    solution: String(row.solution),
    gotchas,
    artifact_name: row.artifact_name ? String(row.artifact_name) : null,
    artifact_code: row.artifact_code ? String(row.artifact_code) : null,
    author: String(row.author ?? ""),
    created_at: String(row.created_at),
    supersedes: row.supersedes ? String(row.supersedes) : null,
    superseded_by_ids,
    confirmations: Number(row.confirmations ?? 0),
    rejections: Number(row.rejections ?? 0),
    confidence: Number(row.confirmations ?? 0) - Number(row.rejections ?? 0),
  };
}

function serializeSummary(row: Record<string, unknown>): TipSummary {
  const confirmations = Number(row.confirmations ?? 0);
  const rejections = Number(row.rejections ?? 0);
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    topic_slug: String(row.topic_slug),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    author: String(row.author ?? ""),
    created_at: String(row.created_at),
    supersedes: row.supersedes ? String(row.supersedes) : null,
    superseded_by: Number(row.superseded_by ?? 0),
    confirmations,
    rejections,
    confidence: confirmations - rejections,
  };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "untitled"
  );
}

function sanitizeTerms(q: string): string[] {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[^a-zA-Z0-9_]/g, ""))
    .filter((t) => t.length > 0);
}

function ftsMatch(q: string): { strict: string; loose: string } {
  const terms = sanitizeTerms(q);
  if (!terms.length) return { strict: "", loose: "" };
  return { strict: terms.join(" "), loose: terms.join(" OR ") };
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[0-9A-Za-z]{36,}/,
  /xox[baprs]-[0-9A-Za-z-]{10,}/,
  /sk-[0-9A-Za-z]{24,}/,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
];

function assertNoSecrets(fields: ReadonlyArray<readonly [string, string | undefined]>): void {
  for (const [name, value] of fields) {
    if (!value) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(
          `Refusing to share: "${name}" looks like it contains a secret. Never put credentials in a shared tip.`
        );
      }
    }
  }
}

export function createTopic(
  db: Database.Database,
  name: string,
  slug?: string,
  description = ""
): Topic {
  const finalSlug = slug || slugify(name);
  db.prepare(
    "INSERT OR IGNORE INTO topics (slug, name, description) VALUES (?, ?, ?)"
  ).run(finalSlug, name, description);
  return db
    .prepare("SELECT * FROM topics WHERE slug = ?")
    .get(finalSlug) as Topic;
}

export function ensureTopic(db: Database.Database, slug: string): Topic {
  const existing = db
    .prepare("SELECT * FROM topics WHERE slug = ?")
    .get(slug) as Topic | undefined;
  if (existing) return existing;
  return createTopic(db, slug, slug);
}

export function topicExists(db: Database.Database, slug: string): boolean {
  return !!db.prepare("SELECT 1 FROM topics WHERE slug = ?").get(slug);
}

export function listTopics(
  db: Database.Database
): Array<Topic & { tip_count: number }> {
  return db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM tips WHERE topic_slug = t.slug) AS tip_count
       FROM topics t ORDER BY t.name ASC`
    )
    .all() as Array<Topic & { tip_count: number }>;
}

export function shareTip(
  db: Database.Database,
  input: {
    topic_slug: string;
    title: string;
    summary?: string;
    problem?: string;
    solution: string;
    gotchas?: string[];
    artifact_name?: string;
    artifact_code?: string;
    author: string;
    supersedes?: string;
  }
): TipSummary {
  assertNoSecrets([
    ["title", input.title],
    ["summary", input.summary],
    ["problem", input.problem],
    ["solution", input.solution],
    ...(input.gotchas ?? []).map((g, i) => [`gotchas[${i}]`, g] as const),
    ["artifact_code", input.artifact_code],
  ]);
  let supersedes: string | null = null;
  if (input.supersedes !== undefined && input.supersedes !== null && input.supersedes !== "") {
    const value = String(input.supersedes);
    const byUuid = db
      .prepare("SELECT uuid FROM tips WHERE uuid = ?")
      .get(value) as { uuid: string } | undefined;
    if (byUuid) {
      supersedes = byUuid.uuid;
    } else if (/^\d+$/.test(value)) {
      const byId = db
        .prepare("SELECT uuid FROM tips WHERE id = ?")
        .get(Number(value)) as { uuid: string } | undefined;
      if (!byId) throw new Error(`supersedes target not found: ${value}`);
      supersedes = byId.uuid;
    } else {
      throw new Error(`supersedes target not found: ${value}`);
    }
  }
  ensureTopic(db, input.topic_slug);
  const info = db
    .prepare(
      `INSERT INTO tips
        (uuid, topic_slug, title, summary, problem, solution, gotchas, artifact_name, artifact_code, author, supersedes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      input.topic_slug,
      input.title,
      input.summary ?? "",
      input.problem ?? "",
      input.solution,
      JSON.stringify(input.gotchas ?? []),
      input.artifact_name ?? null,
      input.artifact_code ?? null,
      input.author,
      supersedes
    );
  const tipId = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO subscriptions (author, topic_slug, last_seen_tip_id)
     VALUES (?, ?, ?)
     ON CONFLICT(author, topic_slug) DO NOTHING`
  ).run(input.author, input.topic_slug, tipId);
  return getSummary(db, tipId);
}

export function getTip(db: Database.Database, id: number): Tip {
  const row = db.prepare(`${TIP_SELECT} WHERE t.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error(`Tip ${id} not found`);
  const superseding = db
    .prepare("SELECT id FROM tips WHERE supersedes = ? ORDER BY id ASC")
    .all(String(row.uuid)) as Array<{ id: number }>;
  return serializeTip(row, superseding.map((s) => s.id));
}

function getSummary(db: Database.Database, id: number): TipSummary {
  const row = db.prepare(`${SUMMARY_SELECT} WHERE t.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error(`Tip ${id} not found`);
  return serializeSummary(row);
}

export function getFeed(
  db: Database.Database,
  topic_slug: string,
  limit = 10
): TipSummary[] {
  const rows = db
    .prepare(
        `${SUMMARY_SELECT} WHERE t.topic_slug = ? AND NOT EXISTS (SELECT 1 FROM tips sup WHERE sup.supersedes = t.uuid) ORDER BY confidence DESC, confirmations DESC, t.created_at DESC LIMIT ?`
    )
    .all(topic_slug, limit) as Record<string, unknown>[];
  return rows.map(serializeSummary);
}

const SUMMARY_AGG = `
  COALESCE((SELECT COUNT(*) FROM outcomes o WHERE o.tip_id = t.id AND o.worked = 1), 0) AS confirmations,
  COALESCE((SELECT COUNT(*) FROM outcomes o WHERE o.tip_id = t.id AND o.worked = 0), 0) AS rejections
`;

export function search(
  db: Database.Database,
  query: string,
  topic_slug?: string,
  limit = 10
): TipSummary[] {
  const { strict, loose } = ftsMatch(query);
  if (!strict) return [];
  const run = (match: string): TipSummary[] => {
    if (topic_slug) {
      const rows = db
        .prepare(
          `SELECT t.id, t.uuid, t.topic_slug, t.title, t.summary, t.author, t.created_at, ${SUMMARY_AGG}
           FROM tips_fts f JOIN tips t ON t.id = f.rowid
           WHERE tips_fts MATCH ? AND t.topic_slug = ?
             AND NOT EXISTS (SELECT 1 FROM tips sup WHERE sup.supersedes = t.uuid)
           ORDER BY bm25(tips_fts) LIMIT ?`
        )
        .all(match, topic_slug, limit) as Record<string, unknown>[];
      return rows.map(serializeSummary);
    }
    const rows = db
      .prepare(
        `SELECT t.id, t.uuid, t.topic_slug, t.title, t.summary, t.author, t.created_at, ${SUMMARY_AGG}
         FROM tips_fts f JOIN tips t ON t.id = f.rowid
         WHERE tips_fts MATCH ?
           AND NOT EXISTS (SELECT 1 FROM tips sup WHERE sup.supersedes = t.uuid)
         ORDER BY bm25(tips_fts) LIMIT ?`
      )
      .all(match, limit) as Record<string, unknown>[];
    return rows.map(serializeSummary);
  };
  const strictHits = run(strict);
  if (strictHits.length) return strictHits;
  return run(loose);
}

export function markOutcome(
  db: Database.Database,
  tip_id: number,
  worked: boolean,
  note: string,
  author: string
): TipSummary {
  getTip(db, tip_id);
  const existing = db
    .prepare("SELECT id FROM outcomes WHERE tip_id = ? AND author = ?")
    .get(tip_id, author) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE outcomes SET worked = ?, note = ?, created_at = datetime('now') WHERE id = ?"
    ).run(worked ? 1 : 0, note, existing.id);
  } else {
    db.prepare(
      "INSERT INTO outcomes (uuid, tip_id, author, worked, note) VALUES (?, ?, ?, ?, ?)"
    ).run(randomUUID(), tip_id, author, worked ? 1 : 0, note);
  }
  return getSummary(db, tip_id);
}

export function subscribe(
  db: Database.Database,
  author: string,
  topic_slug: string
): void {
  ensureTopic(db, topic_slug);
  db.prepare(
    `INSERT INTO subscriptions (author, topic_slug) VALUES (?, ?)
     ON CONFLICT(author, topic_slug) DO NOTHING`
  ).run(author, topic_slug);
}

export function unsubscribe(
  db: Database.Database,
  author: string,
  topic_slug: string
): void {
  db.prepare(
    "DELETE FROM subscriptions WHERE author = ? AND topic_slug = ?"
  ).run(author, topic_slug);
}

export function listSubscriptions(
  db: Database.Database,
  author: string
): Array<Topic & { last_seen_tip_id: number }> {
  return db
    .prepare(
      `SELECT t.slug, t.name, t.description, t.created_at, s.last_seen_tip_id
       FROM subscriptions s
       JOIN topics t ON t.slug = s.topic_slug
       WHERE s.author = ?
       ORDER BY t.name ASC`
    )
    .all(author) as Array<Topic & { last_seen_tip_id: number }>;
}

export function getUpdates(db: Database.Database, author: string): TipSummary[] {
  const subs = db
    .prepare("SELECT topic_slug, last_seen_tip_id FROM subscriptions WHERE author = ?")
    .all(author) as Array<{ topic_slug: string; last_seen_tip_id: number }>;
  const collected: TipSummary[] = [];
  const selectNew = db.prepare(
    `${SUMMARY_SELECT} WHERE t.topic_slug = ? AND t.id > ? AND NOT EXISTS (SELECT 1 FROM tips sup WHERE sup.supersedes = t.uuid) ORDER BY t.id ASC`
  );
  const updateCursor = db.prepare(
    "UPDATE subscriptions SET last_seen_tip_id = ? WHERE author = ? AND topic_slug = ?"
  );
  const maxIdStmt = db.prepare(
    "SELECT COALESCE(MAX(id), 0) AS m FROM tips WHERE topic_slug = ?"
  );
  for (const sub of subs) {
    const rows = selectNew.all(sub.topic_slug, sub.last_seen_tip_id) as Record<
      string,
      unknown
    >[];
    collected.push(...rows.map(serializeSummary));
    const { m } = maxIdStmt.get(sub.topic_slug) as { m: number };
    updateCursor.run(m, author, sub.topic_slug);
  }
  collected.sort((a, b) => a.id - b.id);
  return collected;
}

export interface ExportData {
  format: "tipshare/v1";
  exported_at: string;
  topics: Array<{
    slug: string;
    name: string;
    description: string;
    created_at: string;
  }>;
  tips: Array<{
    uuid: string;
    topic_slug: string;
    title: string;
    summary: string;
    problem: string;
    solution: string;
    gotchas: string[];
    artifact_name: string | null;
    artifact_code: string | null;
    author: string;
    supersedes: string | null;
    created_at: string;
  }>;
  outcomes: Array<{
    uuid: string;
    tip_uuid: string;
    author: string;
    worked: boolean;
    note: string;
    created_at: string;
  }>;
}

export function exportStore(db: Database.Database): ExportData {
  const topics = db
    .prepare("SELECT slug, name, description, created_at FROM topics ORDER BY slug")
    .all() as Array<{
    slug: string;
    name: string;
    description: string;
    created_at: string;
  }>;
  const tips = db
    .prepare(
      `SELECT uuid, topic_slug, title, summary, problem, solution, gotchas,
              artifact_name, artifact_code, author, supersedes, created_at
       FROM tips ORDER BY created_at`
    )
    .all() as Array<{
    uuid: string;
    topic_slug: string;
    title: string;
    summary: string;
    problem: string;
    solution: string;
    gotchas: string;
    artifact_name: string | null;
    artifact_code: string | null;
    author: string;
    supersedes: string | null;
    created_at: string;
  }>;
  const outcomes = db
    .prepare(
      `SELECT o.uuid, o.author, o.worked, o.note, o.created_at, t.uuid AS tip_uuid
       FROM outcomes o JOIN tips t ON t.id = o.tip_id ORDER BY o.created_at`
    )
    .all() as Array<{
    uuid: string;
    author: string;
    worked: number;
    note: string;
    created_at: string;
    tip_uuid: string;
  }>;
  return {
    format: "tipshare/v1",
    exported_at: new Date().toISOString(),
    topics,
    tips: tips.map((t) => {
      let gotchas: string[] = [];
      try {
        const parsed = JSON.parse(t.gotchas ?? "[]");
        if (Array.isArray(parsed)) gotchas = parsed.map(String);
      } catch {
        gotchas = [];
      }
      return {
        uuid: t.uuid,
        topic_slug: t.topic_slug,
        title: t.title,
        summary: t.summary,
        problem: t.problem,
        solution: t.solution,
        gotchas,
        artifact_name: t.artifact_name,
        artifact_code: t.artifact_code,
        author: t.author,
        supersedes: t.supersedes,
        created_at: t.created_at,
      };
    }),
    outcomes: outcomes.map((o) => ({
      uuid: o.uuid,
      tip_uuid: o.tip_uuid,
      author: o.author,
      worked: !!o.worked,
      note: o.note,
      created_at: o.created_at,
    })),
  };
}

export function importStore(
  db: Database.Database,
  data: ExportData
): { topics: number; tips: number; outcomes: number } {
  const insTopic = db.prepare(
    "INSERT OR IGNORE INTO topics (slug, name, description, created_at) VALUES (?, ?, ?, ?)"
  );
  const insTip = db.prepare(
    `INSERT OR IGNORE INTO tips
       (uuid, topic_slug, title, summary, problem, solution, gotchas, artifact_name, artifact_code, author, supersedes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insOutcome = db.prepare(
    `INSERT OR IGNORE INTO outcomes (uuid, tip_id, author, worked, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const tipIdByUuid = db.prepare("SELECT id FROM tips WHERE uuid = ?");
  const run = db.transaction(() => {
    let topics = 0;
    let tips = 0;
    let outcomes = 0;
    for (const topic of data.topics ?? []) {
      insTopic.run(topic.slug, topic.name, topic.description, topic.created_at);
      topics++;
    }
    for (const tip of data.tips ?? []) {
      const res = insTip.run(
        tip.uuid,
        tip.topic_slug,
        tip.title,
        tip.summary ?? "",
        tip.problem ?? "",
        tip.solution,
        JSON.stringify(tip.gotchas ?? []),
        tip.artifact_name ?? null,
        tip.artifact_code ?? null,
        tip.author,
        tip.supersedes ?? null,
        tip.created_at
      );
      if (res.changes > 0) tips++;
    }
    for (const outcome of data.outcomes ?? []) {
      const tipRow = tipIdByUuid.get(outcome.tip_uuid) as { id: number } | undefined;
      if (!tipRow) continue;
      const res = insOutcome.run(
        outcome.uuid,
        tipRow.id,
        outcome.author,
        outcome.worked ? 1 : 0,
        outcome.note ?? "",
        outcome.created_at
      );
      if (res.changes > 0) outcomes++;
    }
    return { topics, tips, outcomes };
  });
  return run();
}