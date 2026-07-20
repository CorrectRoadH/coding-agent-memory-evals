import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillSpec } from "niceeval/adapter";
import { createCheckpoint, restoreCheckpoint } from "niceeval/sandbox";
import type { Sandbox, SandboxHook, SandboxHookContext } from "niceeval/sandbox";
import {
  NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE,
  NICEEVAL_CODEX_E2B_TEMPLATE,
} from "niceeval/sandbox/e2b-template";

const STATE_DIR = fileURLToPath(new URL("../../.cache/mempal/state/", import.meta.url));
const STATE_PATHS = [".mempal", ".mempal-notes"];

/** mempal crates.io 版本；构建模板、模板身份和结果 flags 共用这一处。 */
export const MEMPAL_VERSION = "0.9.0";

/** 每个派生模板只依赖实际使用的完整 base ref，不另存 NiceEval release 锁。 */
export function mempalBaseTemplate(tool: "claude" | "codex"): string {
  return tool === "claude" ? NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE : NICEEVAL_CODEX_E2B_TEMPLATE;
}

/** base ref 或 mempal 版本任一变化，派生模板名都会自然变化，避免复用旧构建。 */
export function mempalTemplate(tool: "claude" | "codex"): string {
  const base = createHash("sha256").update(mempalBaseTemplate(tool)).digest("hex").slice(0, 12);
  const mempal = MEMPAL_VERSION.replace(/[^a-z0-9]+/gi, "-");
  // E2B 静默把模板名小写化（服务端存的就是 memorybench-...），源码里跟着写小写以免依赖未文档化的大小写不敏感匹配。
  return `memorybench-${tool}-mempal-${base}-${mempal}`;
}

/** 报告分组与状态 provenance 共用的实验事实。正式比较应显式设置 MEMPAL_COHORT。 */
export function mempalFlags(): Record<string, string> {
  return {
    memory: "mempal",
    mempalVersion: MEMPAL_VERSION,
    mempalCohort: process.env.MEMPAL_COHORT?.trim() || "local",
  };
}

/** 教 agent 用 mempal CLI 检索/落库的 Skill（Claude 与 Codex 共用）。 */
export const mempalSkill: SkillSpec = {
  kind: "local",
  path: "experiments/shared/mempal-skill",
  name: "mempal-memory",
};

function statePathFor(experimentId: string | undefined): string {
  if (!experimentId) {
    throw new Error(
      "[mempal] ctx.experimentId is missing — persistent state requires an experiment discovered under experiments/.",
    );
  }
  return join(STATE_DIR, mempalFlags().mempalCohort, `${experimentId}.tgz`);
}

function commandFailure(label: string, result: { exitCode: number; stdout: string; stderr: string }): Error {
  const tail = (result.stderr || result.stdout).trim().slice(-500) || "no output";
  return new Error(`[mempal] ${label} failed (exit ${result.exitCode}): ${tail}`);
}

async function requireCommand(sb: Sandbox, label: string, script: string): Promise<void> {
  const result = await sb.runShell(script);
  if (result.exitCode !== 0) throw commandFailure(label, result);
}

function hookLog(ctx: SandboxHookContext, message: string): void {
  ctx.progress({ message });
}

/**
 * 专用模板的 attempt 级环境层：只做廉价探针、checkpoint 恢复和空库初始化。
 * ingest/search 的完整自检属于不可变模板构建，不应在每个业务 attempt 重跑。
 */
export function mempalSetup(tool: "claude" | "codex"): SandboxHook {
  return async (sb, ctx) => {
    const statePath = statePathFor(ctx.experimentId);
    const probe = await sb.runShell("command -v mempal");
    if (probe.exitCode !== 0) {
      throw new Error(
        `[mempal] template does not contain mempal. Build ${mempalTemplate(tool)} with ` +
          `\`pnpm template:mempal ${tool}\`, then use that template.`,
      );
    }
    await requireCommand(
      sb,
      "embedding cache probe",
      'test -n "$(find "$HOME/.cache/huggingface" -name "*.safetensors" -print -quit 2>/dev/null)"',
    );
    hookLog(ctx, "[mempal] template probe passed: binary and embedding cache");

    let state: Buffer | undefined;
    try {
      state = readFileSync(statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (state) {
      await restoreCheckpoint(sb, state);
      hookLog(ctx, `[mempal] state restored from ${ctx.experimentId}.tgz (${(state.length / 1024).toFixed(0)} KB)`);
    } else {
      await requireCommand(sb, "empty state initialization", "mempal init .");
      hookLog(ctx, `[mempal] no saved state for "${ctx.experimentId}", starting from empty palace`);
    }
    await requireCommand(sb, "notes dir", 'mkdir -p "$HOME/.mempal-notes"');
  };
}

/** 用 niceeval 的 provider-neutral checkpoint 原语 best-effort 回存状态。 */
export function mempalTeardown(_tool: "claude" | "codex"): SandboxHook {
  return async (sb, ctx) => {
    const statePath = statePathFor(ctx.experimentId);
    try {
      const home = (await sb.runShell('printf "%s" "$HOME"')).stdout.trim();
      const exists = await sb.runShell(`test -d '${home}/.mempal'`);
      if (exists.exitCode !== 0) {
        ctx.diagnostic({
          code: "mempal-state-missing",
          level: "warning",
          message: "[mempal] state save skipped: $HOME/.mempal does not exist; previous checkpoint preserved.",
          dedupeKey: "mempal-state-missing",
        });
        return;
      }

      const data = await createCheckpoint(
        sb,
        STATE_PATHS.map((path) => `${home}/${path}`),
      );
      mkdirSync(dirname(statePath), { recursive: true });
      const tmp = `${statePath}.tmp`;
      writeFileSync(tmp, data);
      renameSync(tmp, statePath);
      writeFileSync(
        `${statePath}.meta.json`,
        `${JSON.stringify(
          {
            experimentId: ctx.experimentId,
            cohort: mempalFlags().mempalCohort,
            mempalVersion: MEMPAL_VERSION,
            sha256: createHash("sha256").update(data).digest("hex"),
            bytes: data.length,
            savedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      hookLog(ctx, `[mempal] state saved to ${ctx.experimentId}.tgz (${(data.length / 1024).toFixed(0)} KB)`);
    } catch (error) {
      ctx.diagnostic({
        code: "mempal-state-save-failed",
        level: "warning",
        message: `[mempal] state save failed: ${error instanceof Error ? error.message : String(error)}`,
        dedupeKey: "mempal-state-save-failed",
      });
    }
  };
}
