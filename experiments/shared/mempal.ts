import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shared } from "niceeval/adapter";
import type { SkillSpec } from "niceeval/adapter";
import type { E2BSandboxSpec, Sandbox } from "niceeval/sandbox";
import { NICEEVAL_E2B_RELEASE } from "./e2b-templates.ts";

// niceeval 的沙箱级钩子签名。`.setup()/.teardown()` 收的是 SandboxHook —— 一个**窄**上下文
// (只有 experimentId / signal / progress / diagnostic),不是 agent 级 AgentContext,所以拿
// 不到 `ctx.log`(那是 AgentContext 上 `progress` 的别名)。niceeval/sandbox 目前没直接导出
// SandboxHook / SandboxHookContext 类型(候选上游:补导出),这里从 E2BSandboxSpec 派生。
type SandboxHook = Parameters<E2BSandboxSpec["setup"]>[0];
type SandboxHookContext = Parameters<SandboxHook>[1];

// mempal 记忆条件的共享环境层：二进制和 embedding cache 归专用 E2B template；本 hook 只做
// fail-fast 预检、状态恢复/回存和 agent 行为提示。
//
// 【为什么不用 MCP】mempal 的 `serve --mcp` 暴露 25 个工具，tools/list 就是 82 KB
// (≈20.5k tokens)，每个模型请求都要重发一遍——我们只用得上 search/ingest 两个，却要为另外
// 23 个付"工具定义税"。实测 codex 上单 attempt 因此从 ~150k 涨到 0.9-1.3M tokens。mempal 的
// CLI 本身就有 `search --json` 和 `ingest`，agent 用它自带的 shell 工具直接调即可，工具定义
// 开销为零。MCP 那条路等上游给 tool allowlist(见 memory: mempal-codex-token-blowup)再说。
//
// 状态按 MEMPAL_COHORT + experimentId 隔离，实验必须 maxConcurrency: 1 以保护
// [restore … save] 临界区。本文件无 default export，不会被当成 experiment。

/** host 上按 experimentId 持久化记忆态的目录(gitignored,随 .cache/)。 */
const STATE_DIR = fileURLToPath(new URL("../../.cache/mempal/state/", import.meta.url));

/** 跨 attempt 持久化的两个目录(相对 $HOME):记忆库本体 + agent 写下的原始笔记。 */
const STATE_PATHS = [".mempal", ".mempal-notes"];

/**
 * mempal 二进制的 crates.io 版本；构建脚本 `cargo install mempal --version` 用它 pin 死。
 * bump 时同步 rebuild 两个模板(模板名不含它,靠内容变化触发重建)。
 */
export const MEMPAL_VERSION = "0.9.0";

/**
 * Mempal 变体专用模板；由 `pnpm template:mempal <tool>` 从公共 Agent 模板派生构建。
 *
 * 名字 pin 到 base 模板的 release tag —— 和公共模板的 `:v0.6.1` 对齐(见
 * [[e2b-templates-inventory]])。base bump 后模板名自动变,所有实验(都走这个函数)
 * 跟着指向新模板,不会出现「base 升了、mempal 模板还是旧 base」的静默漂移。
 */
export function mempalTemplate(tool: "claude" | "codex"): string {
  const rel = NICEEVAL_E2B_RELEASE.replace(/[^a-z0-9]+/gi, "-");
  return `memory-evals-${tool}-mempal-${rel}`;
}

/** 教 agent 用 mempal CLI 检索/落库的 Skill(claude 与 codex 共用)。 */
export const mempalSkill: SkillSpec = {
  kind: "local",
  path: "experiments/shared/mempal-skill",
  name: "mempal-memory",
};

// Stop hook:session 每次收尾前 block 一次,提示 agent 把本轮关键决策落库。
// stop_hook_active 防循环(被 block 后的下一次 stop 放行),所以每个 session 恰好触发一次。
// Codex 没有等价 hook,只能靠 Skill。
const STOP_HOOK = `#!/usr/bin/env bash
set -uo pipefail
input=$(cat)
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi
cat <<'JSON'
{"decision": "block", "reason": "Before stopping, save durable engineering decisions or reusable debugging lessons to mempal, following the mempal-memory skill: write a short markdown note into $HOME/.mempal-notes/ and run 'mempal ingest \\"$HOME/.mempal-notes\\" --wing memory-evals'. Never store benchmark answers, accepted proposal numbers, hidden-test guesses, raw transcripts, or task-specific output that would reveal an answer on rerun. If nothing reusable was decided, just stop."}
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
  sb: Sandbox,
  label: string,
  script: string,
  opts?: Parameters<Sandbox["runShell"]>[1],
): Promise<void> {
  const result = await sb.runShell(script, opts);
  if (result.exitCode !== 0) throw commandFailure(label, result);
}

/** 沙箱钩子的信息日志:hook ctx 没有 AgentContext 的 `log` 别名,直接走 `progress`。 */
function hookLog(ctx: SandboxHookContext, message: string): void {
  ctx.progress({ message });
}

/**
 * 沙箱级 setup 钩子:专用模板预检、按 tool 装生命周期提示、记忆态载入。
 * 挂到 `e2bSandbox().setup(mempalSetup(tool))`。跑在 workspace 上传 / eval.setup /
 * agent.setup 之前(见 SandboxHooks 执行顺序),所以这里还没有 agent CLI、也还没有
 * MCP 配置 —— MCP 由 `mempalMcp` 走 adapter 构造期单独接。
 */
export function mempalSetup(tool: "claude" | "codex"): SandboxHook {
  return async (sb, ctx) => {
    const statePath = statePathFor(ctx.experimentId);

    // 1. 专用模板必须已经提供二进制。这里不再把二进制逐 attempt 上传；缺失时
    //    fail fast，并给出构建模板的唯一修复路径。
    const probe = await sb.runShell("command -v mempal");
    if (probe.exitCode !== 0) {
      throw new Error(
        `[mempal] template does not contain mempal. Build ${mempalTemplate(tool)} with ` +
          `\`pnpm template:mempal ${tool}\`, then use that template.`,
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
        // 不要 `mempal search … | grep -q`:grep -q 命中即关管道,mempal 还在写 stdout 就吃
        // SIGPIPE,rust 的 println! 直接 panic(exit 134)——实测偶发,把整个 attempt 判 errored。
        // 先把输出落进变量,再在本地匹配。
        "out=$(HOME=/tmp/mempal-preflight-home mempal search niceeval-mempal-preflight-sentinel --json); " +
        "case \"$out\" in *niceeval-mempal-preflight-sentinel*) ;; *) echo \"$out\" >&2; exit 1 ;; esac; " +
        "rm -rf /tmp/mempal-preflight-home /tmp/mempal-preflight-docs",
    );
    hookLog(ctx, "[mempal] preflight passed: binary, cached model, ingest/search");

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
      //
      // 落点用 $HOME 而不是 /tmp:实测 envd 的文件写 API 偶发对 /tmp 报
      // `500: error opening file: … permission denied`(/tmp 是 1777、同一实验里其它
      // attempt 又写得进去,所以是 envd 抽风),而 niceeval 把 permission 类错误归为
      // 不可重试 → 整个 attempt 判 errored。$HOME 是用户自己的目录,不碰 sticky bit。
      // 沙箱 home 路径按 provider 变(不 hardcode /home/user),动态取。
      const home = (await sb.runShell('printf "%s" "$HOME"')).stdout.trim();
      const archive = `${home}/mempal-state.tgz`;
      await sb.uploadFile(archive, state);
      await requireCommand(sb, "state restore", `tar -xzf '${archive}' -C "$HOME" && rm -f '${archive}'`);
      hookLog(ctx, `[mempal] state restored from ${ctx.experimentId}.tgz (${(state.length / 1024).toFixed(0)} KB)`);
    } else {
      // 空库初始化:$HOME/.mempal/palace.db。workspace 此时还没上传(eval test()
      // 里才 uploadDirectory),所以不 init 项目结构、不预 ingest —— 记忆积累
      // 应该来自 agent 自己 session 内写、后续 eval/run 读。
      await requireCommand(sb, "empty state initialization", "mempal init .");
      hookLog(ctx, `[mempal] no saved state for "${ctx.experimentId}", starting from empty palace`);
    }

    // agent 写笔记的目录(Skill 里教它往这里写,再 ingest 整个目录)。先建好,免得
    // agent 还要自己 mkdir;它随状态一起跨 attempt 持久化。
    await requireCommand(sb, "notes dir", 'mkdir -p "$HOME/.mempal-notes"');

    // 4. 按 tool 装生命周期 hook。
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
export function mempalTeardown(_tool: "claude" | "codex"): SandboxHook {
  return async (sb, ctx) => {
    const statePath = statePathFor(ctx.experimentId);
    // 回存记忆态。best-effort:失败只记 log 不抛(runner 本来也会吞 teardown 的错,
    // 但显式 log 才能事后核对)。
    try {
      // 同 setup:走 $HOME 而不是 /tmp(envd 对 /tmp 的文件 API 偶发 500 permission denied)。
      const home = (await sb.runShell('printf "%s" "$HOME"')).stdout.trim();
      const archive = `${home}/mempal-state.tgz`;
      const pack = await sb.runShell(`tar -C "$HOME" -czf '${archive}' ${STATE_PATHS.join(" ")}`);
      if (pack.exitCode === 0) {
        const data = await sb.downloadFile(archive);
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
        hookLog(ctx, `[mempal] state saved to ${ctx.experimentId}.tgz (${(data.length / 1024).toFixed(0)} KB)`);
      } else {
        // $HOME/.mempal 不存在(比如 agent 半路挂了没 ingest 过)也走这里:不覆盖旧存档。
        hookLog(ctx, `[mempal] state save skipped: tar failed (${(pack.stderr || pack.stdout).trim().slice(0, 200)})`);
      }
    } catch (e) {
      hookLog(ctx, `[mempal] state save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}
