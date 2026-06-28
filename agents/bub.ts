import { defineSandboxAgent, shared, requireEnv, type StreamEvent } from "fastevals";

// ───────────────────────────────────────────────────────────────────────────
// bub 的 agent adapter(沙箱型)—— 占位/示意。
//
// 按同一套 agent 模型猜一个最小形状:同样只填那 5 个 per-agent 差异点,
// 其余(沙箱编排、diff、验证、事件流归一化)全部复用 shared。
// 配置归属同前:鉴权本地、模型留空(ctx.model)、flags 透传(ctx.flags)。
//
// ⚠️ CLI 名 / 参数 / transcript 路径都是假设,真接 bub 时按其文档校正。
// ───────────────────────────────────────────────────────────────────────────

const auth = () => ({ BUB_API_KEY: requireEnv("BUB_API_KEY") });

export default defineSandboxAgent({
  name: "bub",
  capabilities: { conversation: true, toolObservability: true, workspace: true },

  async send(input, ctx) {
    const sb = ctx.sandbox;
    await shared.ensureInstalled(sb, "npm", ["install", "-g", "@bub/cli"]);

    const args = ["run", "--yes", "--json"];
    if (ctx.model) args.push("--model", ctx.model);                 // 实验给了才传
    if (ctx.flags.webResearch) args.push("--web");                  // 读实验 feature flag(假设)

    // tape 消融开关(experiments/tape-ablation 的「下限」运行):
    // noTape=true 时不 resume 上一轮的 tape,并让 tape store 不落盘 ——
    // 等于把 bub 的持久记忆机制关掉,只剩当前这一条 prompt。
    // 跨记忆缺口的题在此模式下应当大面积挂掉;它与 tape-on 的通过率差,就是 tape 的净贡献。
    const noTape = ctx.flags.noTape === true;
    const env = { ...auth(), ...(noTape ? { BUB_TAPE_DISABLED: "1" } : {}) };
    if (!noTape && !ctx.session.isNew && ctx.session.id) args.push("--session", ctx.session.id);
    args.push(input.text);

    const res = await sb.runCommand("bub", args, { env });

    const raw = await shared.captureLatestJsonl(sb, "~/.bub/sessions");
    ctx.session.id = shared.firstJsonField(raw, "sessionId");
    return {
      events: parseBub(raw), // ← 原始 JSONL → 标准 StreamEvent[]
      status: res.exitCode === 0 ? "completed" : "failed",
    };
  },

  async readMemory(ctx) {
    return shared.readFiles(ctx.sandbox, ["~/.bub/memory/**", "./BUB.md"]);
  },
});

// o11y/parsers/bub:把 bub 的 JSONL 映射成标准 StreamEvent[](示意,真接 bub 时实现)
declare function parseBub(rawJsonl: string | undefined): StreamEvent[];
