import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(os.tmpdir(), `tipshare-smoke-${process.pid}.db`);
process.env.TIPSHARE_DB = dbPath;

import { openDb, migrate, checkpoint } from "../src/db.js";
import * as store from "../src/store.js";

function cleanup(): void {
  try {
    db?.close();
  } catch {
    void 0;
  }
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      void 0;
    }
  }
}

let db: Database.Database | undefined;
try {
  db = openDb();

  store.createTopic(db, "Godot Pixel Art", "godot-pixel-art");

  const tip = store.shareTip(db, {
    topic_slug: "godot-pixel-art",
    title: "Nearest-neighbor texture filter",
    summary: "Pixel art blurs unless you disable filtering.",
    problem: "Sprites look blurry at runtime.",
    solution: "Set texture_filter = nearest.",
    gotchas: ["Also disable mipmaps"],
    artifact_name: "project.godot",
    artifact_code:
      "[rendering]\ntextures/default_filters/use_nearest_mipmap_filter=false",
    author: "agent-1",
  });
  if (!tip.uuid) throw new Error("tip must have a uuid");
  console.log("tip id:", tip.id, "uuid:", tip.uuid.slice(0, 8));

  const topics = store.listTopics(db);
  if (!topics.every((t) => typeof t.tip_count === "number" && t.tip_count >= 0))
    throw new Error("list_topics must include a numeric tip_count >= 0");
  const pixelTopic = topics.find((t) => t.slug === "godot-pixel-art");
  if (!pixelTopic || pixelTopic.tip_count < 1)
    throw new Error("created topic must report tip_count >= 1 after a share");
  console.log(
    "list_topics tip_count ok:",
    topics.map((t) => `${t.slug}=${t.tip_count}`).join(", ")
  );

  store.markOutcome(db, tip.id, true, "Confirmed on game 2", "agent-2");
  store.markOutcome(
    db,
    tip.id,
    true,
    "Re-mark by same author updates, no dup",
    "agent-2"
  );
  const ocCount = db
    .prepare("SELECT COUNT(*) AS c FROM outcomes WHERE tip_id = ? AND author = ?")
    .get(tip.id, "agent-2") as { c: number };
  if (ocCount.c !== 1)
    throw new Error("mark_outcome must be idempotent per (tip, author)");
  console.log("mark_outcome idempotent ok");

  const feed = store.getFeed(db, "godot-pixel-art");
  if (!("title" in feed[0])) throw new Error("expected summary object");
  if ("artifact_code" in feed[0])
    throw new Error("feed must not include artifact_code");
  if (!feed[0].uuid) throw new Error("summary must include uuid");
  console.log("feed summary ok, confidence:", feed[0].confidence);

  const full = store.getTip(db, tip.id);
  if (
    full.artifact_code !==
    "[rendering]\ntextures/default_filters/use_nearest_mipmap_filter=false"
  ) {
    throw new Error("get_tip must return the code artifact");
  }
  console.log("get_tip returns full body ok");

  const hits = store.search(db, "nearest filter");
  console.log("search hits:", hits.length, "->", hits[0]?.title);

  const tipX = store.shareTip(db, {
    topic_slug: "godot-pixel-art",
    title: "Camera smoothing",
    summary: "Smooth the camera.",
    solution: "Use lerp for camera motion.",
    author: "search-author",
  });
  const tipY = store.shareTip(db, {
    topic_slug: "godot-pixel-art",
    title: "Pixel shader basics",
    summary: "Writing shaders.",
    solution: "Shader code for pixel art.",
    author: "search-author",
  });
  const andOnly = store.search(db, "camera smoothing");
  if (andOnly.length !== 1 || andOnly[0].id !== tipX.id)
    throw new Error("strict AND search must return exactly the tip matching all terms");
  const fallback = store.search(db, "camera zzzznotaterm");
  if (!fallback.some((t) => t.id === tipX.id))
    throw new Error(
      "OR fallback must return partial matches when no tip matches all terms"
    );
  const ftsCount = (match: string): number =>
    (
      db!
        .prepare(
          "SELECT COUNT(*) AS c FROM tips_fts f JOIN tips t ON t.id = f.rowid WHERE tips_fts MATCH ? AND NOT EXISTS (SELECT 1 FROM tips sup WHERE sup.supersedes = t.uuid)"
        )
        .get(match) as { c: number }
    ).c;
  const andRows = ftsCount("pixel shader");
  const orRows = ftsCount("pixel OR shader");
  if (andRows > orRows)
    throw new Error("AND path must return fewer-or-equal rows than OR path");
  const strictHits = store.search(db, "pixel shader");
  if (strictHits.length !== andRows || !strictHits.some((t) => t.id === tipY.id))
    throw new Error("strict AND search must match the tip containing all terms");
  console.log("search AND/OR ok: strict", andRows, "loose", orRows);

  store.subscribe(db, "agent-3", "godot-pixel-art");
  console.log(
    "updates:",
    store
      .getUpdates(db, "agent-3")
      .map((u) => u.title)
      .join(", ")
  );

  const tipA = store.shareTip(db, {
    topic_slug: "godot-pixel-art",
    title: "supersede alphazeta",
    solution: "old approach",
    author: "sup-author",
  });
  const tipB = store.shareTip(db, {
    topic_slug: "godot-pixel-art",
    title: "supersede bravotango",
    solution: "new approach",
    author: "sup-author",
    supersedes: String(tipA.id),
  });
  const feedAfter = store.getFeed(db, "godot-pixel-art");
  if (feedAfter.some((t) => t.id === tipA.id))
    throw new Error("superseded tip A must leave the feed");
  if (!feedAfter.some((t) => t.id === tipB.id))
    throw new Error("superseding tip B must be in the feed");
  const searchAfter = store.search(db, "alphazeta");
  if (searchAfter.some((t) => t.id === tipA.id))
    throw new Error("superseded tip A must leave search");
  store.subscribe(db, "sup-updates", "godot-pixel-art");
  const updatesAfter = store.getUpdates(db, "sup-updates");
  if (updatesAfter.some((t) => t.id === tipA.id))
    throw new Error("superseded tip A must leave updates");
  const tipAFull = store.getTip(db, tipA.id);
  if (!tipAFull.superseded_by_ids.includes(tipB.id))
    throw new Error("get_tip(A) must list B in superseded_by_ids");
  if (tipAFull.supersedes !== null)
    throw new Error("tip A supersedes nothing");
  console.log("supersede by numeric id ok");

  const tipC = store.shareTip(db, {
    topic_slug: "godot-pixel-art",
    title: "supersede charliekilo",
    solution: "newest approach",
    author: "sup-author",
    supersedes: tipB.uuid,
  });
  if (!store.getTip(db, tipB.id).superseded_by_ids.includes(tipC.id))
    throw new Error("supersede by uuid must resolve to the target");
  console.log("supersede by uuid ok");

  for (const bad of ["does-not-exist-xyz", "999999"]) {
    let threw = false;
    try {
      store.shareTip(db, {
        topic_slug: "godot-pixel-art",
        title: "bad supersede",
        solution: "x",
        author: "sup-author",
        supersedes: bad,
      });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`invalid supersedes target must throw: ${bad}`);
  }
  console.log("invalid supersedes target throws ok");

  const freshAuthor = "autosub-fresh";
  const tipD = store.shareTip(db, {
    topic_slug: "godot-pixel-art",
    title: "autosub delta",
    solution: "x",
    author: freshAuthor,
  });
  const subD = db
    .prepare(
      "SELECT last_seen_tip_id FROM subscriptions WHERE author = ? AND topic_slug = ?"
    )
    .get(freshAuthor, "godot-pixel-art") as { last_seen_tip_id: number } | undefined;
  if (!subD || subD.last_seen_tip_id !== tipD.id)
    throw new Error("author must be auto-subscribed with cursor at their own tip");

  const existingAuthor = "autosub-existing";
  store.subscribe(db, existingAuthor, "godot-pixel-art");
  store.getUpdates(db, existingAuthor);
  const cursorBefore = db
    .prepare(
      "SELECT last_seen_tip_id FROM subscriptions WHERE author = ? AND topic_slug = ?"
    )
    .get(existingAuthor, "godot-pixel-art") as { last_seen_tip_id: number };
  store.shareTip(db, {
    topic_slug: "godot-pixel-art",
    title: "autosub echo",
    solution: "x",
    author: existingAuthor,
  });
  const cursorAfter = db
    .prepare(
      "SELECT last_seen_tip_id FROM subscriptions WHERE author = ? AND topic_slug = ?"
    )
    .get(existingAuthor, "godot-pixel-art") as { last_seen_tip_id: number };
  if (cursorAfter.last_seen_tip_id !== cursorBefore.last_seen_tip_id)
    throw new Error("auto-subscribe must not move an existing cursor");
  console.log("auto-subscribe ok");

  checkpoint(db, "TRUNCATE");
  console.log("checkpoint ok");

  let blocked = false;
  try {
    store.shareTip(db, {
      topic_slug: "godot-pixel-art",
      title: "leak",
      solution: "key",
      artifact_code: "AKIAIOSFODNN7EXAMPLE",
      author: "agent-1",
    });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("secret guard failed to block a credential");
  console.log("secret guard blocked credential ok");

  const exported = store.exportStore(db);
  const db2 = new Database(":memory:");
  migrate(db2);
  const counts = store.importStore(db2, exported);
  if (counts.tips !== exported.tips.length)
    throw new Error("import should restore all tips");
  const tip2 = store.getTip(db2, 1);
  if (!tip2.uuid) throw new Error("restored tip must have a uuid");
  if (tip2.title !== "Nearest-neighbor texture filter")
    throw new Error("round-trip content mismatch");
  const again = store.importStore(db2, exported);
  if (again.tips !== 0)
    throw new Error("re-import must be idempotent (0 new tips)");
  console.log("dump/restore round-trip ok (idempotent)");

  console.log("OK");
} finally {
  cleanup();
}
