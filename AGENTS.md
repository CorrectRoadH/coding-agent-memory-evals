# Repository Guide

This repo is a benchmark suite for coding-agent memory conditions. The core rule is simple: evals should be real development tasks, and the primary pass/fail signal should be whether the task is completed.

## What To Optimize For

- Prefer existing benchmark verifiers: unit tests, integration tests, build checks, Docker harnesses, or upstream scoring scripts.
- Do not add separate "memory recall" gates unless the product task itself requires that behavior.
- Treat memory as an experimental condition. Its value should show up in elapsed time, tokens, cost, fewer failed commands, fewer repeated attempts, and better pass^k.
- Keep eval tasks agent-neutral. The same eval should run across Codex, Claude Code, bub/Tape, and no-memory baselines.

## Repo Layout

- `evals/memory/`: niceeval task definitions.
- `workspaces/`: per-eval starter repositories copied into sandboxes.
- `experiments/`: comparable run matrices for agents and models.
- `agents/`: agent adapters.
- `docs/benchmarks.md`: benchmark survey and candidate task notes.
- `niceeval.config.ts`: global agent, sandbox, judge, and concurrency defaults.

## Adding Evals

Use the original benchmark's pass condition wherever possible:

- SWE-bench style tasks should pass `FAIL_TO_PASS` and avoid `PASS_TO_PASS` regressions.
- Terminal-Bench tasks should pass the task's existing `run-tests.sh` / pytest verifier.
- RepoMod-Bench tasks should build and pass the hidden pytest suite for `/workspace/dst`.
- Local Next.js fixtures should pass the focused source assertions plus `build`.

Additional source assertions are fine when they are part of the task's functional requirement. Avoid assertions whose only purpose is proving that an agent remembered a fact.

## 记录问题与 Know-How 的规范

调试基础设施问题（sandbox 报错、agent 安装失败、eval 超时等）时，发现的具体问题和修法**记入 memory**，不写进本文件。

### 记什么

一条有效的 memory 条目包含三个部分：

1. **现象**：出现什么错误、在哪个 eval / sandbox / agent 上复现
2. **根因**：为什么会这样（代码假设、API 限制、路径 hardcode 等）
3. **修法与适用范围**：怎么改、以后遇到类似情况如何判断是否适用

### 记在哪里

- `~/.claude/projects/.../memory/` 目录下，每个问题一个 `.md` 文件
- 类型用 `feedback`（行为规范）或 `project`（具体项目状态）
- 更新 `MEMORY.md` 索引，保证下次对话能被加载

### 什么时候记

- 踩坑并修复之后立刻记，趁上下文还在
- 发现某个假设在换了 sandbox backend / model / 实验配置后不成立时
- 修法有反直觉之处（比如"调大 timeout 反而让 session 更短"）时

## Reporting

When summarizing results, report both:

- task success: pass/fail, pass rate, failed tests, build status
- efficiency: wall time, turns, token/cost budget, repeated failed commands, retries

The benchmark claim is comparative: same task, same model, different memory condition.
