import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";

export default defineExperiment({
  description: "Codex gpt-5.4 · explicit large-task stress run",
  agent: codexAgent(),
  flags: { memory: "baseline" },
  model: "gpt-5.4",
  evals: ["stress/commit0-cachetools"],
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }),
  runs: 1,
  earlyExit: false,
  timeoutMs: 1800000,
  budget: 15,
});
