# coding-agent-memory-evals

现在 agent memory 实现开始分化：

| 系统 | 机制 |
|---|---|
| [Tape](https://tape.systems/) | append-only facts + handoff，把 context 组织成可审计的 lineage |
| [Nowledge Mem](https://mem.nowledge.co/) | local-first graph-augmented 个人上下文层 |
| [mem9](https://mem9.ai/) | 跨 session / device / agent 的 persistent memory，keyword + vector hybrid retrieval |

这些系统都在解决"agent 会忘"的问题，但目前缺一个可复现的评测面来说清楚它们到底有没有用。

这个仓库就是这个 benchmark：同一批 coding tasks、同一个模型、只换 memory 条件，看最终代码、diff、测试和命令是否真的变好。

---

## 测什么

memory 分两层，二者都要测：

| 记忆类型 | 典型失败 |
|---|---|
| **会话内长程记忆** | 前半段的诊断、约束、架构决定，在后半段修 bug / 重构时被忘掉 |
| **跨会话持久记忆** | 上次讨论过的决定、被否方案、阻塞原因，新 session 里没被带回来 |

具体观察指标：

- **任务完成率**：最终开发任务能不能通过原始 benchmark 的验证
- **开发效率**：完成同一任务需要多少时间、turn、命令和 token
- **重复试错**：是否少走已经探索过的失败路径
- **稳定复现**：pass^k，不奖励多跑几次碰运气

memory 的作用不需要做成额外验收项。真实开发里用户关心的是任务是否完成、完成得多快、花费多少、是否少踩坑；如果无 memory 的 agent 也能重新推理并最终通过,那它也应该算过,只是可能更慢、更贵、更不稳定。

---

## 评分方式

主评分只看开发任务本身是否完成。memory 条件的价值通过副指标比较,而不是通过“是否显式记住某条事实”来额外扣分：

| 证据 | 判断什么 |
|---|---|
| build / tests / upstream verifier | 开发任务是否完成 |
| final source tree / diff | 最终产物是否满足任务要求、有无无关破坏 |
| duration / token / cost | memory 是否降低完成成本 |
| tool calls / commands | 是否减少重复探索和失败命令 |
| pass^k | 同一条件下是否稳定复现 |

judge 只用于无法规则化的任务完成判断,不作为独立的 memory 召回考试。

---

## Memory 条件

| 条件 | 状态 |
|---|---|
| no-memory baseline | 已接入 |
| bub + Tape | 已接入 |
| Codex / Claude Code host memory | 已接入 |
| Nowledge Mem / mem9 / db9.ai | 规划中 |

---

## 当前状态

已有 5 条 coding tasks：

| eval | 测什么 |
|---|---|
| `memory/agent-029-use-cache-directive` | Server Action、cache tag 断言 |
| `memory/agent-030-app-router-migration-hard` | 大迁移、文件删除、legacy API 缺席 |
| `memory/agent-037-updatetag-cache` | read-your-own-writes 场景下的正确 cache invalidation |
| `memory/terminal-cancel-async-tasks` | Terminal-Bench async cancellation task，跑原 pytest 语义 |
| `memory/repomod-hello-world-api` | RepoMod-Bench Flask → Java/Spring API 迁移，跑 hidden pytest HTTP 测试 |

后续真实开发任务候选：

- **会话内**：`swe-bench-astropy-1`（长 bug fix，跑原任务 verifier）
- **跨会话**：`swe-bench-astropy-2`（QDP parser bug，切成两段 session，最终仍只看原任务 verifier）

候选列表见 [docs/benchmarks.md](docs/benchmarks.md)。

---

## 运行

默认直接使用 NiceEval 已发布的 `v0.6.1` E2B 公共模板：

```sh
correctroads-default-team/niceeval-claude-code:v0.6.1
correctroads-default-team/niceeval-codex:v0.6.1
correctroads-default-team/niceeval-bub:v0.6.1
```

无需先在自己的 Team 构建，agent CLI（含 bub 的安装指纹）全部烘焙在模板里，attempt 里零运行时安装。
唯一需要自建的是 mempal 变体模板——它在公共模板之上加 mempal 二进制和预热好的 embedding cache：

```sh
bash scripts/build-mempal-linux.sh     # host 侧交叉编译 linux/amd64 二进制(一次性)
pnpm template:mempal claude            # → memory-evals-claude-mempal
pnpm template:mempal codex             # → memory-evals-codex-mempal
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

结果数据 `.niceeval/` 直接提交进仓库(`.gitignore` 只排除单轮可达上百 MB、查看器也不读的 `diff.json`)。Vercel 在部署时用 `scripts/build-site.ts` 从这份数据现场构建整站:`latestPerExperiment` 给每个实验挑最新一份快照,`copyRun` 瘦身出临时 run 目录,再 `niceeval view --out` 整站导出。`site/` 是构建产物,不进仓库。跑完新一轮 eval 后:

```sh
git add -A && git commit -m "eval: <跑了什么>" && git push   # push 即发布,没有本地构建步骤
```

空报告防线在构建侧:`.niceeval/` 里挑不出任何非空快照时 `build-site.ts` 直接失败,Vercel 保留上一次部署。本地想预览线上会长什么样:`pnpm exec tsx scripts/build-site.ts <输出目录>`,或直接 `pnpm exec niceeval view`。

---

## 仓库结构

```txt
coding-agent-memory-evals/
├─ agents/                 # coding agent adapters
│  ├─ bub.ts
│  ├─ claude-code.ts
│  └─ codex.ts
├─ evals/memory/           # memory / coding task evals
├─ experiments/            # comparable run matrices
│  └─ compare/
│     ├─ bub-gpt-5.4.ts
│     └─ codex-gpt-5.4.ts
├─ workspaces/             # per-eval starter repos
├─ docs/benchmarks.md      # SWE benchmark survey and candidate evals
└─ niceeval.config.ts      # agents, judge, sandbox defaults
```
