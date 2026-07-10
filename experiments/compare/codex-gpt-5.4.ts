import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { codexAgent } from "niceeval/adapter";

// compare 组的另一半:同模型(gpt-5.4)下的 codex,作为「没有 tape 那套记忆机制」的对照。
// bub(tape)在记忆题上若稳定高于 codex,就是 tape 价值的证据。
export default defineExperiment({
  description: "codex · gpt-5.4",
  agent: codexAgent(),
  model: "gpt-5.4", // → ctx.model → niceeval codex adapter 写进 config.toml 的 model 行
  sandbox: e2bSandbox({ template: "fasteval-agents" }), // e2b 云沙箱(fasteval-agents 模板)
  // 代理(base_url + key)走 .env,由 niceeval codex adapter 配成自定义 model_provider(wire_api=responses)
  runs: 1,
  earlyExit: false,
  budget: 15,
  // 与 claude 组对齐(重型题 mvn build / pytest 可能超 10 分钟),消除条件间超时偏置。
  timeoutMs: 1200000,
});
