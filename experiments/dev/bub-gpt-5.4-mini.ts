import { defineExperiment } from "fastevals";

// dev/smoke 组的另一半:bub · gpt-5.4-mini。与 codex-gpt-5.4-mini 同模型,
// 快速验证 bub 这条管线(装 uv+bub、tape 跨会话、解析用量)在便宜模型下也跑得通。
//
// ⚠️ bub 是「全量重放」(每轮重载整条 tape),长程压缩题 token 仍会滚雪球——
// 便宜模型只降单价。dev 期建议只跑 `fastevals exp dev memory/multi-session-synthesis`
// (3 轮、最便宜),它就能复现 bub(tape)✓ vs codex ✗ 的跨会话记忆对照。
export default defineExperiment({
  description: "bub · gpt-5.4-mini(dev/smoke,便宜快速验证)",
  agent: "bub",
  model: "gpt-5.4-mini", // → ctx.model → agents/bub.ts 的 BUB_MODEL=openai:gpt-5.4-mini
  sandbox: "docker",
  runs: 1,
  earlyExit: true,
  budget: 2,
});
