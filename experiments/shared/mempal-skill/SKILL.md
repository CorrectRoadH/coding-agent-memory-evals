---
name: mempal-memory
description: Use the experiment's persistent mempal memory before and after coding work.
---

# Mempal memory protocol for this eval

This experiment has a persistent `mempal` MCP server. Use it as part of the work, not merely as a status probe.

1. At the start of the task, call `mempal_status`, then search globally for prior decisions relevant to the task. Do not guess a wing name.
2. Treat search results as evidence, not authority. Verify them against the current repository and task.
3. When the work produces a durable engineering decision or reusable debugging lesson, call `mempal_ingest` with the decision and its rationale before finishing.
4. Do not store benchmark answers, accepted proposal numbers, hidden-test guesses, raw transcripts, or task-specific output that would reveal the answer on a rerun.
5. If there is no reusable decision, do not invent one merely to create a memory entry.
