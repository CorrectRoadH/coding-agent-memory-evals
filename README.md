# [MemoryBench](https://coding-agent-memory-evals.vercel.app)

Powered by [NiceEval](https://github.com/CorrectRoadH/NiceEval)

MemoryBench 是一个针对 coding agent **记忆能力**的评测:同一批真实开发任务、同一个模型,只切换 memory 条件,看最终代码、diff、测试和命令是否真的变好。

agent memory 的实现正在快速分化——[Tape](https://tape.systems/)、[Nowledge Mem](https://mem.nowledge.co/)、[mempal](https://github.com/ZhangHanDong/mempal/) 都在解决"agent 会忘"的问题,但目前缺一个可复现的评测面来说清楚它们到底有没有用、值不值得多花的 token 和延迟。MemoryBench 就是这个评测面。

---

## 测什么

memory 失效分两层，MemoryBench 都测：

- **会话内长程记忆**:前半段的诊断、约束、架构决定,在后半段修 bug / 重构时被忘掉。
- **跨会话持久记忆**:上次讨论过的决定、被否方案、阻塞原因,新 session 里没被带回来。

memory 的作用不做成额外验收项。真实开发里用户关心的是任务是否完成、完成得多快、花费多少、是否少踩坑——如果无 memory 的 agent 也能重新推理并最终通过,那它也应该算过,只是可能更慢、更贵、更不稳定。因此 MemoryBench 实际打的分是:

- **任务完成率**:最终改动能不能通过原始 benchmark 的 verifier。
- **开发效率**:完成同一任务要多少时间、turn、工具调用和 token。
- **重复试错**:是否少走已经探索过的失败路径。
- **稳定复现**:pass^k,不奖励多跑几次碰运气。

## 评分方式

主评分只看任务本身有没有做完——build、测试,或者任务自带的原始 verifier 说了算,和原 benchmark(SWE-bench、Terminal-Bench、RepoMod-Bench……)未经改动时的判法完全一致。memory 条件的价值,是在这个共享的通过/失败信号之上比较出来的,而不是靠"有没有记住某条事实"额外扣分:

| 证据 | 判断什么 |
|---|---|
| build / tests / upstream verifier | 开发任务是否完成 |
| final source tree / diff | 最终产物是否满足任务要求、有无无关破坏 |
| duration / token / cost | memory 是否降低完成成本 |
| tool calls / commands | 是否减少重复探索和失败命令 |
| pass^k | 同一条件下是否稳定复现 |

judge 只用在任务本身就没法规则化判断完成度的地方,不作为独立的 memory 召回考试。

## Memory 条件

| 条件 | 状态 |
|---|---|
| no-memory baseline | 已接入 |
| bub + Tape | 已接入 |
| Codex / Claude Code host memory | 已接入 |
| Nowledge Mem / mem9 / db9.ai | 规划中 |

## 任务

已有 5 条 coding tasks:

| eval | 测什么 |
|---|---|
| `memory/agent-029-use-cache-directive` | Server Action、cache tag 断言 |
| `memory/agent-030-app-router-migration-hard` | 大迁移、文件删除、legacy API 缺席 |
| `memory/agent-037-updatetag-cache` | read-your-own-writes 场景下的正确 cache invalidation |
| `memory/terminal-cancel-async-tasks` | Terminal-Bench async cancellation task,跑原 pytest 语义 |
| `memory/repomod-hello-world-api` | RepoMod-Bench Flask → Java/Spring API 迁移,跑 hidden pytest HTTP 测试 |

后续真实开发任务候选:

- **会话内**:`swe-bench-astropy-1`(长 bug fix,跑原任务 verifier)
- **跨会话**:`swe-bench-astropy-2`(QDP parser bug,切成两段 session,最终仍只看原任务 verifier)

完整候选列表见 [docs/benchmarks.md](docs/benchmarks.md)。

## Quickstart

默认直接使用 NiceEval 已发布的 `v0.6.1` E2B 公共模板:

```sh
correctroads-default-team/niceeval-claude-code:v0.6.1
correctroads-default-team/niceeval-codex:v0.6.1
correctroads-default-team/niceeval-bub:v0.6.1
```

无需先在自己的 Team 构建,agent CLI(含 bub 的安装指纹)全部烘焙在模板里,attempt 里零运行时安装。唯一需要自建的是 mempal 变体模板——它在公共模板之上补 mempal 二进制和预热好的 embedding cache,两样都在构建期从官方源现取(`cargo install` + warmup ingest 自动拉 HF 模型),无 host 前置步骤:

```sh
pnpm template:mempal claude            # → memory-evals-claude-mempal-v0-6-1-0-9-0
pnpm template:mempal codex             # → memory-evals-codex-mempal-v0-6-1-0-9-0
```

设计见 [`docs/mempal-condition-design.md`](docs/mempal-condition-design.md)。

```sh
pnpm exec niceeval list                # 列出发现的 eval
pnpm run smoke                         # dev 组便宜冒烟(单 eval)
pnpm exec niceeval exp compare         # 跑正式对比组
pnpm exec niceeval exp compare memory/agent-037-updatetag-cache   # 只跑某个 eval
pnpm exec niceeval view                # 本地查看结果
```

### 发布线上报告(coding-agent-memory-evals.vercel.app)

结果数据 `.niceeval/` 直接提交进仓库(`.gitignore` 只排除单轮可达上百 MB、查看器也不读的 `diff.json`)。Vercel 的 buildCommand(见 `vercel.json`)直接跑 `niceeval view --results .niceeval --report reports/memory.tsx --out site` 整站导出,没有自定义构建脚本;`site/` 是构建产物,不进仓库。跑完新一轮 eval 后:

```sh
git add -A && git commit -m "eval: <跑了什么>" && git push   # push 即发布,没有本地构建步骤
```

空报告防线是 niceeval 自带的:`.niceeval/` 里没有任何可读快照时 `view --out` 非零退出、不产出空站,Vercel 保留上一次部署。本地想预览线上会长什么样:`pnpm exec niceeval view --report reports/memory.tsx`。

## What is NiceEval

[NiceEval](https://github.com/CorrectRoadH/NiceEval) 是 MemoryBench 跑在其上的评测框架:负责 sandbox 编排(E2B)、agent 适配(Claude Code / Codex / bub)、并发调度和结果快照。MemoryBench 本身只提供任务定义(`evals/memory/`)、起始仓库(`workspaces/`)、跑法矩阵(`experiments/`)和自定义报告(`reports/`)——沙箱怎么起、agent 怎么装、结果怎么落盘都是 NiceEval 的职责。

## Reporting issues

在 [GitHub](https://github.com/CorrectRoadH/memorybench/issues) 上报 eval 定义、memory 条件接线或报告展示的问题。

## 仓库结构

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
