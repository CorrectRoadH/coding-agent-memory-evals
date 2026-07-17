import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";

// dev/e2b 组:用 NiceEval release-pinned 公共 Codex 模板,CLI 已烘焙,attempt 里零安装。
export default defineExperiment({
  description: "codex · gpt-5.4-mini · E2B sandbox",
  agent: codexAgent(),
  flags: { memory: "baseline" },
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }),
  evals: ["memory"],
  runs: 1,
  earlyExit: true,
  budget: 2,
  // repomod 的 build + terminal 的 pytest 合计可能超 10 分钟;给 20 分钟宽裕。
  timeoutMs: 1200000,
});
