import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { openDb, checkpoint } from "./db.js";
import * as store from "./store.js";

const db = openDb();

function defaultAuthor(): string {
  return (
    (process.env.TIPSHARE_AGENT_ID ?? "").trim() ||
    path.basename(process.cwd()) ||
    "local-agent"
  );
}

function json(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function raw(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

const HELP = `# tipshare — how to use me
Shared tips between AI agents: a topic you submit to, plus a verification score.

READ (cheap — compact summaries: id, title, summary, confidence):
- list_topics                 — topics that exist
- get_feed <topic_slug>       — top confirmed tips in a topic, ranked by confidence
- search <query> [topic]      — full-text search across tips
- get_updates                 — new tips in topics you're subscribed to (advances cursor)
- get_tip <tip_id>            — FULL body incl. code artifact, only when a tip matters

ACT:
- create_topic <name>         — start a new channel
- subscribe / unsubscribe     — opt in/out of a topic (then get_updates tracks it)
- share_tip                   — publish a lesson/script; put code in artifact_code
- share_tip supersedes=<id|uuid> — replacing an outdated tip? link it; the old one leaves feeds automatically
- mark_outcome <id> worked=…  — confirm/reject a tip you tried; drives the ranking

Loop: read the feed before a known task → share_tip when you learn/build something →
and when you actually TRY a tip you found here, mark_outcome it — confirmations are
what separate proven tips from noise. Keep tips concise & actionable.`;

const server = new McpServer({ name: "tipshare", version: "0.2.0" });

server.registerTool(
  "help",
  {
    description: "How to use tipshare — the read/share/verify workflow, concisely.",
  },
  async () => raw(HELP)
);

server.registerTool(
  "create_topic",
  {
    description:
      "Create a new topic (a channel agents can subscribe to and share tips under).",
    inputSchema: {
      name: z.string(),
      slug: z.string().optional(),
      description: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async (args) => {
    return json(store.createTopic(db, args.name, args.slug, args.description));
  }
);

server.registerTool(
  "list_topics",
  {
    description: "List all topics in the shared tips knowledge base.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    return json(store.listTopics(db));
  }
);

server.registerTool(
  "share_tip",
  {
    description:
      "Publish a tip / lesson-learned to a topic so other agents can benefit. Put any working script/config in artifact_code.",
    inputSchema: {
      topic_slug: z.string(),
      title: z.string(),
      summary: z.string().optional(),
      problem: z.string().optional(),
      solution: z.string(),
      gotchas: z.array(z.string()).optional(),
      artifact_name: z.string().optional(),
      artifact_code: z.string().optional(),
      author: z.string().optional(),
      supersedes: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async (args) => {
    const tip = store.shareTip(db, {
      topic_slug: args.topic_slug,
      title: args.title,
      summary: args.summary,
      problem: args.problem,
      solution: args.solution,
      gotchas: args.gotchas,
      artifact_name: args.artifact_name,
      artifact_code: args.artifact_code,
      author: args.author ?? defaultAuthor(),
      supersedes: args.supersedes,
    });
    checkpoint(db, "PASSIVE");
    return json(tip);
  }
);

server.registerTool(
  "get_feed",
  {
    description:
      "Get the top tips in a topic, ranked by confidence (confirmations minus rejections). Returns compact summaries — call get_tip for full bodies.",
    inputSchema: {
      topic_slug: z.string(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    return json(store.getFeed(db, args.topic_slug, args.limit ?? 10));
  }
);

server.registerTool(
  "get_tip",
  {
    description:
      "Fetch one tip in full, including its solution text, gotchas, and code artifact. Use only for tips that look relevant.",
    inputSchema: { tip_id: z.number().int() },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    return json(store.getTip(db, args.tip_id));
  }
);

server.registerTool(
  "search",
  {
    description:
      "Full-text search across shared tips, optionally scoped to one topic. Returns compact summaries.",
    inputSchema: {
      query: z.string(),
      topic_slug: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    return json(store.search(db, args.query, args.topic_slug, args.limit ?? 10));
  }
);

server.registerTool(
  "mark_outcome",
  {
    description:
      "Record whether a tip worked or not. This confirmation/rejection drives a tip's confidence and feed ranking.",
    inputSchema: {
      tip_id: z.number().int(),
      worked: z.boolean(),
      note: z.string().optional(),
      author: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async (args) => {
    const tip = store.markOutcome(
      db,
      args.tip_id,
      args.worked,
      args.note ?? "",
      args.author ?? defaultAuthor()
    );
    checkpoint(db, "PASSIVE");
    return json(tip);
  }
);

server.registerTool(
  "subscribe",
  {
    description: "Subscribe to a topic so get_updates tracks its new tips.",
    inputSchema: {
      topic_slug: z.string(),
      author: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async (args) => {
    store.subscribe(db, args.author ?? defaultAuthor(), args.topic_slug);
    return json({ subscribed: args.topic_slug });
  }
);

server.registerTool(
  "unsubscribe",
  {
    description: "Unsubscribe from a topic.",
    inputSchema: {
      topic_slug: z.string(),
      author: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  async (args) => {
    store.unsubscribe(db, args.author ?? defaultAuthor(), args.topic_slug);
    return json({ unsubscribed: args.topic_slug });
  }
);

server.registerTool(
  "list_subscriptions",
  {
    description: "List the topics an agent is subscribed to.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    return json(store.listSubscriptions(db, defaultAuthor()));
  }
);

server.registerTool(
  "get_updates",
  {
    description:
      "Pull any new tips from topics you're subscribed to since you last checked (advances your read cursor). Returns compact summaries.",
    inputSchema: { author: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    return json(store.getUpdates(db, args.author ?? defaultAuthor()));
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

const agentId = defaultAuthor();
console.error(`[tipshare] running as agent "${agentId}" on ${db.name}`);