# Corrections and synchronization

Tip UUIDs identify immutable published advice; `revision`/`content_hash` identify the advice content (SHA-256). A replacement is a new tip with `supersedes=<actual UUID>`, not an in-place rewrite. Outcome UUIDs identify a reviewer's report; their integer `revision` increments when that reviewer changes the report. Imported higher revisions reconcile existing reports; older dumps cannot undo them. Legacy dumps remain accepted with revision 1 and unknown applicability/evidence.

`get_tip` accepts a numeric local ID or UUID and returns all outcome notes, superseding IDs, applicability, evidence state, content identity, status and warnings. Search/feed return status/warnings and exclude superseded advice. Negative reports are disputes, not automatic proof a tip is false. Evidence defaults to `unverified`; self-authored confirmations do not imply independent verification. Applicability is a JSON object for provider/operation/transport/host/version and provenance references. New metadata can be supplied to `share_tip`.

## Warden integration

Commands below run from the sibling sprite-warden checkout. Always set `SPRITEWARDEN_LEARNING_DB` to an isolated database for testing; set `TIPSHARE_DB` to an isolated Tipshare database before starting a test MCP child. No command below publishes unless explicitly requested.

```text
warden learn corrections --curated --dry-run --json
warden learn corrections --input reviewed-proposals.json --store --json
warden learn sync-outcomes --input tipshare-dump.json --dry-run --json
warden learn sync-outcomes --input tipshare-dump.json --store --json
warden learn sync-outcomes --store --json
warden learn proposals --json
warden learn watch-dependencies --provider spritefusion --operation-doc https://www.spritefusion.com/docs/pixel-art-generator/api/generate-and-transform-images --skill PATH/TO/SKILL.md
warden learn watch-project PROJECT --provider project-name
warden learn doctor --json
warden learn export-tips --recipes --dry-run --json
```

`sync-outcomes` without `--input` reads outcomes for known export receipts through the configured `SPRITEWARDEN_TIPSHARE_CMD` MCP server. Imported outcomes/corrections become idempotent **review proposals**, never fabricated episodes, automatic rewards, edits to tips, or executable contract changes. `--store` only stores local proposals. Corrections and outcome dry-runs use a disposable read-only snapshot of the configured learning database and do not migrate/create that database.

Curated proposals cover audited #34/#31/#40/#60/#63. Local numeric IDs are discovery references, **not publishable global identity**. Resolve and review the actual source UUID before creating a replacement. Proposals retain useful staging and observed hole checks, narrow unsupported instructions, distinguish unproven causation from retracted interpretations, and label upstream size documentation conflicts unresolved. They are derived from the October 11 audit, not newly verified provider facts.

Recipe export keys include a SHA-256 of provider data plus pipeline rules/stages; identity guidance is included. A later recipe links `supersedes` to the previous verified tip UUID. Publishing verifies full content with `get_tip` before recording the receipt. Same-title/different-content responses fail rather than silently mark exported. Blind `--mark`/`mark_exported` is refused; old numeric/empty receipts need explicit reconciliation, not a guessed UUID. Recipe content reflects **local policy**, not proof of current provider support or universal enforcement.

Fetch failures and non-success HTTP responses are persisted separately from the last good source snapshot. A 503 cannot replace docs. Doctor reports failed/overdue sources and zero episode capture. Project watches cover current config names, pipeline records and notes; operation docs and installed skills are explicit dependencies. Installed documentation does not prove a connected server exposes those capabilities. Approving a doc-change review generates a separate proposed contract/test/doc update; it does not silently apply policy.

## Isolated verification

```text
npm run build
npm test
```

On this host the installed better-sqlite3 binary targets Node 22, while the default Node has another ABI. Use `npx -p node@22 -c "npm test"` or a Node 22 installation; no dependency rebuild is required. Warden's `tests/test_knowledge_lifecycle.py` additionally exercises a real isolated Tipshare MCP round trip when `TIPSHARE_TEST_NODE` and `TIPSHARE_TEST_SERVER` explicitly name Node 22 and this checkout's built `dist/server.js`.
