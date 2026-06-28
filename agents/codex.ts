import { defineSandboxAgent, shared, requireEnv } from "fastevals";

// ───────────────────────────────────────────────────────────────────────────
// OpenAI Codex 的 agent adapter(沙箱型)。
//
// 连接方式:在沙箱里 spawn `codex exec --json`,让它在沙箱文件系统上自己跑工具,
// 跑完从 stdout 的 JSONL 抠出 transcript,经 shared.parseCodex 解析成标准事件流。
//
// 配置归属:
//   · 鉴权(base_url + key)—— 本地配,走 .env 的 s2a 代理(OpenAI 兼容,wire_api=responses);
//   · 模型 —— 留空交给实验(ctx.model);无实验时兜底 gpt-5.4;
//   · feature flags —— experiment 经 ctx.flags 透传(effort)。
//
// memory eval 是「多轮」:同一 eval 的多次 send 落在同一沙箱、`codex exec resume <id>`
// 续接同一会话;t.newSession() 则开新 thread(同沙箱)。
// ───────────────────────────────────────────────────────────────────────────

// 本地配:这条 channel 怎么连它自己的后端 —— 走一个 OpenAI 兼容代理(s2a)。
const proxyBase = () => process.env.CODEX_BASE_URL; // 如 https://s2a.jihuayu.site/v1
const apiKey = () => requireEnv("CODEX_API_KEY"); // 代理 key

export default defineSandboxAgent({
  name: "codex",
  // compactionObservability:codex 的 `codex exec --json` stdout 流【不暴露】压缩/摘要事件
  //(压缩只在 ~/.codex/sessions 的 rollout 文件里、且 exec 模式覆盖不全)。所以解析 stdout 时
  //  t.transcript.compactions() 恒为 0 → 长程压缩类 eval 自动 skip(不误判 agent 挂)。
  capabilities: { conversation: true, toolObservability: true, workspace: true, compactionObservability: true },

  async send(input, ctx) {
    const sb = ctx.sandbox;
    await shared.ensureInstalled(sb, "npm", ["install", "-g", "@openai/codex"]);

    const model = ctx.model ?? "gpt-5.4"; // 模型来自实验(ctx.model);无则兜底
    const effort = (ctx.flags.effort as string | undefined) ?? "medium"; // 读实验 feature flag
    const base = proxyBase();

    // 写 ~/.codex/config.toml:adapter 每次 send 都重写(代理配置必须在这里,不能放进实验 setup)。
    if (base) {
      // wire_api="responses" → codex 调 {base_url}/responses,匹配代理的 /v1/responses。
      // key 经 env_key(CODEX_API_KEY)注入,因此【不跑 codex login】。
      await shared.writeFile(
        sb,
        "~/.codex/config.toml",
        `model = "${model}"\n` +
          `model_provider = "s2a"\n` +
          `model_reasoning_effort = "${effort}"\n\n` +
          `[model_providers.s2a]\n` +
          `name = "s2a"\n` +
          `base_url = "${base}"\n` +
          `env_key = "CODEX_API_KEY"\n` +
          `wire_api = "responses"\n`,
      );
    } else {
      // 无代理:回落到 OpenAI 官方(需要 OPENAI_API_KEY / codex login)。
      await shared.writeFile(sb, "~/.codex/config.toml", `model = "${model}"\nmodel_reasoning_effort = "${effort}"\n`);
    }

    // 拼调用:resume 是 exec 的子命令,必须紧跟 exec;flag 放其后。
    const flags = "--json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check";
    const escaped = input.text.replace(/'/g, "'\\''");
    const resuming = !ctx.session.isNew && ctx.session.id;
    const cmd = resuming
      ? `codex exec resume ${ctx.session.id} ${flags} '${escaped}'`
      : `codex exec ${flags} '${escaped}'`;

    const res = await sb.runShell(cmd, { env: { CODEX_API_KEY: apiKey() } });

    // stdout 即 JSONL transcript;抠出 → 解析成标准事件流 + 用量。
    const raw = shared.extractJsonlFromStdout(res.stdout);
    ctx.session.id = shared.codexThreadId(res.stdout) ?? ctx.session.id; // 回传供下轮 resume
    const parsed = shared.parseCodex(raw);
    return {
      events: parsed.events,
      usage: parsed.usage,
      status: res.exitCode === 0 ? "completed" : "failed",
    };
  },
});
