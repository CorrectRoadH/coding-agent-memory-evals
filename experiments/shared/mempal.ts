import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shared } from "niceeval/adapter";
import type { AgentSetup, AgentTeardown, McpServer, SkillSpec } from "niceeval/adapter";

// mempal 记忆条件的共享环境层：MCP 注册归 adapter；二进制和 514 MB 模型 cache
// 归专用 E2B template；本 hook 只做 fail-fast 预检、状态恢复/回存和 agent 特有提示。
// Claude 用 Stop hook 促成写入；Codex 用 mempalCodexSkill，已删除对单 agent 无作用的
// cowork-drain hook。状态按 MEMPAL_COHORT + experimentId 隔离，实验必须 maxConcurrency: 1
// 以保护 [restore … save] 临界区。本文件无 default export，不会被当成 experiment。

/** host 上按 experimentId 持久化记忆态的目录(gitignored,随 .cache/)。 */
const STATE_DIR = fileURLToPath(new URL("../../.cache/mempal/state/", import.meta.url));

/** Mempal 变体专用模板；分别从 E2B 官方 Agent template 派生。 */
export function mempalTemplate(tool: "claude" | "codex"): string {
  return process.env[`MEMPAL_E2B_${tool.toUpperCase()}_TEMPLATE`] ?? `memory-evals-${tool}-mempal`;
}

/** mempal MCP server 描述符,传给 `claudeCodeAgent`/`codexAgent` 构造期的 `mcpServers`。 */
export const mempalMcp: McpServer = { name: "mempal", command: "mempal", args: ["serve", "--mcp"] };

/** Codex 没有等价 Stop hook，用 Skill 明确约束 search/ingest 行为。 */
export const mempalCodexSkill: SkillSpec = {
  kind: "local",
  path: "experiments/shared/mempal-skill",
  name: "mempal-memory",
};

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
{"decision": "block", "reason": "Before stopping, save only durable engineering decisions or reusable debugging lessons to mempal. Include rationale and search first to avoid duplicates. Never store benchmark answers, accepted proposal numbers, hidden-test guesses, raw transcripts, or task-specific output that would reveal an answer on rerun. If nothing reusable was decided, just stop."}
JSON
exit 0
`;

/** host 上 <experimentId>.tgz 的存档路径;experimentId 缺失时 fail fast(见文件头注)。 */
function statePathFor(experimentId: string | undefined): string {
  if (!experimentId) {
    throw new Error(
      "[mempal] ctx.experimentId is missing — mempalSetup/mempalTeardown persist memory state " +
        "keyed by the experiment's path-derived id, and only have that id when running through " +
        "an experiment discovered under experiments/ (not a bare sandbox/eval dev run).",
    );
  }
  const cohort = process.env.MEMPAL_COHORT?.trim() || "local";
  return join(STATE_DIR, cohort, `${experimentId}.tgz`);
}

function commandFailure(label: string, result: { exitCode: number; stdout: string; stderr: string }): Error {
  const tail = (result.stderr || result.stdout).trim().slice(-500) || "no output";
  return new Error(`[mempal] ${label} failed (exit ${result.exitCode}): ${tail}`);
}

async function requireCommand(
  sb: Parameters<AgentSetup>[0],
  label: string,
  script: string,
  opts?: Parameters<Parameters<AgentSetup>[0]["runShell"]>[1],
): Promise<void> {
  const result = await sb.runShell(script, opts);
  if (result.exitCode !== 0) throw commandFailure(label, result);
}

/**
 * 沙箱级 setup 钩子:专用模板预检、按 tool 装生命周期提示、记忆态载入。
 * 挂到 `e2bSandbox().setup(mempalSetup(tool))`。跑在 workspace 上传 / eval.setup /
 * agent.setup 之前(见 SandboxHooks 执行顺序),所以这里还没有 agent CLI、也还没有
 * MCP 配置 —— MCP 由 `mempalMcp` 走 adapter 构造期单独接。
 */
export function mempalSetup(tool: "claude" | "codex"): AgentSetup {
  return async (sb, ctx) => {
    const statePath = statePathFor(ctx.experimentId);

    // 1. 专用模板必须已经提供二进制。这里不再把 14 MB 文件逐 attempt 上传；缺失时
    //    fail fast，并给出构建模板的唯一修复路径。
    const probe = await sb.runShell("command -v mempal");
    if (probe.exitCode !== 0) {
      throw new Error(
        `[mempal] template does not contain mempal. Build ${mempalTemplate(tool)} with ` +
          `\`bash scripts/build-mempal-linux.sh && pnpm template:mempal ${tool}\`, then use that template.`,
      );
    }

    // 2. 在隔离 HOME 里做真实 ingest→search 与 MCP 进程存活预检。复用模板里的模型
    //    cache，但不会读写随后恢复的实验状态，也不会把 sentinel 带进 benchmark。
    await requireCommand(
      sb,
      "binary/model/ingest/search preflight",
      "set -euo pipefail; real_home=\"$HOME\"; " +
        "rm -rf /tmp/mempal-preflight-home /tmp/mempal-preflight-docs; " +
        "mkdir -p /tmp/mempal-preflight-home /tmp/mempal-preflight-docs; " +
        "ln -s \"$real_home/.cache\" /tmp/mempal-preflight-home/.cache; " +
        "printf '%s\\n' 'niceeval-mempal-preflight-sentinel' >/tmp/mempal-preflight-docs/sentinel.md; " +
        "HOME=/tmp/mempal-preflight-home mempal init /tmp/mempal-preflight-docs; " +
        "HOME=/tmp/mempal-preflight-home mempal ingest /tmp/mempal-preflight-docs --wing niceeval-preflight; " +
        "HOME=/tmp/mempal-preflight-home mempal search niceeval-mempal-preflight-sentinel --json " +
        "| grep -q niceeval-mempal-preflight-sentinel; " +
        "rm -rf /tmp/mempal-preflight-home /tmp/mempal-preflight-docs",
    );
    await requireCommand(
      sb,
      "MCP server preflight",
      "set +e; timeout 1s sh -c 'tail -f /dev/null | mempal serve --mcp >/tmp/mempal-mcp.out 2>/tmp/mempal-mcp.err'; " +
        "code=$?; test \"$code\" -eq 124",
    );
    ctx.log("[mempal] preflight passed: binary, cached model, ingest/search, and MCP process");

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
      await requireCommand(sb, "state restore", 'tar -xzf /tmp/mempal-state.tgz -C "$HOME" && rm -f /tmp/mempal-state.tgz');
      ctx.log(`[mempal] state restored from ${ctx.experimentId}.tgz (${(state.length / 1024).toFixed(0)} KB)`);
    } else {
      // 空库初始化:$HOME/.mempal/palace.db。workspace 此时还没上传(eval test()
      // 里才 uploadDirectory),所以不 init 项目结构、不预 ingest —— 记忆积累
      // 应该来自 agent 自己 session 内写、后续 eval/run 读。
      await requireCommand(sb, "empty state initialization", "mempal init .");
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
      await requireCommand(sb, "Claude Stop hook chmod", 'chmod +x "$HOME/.claude/hooks/mempal-stop.sh"');
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
        writeFileSync(
          `${statePath}.meta.json`,
          JSON.stringify({
            experimentId: ctx.experimentId,
            cohort: process.env.MEMPAL_COHORT?.trim() || "local",
            sha256: createHash("sha256").update(data).digest("hex"),
            bytes: data.length,
            savedAt: new Date().toISOString(),
          }, null, 2) + "\n",
        );
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
