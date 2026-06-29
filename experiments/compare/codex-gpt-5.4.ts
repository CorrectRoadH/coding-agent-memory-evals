import { defineExperiment, codexAgent } from "fasteval";

// compare 组的另一半:同模型(gpt-5.4)下的 codex,作为「没有 tape 那套记忆机制」的对照。
// bub(tape)在记忆题上若稳定高于 codex,就是 tape 价值的证据。
export default defineExperiment({
  description: "codex · gpt-5.4",
  agent: codexAgent,
  model: "gpt-5.4", // → ctx.model → agents/codex.ts 写进 config.toml 的 model 行
  sandbox: "docker", // 本地 docker 沙箱
  // 代理(base_url + key)走 .env,由 agents/codex.ts 配成自定义 model_provider(wire_api=responses)
  runs: 1,
  earlyExit: false,
  budget: 15,
});
