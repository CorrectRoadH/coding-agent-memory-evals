import { defineSandboxAgent, shared, requireEnv, type StreamEvent } from "fastevals";

// ───────────────────────────────────────────────────────────────────────────
// OpenAI Codex 的 agent adapter(沙箱型)。
//
// 形状和 claude-code 一模一样,只有 5 个「per-agent 差异点」不同 —— 这正是
// 「同一套 agent 模型」的意义:差异全关在 adapter 内部,运行器只看到
// 「一次 send → 一个带标准事件流的 Turn」。
//
// 配置归属同 claude-code:鉴权本地、模型留空(ctx.model)、flags 透传(ctx.flags)。
// ⚠️ 仅示意,未必真能跑。
// ───────────────────────────────────────────────────────────────────────────

// 本地配:Codex 用 `codex login --with-api-key` 鉴权,key 在这里读
const apiKey = () => requireEnv("OPENAI_API_KEY");

export default defineSandboxAgent({
  name: "codex",
  capabilities: { conversation: true, toolObservability: true, workspace: true },

  async send(input, ctx) {
    const sb = ctx.sandbox;
    await shared.ensureInstalled(sb, "npm", ["install", "-g", "@openai/codex"]);

    // 模型/参数写进 profile(Codex 的 CLI 默认会回落到 "low",必须显式写)。
    // 模型来自 ctx.model(实验给);省略则不写 model 行,用 Codex 原生默认。
    const modelLine = ctx.model ? `model = "${ctx.model}"\n` : "";
    const effort = ctx.flags.effort ?? "high"; // 读实验 feature flag
    await shared.writeFile(sb, "~/.codex/default.config.toml", `${modelLine}reasoning_effort = "${effort}"\n`);

    const resume = !ctx.session.isNew && ctx.session.id ? ` resume ${ctx.session.id}` : "";
    const escaped = input.text.replace(/'/g, "'\\''");
    const res = await sb.runShell(
      `echo '${apiKey()}' | codex login --with-api-key && ` +
        `codex exec --profile default --json --dangerously-bypass-approvals-and-sandbox${resume} '${escaped}'`,
    );

    const raw = shared.extractJsonlFromStdout(res.stdout); // --json stdout 即 JSONL
    ctx.session.id = shared.codexThreadId(res.stdout);
    return {
      events: parseCodex(raw), // ← 原始 JSONL → 标准 StreamEvent[]
      status: res.exitCode === 0 ? "completed" : "failed",
    };
  },

  // Codex 的私人记忆:~/.codex 与 AGENTS.md
  async readMemory(ctx) {
    return shared.readFiles(ctx.sandbox, ["~/.codex/**", "./AGENTS.md"]);
  },
});

// o11y/parsers/codex:把 Codex 的 JSONL 映射成标准 StreamEvent[](示意)
declare function parseCodex(rawJsonl: string | undefined): StreamEvent[];
