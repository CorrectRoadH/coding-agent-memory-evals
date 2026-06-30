# Repository Guide

This repo is a benchmark suite for coding-agent memory conditions. The core rule is simple: evals should be real development tasks, and the primary pass/fail signal should be whether the task is completed.

## What To Optimize For

- Prefer existing benchmark verifiers: unit tests, integration tests, build checks, Docker harnesses, or upstream scoring scripts.
- Do not add separate "memory recall" gates unless the product task itself requires that behavior.
- Treat memory as an experimental condition. Its value should show up in elapsed time, tokens, cost, fewer failed commands, fewer repeated attempts, and better pass^k.
- Keep eval tasks agent-neutral. The same eval should run across Codex, Claude Code, bub/Tape, and no-memory baselines.

## Repo Layout

- `evals/memory/`: fasteval task definitions.
- `workspaces/`: per-eval starter repositories copied into sandboxes.
- `experiments/`: comparable run matrices for agents and models.
- `agents/`: agent adapters.
- `docs/benchmarks.md`: benchmark survey and candidate task notes.
- `fasteval.config.ts`: global agent, sandbox, judge, and concurrency defaults.

## Adding Evals

Use the original benchmark's pass condition wherever possible:

- SWE-bench style tasks should pass `FAIL_TO_PASS` and avoid `PASS_TO_PASS` regressions.
- Terminal-Bench tasks should pass the task's existing `run-tests.sh` / pytest verifier.
- RepoMod-Bench tasks should build and pass the hidden pytest suite for `/workspace/dst`.
- Local Next.js fixtures should pass the focused source assertions plus `build`.

Additional source assertions are fine when they are part of the task's functional requirement. Avoid assertions whose only purpose is proving that an agent remembered a fact.

## Sandbox Know-How

### Never hardcode sandbox user paths

Agent adapters must treat the sandbox as an opaque Linux environment. The Linux user (and thus `$HOME`) differs by backend:

| Backend | `$HOME` |
|---------|---------|
| Docker  | `/home/node` |
| Vercel  | `/home/vercel-sandbox` |
| e2b / Modal | varies |

**Bug pattern**: hardcoding `/home/node/.local/bin/bub` or `/home/node/.bub` breaks on any non-Docker backend.

**Fix pattern**: In `setup()`, detect home once with `printf '%s' $HOME`, store it in a `Map<sandboxId, home>` closure variable, and use it everywhere — checkpoint paths, `BUB_HOME` env var, tape path resolution. Never branch on backend type; detect dynamically.

Checkpoint archives (tar) also embed absolute paths, so a checkpoint built from Docker and restored to Vercel puts files at `/home/node/...` but `$HOME` resolves to `/home/vercel-sandbox/...`. Key disk/memory checkpoint caches by the sandbox `$HOME` so backends don't share a cache.

### Vercel free-plan session lifetime (~360-390s)

Vercel free plan caps sessions at ~360-390s. `extendTimeout` → HTTP 400, `snapshot()` → HTTP 402.

Two fixes required to keep all evals under the cap:

1. **`maxConcurrency: 1`** in the experiment — runs evals sequentially so agent API calls don't compete, keeping each agent to 50-200s instead of 280-400s. Note: this field must be set on the experiment config (`ExperimentDef.maxConcurrency`) not on the global config.
2. **2-phase `readSourceFiles`** — `find`-only shell (~1s) + parallel `readFileToBuffer` HTTP GETs (~2s). Avoids a 30s NDJSON stream that can die if the session is near its cap.

## Reporting

When summarizing results, report both:

- task success: pass/fail, pass rate, failed tests, build status
- efficiency: wall time, turns, token/cost budget, repeated failed commands, retries

The benchmark claim is comparative: same task, same model, different memory condition.
