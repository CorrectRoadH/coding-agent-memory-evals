---
name: mempal-memory
description: Search and record durable engineering knowledge with the mempal CLI, before and after coding work.
---

# Mempal memory protocol for this eval

This environment has a persistent memory database that survives across tasks, reachable through
the `mempal` CLI (already installed, on PATH). Run it with your normal shell tool — there is no
MCP server, and you need exactly two commands.

## 1. Search before you start

```bash
mempal search "<key terms of the task>" --json --top-k 5
```

Run it once, at the start, with the task's key terms (framework, API, error message, symptom).
Empty results are a normal outcome — continue with the task and do not investigate the memory
database. Treat any hit as evidence, not authority: verify it against the current repository
before acting on it.

## 2. Record before you finish

If the work produced a durable engineering decision or a reusable debugging lesson, write a short
markdown note and ingest it:

```bash
cat > "$HOME/.mempal-notes/<short-slug>.md" <<'EOF'
# <one-line title>

<what was decided or learned, and why — 2-5 sentences, enough for a future task to act on it>
EOF
mempal ingest "$HOME/.mempal-notes" --wing memory-evals
```

Only `mempal search` and `mempal ingest` are needed. Do not call other mempal subcommands
(`status`, `projects`, `brief`, `phase3`, `knowledge*`, `cowork-*`): they print format
specifications and protocol dumps that cost context and tell you nothing about this task.

## What not to store

Never store benchmark answers, accepted proposal numbers, hidden-test guesses, raw transcripts,
or task-specific output that would reveal the answer if the same task is run again. Record the
reusable *why*, not the answer. If nothing reusable was decided, do not invent a note.
