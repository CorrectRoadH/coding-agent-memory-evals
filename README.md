# coding-agent-memory-evals

现在 agent memory 实现开始分化：

| 系统 | 机制 |
|---|---|
| [Tape](https://tape.systems/) | append-only facts + handoff，把 context 组织成可审计的 lineage |
| [Nowledge Mem](https://mem.nowledge.co/) | local-first graph-augmented 个人上下文层 |
| [mem9](https://mem9.ai/) | 跨 session / device / agent 的 persistent memory，keyword + vector hybrid retrieval |
| [db9.ai](https://db9.ai/) | serverless Postgres for agents，内置 vector search，structured state + file storage 合一 |
| [OpenClaw](https://docs.openclaw.ai/concepts/memory) | workspace Markdown 文件 + dreaming / promotion 机制 |

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

- **长程保持**：早期定下的架构选择、试错结论，会不会在后半段被遗忘
- **错误方案抑制**：agent 是否会重新采用已明确否决的方案
- **工程一致性**：最终代码是否贯彻同一套约定
- **稳定复现**：pass^k，不奖励多跑几次碰运气

> eval 的答案必须放在"从代码推不出来"的地方。如果无 memory 的 agent 也能读代码重做推理，benchmark 就测不出差异。

---

## 评分方式

硬断言优先，judge 只处理无法可靠 grep 的开放判断：

| 证据 | 判断什么 |
|---|---|
| final source tree | 正确写法是否真的落进代码 |
| diff | 错误方案、旧依赖、无关重写是否出现 |
| build / tests | patch 是否能跑 |
| tool calls / commands | 是否重复踩已知坑 |
| judge | 是否召回了"为什么"，例如被否方案的理由 |

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

已有 3 条从 `next-evals-oss` 迁来的 Next.js coding tasks，用于验证 TypeScript DSL 和评分面：

| eval | 测什么 |
|---|---|
| `memory/agent-029-use-cache-directive` | Server Action、cache tag 断言 |
| `memory/agent-030-app-router-migration-hard` | 大迁移、文件删除、legacy API 缺席 |
| `memory/agent-037-updatetag-cache` | read-your-own-writes 场景下的正确 cache invalidation |

下一步新增两个真实 memory tasks：

- **会话内**：`swe-bench-astropy-1`（长 bug fix，测 agent 能否保留早期诊断出的矩阵组合语义）
- **跨会话**：`swe-bench-astropy-2`（QDP parser bug，切成两段 session，测第一段的约束能否带入第二段）

候选列表见 [docs/benchmarks.md](docs/benchmarks.md)。

---

## 运行

```sh
pnpm run list
pnpm run codex
pnpm run compare
pnpm run view
```

```sh
fasteval exp compare
fasteval --agent codex memory/agent-037-updatetag-cache
fasteval view
```

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
└─ fasteval.config.ts      # agents, judge, sandbox defaults
```
