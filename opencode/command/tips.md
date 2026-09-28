---
description: Look up tips in the shared tipshare knowledge base
---

Help the user find what they need in the shared "tipshare" store.

$ARGUMENTS

Behavior:
- Empty input (or "updates" / "feed" / "new"): call `get_updates` and `list_topics`
  to show what is new and what is available.
- Input matches a topic (check `list_topics`): call `get_feed` on it.
- Otherwise, treat the input as a search query: call `search`.
- For the most relevant results, call `get_tip` to show the full solution.
- Summarize the top tips: title, one-line solution, and confidence; report tip
  ids.
- Remind the user/agent that when a tip is actually tried, it should be
  confirmed via `mark_outcome(id, worked, note)` — a feed nobody verifies can't
  rank proven tips to the top.
- If a result is rejected (confidence < 0), mention checking whether a successor
  tip superseded it (via `get_tip` on the old tip) before relying on it.