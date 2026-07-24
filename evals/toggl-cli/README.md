# toggl-cli：一条「记忆决定通过」的计费规则链

七道题，同一个真实仓库（[CorrectRoadH/toggl-cli](https://github.com/CorrectRoadH/toggl-cli)，Rust CLI），
围绕「给公司搭一个内部计费系统」展开。链条跨多次会话，**计费规则累积在记忆里**，后面的题只说
「用我们的计费规则」而不重述。带记忆的条件能通过、不带记忆的通不过——这是这组题实测证明的核心。

## 为什么是「业务规则」而不是「格式约定」

这条链的前身是一组「格式约定」题（紧凑时长、默认今天、空结果处理）。实测（deepseek + codex）
证明它们在**通过制下体现不了记忆**：baseline 与 mempal 的 pass/fail 完全一样。`niceeval show
--execution` 暴露了两个死因：

1. **反直觉的约定被漏存**：「默认今天(≠report 的本周一)」这条，agent 存记忆时根本没存进去——
   它自己都没意识到这值得记。后面的题召回不到，照仓库现状做了。
2. **与仓库冲突的召回了也压不过**：「紧凑时长」召回到了，但实现出来还是照抄了满仓库的 `H:MM:SS`
   ——仓库现状的引力压过了记忆。

结论：**记忆要放在「任务核心的业务规则」上，而不是边角的格式约定**。一条计费规则（每条时长按
15 分钟向上取整）同时治好这两个死因，还满足「真实、不贴判据」：

| | 为什么 |
|---|---|
| 是任务核心（算错整个数字就错） | agent **必然主动存**，不会漏 |
| 仓库里没有计费逻辑可抄 | 召回后**没有引力对抗** |
| 无自然默认（默认会精确求和） | 无记忆**必然算错** → 干净的 fail |
| 判据只看最终金额 | **不锁实现**（整数除法/ceil 都行）→ 真实开发任务 |

## 链条设计（做功能 + 问功能混合）

记忆承载两条累积的计费规则：**R-round**（每条按 15 分钟向上取整、只算 billable，第 2 题建立）、
**R-min**（30 分钟最低计费额，第 5 题建立）。

| 题 | 类型 | 命令 / 问题 | 记忆承载 | 是否靠记忆 |
|---|---|---|---|---|
| 01 | 做 | `entry stats` | — | 控制点(保留) |
| 02 | 做 | `entry bill` | 建立 R-round | 控制点 |
| 03 | 做 | `entry bill-weekly` | 依赖 R-round | ★ |
| 04 | **问** | "给新同事写文档，我们 bill 怎么算？" | R-round | ★ |
| 05 | 做 | `entry invoice` | 建立 R-min（自包含 R-round） | 控制点 |
| 06 | 做 | `entry invoice-monthly` | 依赖 R-round + R-min | ★ |
| 07 | **问** | "客户 7min+40min 该开多少？" → 60min | R-round | ★ |

**「问功能」题（04/07）** 是最纯粹的记忆题：不 clone 仓库、不写代码，agent 在空沙箱里被问「我们
的规则是什么」/「按规则算是多少」。它没有任何代码可读，唯一信息来源就是记忆——无记忆只能诚实说
「答不出」，判据看回答（`includes` + judge）。这类题最真实（给同事写文档、心算报价是日常）、也最不
「贴」。

## 实测证据（2026-07-24，codex · gpt-5.6-luna）

清空记忆库后跑三条件对比。核心翻转对**两种不同的记忆机制**都成立：

| eval | 类型 | baseline（无记忆） | mempal | nowledge |
|---|---|---|---|---|
| 02-entry-bill | 控制点 | — | **passed** | **passed** |
| **03-entry-bill-weekly** | 做功能 | **failed** | **passed** ★ | **passed** ★ |
| **04-billing-doc** | 问功能 | **failed** | **passed** ★ | **passed** ★ |

因果链清清楚楚：
- **03 baseline** 算出 `[1800,1860]` / total `3660` —— 正是「精确求和、没取整」；两个记忆条件都召回规则算出 `5400`。
- **04 baseline** 直接答 *"I can't verify the rule because the workspace contains no repository..."*；
  两个记忆条件各用各的 CLI 召回同一条规则——mempal 跑 `mempal search`、nowledge 跑 `nmem ... search`，
  都拿到 **"quarter-hour billing rule"** 后答对。

**这是比「某个记忆实现能过」更强的结论**：mempal（agent 主动跑 CLI 存取）和 nowledge（中心化 server +
自动 hooks）机制迥异,却都翻转了同样的题——记忆价值来自**题目设计本身**,而非某个记忆机制的特例。
同一个 codex 模型,无记忆过不了、有记忆能过,做功能 + 问功能两种题型都如此。05/06/07（R-min + 算术）
机制同构、判据本地三向验证过,可按需补跑。

## 判据：黑盒探针，不碰实现内部

做功能题:`_support/probe.py` 起一个假的 Toggl API（`TOGGL_API_URL` 指过去，`TOGGL_DISABLE_HTTP_CACHE=1`
关缓存），跑真二进制，回收每条命令的 stdout / exit code / 请求 URL；断言写在 `.eval.ts` 里，只看最终
计费数字。问功能题:直接 `t.send` 问题、判 `t.reply`，不碰实现。两者都不引用 agent 未被告知的内部
标识符。

## 三向验证（做功能题）

- **RED**：精确求和（模拟无记忆不懂规则）→ 数字错 → 判据挂
- **GREEN**：15 分钟向上取整（+30 分钟最低额）→ 数字对 → 过
- **ALT**：换取整写法（整数除法 → f64 ceil）→ 依然过，确认判据不锁实现

05 的判据还专门区分了三档：只取整=3600、都不懂=2820、取整+最低额才=4500——把「记住几条规则」
拆得开。

## 运行环境

Rust 工具链和系统依赖（`libdbus-1-dev` / `libssl-dev` / `pkg-config`）由 `harness.ts` 的
`installRustToolchain` 以 root 装进 `/usr/local`，属于 `eval.setup`，不进 agent diff。依赖首次编译在
`prepareRepo` 里预热掉。cargo 的 target 目录重定向到 `/opt`（不能是 workdir——1GB 产物会拖垮 diff
捕获；也不能是 `/tmp`——若是 tmpfs 会把沙箱 OOM），并关掉 debug symbols 压小体积。单题 `timeoutMs`
放宽到 30 分钟。问功能题（04/07）不 clone、不编译，跑得快、便宜。

**codex provider 的并发上限实测为 1**——baseline 并发跑会撞 `Concurrency limit` 丢数据，必须串行
（`--max-concurrency 1`，且 baseline 与 mempal 不能同时跑）。mempal 本就 `maxConcurrency: 1` 串行。
