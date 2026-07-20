# [MemoryBench](https://coding-agent-memory-evals.vercel.app)

[中文](README.md)

Powered by [NiceEval](https://github.com/CorrectRoadH/NiceEval)

MemoryBench is an evaluation of coding agents' **memory capability**: the same batch of real development tasks, the same model, only the memory condition is switched — and we check whether the final code, diff, tests, and commands actually get better.

Agent memory implementations are diversifying fast — [Tape](https://tape.systems/), [Nowledge Mem](https://mem.nowledge.co/), and [mempal](https://github.com/ZhangHanDong/mempal/) are all tackling the "agents forget" problem, but there's currently no reproducible evaluation that can clearly say whether they actually help and whether they're worth the extra tokens and latency. MemoryBench is that evaluation.

---

## What it measures

Memory failure happens at two layers, and MemoryBench measures both:

- **Long-horizon memory within a session**: diagnoses, constraints, and architectural decisions made early on get forgotten later when fixing bugs or refactoring.
- **Persistent memory across sessions**: decisions, rejected approaches, and blockers discussed last time don't carry over into a new session.

Memory's contribution is not scored as an extra checklist item. In real development, what users care about is whether the task got done, how fast, how much it cost, and whether fewer mistakes were made along the way — if a no-memory agent can also re-reason its way through and eventually pass, it should still pass, just possibly slower, more expensive, or less stable. So what MemoryBench actually scores is:

- **Task completion rate**: whether the final change passes the original benchmark's verifier.
- **Development efficiency**: how much time, how many turns, tool calls, and tokens it takes to finish the same task.
- **Repeated trial and error**: whether fewer already-explored failed paths are retraced.

## Memory conditions

| Condition | Status |
|---|---|
| no-memory baseline | integrated |
| bub + Tape | integrated |
| Codex / Claude Code host memory | integrated |
| Nowledge Mem | integrated |

Full candidate list in [docs/benchmarks.md](docs/benchmarks.md).

## Quickstart

```sh
git clone https://github.com/CorrectRoadH/MemoryBench.git
cd MemoryBench
pnpm i
pnpm exec niceeval exp compare
```

## Reporting issues

Report issues with eval definitions, memory condition wiring, or report rendering on [GitHub](https://github.com/CorrectRoadH/memorybench/issues).

## Repository layout

```txt
memorybench/
├─ evals/memory/           # memory / coding task evals
├─ experiments/            # comparable run matrices
│  ├─ shared/              # experimental-condition helpers, not adapter reimplementations
│  └─ compare/
│     ├─ bub-gpt-5.4.ts
│     └─ codex-gpt-5.4.ts
├─ workspaces/             # per-eval starter repos
├─ reports/                # custom NiceEval reports
├─ docs/benchmarks.md      # SWE benchmark survey and candidate evals
└─ niceeval.config.ts      # agents, judge, sandbox defaults
```
