import { defineExperiment } from "fastevals";

// 演示「model 由实验给(agent 留空)」+「feature flags 透传」。
// 同一批 memory eval、同样三条 agent,但这次:指定 opus、打开联网、走严格模式。
export default defineExperiment({
  description: "联网 + 严格模式跑一遍,对比默认模式",
  agent: ["claude-code", "codex", "bub"],

  model: "opus", // 模型在实验给;agent 里是留空的

  flags: {
    webResearch: true,  // → agent 的 ctx.flags.webResearch:给 agent 联网工具
    strictSecrets: true, // → eval 的 t.flags.strictSecrets:加严密钥相关断言
  },

  runs: 3,
  earlyExit: false,
  budget: 15,
});
