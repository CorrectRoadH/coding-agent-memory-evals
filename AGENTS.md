# Repository Guide

This repo is a benchmark suite for coding-agent memory conditions. The core rule is simple: evals should be real development tasks, and the primary pass/fail signal should be whether the task is completed.

总是使用中文回复与讨论

## 工作方式约定记在这里

**工作方式 / 流程偏好一律记录在本文件（AGENTS.md，CLAUDE.md 是它的符号链接），不散落在个人 memory。** 个人 memory 只放调试 know-how、项目状态、上游候选等（见下方「记录问题与 Know-How 的规范」）；「我该怎么协作」这类约定放这里，保证换 agent / 换会话都能读到。

### Git 工作流：直接在 main 上开发

本仓库**直接在 `main` 分支上提交**，不开 feature 分支、不走 PR review 流程。需要提交时直接 commit 到 `main`（这覆盖「在默认分支上先建分支」的通用默认行为）。push 仍只在用户明确要求时进行。

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
- `scripts/hooks/pre-commit`: 体积闸。niceeval 原样落盘工具输出，agent 一句 `grep -R` 扫进 node_modules 就能让单个 trace.json 破 100MB，撞死 GitHub 单文件硬上限。hook 会把 >50MB 的文件自动移出本次提交（不拦 commit，文件留在磁盘上）。**新 clone 后需手动启用一次**：`git config core.hooksPath scripts/hooks`。

## Adding Evals

Use the original benchmark's pass condition wherever possible:

- SWE-bench style tasks should pass `FAIL_TO_PASS` and avoid `PASS_TO_PASS` regressions.
- Terminal-Bench tasks should pass the task's existing `run-tests.sh` / pytest verifier.
- RepoMod-Bench tasks should build and pass the hidden pytest suite for `/workspace/dst`.
- Local Next.js fixtures should pass the focused source assertions plus `build`.

Additional source assertions are fine when they are part of the task's functional requirement. Avoid assertions whose only purpose is proving that an agent remembered a fact.

### 隐藏测试不许断言 prompt 没给过的标识符

直接把上游 PR 的测试搬来当隐藏测试是**默认错误做法**——上游测试是贴着上游实现写的，会连带把私有命名搬进判据。规则：

> **隐藏测试里出现的每一个标识符（CSS 类名、DOM 结构、函数返回的键名、组件 state 字段、新增的 callback prop），要么在 prompt 里写清楚是公开契约，要么就不许出现在断言里。**

区分标准是「库的使用者需不需要知道它」：
- **是公开契约** → 写进 prompt，理直气壮地断言。例：`react-tooltip__place-<placement>` 类名，consumer 要写 CSS 就必须知道；不写死这个名字功能本身就没意义。
- **不是** → 改成行为断言。例：内部函数多返回一个键、组件 state 叫什么、新造的 wrapper 节点叫什么。

行为断言的常用替代手法（都在本仓库有现成例子）：
- 读无障碍标签而不是内部 state：`.react-datepicker__month` 的 `aria-label="Month June, 2024"` 能直接判断哪个面板显示哪个月（pr-6058）
- 用文档顺序而不是新类名：`compareDocumentPosition` 比较 `__current-month` / `__day-names` / `__month` 的先后，可完整表达 top/middle/bottom（pr-6092）
- 用公开 prop 驱动内部状态：react-tooltip 的 `middlewares` 是公开 prop，用一个强制 placement 的 floating-ui middleware 就能造出「实际 placement ≠ 请求的 place」，无需 mock 内部模块（pr-970）
- 给异步实现留出 flush：断言前 `await act(async () => {})`，让 observer / microtask 类实现也能算对，而不是只认同步写法（lightbox commit-5578052）

### 新增或改动隐藏测试后必须做三向验证

只验 RED→GREEN 会漏掉「测试锁死了上游实现」这一类问题——这正是 2026-07-23 那次四道题 100% 失败的成因。三向缺一不可：

1. **RED**：base commit 原样跑隐藏测试 → 必须挂，且**挂的原因要正确**（是功能缺失，不是编译错、找不到文件之类）
2. **GREEN**：打上游官方修复 → 必须全过
3. **ALT**：自己写一个**合理但与上游不同**的实现 → 也必须全过

第 3 步是硬性要求。ALT 不用写得漂亮，够用就行：换个类名、换个内部字段名、把上游的新 callback prop 换成组件本地 state。只要 ALT 挂了，就是测试在考实现而不是考功能，回去改测试。

顺带一提，跑 GREEN 时如果上游官方修复自己都过不了某条断言（lightbox 那道就是：官方 fix 解决不了「祖先 dir 属性被改」的场景），说明 prompt 描述的症状和测试考的场景根本不是同一件事，要改的是 prompt。

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
After a run, drill into failures with `niceeval show <eval id>`, then open an attempt
via its locator: `niceeval show @<locator>` (add `--source` / `--execution` /
`--timing` / `--diff` for evidence); the snapshot and per-attempt `result.json` under
`.niceeval/` are the structured source of truth.
<!-- END:niceeval-agent-rules -->
