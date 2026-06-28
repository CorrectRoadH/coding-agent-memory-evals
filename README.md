# coding-agent-memory-evals

用 [fastevals](../fastevals) 写的一套**记忆能力**评测,跨三个 coding agent(**claude-code / codex / bub**)。

**这套件要回答一个具体问题**:bub 换上 tape 记忆机制后,在**长程、多轮开发**下效果到底有没有变好?
为此它不只是「写几条用例」——它是一个有方法论的小 benchmark,设计直接对标
[vercel/next-evals-oss](https://github.com/vercel/next-evals-oss)、[LongMemEval](https://arxiv.org/abs/2410.10813)、
[LoCoMo](https://arxiv.org/abs/2402.17753)、[τ-bench](https://arxiv.org/abs/2406.12045)。

---

## 核心论点:记忆的承载点必须在【代码看不到的地方】

很多「记忆 eval」是**第 1 轮立约定 → 第 2 轮就用**。这测不出记忆——约定还躺在上文里,没记忆机制的 agent 也能过。
我一开始的修法是在中间塞「干扰轮」凑长度(gap),但那是**合成填充**,不是真实开发,也不对味。

真正的关键是另一件事:**让后面那一步依赖一个「代码里看不到、只存在记忆里」的决定。**

- next-evals-oss 那类任务是单轮的「跟随现有写法」——而「跟随现有写法」恰恰是**从代码重新推导**:
  agent 读一眼盘上的文件就知道该怎么写,根本不用记。**能从代码推导出来的,就不是记忆题。**
- 所以这套件每条 eval 都是**一次真实的多轮开发**(搭 API client、建组件、写 ADR…),跨一个**真实的会话边界**
  (`t.newSession()`,就是「第二天接着做」),而探测点钉在一个盘上找不到的事实上:
  **计划里还没做的部分、被推翻的旧选择、说过但还没写进代码的规范、密钥的归属地、从没定过的值。**
- 这同时也是 tape on/off 能拉开差距的原因:**关了 tape 的 bub 能读盘上的文件,却读不到只在记忆里的决定。**
  要是承载点能从代码推出来,tape-off 也能过,delta 归零——既测不出记忆、也测不出 tape。

> 不再用合成 gap;**真实会话边界**就是天然的「缺口」——它保证植入的事实确已离开上下文,且本身就是真实开发的一部分。

这和 [LongMemEval](https://arxiv.org/abs/2410.10813) 把证据埋进真实对话、并测「abstention(没说过就别编)」是同一套思路。

---

## 10 条 eval,按记忆失败模式划分

每条对准一个**不同的**失败模式(分类骨架来自 LongMemEval 的五维 + 长上下文 + 持久化扩展),
都是**一次真实开发**,跨真实会话边界。`id` 由路径推导(`evals/memory/knowledge-update.eval.ts` → `memory/knowledge-update`)。

| eval | 失败模式 | 真实任务 | 记忆承载点(盘上看不到) | 怎么判 / 出处 |
|---|---|---|---|---|
| `cross-session-persistence` | 跨会话续作 | 按计划建 5 个组件,做掉 3 个→新会话续作 | 计划里【还没做的那两个】 | 正好补 UserBadge/ChangelogBanner、不重做、不误判完工 · Anthropic long-running harness |
| `deferred-spec-recall` | 精确规范延后落地 | 搭 API client,先骨架、超时/重试下次加 | 说过但【还没写进代码】的 8000ms / 2 次 | 新会话补的逻辑用 8000/2,无别的默认值 · LongMemEval info-extraction |
| `knowledge-update` | 旧值被取代 | 用 date-fns 写,再宣布弃用、改原生(暂不动码) | 那条「弃 date-fns 改原生」的决定(与盘上代码相反) | 重构后用原生,**date-fns 彻底不出现** · Mem0 UPDATE |
| `temporal-reasoning` | 决策先后 | 选型几经变更→新会话写 ADR | 决策的【历史与顺序】(代码只反映当前) | ADR 写对「先 Redux、后 Zustand」 · LongMemEval/LoCoMo temporal |
| `recall-under-interference` | 干扰下精确检索 | 登记 4 个相似 env 名→新会话接其一 | 那张【还没接线】的 env 登记表 | Sentry 初始化用 SENTRY_DSN,不串兄弟项 · LoCoMo single-hop |
| `abstention` | 拒答 / 不编造 | 搭登录骨架→新会话设「之前定的」过期时间 | 一个【从没定过】的值 | 承认没定过、请求澄清,**不编数值** · LongMemEval abstention |
| `convention-applied-in-diff` | 复述≠落地 · 无先例 | 先立「禁 default 导出」规矩→新会话写第一个模块 | 规矩本身(没写进任何文件、无代码先例可抄) | **看产出**:具名导出在、`export default` 不在 · next-evals-oss「断言错误缺席」 |
| `multi-session-synthesis` | 多会话综合 | 三个会话分别定 base URL / token / 合成 | 分散两会话、都【没接线】的两条决定 | request() 同时用上 API_BASE_URL + Bearer · LongMemEval multi-session |
| `selective-forgetting-scope` | 范围辨别 · 不过度泛化 | 立全局 JSDoc 规矩 + legacy 豁免→新会话碰两文件 | 规矩的【适用范围】(盘上看不出规矩存在) | 新文件有 JSDoc、被豁免的 legacy 不被强加 · 记忆「作用域」 |
| `private-memory-stays-private` | 私密 · 记来源不泄露 | 定密钥习惯+搭 config→新会话写带 key 的功能 | 密钥归属地 1Password(永不进盘) | 从 env 取、点名 1Password,**明文密钥绝不进 diff** | 

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
- **delta ≈ 0**的 eval(承载点其实能从代码推出来的)说明那条题没真考记忆——反过来帮你校准承载点设计。
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
├─ evals/memory/                # 10 条 eval,一条一个失败模式(见上表);无任何合成填充层
│                               #   每条 = 一次真实开发,跨 t.newSession() 的真实会话边界
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
- **不靠「塞满上下文」来制造缺口**:每条 eval 把记忆承载点放在【盘上看不到】的决定上,再跨一个真实会话边界。
  这样即使会话不算很长,也是真记忆题(代码里推不出答案);要更狠可以把每条的真实开发拉长到 N 步。
  消融 A/B 也不依赖「一定塞满」——只要 tape-off 这条线确实没有跨会话记忆,delta 就成立。

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
