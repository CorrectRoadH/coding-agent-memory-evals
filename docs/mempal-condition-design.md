# mempal 记忆条件:设计文档

日期:2026-07-08。状态:已定稿,待实现。v2:新增「跨 eval 记忆共享」(§记忆状态共享)——
没有它,每个沙箱空库起步,记忆条件等于没测。

## 目标

把 [mempal](https://github.com/ZhangHanDong/mempal)(单二进制 Rust 记忆 CLI:SQLite `~/.mempal/palace.db` + BM25/向量混合检索 + MCP server)作为一个**记忆条件**接进 compare 实验矩阵,给 claude-code 和 codex 各出一个 `--mempal` 变体,与各自基线同题对比 pass 率与效率。

## 硬约束(全部实测过,别推翻)

1. **模板不动**。沙箱模板(`fasteval-agents`)保持现状,mempal 的安装完全由实验自己的 `agent.setup()` 完成。这是明确的产品决策:记忆条件是实验的事,不是基础设施的事。
2. **mempal 无预编译 release**(GitHub releases 的 assets 为空),只能 `cargo install mempal`(crates.io v0.7.0)。沙箱内现场 rustup + cargo 编译要 3-6 分钟/沙箱,不可接受 → 必须 host 侧一次性构建、setup 时上传。
3. **二进制很小**:本机 arm64 release 构建产物仅 9.8MB,`sb.uploadFile(path, Buffer)` 上传是秒级,per-sandbox 上传完全可行。
4. **HF_HOME 不生效**(mempal 0.7.0 实测):embed 模型 `minishlab/potion-multilingual-128M`(~514MB)在首次 embed 时下载,只认 `$HOME/.cache/huggingface`,设 HF_HOME 环境变量没用。
5. **codex hooks flag 随版本变名**:mempal 文档说 `codex features enable codex_hooks`,但 codex-cli 0.142.5 里叫 `hooks` 且 stable 默认开。两个名字都要 best-effort 试,并把 `codex features list | grep -i hook` 记进 ctx.log。
6. **不 hardcode 任何用户 home 路径**(docker 后端是 node 用户、e2b 是 user、vercel 是 vercel-sandbox)。沙箱内一律 `$HOME` / `~`(`shared.writeFile` 会展开 `~`)。
7. **绝不裸跑 `niceeval exp`**——不带实验名它会直接跑全矩阵(计费)。实现过程中验证只允许 tsx import 检查 + `pnpm typecheck`,不跑任何 eval。

## 架构

```
host(一次性)                          sandbox(每个 attempt 的 agent.setup)
─────────────                         ────────────────────────────────────
scripts/build-mempal-linux.sh          withMempal(base, tool).setup:
  docker run --platform linux/amd64      1. command -v mempal ? 跳过安装
  node:24-slim(与模板同基底,ABI 一致)     : 读 .cache/mempal/mempal(host fs)
  rustup + cargo install mempal              → sb.uploadFile(/tmp/mempal)
  → 产物落 .cache/mempal/mempal              → root: install -m755 到 /usr/local/bin
  (gitignored,~10MB)                    2. 预热模型:假 ingest 触发 HF 下载到
                                            $HOME/.cache/huggingface(~514MB,
                                            数据中心带宽,秒~分钟级);完了删
                                            $HOME/.mempal 让 agent 从空库开始
                                         3. mempal init .(建空 palace.db)
                                         4. 按 tool 装 hook(见下)
```

MCP 注册由 helper 的 setup 自己做,**不走 adapter 的 mcpServers 参数**:niceeval ≤0.4.4
两个 adapter 都写错了位置(codex 写单数 `[mcp_server.x]`,正确是复数 `[mcp_servers.x]`;
claude 写不存在的 `~/.claude/claude.json`,正确是用户级 `~/.claude.json` 顶层
`mcpServers`),两家 CLI 静默忽略错误配置——首轮验证 run 里 codex 全程 0 次 mempal
调用就是这么发现的。上游已在 ../fastevals 修复(待发版);helper 自注册与修复后的
adapter 写同一份配置,无冲突。

## 记忆状态共享(跨 eval / 跨 run 累积)

**问题**:沙箱是 per-attempt 一次性的,palace.db 随沙箱销毁。九道 eval 各自空库起步,
agent 存进去的决策永远没有下一个消费者——记忆条件形同虚设。

**机制**:把 `$HOME/.mempal`(palace.db + audit.jsonl)在 host 上按实验为 key 持久化,
经 setup/teardown 往返:

```
setup(载入):  host .cache/mempal/state/<stateKey>.tgz 存在?
                → sb.uploadFile + tar -xzf 到 $HOME(替代 mempal init 空库)
                : mempal init 空库起步
teardown(回存): tar -C $HOME -czf /tmp/… .mempal → sb.downloadFile
                → host 原子写回 state/<stateKey>.tgz(先写 .tmp 再 rename)
```

要点:

1. **互斥**:attempt 的 [载入 … 回存] 是临界区。并发 attempt 交错会丢更新
   (A 载入 → B 载入旧态 → A 回存 → B 回存覆盖 A)。niceeval ≤0.4.4 的实验级
   maxConcurrency 是全局钳制(取所有选中实验的最小值),设 1 会把整批基线拖成串行,
   不可用 → helper 内做**模块级 per-stateKey promise 互斥锁**:setup 载入前取锁,
   teardown 回存后放锁;setup 中途抛错也必须放锁(否则 runner 不调 teardown,锁死
   后续 attempt)。代价:并发>1 时 mempal 条件的 attempt 会排队(沙箱空转等锁)。
   **2026-07-10 上游已改**(fastevals main,待发版):`ExperimentDef.maxConcurrency`
   变为按实验单独限流(runner 两级信号量),同批其它实验不受影响——发版并 bump 后,
   mempal 实验直接声明 `maxConcurrency: 1`,本 helper 的锁整个退役(见 §遗留)。
2. **stateKey 按实验隔离**:claude 条件和 codex 条件各自积累,互不泄漏
   (`"claude-dp-v4--mempal"` / `"codex-gpt-5.4--mempal"`),由实验文件显式传入。
3. **累积语义**:同一次 run 内按 eval 顺序累积(discoverEvals 按文件名排序,
   并发 1 时顺序确定);跨 niceeval 调用也累积(host 文件常驻)——包括 runs>1 /
   pass^k 重跑,「第二次见到同一道题」正是记忆条件最该赢的场景。
4. **结果解读要带状态出处**:eval N 的表现依赖 eval 1..N-1 乃至历史 run 的记忆,
   这是被测条件的固有属性,不是缺陷;但做「干净」对照前要
   `rm -rf .cache/mempal/state/` 重置,报告里注明状态起点(空库/带积累)。
5. **不防跨进程并发**:两个 niceeval 进程同时跑同一实验不受保护——本 repo 工作流
   不存在这种用法,不为它加文件锁。
6. teardown 只在 agent setup 成功后由 runner 在 finally 调(attempt.ts:413),
   回存 best-effort:失败记 log 不改判决。

## Hook 设计(两端不对称,是 mempal 本身的形态)

- **claude-code**:用户级 `~/.claude/settings.json` 挂 Stop hook(脚本
  `~/.claude/hooks/mempal-stop.sh`)。行为:session 每次收尾 block 一次,提示 agent 把本
  session 关键决策经 `mempal_ingest` MCP 工具落库;靠 stdin JSON 里的 `stop_hook_active`
  防死循环(被 block 后的下一次 stop 放行)→ 每 session 恰好触发一次。写用户级而非
  workspace 级:躲开 eval `uploadDirectory` 覆盖与 diff 捕获噪音。
- **codex**:`~/.codex/hooks.json` 挂 UserPromptSubmit hook(`mempal cowork-drain
  --target codex --format codex-hook-json --cwd-source stdin-json`)。这是 cowork 收件箱
  注入,单 agent 记忆题上是 no-op,装上是为了保持「mempal 出厂形态」完整;记忆读写走
  MCP(MEMORY_PROTOCOL 嵌在 ServerInfo,server 端下发,零 prompt 配置)。schema 是
  mempal 对旧版 codex 源码验证的(CamelCase + 嵌套 hooks,UserPromptSubmit 忽略
  matcher),新版兼容性未实证——不匹配时静默忽略,不会炸 run,跑完看 log 核对。

## 文件清单

| 文件 | 状态 | 内容 |
|---|---|---|
| `scripts/build-mempal-linux.sh` | 新建 | host 侧一次性构建 linux/amd64 二进制到 `.cache/mempal/mempal`;幂等(产物已存在且 `--force` 未给则跳过);构建完 `file` 校验是 x86-64 ELF |
| `.gitignore` | 追加 | `.cache/` |
| `experiments/shared/mempal.ts` | 重写 | 上表架构 + §记忆状态共享:`withMempal(base, tool, { stateKey })`,setup 载入态、teardown 回存态、per-stateKey 互斥;`mempalMcp` 与 hook 部分保留 |
| `experiments/compare/claude-dp-v4--mempal.ts` | 改一行 | `withMempal(…, "claude", { stateKey: "claude-dp-v4--mempal" })` |
| `experiments/compare/codex-gpt-5.4--mempal.ts` | 改一行 | `withMempal(…, "codex", { stateKey: "codex-gpt-5.4--mempal" })` |

## setup 伪码(experiments/shared/mempal.ts)

```ts
async setup(sb, ctx) {
  const cleanup = await base.setup?.(sb, ctx);

  // 1. 二进制:沙箱有就跳过;否则从 host 缓存上传。缓存缺失 → throw,
  //    错误信息指向 scripts/build-mempal-linux.sh。host 路径用
  //    fileURLToPath(new URL("../../.cache/mempal/mempal", import.meta.url)) 解析,
  //    fs.readFileSync 读成 Buffer(setup 跑在 host 上)。
  if ((await sb.runShell("command -v mempal")).exitCode !== 0) {
    await sb.uploadFile("/tmp/mempal", readFileSync(BIN));
    await sb.runShell("install -m755 /tmp/mempal /usr/local/bin/mempal && rm -f /tmp/mempal", { root: true });
  }

  // 2. 预热模型(以沙箱默认用户跑,缓存落对 $HOME)+ 清掉预热库。
  //    best-effort:失败不阻塞(首次真 ingest 会重试下载),但 ctx.log 记录。
  const warm = await sb.runShell(
    'mkdir -p /tmp/mempal-warm && echo warm > /tmp/mempal-warm/w.md && ' +
    'mempal init /tmp/mempal-warm && mempal ingest /tmp/mempal-warm --wing warm && ' +
    'rm -rf /tmp/mempal-warm "$HOME/.mempal"'
  );
  ctx.log(`[mempal] model warm-up: ${warm.exitCode === 0 ? "ok" : "failed (will retry on first ingest)"}`);

  // 3. 记忆态:host 有存档就恢复,没有才空库起步(§记忆状态共享;整个 setup→teardown
  //    包在 per-stateKey 互斥锁里)。
  // 4. hook(与现实现相同:claude → Stop hook;codex → hooks.json + feature 探测)
  return cleanup;
}

async teardown(sb, ctx) {
  // tar $HOME/.mempal → downloadFile → 原子写回 host state/<stateKey>.tgz → 放锁
  // best-effort:失败 ctx.log,不抛。base 无 teardown,但仍要透传调用以防未来加上。
}
```

## 验证结果(2026-07-08,dev-e2b,实测)

- **codex(gpt-5.4-mini)**:2 题 pass。MCP 挂载确认(`codex mcp list` → enabled);
  读路径工作 —— transcript 里有 `mempal.mempal_status` 调用(MEMORY_PROTOCOL rule 0);
  **写路径弱**:codex 没有 Stop hook 类的存库提醒,纯靠协议自觉,gpt-5.4-mini 没有
  主动 ingest(drawer_count 0)。这是 mempal 在 codex 上的出厂形态,如实计入条件。
- **claude-code(deepseek-v4-flash)**:全链路闭环 —— MCP `✔ Connected`;Stop hook
  在 transcript 可见并触发;单题 5 次 mempal 调用(status/search/ingest×3/projects),
  存了 3 个 drawer(决策+rationale 质量高);teardown 回存 15 KB,下一题成功恢复。
  terminal-cancel 题目本身 fail(模型能力,与 mempal 无关)。
- **并发**:实际 maxConcurrency=20(首轮串行只是 budget 护栏的首样本探针效应),
  互斥锁被真实使用,状态无损坏。
- 途中发现并修复:niceeval ≤0.4.4 两个 adapter 的 mcpServers 均写错位置(静默失败),
  上游已修(../fastevals),本 repo 用 helper 自注册绕过(见 §架构 的 MCP 段)。

## 验证清单(实现者必须做)

1. `bash scripts/build-mempal-linux.sh` 真跑一遍,确认 `.cache/mempal/mempal` 产出且
   `file` 输出含 `ELF 64-bit ... x86-64`(Apple Silicon 上 docker 走 Rosetta,慢是正常的,可能 10-20 分钟)。
2. tsx import 检查:临时 .mts 脚本 import 三个文件,验证两个实验 `default.agent.{name,kind,setup}` 正常、shared 无 default export。(`tsx -e` 是 CJS 不支持顶层 await,必须走脚本文件。)
3. `pnpm typecheck` 通过。
4. **不要跑任何 `niceeval` 命令**。

## 遗留(不在本次范围)

- **双 session eval**:现有 9 题全是单 session,mempal 空库起步预期无增益。价值验证要新题:session 1 探索/踩坑 → `t.newSession()` → session 2 看记忆复用。niceeval 已支持。
- ~~跨 attempt 记忆延续~~:已并入本设计(§记忆状态共享,per-stateKey 互斥解决顺序问题)。若未来 niceeval 原生支持「实验级持久状态目录」,helper 的 tar 往返可以退役。
- **锁 → 声明式串行的迁移**(等 niceeval >0.4.4 发版):上游已支持实验级
  `maxConcurrency` 按实验限流(fastevals `03de80d`)。迁移三步:bump niceeval;
  两个 mempal 实验文件加 `maxConcurrency: 1`;删 `shared/mempal.ts` 里的
  acquireStateLock/releaseStateLock 及 setup/teardown 里的取放锁调用(tar 往返保留)。
  注意 0.4.4 **不要**提前加 `maxConcurrency: 1`——旧语义会把整批 compare 矩阵钳成串行。
- **0.4.4 快照完整性核查**:0.4.4 带一个 earlyExit 回归(去重键丢了 experimentId,
  上游 `1fd1c82` 已修):同 agent 同 model 的实验对(compare 组的 baseline /
  --agents-md / --mempal 三元组正是)整矩阵同跑时,先 pass 的变体会让其它变体的同名
  eval 被跳过或丢结果、工件互相覆盖。用 0.4.4 跑的全矩阵快照要核对每个实验是否真有
  全部题目的结果;升级后建议重跑对照。
- vercel/docker 后端:本设计只对 e2b 验证(compare 组全在 e2b);`install -m755` 的 root 语义三后端一致,理论上通用。
