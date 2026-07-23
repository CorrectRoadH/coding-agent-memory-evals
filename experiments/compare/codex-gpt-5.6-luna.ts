import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { codexAgent } from "niceeval/adapter";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";

// compare 组的另一半:同模型(gpt-5.6-luna)下的 codex,作为「没有 tape 那套记忆机制」的对照。
// bub(tape)在记忆题上若稳定高于 codex,就是 tape 价值的证据。
export default defineExperiment({
  evals: ["react-hook-form/", "react-datepicker/", "downshift/", "react-tooltip/", "yet-another-react-lightbox/"],
  description: "codex · gpt-5.6-luna",
  labels: { line: "codex" },  // 报告归类:同 line 值连成一条线(baseline → 变体),见 niceeval docs「labels」
  agent: codexAgent(),
  flags: { memory: "baseline" },
  model: "gpt-5.6-luna", // → ctx.model → niceeval codex adapter 写进 config.toml 的 model 行
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }),
  // 代理(base_url + key)走 .env,由 niceeval codex adapter 配成自定义 model_provider(wire_api=responses)
  runs: 1,
  earlyExit: false,
  budget: 200,  // 不设实际上限:evals 目录前缀展开成 30 个 eval,$15 盖不住(mempal/nowledge 跑到一半就 budget_exhausted 留 unstarted),200 作 runaway backstop
  // 与 claude 组对齐(重型题 mvn build / pytest 可能超 10 分钟),消除条件间超时偏置。
  timeoutMs: 1200000,
});
