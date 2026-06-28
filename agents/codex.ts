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

// 本地配:这条 channel 怎么连它自己的后端 —— 走一个 OpenAI 兼容代理(s2a)。
// base_url + key 都从 env 读(.env,见 .env.example);model 由实验给(ctx.model)。
// 设了 CODEX_BASE_URL 就走自定义 model_provider;否则回落到 OpenAI 官方 login。
const proxyBase = () => process.env.CODEX_BASE_URL; // 如 https://s2a.jihuayu.site/v1
const apiKey = () => requireEnv("CODEX_API_KEY"); // 代理 key(无代理时也可放 OPENAI_API_KEY)

export default defineSandboxAgent({
  name: "codex",
  capabilities: { conversation: true, toolObservability: true, workspace: true },

  async send(input, ctx) {
    const sb = ctx.sandbox;
    await shared.ensureInstalled(sb, "npm", ["install", "-g", "@openai/codex"]);

    const model = ctx.model ?? "gpt-5.4"; // 模型来自实验(ctx.model)
    const effort = ctx.flags.effort ?? "high"; // 读实验 feature flag
    const base = proxyBase();

    // 写 ~/.codex/config.toml。注意:adapter 每次 send 都重写它 —— 所以代理配置必须在这里、
    // 不能放进实验的 setup(会被这次重写盖掉)。自定义 provider 见 developers.openai.com/codex/config-advanced。
    let cmd: string;
    if (base) {
      // wire_api="responses" → codex 调 {base_url}/responses,正好匹配代理的 /v1/responses。
      // key 经 env_key(CODEX_API_KEY)注入,因此【不跑 codex login】。
      await shared.writeFile(
        sb,
        "~/.codex/config.toml",
        `model = "${model}"\n` +
          `model_provider = "s2a"\n` +
          `reasoning_effort = "${effort}"\n\n` +
          `[model_providers.s2a]\n` +
          `name = "s2a"\n` +
          `base_url = "${base}"\n` +
          `env_key = "CODEX_API_KEY"\n` +
          `wire_api = "responses"\n`,
      );
      const resume = !ctx.session.isNew && ctx.session.id ? ` resume ${ctx.session.id}` : "";
      const escaped = input.text.replace(/'/g, "'\\''");
      const res = await sb.runShell(
        `codex exec --json --dangerously-bypass-approvals-and-sandbox${resume} '${escaped}'`,
        { env: { CODEX_API_KEY: apiKey() } }, // 注入 env_key 指向的变量
      );
      const raw = shared.extractJsonlFromStdout(res.stdout);
      ctx.session.id = shared.codexThreadId(res.stdout);
      return { events: parseCodex(raw), status: res.exitCode === 0 ? "completed" : "failed" };
    }

    // 无代理:回落到 OpenAI 官方 login 路径
    await shared.writeFile(sb, "~/.codex/config.toml", `model = "${model}"\nreasoning_effort = "${effort}"\n`);
    const resume = !ctx.session.isNew && ctx.session.id ? ` resume ${ctx.session.id}` : "";
    const escaped = input.text.replace(/'/g, "'\\''");
    const res = await sb.runShell(
      `echo '${apiKey()}' | codex login --with-api-key && ` +
        `codex exec --json --dangerously-bypass-approvals-and-sandbox${resume} '${escaped}'`,
    );
    const raw = shared.extractJsonlFromStdout(res.stdout);
    ctx.session.id = shared.codexThreadId(res.stdout);
    return { events: parseCodex(raw), status: res.exitCode === 0 ? "completed" : "failed" };
  },

  // Codex 的私人记忆:~/.codex 与 AGENTS.md
  async readMemory(ctx) {
    return shared.readFiles(ctx.sandbox, ["~/.codex/**", "./AGENTS.md"]);
  },
});

// o11y/parsers/codex:把 Codex 的 JSONL 映射成标准 StreamEvent[](示意)
declare function parseCodex(rawJsonl: string | undefined): StreamEvent[];
