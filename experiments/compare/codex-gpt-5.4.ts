import { defineExperiment } from "fastevals";

// compare 组的另一半:同模型(gpt-5.4)下的 codex,作为「没有 tape 那套记忆机制」的对照。
// bub(tape)在记忆题上若稳定高于 codex,就是 tape 价值的证据。
export default defineExperiment({
  description: "codex · gpt-5.4",
  agent: "codex",
  model: "gpt-5.4",
  runs: 5,
  earlyExit: false,
  budget: 15,
});
