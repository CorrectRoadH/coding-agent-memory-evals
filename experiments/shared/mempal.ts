import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shared } from "niceeval/adapter";
import type { AgentSetup, AgentTeardown, McpServer } from "niceeval/adapter";

// ───────────────────────────────────────────────────────────────────────────
// mempal(https://github.com/ZhangHanDong/mempal)记忆条件的共享沙箱钩子。
//
// mempal = 单二进制 Rust CLI:SQLite(~/.mempal/palace.db)+ BM25/向量混合检索,
// 通过两条通道接进 agent:
//   1. MCP server(`mempal serve --mcp`)—— mempal_search / mempal_ingest 等工具,
//      MEMORY_PROTOCOL 嵌在 ServerInfo 里,agent 端零 system prompt 配置。走
//      adapter 构造期的 `mcpServers` 参数(`mempalMcp` 导出),不在本文件里手写。
//   2. 生命周期 hook —— Claude Code 用 Stop hook(session 结束前提示把决策存入 mempal);
//      Codex 的 hooks(~/.codex/hooks.json)被上游 `codex_hooks`/`hooks` 实验 flag 门控,
//      flag 关着时静默忽略,这里 best-effort enable,不作硬前提。
//
// 本文件导出三件东西,分别接进实验的三个不同挂点:
//   - `mempalMcp`:传给 `claudeCodeAgent({ mcpServers: [mempalMcp] })` /
//     `codexAgent({ mcpServers: [mempalMcp] })`,adapter 构造期写各自的 MCP 配置文件。
//   - `mempalSetup(tool)` / `mempalTeardown(tool)`:挂到
//     `e2bSandbox().setup(mempalSetup(tool)).teardown(mempalTeardown(tool))`
//     —— 二进制上传、模型预热、生命周期 hook 文件、跨 attempt 记忆态载入/回存。
//
// 取舍:旧版本(withMempal 包装已构造 Agent)在这里自己写 MCP 配置文件、并用
// `claude mcp list` / `codex mcp list` 自省留证据,因为彼时两个 adapter 的
// mcpServers 写入路径都是错的(见 memory: niceeval-adapter-mcp-config-broken)。
// 现在 MCP 改走构造期参数,写入逻辑连同自省一起删除 —— 且即便想留自省也做不到:
// 沙箱生命周期是「sandbox.setup(本文件)→ agent.setup(装 CLI、写 MCP 配置)→ sends」,
// 沙箱钩子跑在 agent CLI 装好、MCP 配置写好之前,这里跑 `claude/codex mcp list`
// 只会看到「命令不存在」。上游 0.5 adapter 的 mcpServers 写入路径已修好且有 e2e
// 覆盖,不再需要下游自证;真要留证据,留给 eval 侧或首轮 send 之后核对。
//
// 二进制来源:模板(fasteval-agents)不烘焙 mempal —— 记忆条件是实验自己的事,不是
// 基础设施的事。mempal 也没有预编译 release(GitHub releases assets 为空),沙箱内
// 现场 `cargo install mempal` 要 3-6 分钟/沙箱,不可接受。所以改为 host 侧一次性
// 交叉编译(scripts/build-mempal-linux.sh → .cache/mempal/mempal,gitignored),
// setup 时从 host 读进 Buffer 直接 uploadFile 到沙箱 —— 二进制仅 ~10MB,秒级。
// 缺了缓存就快速失败,提示先跑 build 脚本。
//
// 记忆状态共享(跨 eval / 跨 run 累积):沙箱是 per-attempt 一次性的,palace.db 随
// 沙箱销毁 —— 不共享的话每题空库起步,agent 存的决策永远没有下一个消费者,记忆条件
// 形同虚设。所以把 $HOME/.mempal 按 `ctx.experimentId`(实验路径推导出的稳定 id,
// 如 `compare/codex-gpt-5.4--mempal`)在 host 上持久化:setup 载入存档
// (.cache/mempal/state/<experimentId>.tgz,可含子目录),teardown tar 回存。
// experimentId 缺失(不经实验直接跑沙箱/eval dev)时 fail fast——没有稳定 key
// 就没法做「跨 attempt 累积」这件事,静默退化成空库比报错更容易被忽略。
//
// 【串行前提】attempt 的 [载入 … 回存] 是临界区,并发交错会丢更新(A 载入 → B 载入
// 旧态 → A 回存 → B 回存覆盖 A)。用 mempalSetup/mempalTeardown 的实验**必须声明
// `maxConcurrency: 1`**(niceeval ≥0.4.5 按实验限流,不拖慢同批其它实验)——串行由
// 调度器保证,本文件不持锁。跨进程并发同样不防(两个 niceeval 进程同跑同一实验不是
// 本 repo 的工作流)。做干净对照前 rm -rf .cache/mempal/state/,报告注明状态起点
// (空库/带积累)。
//
// 【settings.json 覆盖核查】claudeCodeAgent 的 agent.setup 只写 `~/.claude.json`
// (mcpServers)和(装 skill 时的)skills-lock.json,不碰 `~/.claude/settings.json`
// ——所以 mempalSetup 在 agent.setup 之前写的 Stop hook settings.json 不会被后跑的
// agent.setup 覆盖或合并冲突(核对自 fastevals src/agents/claude-code.ts,2026-07-10)。
// codex 同理:codexAgent 的 agent.setup 整体覆写 `~/.codex/config.toml`,但 mempalSetup
// 写的是不同文件 `~/.codex/hooks.json`,两者互不影响。
//
// 本文件没有 default export,niceeval 的 discoverExperiments 会跳过它。
// ───────────────────────────────────────────────────────────────────────────

/** host 上缓存的 linux/amd64 mempal 二进制路径(scripts/build-mempal-linux.sh 产出)。 */
const BIN = fileURLToPath(new URL("../../.cache/mempal/mempal", import.meta.url));

/** host 上按 experimentId 持久化记忆态的目录(gitignored,随 .cache/)。 */
const STATE_DIR = fileURLToPath(new URL("../../.cache/mempal/state/", import.meta.url));

/** mempal MCP server 描述符,传给 `claudeCodeAgent`/`codexAgent` 构造期的 `mcpServers`。 */
export const mempalMcp: McpServer = { name: "mempal", command: "mempal", args: ["serve", "--mcp"] };

// Stop hook:session 每次收尾前 block 一次,提示 agent 把本轮关键决策经
// mempal_ingest 落库。stop_hook_active 防循环(被 block 后的下一次 stop 放行),
// 所以每个 session 恰好触发一次,不会死循环。
// 改编自 mempal 仓库 hooks/mempal_save_hook.sh(原版每 N 次 stop 触发一次,
// eval session 短,这里改成每次 stop 都触发)。
const STOP_HOOK = `#!/usr/bin/env bash
set -uo pipefail
input=$(cat)
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi
cat <<'JSON'
{"decision": "block", "reason": "Before stopping, save the key decisions from this session to mempal: for each decision call the mempal_ingest MCP tool with content = the decision plus its rationale (why, not just what). Query mempal_search first to avoid duplicates. If nothing new was decided this session, just stop."}
JSON
exit 0
`;

// Codex 原生 hook 配置(schema 依 mempal P8 spec,自 Codex 源码验证:CamelCase +
// 嵌套 hooks,UserPromptSubmit 的 matcher 被忽略故省略)。作用是 cowork inbox
// drain(伙伴消息随下一次 prompt 注入 additionalContext);单 agent 记忆题上是
// no-op,装上是为了让「mempal 出厂形态」完整可测。
const CODEX_HOOKS_JSON = JSON.stringify(
  {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: "mempal cowork-drain --target codex --format codex-hook-json --cwd-source stdin-json",
            },
          ],
        },
      ],
    },
  },
  null,
  2,
);

/** host 上 <experimentId>.tgz 的存档路径;experimentId 缺失时 fail fast(见文件头注)。 */
function statePathFor(experimentId: string | undefined): string {
  if (!experimentId) {
    throw new Error(
      "[mempal] ctx.experimentId is missing — mempalSetup/mempalTeardown persist memory state " +
        "keyed by the experiment's path-derived id, and only have that id when running through " +
        "an experiment discovered under experiments/ (not a bare sandbox/eval dev run).",
    );
  }
  return join(STATE_DIR, `${experimentId}.tgz`);
}

/**
 * 沙箱级 setup 钩子:二进制上传、embed 模型预热、按 tool 装生命周期 hook、记忆态载入。
 * 挂到 `e2bSandbox().setup(mempalSetup(tool))`。跑在 workspace 上传 / eval.setup /
 * agent.setup 之前(见 SandboxHooks 执行顺序),所以这里还没有 agent CLI、也还没有
 * MCP 配置 —— MCP 由 `mempalMcp` 走 adapter 构造期单独接。
 */
export function mempalSetup(tool: "claude" | "codex"): AgentSetup {
  return async (sb, ctx) => {
    const statePath = statePathFor(ctx.experimentId);

    // 1. 二进制:沙箱已有(比如自定义模板)就跳过;否则从 host 缓存上传。host 缓存
    //    缺失 → 快速失败,别退化成"跑完了但记忆条件没生效"——错误信息指向构建脚本。
    const probe = await sb.runShell("command -v mempal");
    if (probe.exitCode !== 0) {
      let bin: Buffer;
      try {
        bin = readFileSync(BIN);
      } catch {
        throw new Error(
          `mempal 二进制缓存不存在(${BIN})。先在 host 上跑一次 ` +
            "`bash scripts/build-mempal-linux.sh`(host 侧交叉编译,只需一次)。",
        );
      }
      await sb.uploadFile("/tmp/mempal", bin);
      await sb.runShell("install -m755 /tmp/mempal /usr/local/bin/mempal && rm -f /tmp/mempal", { root: true });
    }

    // 2. 预热 embed 模型(minishlab/potion-multilingual-128M,~514MB):hf-hub 只认
    //    $HOME/.cache/huggingface,不认 HF_HOME env(mempal 0.7.0 实测)。以沙箱默认
    //    用户跑一次假 ingest 触发下载,让缓存落对 $HOME,再清掉预热产生的 palace.db,
    //    好让 agent 从空库开始。best-effort:失败不阻塞 run(首次真 ingest 会重试
    //    下载,只是变慢),但记进 log 供事后核对。
    const warm = await sb.runShell(
      "mkdir -p /tmp/mempal-warm && echo warm > /tmp/mempal-warm/w.md && " +
        "mempal init /tmp/mempal-warm && mempal ingest /tmp/mempal-warm --wing warm && " +
        'rm -rf /tmp/mempal-warm "$HOME/.mempal"',
    );
    ctx.log(`[mempal] model warm-up: ${warm.exitCode === 0 ? "ok" : "failed (will retry on first ingest)"}`);

    // 3. 记忆态载入:[载入 … 回存] 临界区的串行由实验声明 maxConcurrency: 1 保证
    //    (niceeval ≥0.4.5 按实验限流;见文件头注的【串行前提】)。
    let state: Buffer | undefined;
    try {
      state = readFileSync(statePath);
    } catch {
      // 无存档(首次跑 / 刚清过状态)→ 空库起步
    }
    if (state) {
      // 恢复历史积累的 $HOME/.mempal(palace.db + audit.jsonl)—— 记忆条件的
      // 价值正在于「第二次见到同类问题」,跨 eval / 跨 run 都要延续。
      await sb.uploadFile("/tmp/mempal-state.tgz", state);
      await sb.runShell('tar -xzf /tmp/mempal-state.tgz -C "$HOME" && rm -f /tmp/mempal-state.tgz');
      ctx.log(`[mempal] state restored from ${ctx.experimentId}.tgz (${(state.length / 1024).toFixed(0)} KB)`);
    } else {
      // 空库初始化:$HOME/.mempal/palace.db。workspace 此时还没上传(eval test()
      // 里才 uploadDirectory),所以不 init 项目结构、不预 ingest —— 记忆积累
      // 应该来自 agent 自己 session 内写、后续 eval/run 读。
      await sb.runShell("mempal init . || true");
      ctx.log(`[mempal] no saved state for "${ctx.experimentId}", starting from empty palace`);
    }

    // 4. 按 tool 装生命周期 hook(MCP 已经不在这里接,见文件头注)。
    if (tool === "claude") {
      // 用户级 settings:不落在 workspace 里,躲开上传覆盖与 diff 捕获。
      await shared.writeFile(sb, "~/.claude/hooks/mempal-stop.sh", STOP_HOOK);
      await shared.writeFile(
        sb,
        "~/.claude/settings.json",
        JSON.stringify(
          {
            hooks: {
              Stop: [{ hooks: [{ type: "command", command: 'bash "$HOME/.claude/hooks/mempal-stop.sh"' }] }],
            },
          },
          null,
          2,
        ),
      );
      await sb.runShell('chmod +x "$HOME/.claude/hooks/mempal-stop.sh"');
    } else {
      await shared.writeFile(sb, "~/.codex/hooks.json", CODEX_HOOKS_JSON);
      // hooks 的 feature flag 随 codex 版本变名:0.142.x 里叫 `hooks` 且 stable 默认开
      // (mempal 文档里的 `codex_hooks` 是旧名)。两个名字都试着 enable,失败不阻塞
      // (flag 关着时 hooks.json 被静默忽略)—— 把实际状态记进 log 供事后核对。
      // 注意:`codex features` 子命令此刻可能还没装(codex CLI 由后跑的 agent.setup
      // 负责装),best-effort 静默失败即可,不视为异常。
      await sb.runShell(
        "codex features enable hooks 2>/dev/null || codex features enable codex_hooks 2>/dev/null || true",
      );
      const st = await sb.runShell("codex features list 2>/dev/null | grep -i hook || true");
      ctx.log(`[mempal] codex hooks feature state: ${st.stdout.trim() || "(unknown, codex CLI may not be installed yet)"}`);
    }
  };
}

/**
 * 沙箱级 teardown 钩子:记忆态回存。挂到 `e2bSandbox().setup(...).teardown(mempalTeardown(tool))`。
 * `tool` 参数当前未被回存逻辑本身使用(回存的是 `$HOME/.mempal` 全量,与 tool 无关),
 * 保留是为了和 `mempalSetup(tool)` 调用形态对称、方便以后按 tool 差异化回存内容。
 */
export function mempalTeardown(_tool: "claude" | "codex"): AgentTeardown {
  return async (sb, ctx) => {
    const statePath = statePathFor(ctx.experimentId);
    // 回存记忆态。best-effort:失败只记 log 不抛(runner 本来也会吞 teardown 的错,
    // 但显式 log 才能事后核对)。
    try {
      const pack = await sb.runShell('tar -C "$HOME" -czf /tmp/mempal-state.tgz .mempal');
      if (pack.exitCode === 0) {
        const data = await sb.downloadFile("/tmp/mempal-state.tgz");
        // host 侧原子写回:先落 .tmp 再 rename,进程半途被杀也不会留下半截 tgz。
        // experimentId 可能含 "/"(如 "compare/codex-gpt-5.4--mempal"),statePath 落在
        // 嵌套目录下,先 mkdir -p 到父目录。
        mkdirSync(dirname(statePath), { recursive: true });
        const tmp = `${statePath}.tmp`;
        writeFileSync(tmp, data);
        renameSync(tmp, statePath);
        ctx.log(`[mempal] state saved to ${ctx.experimentId}.tgz (${(data.length / 1024).toFixed(0)} KB)`);
      } else {
        // $HOME/.mempal 不存在(比如 agent 半路挂了没 ingest 过)也走这里:不覆盖旧存档。
        ctx.log(`[mempal] state save skipped: tar failed (${(pack.stderr || pack.stdout).trim().slice(0, 200)})`);
      }
    } catch (e) {
      ctx.log(`[mempal] state save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}
