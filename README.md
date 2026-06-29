# coding-agent-memory-evals

一个用 [fasteval](../fastevals) 写的轻量 coding-agent benchmark，用来回答一个很具体的问题：

> 给 coding agent 接上不同的 memory system 之后，长程开发任务到底有没有更稳定、更少返工、更少忘记早期决定？

现在 agent memory 的实现开始分化：有 [Tape Systems](https://tape.systems/) 这种把 context 组织成 append-only facts、anchors、handoff、fork/merge 的架构；有 [Nowledge Mem](https://mem.nowledge.co/) 这种 local-first、graph-augmented 的个人上下文层；有 [mem9](https://mem9.ai/) 这种跨 session / device / workflow 的 persistent memory；有 [db9.ai](https://db9.ai/) 这种把结构化 memory 放进 Postgres、把 raw context 放进文件工作区的形态；也有 [OpenClaw memory](https://docs.openclaw.ai/concepts/memory) 这种基于 workspace Markdown 文件的显式记忆，以及社区里的三层 memory 玩法。

这些系统都在解决“agent 会忘”的问题，但它们需要一个可复现的评测面：同一批 coding tasks、同一个模型、只换 memory 条件，然后看最终代码、命令、diff、测试和回答是否真的变好。

这就是本仓库要做的事。

---

## 要测什么

我们不测“memory API 有没有返回一段文本”。那太容易变成检索演示。

这里的 memory 分两层，二者都要测：

| 记忆类型 | 发生在哪里 | 典型失败 | 适合的 SWE 任务形状 |
|---|---|---|---|
| **会话内长程记忆** | 同一个 agent run 内，任务很长，context 不断累积、压缩、摘要或被注意力稀释 | 前半段做过的诊断、约束、架构决定，在后半段修 bug / 重构 / 补测试时被忘掉 | SWE-bench / SWE-Gym 这类长 bug fix；Commit0 这类从规范实现库；Terminal-Bench 这类长 CLI 排障 |
| **跨会话持久记忆** | `newSession()` 或隔天继续做，同一 repo 但上下文清空，只能依赖外部 memory / 文件 / tape / DB | 上次讨论过的决定、被否方案、阻塞原因、用户偏好没被带回来 | 续作任务、review 后返工、被否方案再次出现、skip 理由复现 |

所以，一个普通 SWE 修 bug 任务如果足够长，本身就是 memory eval：agent 要记住早期定位、失败实验、repo 约定、临时 workaround 和目标约束，才能在后面写出一致的 patch。跨会话不是唯一目标，它只是第二类更硬的 memory 压力。

我们测的是 memory 是否改变了 agent 的工程行为：

- **会话内长程保持**：单个长任务中，早期定下的架构选择、试错结论、代码惯例，会不会在后半段被遗忘。
- **跨会话召回**：新 session 里，agent 能不能记住上一轮只存在于讨论中的决定、否决理由、工作约束。
- **错误方案抑制**：agent 是否会重新采用以前已经明确否决过的方案。
- **工程一致性**：最终代码是否贯彻同一套约定，而不是前半段一种写法、后半段另一种写法。
- **稳定复现**：不是“跑 5 次蒙中过 1 次”，而是同一个 memory setup 多次运行都能稳定通过。

一个好的 memory eval 必须把答案放在代码推不出来的地方。比如：

- “不要用 WebSocket，因为这个产品是 offline-first，同步链路不能被长连接假设绑死。”
- “这个 repo 的插件注册必须走 registry，后面的 handler 也不能改回硬编码分支。”
- “上次已经确认这条任务被上游 bug 阻塞，继续重试只会烧预算。”
- “这个缓存场景要求 read-your-own-writes，所以必须用不会返回 stale data 的失效方式。”

如果答案能从当前文件树直接推出来，那就不是 memory 题。无 memory 的 agent 也能读代码重做推理，benchmark 就测不出差异。

---

## 要比较谁

目标是把 memory system 当成 experiment 条件，而不是把 eval 写死给某一个 agent。

| memory 条件 | feature / 机制侧重点 | 主要支持哪类记忆 | 想解决的问题 | 在 coding eval 里观察什么 |
|---|---|---|---|---|
| no-memory baseline | 新会话只靠 repo 文件、prompt、当前上下文 | 只有模型原生上下文 | 给所有 memory backend 一个干净下限 | 忘记率、返工率、误采旧方案、重复踩坑次数 |
| [bub + Tape](https://tape.systems/) | append-only facts、anchors、handoff、topic/thread views、fork/merge | 会话内长程；也可通过 tape handoff 做跨会话 | 长任务压缩后不丢历史；阶段切换时只继承必要状态；保留可审计 lineage | 压缩后是否仍遵守早期决定；跨 session 是否接上 handoff；是否能解释“为什么这么做” |
| [Nowledge Mem](https://mem.nowledge.co/) | local-first、graph-augmented personal context、conversation/files/decisions search、MCP integration | 跨会话、跨工具；也可在长任务中主动检索旧上下文 | 重要上下文散落在多个 AI 工具和旧对话里，靠人翻历史太慢 | 能否召回非代码事实、历史决策、用户偏好；是否少问已回答过的问题 |
| [mem9](https://mem9.ai/) | managed persistent memory、hybrid retrieval、shared memory across sessions/machines/users、inspection surfaces | 跨会话、跨机器、跨 agent；也可作为长任务外部 recall 层 | 单纯向量库不够；需要 ingestion、ranking、dedupe、audit、evaluation 一整套 memory product | 多 session / 多 agent 是否共享同一事实；召回是否稳定、不过量、不重复；错误 memory 是否可定位 |
| [db9.ai](https://db9.ai/) | Postgres + cloud filesystem、SQL/vector/full-text、branching、files + tables in one workspace | 跨会话状态；结构化 run history；可分支的实验记忆 | agent state 分散在 DB、对象存储、向量库、日志里，难查、难分支、难审计 | 结构化状态是否可查询；raw context 是否可追溯；branch 后实验是否隔离且可复现 |
| [OpenClaw-style memory](https://docs.openclaw.ai/concepts/memory) | memory files、semantic/keyword hybrid search、memory flush before compaction、dreaming / promotion、wiki layer | 会话内压缩前保存；跨会话文件召回 | 长对话压缩前重要事实没落盘；raw notes 需要变成可维护知识层 | compaction 前是否保存关键约束；promoted memory 是否高信号；文件记忆是否漂移或互相矛盾 |
| Codex / Claude Code host memory | agent 宿主自带或通过配置/文件形成的持久上下文 | 取决于宿主：通常有会话内上下文，部分支持项目/用户级持久文件 | 真实开发工具默认能记住多少，作为开发者实际会用到的基线 | 不接外部 backend 时，工具原生 memory 是否足够完成长程和跨会话任务 |

同一个 eval 可以跑在这些条件上。fasteval 负责把“测什么”和“怎么跑”拆开：

- `evals/` 写任务和评分，不关心被测的是 bub、Codex、Claude Code，还是外部 memory backend。
- `experiments/` 写对照组，例如同模型下 `bub+tape` vs `codex` vs `codex+mem9`。
- `agents/` 和 adapter 负责把不同 CLI / memory backend 接进同一套 runner。

---

## 怎么测

评分尽量走硬断言，judge 只处理无法可靠 grep 的开放判断。

| 证据 | 用来判断什么 |
|---|---|
| final source tree | 正确写法是否真的落进代码 |
| diff | 错误方案、旧依赖、无关重写是否出现 |
| build / tests | patch 是否能跑，不只会写文字 |
| tool calls / commands | 是否重复踩已知坑，是否按记忆直接走正确路径 |
| judge | 回答是否召回了“为什么”，例如被否方案的理由 |
| repeated runs | pass^k，看稳定性，不看偶然命中 |

核心原则：

1. **行动轨优先**：memory 是否有用，看最终行为，不看“检索到了吗”。
2. **正反都断言**：不只检查正确方案存在，也检查错误方案缺席。
3. **同模型对照**：模型能力固定，只换 agent / memory 条件，差异才干净。
4. **pass^k 而不是 pass@k**：memory 应该提高稳定复现率，不奖励多跑几次碰运气。
5. **eval 和 experiment 分层**：同一条 eval 可以被任何 memory system 重跑。

---

## 当前状态

当前仓库已经接通 fasteval、sandbox、agent adapter、diff 采集、build 验证、judge 和 compare experiment。已有 3 条从 `next-evals-oss` 迁来的 Next.js coding tasks，主要用于验证这套 TypeScript DSL 能覆盖真实 agent eval 的写法：

| eval | 来源 | 当前用途 |
|---|---|---|
| `memory/agent-029-use-cache-directive` | next-evals `agent-029` | 验证源码扫描、Server Action、cache tag 断言 |
| `memory/agent-030-app-router-migration-hard` | next-evals `agent-030` | 验证大迁移任务、文件删除、legacy API 缺席 |
| `memory/agent-037-updatetag-cache` | next-evals `agent-037` | 验证 read-your-own-writes 场景下的正确 cache invalidation |

这 3 条还不是最终 memory benchmark 的完整形态。它们是接通 runner 和评分面的第一批真实 coding tasks。下一步会把候选任务改造成真正的 memory tasks：既包括 **SWE 式长 bug fix / 长迁移任务**，也包括跨 session 续作任务。前者测会话内长程保持，后者测持久 memory 召回。

优先新增的两个真实来源样例：

- **会话内长程记忆**：Terminal-Bench 的 `swe-bench-astropy-1`。这是一个真实 SWE-bench Astropy bug，验证脚本会给 `test_separable.py` 打补丁并跑 pytest。它适合测长 bug fix 中 agent 能不能保留早期诊断出的矩阵组合语义，而不是后半段写出“测试碰巧过但语义漂移”的 patch。
- **跨会话持久记忆**：Terminal-Bench 的 `swe-bench-astropy-2`。这是一个真实 Astropy QDP parser bug，原 issue 来自 macOS / Clang / Python 3.10 复现，验证脚本会给 `test_qdp.py` 加 lowercase roundtrip case 并跑 pytest。评测层可以把它切成两段：会话 A 定位到 QDP commands 应该 case-insensitive，且 `NO` 数据 sentinel 也会被 lowercase 成 `no`；会话 B 清空上下文后继续实现。只记住第一个约束会漏掉第二个，测试仍会失败。

更多候选见 [docs/benchmarks.md](docs/benchmarks.md)。

---

## 运行

```sh
pnpm run list
pnpm run codex
pnpm run compare
pnpm run view
```

常用路径：

```sh
fasteval exp compare
fasteval --agent codex memory/agent-037-updatetag-cache
fasteval view
```

实验组织方式：

```txt
experiments/
└─ compare/
   ├─ bub-gpt-5.4.ts
   └─ codex-gpt-5.4.ts
```

后续 memory-system 对照会继续沿用这个形状，例如：

```txt
experiments/memory-backends/
├─ codex-none-gpt-5.4.ts
├─ codex-nowledge-gpt-5.4.ts
├─ codex-mem9-gpt-5.4.ts
├─ codex-db9-gpt-5.4.ts
└─ bub-tape-gpt-5.4.ts
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
├─ workspaces/             # per-eval starter repos
├─ docs/benchmarks.md      # SWE benchmark survey and candidate evals
└─ fasteval.config.ts      # agents, judge, sandbox defaults
```

---

## 为什么这也在推广 fasteval

Memory benchmark 是一个很好的 fasteval 展示面，因为它同时需要：

- 多轮对话和 `newSession()`。
- 沙箱里的真实 repo。
- final source / diff / tests / commands。
- LLM judge，但不能让 judge 承担所有评分。
- 多 agent、多 memory backend 的 experiment matrix。
- 可视化结果、成本、trace、失败原因。

这正好是 fasteval 的定位：用很少的 TypeScript，把 agent eval 从“脚本散落一地”变成可复现、可比较、能解释失败原因的 benchmark。

如果这套 benchmark 能公开展示不同 memory system 在真实 coding tasks 上的差异，它同时会说明两件事：

1. memory system 的价值不能只靠 demo，要靠稳定的行为结果证明。
2. fasteval 足够轻，能把这些对照实验快速落地。
