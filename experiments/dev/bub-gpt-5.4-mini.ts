import { defineExperiment, bubAgent } from "fasteval";

// dev/smoke 组的另一半:bub · gpt-5.4-mini。与 codex-gpt-5.4-mini 同模型,
// 快速验证 bub 这条管线(装 uv+bub、tape 跨会话、解析用量)在便宜模型下也跑得通。
//
// dev 期锁在较小的 cache eval 上,用于快速验证 bub 这条管线
// (装 uv+bub、运行 Next starter、解析用量)在便宜模型下也跑得通。
export default defineExperiment({
  description: "bub · gpt-5.4-mini(dev/smoke,便宜快速验证)",
  agent: bubAgent(),
  model: "gpt-5.4-mini", // → ctx.model → agents/bub.ts 的 BUB_MODEL=openai:gpt-5.4-mini
  sandbox: "docker",
  runs: 1,
  earlyExit: true,
  budget: 2,
});
