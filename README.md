# coding-agent-memory-evals

用 [fastevals](../fastevals) 写的一套**记忆能力**评测,跨三个 coding agent(**claude-code / codex / bub**)。

**这套件要回答一个具体问题**:bub 换上 tape 记忆机制后,在**长程、多轮开发**下效果到底有没有变好?
为此它不只是「写几条用例」——它是一个有方法论的小 benchmark,设计直接对标
[vercel/next-evals-oss](https://github.com/vercel/next-evals-oss)、[LongMemEval](https://arxiv.org/abs/2410.10813)、
[LoCoMo](https://arxiv.org/abs/2402.17753)、[τ-bench](https://arxiv.org/abs/2406.12045)。

---

## 核心论点

### 一、记忆有两种遗忘,两种都要测

记忆不是只有「多会话」。它有两种 regime,这套件**刻意都覆盖**(而且重心放在更被低估的前者):

- 🌀 **长程压缩(单会话)** —— 会话太长,上下文被**反复压缩 / 摘要**;一条早早定下的决定,得熬过这一次次压缩、在很后面被需要时还在。对 bub 来说这直接考 **tape 的 anchor(压缩检查点)**:压缩时把关键约束留下了吗?
- 🚪 **跨会话** —— `t.newSession()` 上下文清零,只有**落盘的持久记忆(tape handoff)**能跨过来。

> 早期版本几乎全用 `newSession`,漏掉了「长程压缩」这一半。现在 3 条里 **2 条是长程压缩、1 条是跨会话**。

### 二、承载点必须在【代码看不到的地方】

无论哪种 regime,要真考记忆(而不是「读代码重新推导」),探测点必须钉在一个**只在记忆里、盘上看不到**的事实上:
**被推翻的旧决定、说过但还没写进代码的规范、计划里还没做的部分、从没定过的值。**

- 能从盘上的代码推出来的,关了记忆的 agent 也能读盘推出来 → tape on/off 的 **delta 归零** → 既测不出记忆、也测不出 tape。
- next-evals-oss 那类任务是单轮的「跟随现有写法」=**从代码重新推导**,所以它的 prompt 不能直接用——
  但**它的场景是金矿**:每个都是「项目该用现代写法、模型先验却偏过时」(`proxy.ts` vs `middleware.ts`、Server Component vs `useEffect`…)。
  把「该用哪种写法」当成**项目决定**植入,再让它**熬过压缩 / 跨会话**,next-oss 的判断题就成了记忆题。

这和 [LongMemEval](https://arxiv.org/abs/2410.10813) 把证据埋进真实对话是同一套思路;长程那一半也对应 Anthropic 讲的「压缩要留住关键约束」。

---

## 3 条 eval(各极具代表性)+ 怎么验

从早期 10 条压到 3 条:每条代表一个**不可再约的记忆能力**,且**刻意覆盖两种 regime**(2 长程压缩 + 1 跨会话)。
被砍掉的 7 条不丢——失败模式 + 任务 + 验收都留在 [`docs/benchmarks.md`](docs/benchmarks.md) 的候选池里。
`id` 由路径推导(`…/knowledge-update.eval.ts` → `memory/knowledge-update`)。

| # | eval | 记忆能力 | 遗忘机制 | 任务(next-oss 场景) | 怎么验 |
|---|---|---|---|---|---|
| 1 | `retention-through-compaction` | 信息保持 | 🌀 长程压缩(单会话) | 早期定「金额一律整数分 cents、禁浮点」,连做 ~12 个无关真实功能(触发多次压缩),最后给购物车加合计 | ✅合计用整数分、`notInDiff(/parseFloat\|toFixed\(2\)\|\.\d{2}\b/)`、build 过 · 🔍`t.memory.recalled(/cents/)` · 🧪`t.memory.compactions()≥2`(确实压缩过) |
| 2 | `knowledge-update` | 更新 / 抗陈旧 · 压过模型先验 | 🌀 长程压缩 | **agent-031**:早讲「用 `proxy.ts` 弃 `middleware.ts`」,做一串真实活(压缩),最后加中间件 | ✅写进 `proxy.ts`、`notInDiff(/middleware\.ts/)`、`notCalledTool` 建 middleware.ts · 🧪决定与模型先验相反+盘上无可抄、`compactions()≥1` |
| 3 | `multi-session-synthesis` | 多源综合 / multi-hop | 🚪 跨会话(唯一一条) | 异步 `cookies()`(会A)+ cookie 名 `sid`(会B)→ 会C 写 `getCurrentUser` 合成 | ✅`t.file` 同含 `await cookies()`+`'sid'`、agent-judge 查真接线 · 🧪两条决定分散两会话、会C 都不在上下文 |

**横切验证**:tape on/off 配对 delta 是头号信号;报 pass^k;检索轨(`recalled`)与行动轨(diff)分开;每条都断言「错误答案缺席」;
长程类用 `t.memory.compactions()≥N` 证明真压缩过;tape 是否在发力,看 compare 组里 bub(tape)对 codex 的差异。

---

## 评分哲学(从这些 benchmark 抄来的硬规矩)

1. **能硬断言就别用 judge。** next-evals-oss 全程 vitest 硬断言、零 LLM-judge;τ-bench 比对数据库写入的哈希;
   SWE-bench 跑 pytest。本套件优先查 **sandbox 最终文件(`t.file(path)`)/ 改动(`t.diff` · `notInDiff`)/ 工具调用 / 构建**,
   judge 只用在「对不对靠规则说不清」的开放回答上(拒答语气、时序表述),且都是 `soft + 阈值`,不一票挂。
   正向内容查最终文件比查 diff 文本更稳(diff 带 +/− 前缀、hunk 头);「错误答案的缺席」才查 diff(只看改动)。
5. **judge 也能是个能进 sandbox 的 agent。** 有些事 text-only judge 看不到——比如「约定有没有在【整个代码库】贯彻」「跨会话合成是不是真接上了线」。
   `t.judge.agent(rubric)` 派一个独立评判 agent,给它**只读** sandbox 工具(list / read / grep),让它通读真实项目状态再给 0–1 分
   (借鉴 fastevals 失败分类器「给小模型只读探索工具」的做法)。它是 soft 质量分,硬断言仍当 gate——两层叠着用:gate 兜底正确性,agent-judge 抓全局漂移。
2. **断言「错误答案的缺席」,不止「正确答案的存在」。** 这是 next-evals-oss 的签名招式,也是反作弊的命门:
   `knowledge-update` 的真正考点是 `t.notInDiff(/middleware\.ts/)`,`retention-through-compaction` 的是「合计里没有浮点表示钱」。
3. **检索 / 行动 / 元数据,三轨分开。** 像 LongMemEval 把「检索到了吗」和「答对了吗」拆开:
   `t.memory.recalled(...)` 查事实是否真进了持久记忆(检索轨),diff 断言查产出的代码是否照做(行动轨);
   长程类再加一条元数据轨 `t.memory.compactions()≥N` —— 证明这一会话**真的压缩过**,否则它就不算「长程压缩」题。
   失败时能归因:没记住 / 记住了没用上 / 根本没触发压缩。
4. **报 pass^k,不报 pass@k。** 对标 τ-bench:`runs≥5 + earlyExit:false` 取完整分布。
   pass^k(k 次独立运行【全过】的概率)随 k **下降**,奖励的是**稳定复现**召回——这才是记忆机制该被衡量的样子。
   pass@k 会奖励「跑得多总有一次蒙对」,对记忆是错的指标。

---

## 实验怎么组织:一个文件夹 = 一组可对比的实验

eval(测什么)和 experiment(怎么跑)分开。experiment 的组织借了 next-evals-oss 的「一条件一文件」,
并用**文件夹**把「可比性」显式化:

```
experiments/
└─ compare/                  # 唯一一组可对比实验:同一模型下 bub vs codex
   ├─ bub-gpt-5.4.ts         #   单一配置,文件名 = <agent>-<model>;bub 默认 tape 开
   └─ codex-gpt-5.4.ts
```

- **文件夹 = 一组可对比的实验**;**同一文件夹下的文件才互相对比**。`fastevals exp compare` 跑整组。
- **文件 = 单一配置**,文件名按 `<agent>-<model>` 命名。两个配置钉**同一个模型(gpt-5.4)**,差异才干净地归因到 agent / 记忆机制。
- 为什么不用「一个文件里 `agent: [数组]` 扇出」?——**文件夹把「这一组就是要被并排比较的」这层语义说清楚了**
  (next-oss 的「一条件一文件」也是这个思路);数组扇出适合随手扫,但表达不了「可比性」。

### 验证 tape 真的有用

```sh
fastevals exp compare   # 同模型下 bub(带 tape)vs codex(无对应持久记忆机制)
fastevals view          # 并列看通过率 / pass^k / 质量×成本
```

- 两边**同模型(gpt-5.4)、同一批记忆 eval**,差异就落在 agent 与其记忆机制上。bub(tape)在记忆题上若**稳定高于** codex,就是 tape 价值的证据。
- 报 **pass^k**(`runs≥5 + earlyExit:false`):记忆要的是稳定复现,不是偶尔蒙对。
- **想要更硬的因果证据(tape 自身的净贡献)**:bub channel 留了 `noTape` 旗标,可临时跑一次「bub 关 tape」做 within-bub 的 A/B(`--flag noTape`),delta 即 tape 净贡献。本套件默认不把它作为常驻实验,保持实验集精简。

---

## 结构

```
coding-agent-memory-evals/
├─ fastevals.config.ts          # 注册 3 个 agent + 默认 workspace + judge + 超时
├─ agents/                      # 三个 coding agent 的 adapter(沙箱型,示意为主)
│  ├─ claude-code.ts            #   都只填 5 个 per-agent 差异点,其余复用 shared
│  ├─ codex.ts
│  └─ bub.ts                    #   多一个 noTape 旗标,供消融实验关掉 tape
├─ workspaces/next-app/         # 工作项目:最小 Next.js App Router 应用(承载 next-oss 风格的真实开发)
├─ evals/memory/                # 3 条 eval(见上表);无任何合成填充层
│  ├─ retention-through-compaction.eval.ts   # 🌀 长程压缩:精确约束熬过多次压缩
│  ├─ knowledge-update.eval.ts               # 🌀 长程压缩:proxy.ts 取代 middleware.ts、压过先验
│  └─ multi-session-synthesis.eval.ts        # 🚪 跨会话:两源合成
└─ experiments/compare/         # 唯一一组可对比实验:bub-gpt-5.4 vs codex-gpt-5.4(见上一节)
```

**eval(测什么)和 experiment(怎么跑)分开**是这套 DX 的关键:eval **agent 无关**(从不写死被测的是谁),
`--agent` 一换就测三个;experiment 才决定跑哪些 agent / 几次 / 预算 / flags。三类配置各归其位:
鉴权 / CLI 细节是 **agent 本地**配;**model 留空**由 experiment 给(`ctx.model`);**flags** 挂 experiment、
经 `ctx.flags`(agent)和 `t.flags`(eval)透传。

```sh
fastevals exp compare                    # 跑整组实验(bub vs codex)
fastevals --agent bub memory/retention   # 临时:只跑 id 以 memory/retention 开头的
fastevals view                           # 事后看图
```

---

## 诚实声明

- **fastevals 本身还没实现**(`../fastevals` 目前是设计文档)。所以这套件是「对着设计中的 DSL 写出来的、可读可评审的真实用例」,
  目的之一就是用最刁钻的多轮记忆场景去压这套 DSL,看它扛不扛得住(下面的 DX 反馈)。
- 几个 eval 用到了 DSL 里**尚待实现**的便利层(都列在下面 DX 反馈里,这里是真用上了):
  `t.memory.recalled(/…/)`、`t.memory.compactions()`(本会话压缩了几次)、读 sandbox 最终文件的 `t.file(path)`、
  可查询的 `t.diff`、`notCalledTool(name, { input })`、以及能进 sandbox 的 `t.judge.agent(rubric)`。
- `agents/*.ts` 的 CLI 名 / 参数 / 记忆路径是**按文档猜的形状**,真接各 agent 时按其 CLI 校正;
  bub 的 `BUB_TAPE_DISABLED` 同理——它把「关掉 tape」具体化成一个可操作的旗标,真实开关名以 bub 实现为准。
- **承载点放在【盘上看不到】的决定上,而不是靠塞满上下文**:这样即便会话不长也是真记忆题(代码里推不出答案)。
  长程压缩类的会话要足够长才会触发压缩——轮数按模型上下文调,并用 `t.memory.compactions()≥N` 把「真的压缩过」断言出来。
  默认实验是 bub(tape)对 codex 的同模型对比;想要 tape 自身净贡献的硬证据,可用 bub channel 的 `noTape` 旗标临时做 within-bub A/B。

---

## DX 反馈(对着 fastevals DSL 写这套件的产出)

### 顺手的地方 👍

1. **多轮就是顺着写。** `const ack = await t.send(...)` → 断言 → 再 `t.send(...)` → 断言,读起来就是一段对话剧本,没有样板。
2. **「agent 无关」的 eval 很值。** 一份 memory 用例,`--agent` 一换就测三个;写 eval 时完全不用想被测的是谁。
3. **gate / soft 分得清。** 行为类断言(`calledTool`、`notInDiff`)天然是 gate,质量类(`judge.closedQA`)天然是 soft。
4. **judge 写法自然。** `t.judge.closedQA("…", { on: ack.message }).atLeast(0.7)` 一行就把「确认语气」这种说不清的判断交出去了。
5. **配置归属清晰,agent 可复用。** 同一个 bub adapter,既能在 `compare/` 里默认 tape-on 跑,也能用 `noTape` 旗标临时关掉做 A/B,没改一行 agent。
6. **「文件夹 = 可对比组」很顺手。** experiment 按文件夹分组、一文件一配置(`<agent>-<model>-<feature>`),「哪些该并排比」直接由目录结构表达,比「一个文件塞数组」更说得清意图;配对 A/B(只差一行 flag)尤其清爽。

### 试出来的缺口 / 待定 ⚠️(给 fastevals 的需求)

1. **记忆探针要 agent 无关。** 私人记忆位置每个 agent 不同(`~/.claude` vs `~/.bub/tapes` …),eval 不该硬编码路径。本套件假设了 `t.memory.recalled(/.../)`,由各 adapter 的 `readMemory()` 归一化。**这是 memory 评测专门需要的能力位**(类似 transcript 的归一化)。
2. **`t.diff` 需要查询助手 + 直接读 sandbox 最终文件。** 用到了 `t.diff.get(path)` / `t.notInDiff(re)`(查改动),以及 `t.file(path)`(读 sandbox 里的最终文件内容)。正向内容断言查最终文件比查 diff 文本更稳(diff 带 +/− 前缀、hunk 头);「错误答案的缺席」才查 diff。建议:`t.diff` 做成可查询对象(`get` / `isEmpty` / `matches` / `notInDiff`),并正式提供 `t.file(path)` 作为 `t.sandbox.readFile` 的高层封装。
7. **agent-as-judge:能进 sandbox 的评判 agent。** 用到了 `t.judge.agent(rubric)` —— 派一个独立评判 agent,给它只读 sandbox 工具(list / read / grep),让它通读真实项目状态后给 0–1 分。text-only judge 看不到「约定有没有全项目贯彻」「跨会话合成是否真接上线」这类需要遍历代码库的判断。fastevals 失败分类器已经有「给小模型只读探索工具」的现成形状,把它提升成 eval 作者可用的 `t.judge.agent` 即可。
3. **多轮的会话语义要标准化。** 「同一 eval 的多轮 = 同沙箱 + resume」「`newSession()` = 新会话 + 同沙箱」是 memory 能测的前提。应在 Agent 契约里把 `session.id` / `session.isNew` 钉死,否则每个沙箱 adapter 各写各的。
4. **`notCalledTool` 要支持 options。** 写了 `b.notCalledTool("file_write", { input: { path: /Header/ } })`,需要和 `calledTool` 对齐,也接匹配小语言。
5. **`workspace` 字段要落到 `defineEval`。** 单条 eval 想换工作项目时需要 `defineEval({ workspace })`。
6. **judge 要能对「整段对话」打分。** 现在只能 `{ on: 某条 message }`;memory 有时想判「整段对话里它是否始终守约定」,需要 `t.judge.transcript(...)`。
7. **要能断言「上下文压缩」这个事件。** 长程压缩类的 eval 必须能确认「这一会话真的压缩过」,否则就退化成短会话。本套件假设了 `t.memory.compactions()`(本次运行发生的上下文压缩/anchor 次数),由各 adapter 归一化(bub = tape anchor 数)。**这是「长程压缩」regime 专属的能力位**。
8. **experiment 应支持「文件夹分组」。** 约定 `experiments/<组>/<配置>.ts`,`fastevals exp <组>` 跑整组、同组互为对照。`defineExperiment` 仍可用 `agent: [数组]` 扇出,但「可比性」交给目录表达更清楚。

> 结论:多轮记忆这个最刁钻的场景,**核心的 `t.send` / `judge` / `calledTool` / diff 完全扛得住**;真正缺的是几块 memory 专属便利层——归一化记忆探针(含 `compactions()`)、可查询 diff、能进 sandbox 的 agent-judge、标准化会话语义。补上这些,memory 评测就完全顺了。

## 参考

next-evals-oss · LongMemEval `2410.10813` · LoCoMo `2402.17753` · τ-bench `2406.12045` ·
Mem0 `2504.19413` · MemGPT/Letta `2310.08560` · Lost in the Middle `2307.03172` ·
Anthropic「effective context engineering / harnesses for long-running agents」
