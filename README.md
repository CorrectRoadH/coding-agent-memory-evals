# coding-agent-memory-evals

用 [fastevals](../fastevals) 写的一套**记忆能力**评测,跨三个 coding agent(**claude-code / codex / bub**)。

**这套件要回答一个具体问题**:bub 换上 tape 记忆机制后,在**长程、多轮开发**下效果到底有没有变好?
为此它不只是「写几条用例」——它是一个有方法论的小 benchmark,设计直接对标
[vercel/next-evals-oss](https://github.com/vercel/next-evals-oss)、[LongMemEval](https://arxiv.org/abs/2410.10813)、
[LoCoMo](https://arxiv.org/abs/2402.17753)、[τ-bench](https://arxiv.org/abs/2406.12045)。

---

## 核心论点:大多数「记忆 eval」其实在测上下文,不是记忆

一种很常见的写法:**第 1 轮立约定 → 第 2 轮就用**。这测不出记忆——约定还躺在上文里,
一个**完全没有记忆机制**的 agent 也能过。要看出记忆,植入的事实必须**已经离开实时上下文**。

所以这套件每条 eval 都是三段式:

```
Plant(植入)  →  Gap(缺口)  →  Probe(探测)
```

- **Gap 用真实开发任务,不用合成填充。** 对标 next-evals-oss——它每个 case 都是真实编码任务。
  缺口是一串**真实的、自包含的功能开发**(`evals/_support/gap.ts` 的 `realWork`:建组件、加工具函数、调配置、做代码审查…),
  让整段对话像一次真实的长跑开发:早期定个决定,中间做几件真实的活(决定进入休眠),后面一个真实任务必须把它捞回来。
  这正是现实里的失败:「很多轮以前定的事,现在忘了」。跨会话的题则直接用 `t.newSession()` 作缺口。
- **缺口任务避开被测决定那条轴**(`realWork` 的 `avoid`),否则就成了「你 1 轮前刚做过同一件事」而不是记忆测试:
  测「日期库」就用建 UI 组件来填,测「具名导出」就用文档 / 配置 / 代码审查来填。
- 跨过缺口还能答对的,只可能是**真的记住了**(对 bub 就是 tape 的 anchor / handoff / search)。

这正是 [LongMemEval](https://arxiv.org/abs/2410.10813) 的 haystack 思路(把证据埋进真实对话里),也是下文 tape 消融实验能测出差异的前提。

---

## 10 条 eval,按记忆失败模式划分

每条对准一个**不同的**失败模式(分类骨架来自 LongMemEval 的五维 + 长上下文 + 持久化扩展),
都是多轮对话,都带真实缺口。`id` 由路径推导(`evals/memory/knowledge-update.eval.ts` → `memory/knowledge-update`)。

| eval | 失败模式 | 缺口(真实任务) | 怎么判(行动轨) | 出处 |
|---|---|---|---|---|
| `cross-session-persistence` | 跨会话持久 ·「接着上次继续」 | newSession | 正好补齐清单剩余两个、不重做已完成、不误判完工(+ agent-judge 查 sandbox) | Anthropic long-running harness |
| `long-horizon-recall` | 长程精确提取 / lost-in-the-middle | 6 件真实功能(不碰后端) | 限流值仍是 100,且无其它默认值 | LongMemEval info-extraction;[2307.03172](https://arxiv.org/abs/2307.03172) |
| `knowledge-update` | 知识更新 · 旧值被取代 | 5 件真实功能(不碰日期) | 用 dayjs,且 **date-fns 彻底不出现** | LongMemEval knowledge-update;Mem0 UPDATE |
| `temporal-reasoning` | 时序推理(先 / 后) | 5 件真实功能 | 区分「最早 Redux / 现在 Zustand」 | LongMemEval temporal;LoCoMo temporal |
| `recall-under-interference` | 干扰下精确检索 | 4 条相似约定 + 5 件真实功能 | API 落到 `src/api/client.ts`,不串到兄弟约定 | LoCoMo single-hop |
| `abstention` | 拒答 / 不编造 | 5 件真实功能 | 承认「从没约定过」并请求澄清,**不编数值** | LongMemEval abstention |
| `convention-applied-in-diff` | 复述 ≠ 落地 | 5 件真实活(文档/配置/审查) | **看产出**:具名导出在、`export default` 不在(+ agent-judge 查全项目贯彻) | next-evals-oss「断言错误答案缺席」 |
| `multi-session-synthesis` | 多会话综合 / multi-hop | 跨 3 个会话 | fetch 封装同时用上 A 的 base URL + B 的 token(+ agent-judge 查接线) | LongMemEval multi-session;LoCoMo multi-hop |
| `selective-forgetting-scope` | 范围辨别 · 不过度泛化 | 5 件真实功能 | 全局规则套到新文件;一次性例外不泄漏(+ agent-judge 查规则+例外) | 记忆的「写入与作用域」 |
| `private-memory-stays-private` | 私密 ·「记得来源、绝不泄露」 | 5 件真实功能 + newSession | 从 env 取密钥、点名 1Password;**明文密钥绝不进 diff**(+ agent-judge 查无硬编码) | — |

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
   `knowledge-update` 的真正考点是 `t.notInDiff(/date-fns/)`,`convention-applied-in-diff` 的是「新文件里没有 `export default`」。
3. **检索 vs 行动,两轨分开。** 像 LongMemEval 把「检索到了吗」和「答对了吗」拆开:
   `t.memory.recalled(...)` 查事实是否真进了持久记忆(检索轨),diff 断言查产出的代码是否照做(行动轨)。
   失败时能归因:到底是没记住,还是记住了没用上。
4. **报 pass^k,不报 pass@k。** 对标 τ-bench:`runs≥5 + earlyExit:false` 取完整分布。
   pass^k(k 次独立运行【全过】的概率)随 k **下降**,奖励的是**稳定复现**召回——这才是记忆机制该被衡量的样子。
   pass@k 会奖励「跑得多总有一次蒙对」,对记忆是错的指标。

---

## 怎么验证 tape 真的有用:消融 A/B

光看「bub 通过率高不高」不够——分不清是模型本身强,还是 tape 在起作用。
所以做**配对消融**(对标 next-evals-oss 的 `<model>` vs `<model>--agents-md` delta):

```sh
fastevals exp tape-ablation   # treatment:bub 开 tape + claude-code/codex 参照
fastevals exp tape-off        # floor:同一批 eval,bub 关掉 tape(flags.noTape)
fastevals view                # 并列看通过率 / pass^k / 质量×成本
```

逐 eval 相减:

```
delta(eval) = passRate(bub, tape on) − passRate(bub, tape off)
```

- **delta 大**的 eval = tape 真正在发力的地方(跨会话、长程召回)。这是 tape 的**净贡献**,且是因果证据:除 tape 外全相同。
- **delta ≈ 0**的 eval(本来就不依赖记忆的)反过来验证了缺口设计——证明 delta 不是噪声。
- **claude-code / codex** 是外部参照系:bub+tape 站在业界 coding agent 的什么位置。

> **上限(Oracle)/ 下限(floor)的读法**:`tape-off` 是下限(零持久记忆)。要上限可在实验的 `setup` 里
> 把植入的事实**预置**进 agent 记忆位置(免检索的理想态);Oracle 与真实运行的差,就是「检索 / 压缩」环节的损耗。
> 本套件先落地最关键的那条因果链(下限 A/B),Oracle 作为方法记在这里。

---

## 结构

```
coding-agent-memory-evals/
├─ fastevals.config.ts          # 注册 3 个 agent + 默认 workspace + judge + 超时
├─ agents/                      # 三个 coding agent 的 adapter(沙箱型,示意为主)
│  ├─ claude-code.ts            #   都只填 5 个 per-agent 差异点,其余复用 shared
│  ├─ codex.ts
│  └─ bub.ts                    #   多一个 noTape 旗标,供消融实验关掉 tape
├─ workspaces/react-greeting/   # 通用工作项目(最小 React/TSX 应用,agent 在它上面干活)
├─ evals/
│  ├─ _support/gap.ts           # ★ 记忆缺口:真实开发任务池 + realWork(承重墙,按轴避让)
│  └─ memory/                   # 10 条 eval,一条一个失败模式(见上表)
└─ experiments/                 # 运行矩阵(怎么跑),不掺评分
   ├─ tape-ablation.experiment.ts   # ★ tape 开(treatment)+ 参照
   ├─ tape-off.experiment.ts        # ★ tape 关(floor)—— 配对 A/B
   ├─ compare-agents.experiment.ts  # 三 agent 质量×成本对比
   ├─ research-mode.experiment.ts   # opus + 联网 + 严格模式(演示 model/flags)
   └─ claude-smoke.experiment.ts    # claude 单跑冒烟
```

**eval(测什么)和 experiment(怎么跑)分开**是这套 DX 的关键:eval **agent 无关**(从不写死被测的是谁),
`--agent` 一换就测三个;experiment 才决定跑哪些 agent / 几次 / 预算 / flags。三类配置各归其位:
鉴权 / CLI 细节是 **agent 本地**配;**model 留空**由 experiment 给(`ctx.model`);**flags** 挂 experiment、
经 `ctx.flags`(agent)和 `t.flags`(eval)透传。

```sh
fastevals exp tape-ablation              # 跑实验(推荐)
fastevals --agent bub memory/knowledge   # 临时:只跑 id 以 memory/knowledge 开头的
fastevals exp claude-smoke               # 快速冒烟
fastevals view                           # 事后看图
```

---

## 诚实声明

- **fastevals 本身还没实现**(`../fastevals` 目前是设计文档)。所以这套件是「对着设计中的 DSL 写出来的、可读可评审的真实用例」,
  目的之一就是用最刁钻的多轮记忆场景去压这套 DSL,看它扛不扛得住(下面的 DX 反馈)。
- 几个 eval 用到了 DSL 里**尚待实现**的便利层(都列在下面 DX 反馈里,这里是真用上了):
  `t.memory.recalled(/…/)`、读 sandbox 最终文件的 `t.file(path)`、可查询的 `t.diff`、
  `notCalledTool(name, { input })`、以及能进 sandbox 的 `t.judge.agent(rubric)`。
- `agents/*.ts` 的 CLI 名 / 参数 / 记忆路径是**按文档猜的形状**,真接各 agent 时按其 CLI 校正;
  bub 的 `BUB_TAPE_DISABLED` 同理——它把「关掉 tape」具体化成一个可操作的旗标,真实开关名以 bub 实现为准。
- 缺口的**轮数(默认 12~14)**要按被测模型的上下文长度调:窗口越大,塞满它需要的干扰轮越多。
  但消融 A/B 不依赖「一定塞满」——只要 tape-off 这条线确实没有跨轮记忆,delta 就成立。

---

## DX 反馈(对着 fastevals DSL 写这套件的产出)

### 顺手的地方 👍

1. **多轮就是顺着写。** `const ack = await t.send(...)` → 断言 → 再 `t.send(...)` → 断言,读起来就是一段对话剧本,没有样板。
2. **「agent 无关」的 eval 很值。** 一份 memory 用例,`--agent` 一换就测三个;写 eval 时完全不用想被测的是谁。
3. **gate / soft 分得清。** 行为类断言(`calledTool`、`notInDiff`)天然是 gate,质量类(`judge.closedQA`)天然是 soft。
4. **judge 写法自然。** `t.judge.closedQA("…", { on: ack.message }).atLeast(0.7)` 一行就把「确认语气」这种说不清的判断交出去了。
5. **配置归属清晰,agent 可复用。** 同一个 bub adapter 被 `tape-ablation` 和 `tape-off` 两个实验以不同 flags 复用,没改一行 agent —— 消融 A/B 几乎是免费的。

### 试出来的缺口 / 待定 ⚠️(给 fastevals 的需求)

1. **记忆探针要 agent 无关。** 私人记忆位置每个 agent 不同(`~/.claude` vs `~/.bub/tapes` …),eval 不该硬编码路径。本套件假设了 `t.memory.recalled(/.../)`,由各 adapter 的 `readMemory()` 归一化。**这是 memory 评测专门需要的能力位**(类似 transcript 的归一化)。
2. **`t.diff` 需要查询助手 + 直接读 sandbox 最终文件。** 用到了 `t.diff.get(path)` / `t.notInDiff(re)`(查改动),以及 `t.file(path)`(读 sandbox 里的最终文件内容)。正向内容断言查最终文件比查 diff 文本更稳(diff 带 +/− 前缀、hunk 头);「错误答案的缺席」才查 diff。建议:`t.diff` 做成可查询对象(`get` / `isEmpty` / `matches` / `notInDiff`),并正式提供 `t.file(path)` 作为 `t.sandbox.readFile` 的高层封装。
7. **agent-as-judge:能进 sandbox 的评判 agent。** 用到了 `t.judge.agent(rubric)` —— 派一个独立评判 agent,给它只读 sandbox 工具(list / read / grep),让它通读真实项目状态后给 0–1 分。text-only judge 看不到「约定有没有全项目贯彻」「跨会话合成是否真接上线」这类需要遍历代码库的判断。fastevals 失败分类器已经有「给小模型只读探索工具」的现成形状,把它提升成 eval 作者可用的 `t.judge.agent` 即可。
3. **多轮的会话语义要标准化。** 「同一 eval 的多轮 = 同沙箱 + resume」「`newSession()` = 新会话 + 同沙箱」是 memory 能测的前提。应在 Agent 契约里把 `session.id` / `session.isNew` 钉死,否则每个沙箱 adapter 各写各的。
4. **`notCalledTool` 要支持 options。** 写了 `b.notCalledTool("file_write", { input: { path: /Header/ } })`,需要和 `calledTool` 对齐,也接匹配小语言。
5. **`workspace` 字段要落到 `defineEval`。** 单条 eval 想换工作项目时需要 `defineEval({ workspace })`。
6. **judge 要能对「整段对话」打分。** 现在只能 `{ on: 某条 message }`;memory 有时想判「整段对话里它是否始终守约定」,需要 `t.judge.transcript(...)`。

> 结论:多轮记忆这个最刁钻的场景,**核心的 `t.send` / `judge` / `calledTool` / diff 完全扛得住**;真正缺的是三块 memory 专属便利层——归一化记忆探针、可查询 diff、标准化会话语义。补上这三块,memory 评测就完全顺了。

## 参考

next-evals-oss · LongMemEval `2410.10813` · LoCoMo `2402.17753` · τ-bench `2406.12045` ·
Mem0 `2504.19413` · MemGPT/Letta `2310.08560` · Lost in the Middle `2307.03172` ·
Anthropic「effective context engineering / harnesses for long-running agents」
