import { defineSandboxAgent, shared, requireEnv } from "fastevals";

// ───────────────────────────────────────────────────────────────────────────
// Claude Code 的 agent adapter(沙箱型)。
//
// 连接方式不是 wire 协议,而是:在沙箱里 spawn `claude` CLI、把 prompt 当参数
// 丢进去、让它在沙箱文件系统上自己跑工具,跑完读回 transcript。
// adapter 的核心活 = 把原始 transcript 解析成标准 StreamEvent[](所有断言查它)。
//
// 配置归属(关键):
//   · 本地配 —— 鉴权(下面的 auth)、CLI 细节、transcript / 私人记忆位置;
//   · 留空   —— 模型!agent 不写死,由 experiment 给,从 ctx.model 拿;
//   · 透传   —— experiment 的 feature flags 经 ctx.flags 进来。
//
// memory eval 是「多轮」:同一 eval 的多次 send 落在同一沙箱、resume 同一会话,
// 所以私人记忆持久;t.newSession() 则「新会话、同沙箱」,持久记忆仍在。
// 下面只示意形状,未必真能跑(注释为主)。
// ───────────────────────────────────────────────────────────────────────────

// 本地配:这个 agent 怎么连它自己 —— API key 在这里读,与「跑哪个模型」无关
const auth = () => ({ ANTHROPIC_API_KEY: requireEnv("ANTHROPIC_API_KEY") });

export default defineSandboxAgent({
  name: "claude-code",
  // compactionObservability:transcript 解析器能数出本会话的自动压缩次数,
  // 供长程压缩类 eval 的 t.transcript.compactions() 守卫用。
  capabilities: { conversation: true, toolObservability: true, workspace: true, compactionObservability: true },
  // 注意:没有 defaultModel、没有 apiKeyEnvVar —— 模型留空交给实验,鉴权本地自理

  async send(input, ctx) {
    const sb = ctx.sandbox; // 同一个 eval 的多轮共享同一个沙箱
    await shared.ensureInstalled(sb, "npm", ["install", "-g", "@anthropic-ai/claude-code"]);

    const args = ["--print", "--dangerously-skip-permissions"];
    if (ctx.model) args.push("--model", ctx.model);                 // 实验给了才传;否则用 CLI 原生默认
    if (ctx.flags.webResearch) args.push("--allowedTools", "WebSearch,WebFetch"); // 读实验 feature flag
    if (!ctx.session.isNew && ctx.session.id) args.push("--resume", ctx.session.id); // 多轮续接
    args.push(input.text);

    const res = await sb.runCommand("claude", args, { env: auth() }); // 鉴权来自本地 auth()

    const raw = await shared.captureLatestJsonl(sb, "~/.claude/projects");
    ctx.session.id = shared.sessionIdFromClaudeTranscript(raw) ?? ctx.session.id; // 回传供下一轮 resume
    const parsed = shared.parseClaudeCode(raw); // ← 原始 JSONL → 标准 StreamEvent[] + token 用量
    return {
      events: parsed.events,
      usage: parsed.usage,
      status: res.exitCode === 0 ? "completed" : "failed",
    };
  },
});
