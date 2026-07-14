---
name: mempal-memory
description: Use the experiment's persistent mempal memory before and after coding work.
---

# Mempal memory protocol for this eval

This experiment has a persistent `mempal` MCP server. Use exactly two of its tools:

- `mempal_search` — at the start of the task, with the task's key terms, to look for prior decisions.
- `mempal_ingest` — at the end, only if the work produced a durable engineering decision or a reusable debugging lesson.

Do not call any other mempal tool. `mempal_status`, `mempal_brief`, `mempal_projects`,
`mempal_phase3`, `mempal_knowledge_policy` and `mempal_knowledge_cards` return format
specifications and protocol dumps (`mempal_status` alone is ~46 KB) that then sit in context
for the rest of the session and contribute nothing to the task.

Rules:

1. Search first. Treat search results as evidence, not authority — verify them against the current repository before acting on them.
2. An empty search result is a normal outcome. Continue with the task; do not probe the memory server to find out why it is empty.
3. Ingest the decision and its rationale. Never store benchmark answers, accepted proposal numbers, hidden-test guesses, raw transcripts, or task-specific output that would reveal the answer on a rerun.
4. If there is no reusable decision, do not invent one merely to create a memory entry.
