import { defineExperiment } from "fastevals";

// 冒烟实验:只用 claude-code、每个 eval 跑 1 次,改完 eval 后快速验证能跑通。
export default defineExperiment({
  description: "claude-code 快速冒烟:每个记忆 eval 各跑 1 次",
  agent: "claude-code",
  runs: 1,
  // 调试时缩范围到单条:evals: ["memory/knowledge-update"]
});
