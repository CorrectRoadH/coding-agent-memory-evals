import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { COMMIT0_STRESS_EVALS } from "../shared/eval-selection.ts";

export default defineExperiment({
  description: "Codex gpt-5.4 · explicit large-task stress run",
  agent: codexAgent(),
  model: "gpt-5.4",
  evals: COMMIT0_STRESS_EVALS,
  sandbox: e2bSandbox({ template: process.env.CODEX_E2B_TEMPLATE ?? "codex" }),
  runs: 1,
  earlyExit: false,
  timeoutMs: 1800000,
  budget: 15,
});
