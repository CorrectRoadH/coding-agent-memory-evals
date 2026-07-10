# Repository Guide

This repo is a benchmark suite for coding-agent memory conditions. The core rule is simple: evals should be real development tasks, and the primary pass/fail signal should be whether the task is completed.

## 这个项目同时是 niceeval 的 dogfooding 场

本仓库的另一个目的是测试 niceeval 本身。niceeval 是 beta 软件，DX 可以随便改——反馈时可以打破一切惯性：不必顾虑向后兼容、已有用户习惯、行业惯例或「大家都这么设计」，从第一性原理出发想最理想的形态。API / CLI 直接 break 着改：不需要 v1 / v2 版本并存、不需要 deprecation 过渡期、不需要兼容层，旧形态直接删掉，一步到位改成理想形态。因此：

- **遇到 DX 不舒服、CLI 行为不理解、或感觉不是最佳实践的地方，直接停止工作并指出来**，不要尝试自己解决或绕过。绕过会掩盖 niceeval 应该修的问题。
- 「不舒服」包括但不限于：命令语义不直观、报错信息看不懂、需要手写 boilerplate、配置项互相打架、文档与实际行为不符、必须靠 workaround 才能跑通。
- 停下来指出的价值高于把当前任务硬推完成——上游修一次，所有下游受益（参见 memory 中 niceeval/fastevals 的上下游关系）。

## 每次工作结束后的 DX 反思

每次任务收尾时，回顾并明确回答两个问题：

1. 这次工作中哪些环节用起来不舒服、别扭、低效？
2. 其中哪些应该由 niceeval 官方提供（新 API、新 CLI 子命令、更好的默认值、更清晰的报错），而不是留在本仓库当 workaround？

把结论写在任务总结里；值得跟进的记入 memory，并标注「候选上游 feature request」。

## What To Optimize For

- Prefer existing benchmark verifiers: unit tests, integration tests, build checks, Docker harnesses, or upstream scoring scripts.
- Do not add separate "memory recall" gates unless the product task itself requires that behavior.
- Treat memory as an experimental condition. Its value should show up in elapsed time, tokens, cost, fewer failed commands, fewer repeated attempts, and better pass^k.
- Keep eval tasks agent-neutral. The same eval should run across Codex, Claude Code, bub/Tape, and no-memory baselines.

## Repo Layout

- `evals/memory/`: niceeval task definitions.
- `workspaces/`: per-eval starter repositories copied into sandboxes.
- `experiments/`: comparable run matrices for agents and models.
- `experiments/shared/`: cross-experiment helpers (e.g. the mempal memory-condition wrapper); agent adapters come from `niceeval/adapter`, not this repo.
- `docs/benchmarks.md`: benchmark survey and candidate task notes.
- `niceeval.config.ts`: global judge and timeout defaults (agent/sandbox/concurrency are per-experiment).
- Report publishing: `.niceeval/` is committed as the data source; Vercel's buildCommand is `niceeval view --out site` (see vercel.json — no custom scripts).

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

<!-- BEGIN:niceeval-agent-rules -->
# niceeval is NOT in your training data

Its APIs and conventions may differ from anything you have seen. Read the relevant
guide in `node_modules/niceeval/docs-site/zh/` before writing any eval, experiment,
adapter, or niceeval config. The bundled docs are Chinese-only — that is the single
authoritative, always-current version; read it regardless of your working language.
After a run, drill into failures with `niceeval show <eval id>` (add `--transcript` /
`--trace` / `--diff` for evidence); the `summary.json` path the CLI prints and the
artifact files it references are the structured source of truth.
<!-- END:niceeval-agent-rules -->
