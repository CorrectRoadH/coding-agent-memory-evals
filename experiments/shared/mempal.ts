import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { shared } from "niceeval/adapter";
import type { Agent } from "niceeval/adapter";

// ───────────────────────────────────────────────────────────────────────────
// mempal(https://github.com/ZhangHanDong/mempal)记忆条件的共享 setup。
//
// mempal = 单二进制 Rust CLI:SQLite(~/.mempal/palace.db)+ BM25/向量混合检索,
// 通过两条通道接进 agent:
//   1. MCP server(`mempal serve --mcp`)—— mempal_search / mempal_ingest 等工具,
//      MEMORY_PROTOCOL 嵌在 ServerInfo 里,agent 端零 system prompt 配置。
//   2. 生命周期 hook —— Claude Code 用 Stop hook(session 结束前提示把决策存入 mempal);
//      Codex 的 hooks(~/.codex/hooks.json)被上游 `codex_hooks` 实验 flag 门控,
//      flag 关着时静默忽略,这里 best-effort enable,不作硬前提。
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
// 形同虚设。所以把 $HOME/.mempal 按 stateKey(实验名)在 host 上持久化:setup 载入
// 存档(.cache/mempal/state/<stateKey>.tgz),teardown tar 回存。attempt 的
// [载入 … 回存] 是临界区,用模块级 per-stateKey promise 互斥锁串行化 —— niceeval
// ≤0.4.4 的实验级 maxConcurrency 是全局钳制(设 1 会拖慢整批基线),不可用;所有
// attempt 同进程,进程内锁足够;跨进程并发不防(本 repo 工作流不存在)。
// 【迁移路径】上游已把 ExperimentDef.maxConcurrency 改为按实验限流(fastevals
// 03de80d,待发版):bump 之后在 mempal 实验里声明 maxConcurrency: 1,删掉本文件的
// acquireStateLock/releaseStateLock 与 setup/teardown 的取放锁调用即可(tar 往返保留)。
// 做干净对照前 rm -rf .cache/mempal/state/,报告注明状态起点(空库/带积累)。
//
// 本文件没有 default export,niceeval 的 discoverExperiments 会跳过它。
// ───────────────────────────────────────────────────────────────────────────

/** host 上缓存的 linux/amd64 mempal 二进制路径(scripts/build-mempal-linux.sh 产出)。 */
const BIN = fileURLToPath(new URL("../../.cache/mempal/mempal", import.meta.url));

/** host 上按 stateKey 持久化记忆态的目录(gitignored,随 .cache/)。 */
const STATE_DIR = fileURLToPath(new URL("../../.cache/mempal/state/", import.meta.url));

// per-stateKey 互斥锁:tails 是排队链(新 attempt 接到链尾),releases 是当前持有者的
// 放锁函数 —— 互斥保证同 key 同时只有一个持有者,所以一个槽位就够,不用按 attempt 索引。
// teardown 只在 setup 成功后由 runner 调(attempt.ts finally 的 agentDidSetup 守卫),
// 所以 setup 抛错路径必须自己放锁,否则锁死后续 attempt。
const stateLockTails = new Map<string, Promise<void>>();
const stateLockReleases = new Map<string, () => void>();

/** 取 stateKey 的锁:排到队尾,前面的 attempt 放锁后 resolve。 */
async function acquireStateLock(key: string): Promise<void> {
  const prev = stateLockTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  stateLockTails.set(
    key,
    prev.then(() => held),
  );
  await prev;
  stateLockReleases.set(key, release);
}

/** 放 stateKey 的锁;幂等(没持有时是 no-op),所以 setup 抛错路径和 teardown 都能安全调。 */
function releaseStateLock(key: string): void {
  const release = stateLockReleases.get(key);
  if (release) {
    stateLockReleases.delete(key);
    release();
  }
}

// MCP 注册由本 helper 自己做,不走 adapter 的 mcpServers 参数:niceeval ≤0.4.4 的两个
// adapter 都写错了位置(codex 写成单数 [mcp_server.x]、claude 写到不存在的
// ~/.claude/claude.json),MCP 静默挂不上——首轮验证 run 里 codex 全程 0 次 mempal 调用、
// palace.db 空库就是这么来的。上游已在 ../fastevals 修复(codex.ts/claude-code.ts),
// 等发版后这里的自注册依然无害(写的是同一份配置)。
const MEMPAL_CODEX_MCP_TOML = `
[mcp_servers.mempal]
command = "mempal"
args = ["serve", "--mcp"]
`;

const MEMPAL_CLAUDE_MCP_JSON = JSON.stringify(
  { mcpServers: { mempal: { command: "mempal", args: ["serve", "--mcp"] } } },
  null,
  2,
);

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

/**
 * 把 mempal 记忆条件包到一个已构造的 agent 上:二进制上传、模型预热、MCP 注册、
 * 生命周期 hook、记忆态载入/回存,全部由本包装负责,base agent 不需要任何 mempal
 * 相关参数。stateKey 按实验隔离记忆积累(传实验名),见文件头注。
 */
export function withMempal(base: Agent, tool: "claude" | "codex", opts: { stateKey: string }): Agent {
  const { stateKey } = opts;
  const statePath = join(STATE_DIR, `${stateKey}.tgz`);
  return {
    ...base,
    async setup(sb, ctx) {
      const cleanup = await base.setup?.(sb, ctx);

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

      // 3. 记忆态载入:从这里起进入 [载入 … 回存] 临界区 —— 取 per-stateKey 锁,
      //    正常路径由 teardown 回存后放锁;本 setup 后续任何一步抛错都要自己放锁
      //    (runner 只在 setup 成功后才调 teardown,不放会锁死后续 attempt)。
      await acquireStateLock(stateKey);
      try {
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
          ctx.log(`[mempal] state restored from ${stateKey}.tgz (${(state.length / 1024).toFixed(0)} KB)`);
        } else {
          // 空库初始化:$HOME/.mempal/palace.db。workspace 此时还没上传(eval test()
          // 里才 uploadDirectory),所以不 init 项目结构、不预 ingest —— 记忆积累
          // 应该来自 agent 自己 session 内写、后续 eval/run 读。
          await sb.runShell("mempal init . || true");
          ctx.log(`[mempal] no saved state for "${stateKey}", starting from empty palace`);
        }

        // 4. MCP 注册 + 按 tool 装生命周期 hook。注册完用 CLI 自省命令(`… mcp list`)
        //    确认挂载并记 log —— MCP 配置写错位置是静默失败(adapter 就栽过这跟头,
        //    见文件头注),必须靠自省输出留证据,不能只看「没报错」。
        if (tool === "claude") {
          // 用户级 MCP 在 ~/.claude.json 顶层 mcpServers(沙箱是全新的,直接写不用合并)。
          await shared.writeFile(sb, "~/.claude.json", MEMPAL_CLAUDE_MCP_JSON);
          const mcpSt = await sb.runShell("claude mcp list 2>&1 | grep -i mempal || true");
          ctx.log(`[mempal] claude mcp list: ${mcpSt.stdout.trim() || "(mempal NOT registered!)"}`);
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
          // MCP:追加到 base setup 写好的 ~/.codex/config.toml 末尾(顶层表顺序无关,
          // 与 tracing.configure 之后追加的 [otel] 子表也不冲突)。
          await sb.runShell(`cat >> ~/.codex/config.toml <<'MEMPALEOF'\n${MEMPAL_CODEX_MCP_TOML}\nMEMPALEOF\n`);
          const mcpSt = await sb.runShell("codex mcp list 2>&1 | grep -i mempal || true");
          ctx.log(`[mempal] codex mcp list: ${mcpSt.stdout.trim() || "(mempal NOT registered!)"}`);
          await shared.writeFile(sb, "~/.codex/hooks.json", CODEX_HOOKS_JSON);
          // hooks 的 feature flag 随 codex 版本变名:0.142.x 里叫 `hooks` 且 stable 默认开
          // (mempal 文档里的 `codex_hooks` 是旧名)。两个名字都试着 enable,失败不阻塞
          // (flag 关着时 hooks.json 被静默忽略)—— 把实际状态记进 log 供事后核对。
          await sb.runShell("codex features enable hooks 2>/dev/null || codex features enable codex_hooks 2>/dev/null || true");
          const st = await sb.runShell("codex features list 2>/dev/null | grep -i hook || true");
          ctx.log(`[mempal] codex hooks feature state: ${st.stdout.trim() || "(unknown)"}`);
        }
      } catch (e) {
        releaseStateLock(stateKey);
        throw e;
      }

      return cleanup;
    },

    async teardown(sb, ctx) {
      // 回存记忆态并放锁。回存 best-effort:失败只记 log 不抛(runner 本来也会吞
      // teardown 的错,但显式 log 才能事后核对);放锁必须在 finally —— 回存失败
      // 也不能锁死后续 attempt。
      try {
        const pack = await sb.runShell('tar -C "$HOME" -czf /tmp/mempal-state.tgz .mempal');
        if (pack.exitCode === 0) {
          const data = await sb.downloadFile("/tmp/mempal-state.tgz");
          // host 侧原子写回:先落 .tmp 再 rename,进程半途被杀也不会留下半截 tgz。
          mkdirSync(STATE_DIR, { recursive: true });
          const tmp = `${statePath}.tmp`;
          writeFileSync(tmp, data);
          renameSync(tmp, statePath);
          ctx.log(`[mempal] state saved to ${stateKey}.tgz (${(data.length / 1024).toFixed(0)} KB)`);
        } else {
          // $HOME/.mempal 不存在(比如 agent 半路挂了没 ingest 过)也走这里:不覆盖旧存档。
          ctx.log(`[mempal] state save skipped: tar failed (${(pack.stderr || pack.stdout).trim().slice(0, 200)})`);
        }
      } catch (e) {
        ctx.log(`[mempal] state save failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        releaseStateLock(stateKey);
      }
      await base.teardown?.(sb, ctx);
    },
  };
}
