import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";

// dev/e2b 组:用 E2B 官方 Codex template；环境变量可切换到项目派生版本。
export default defineExperiment({
  description: "codex · gpt-5.4-mini · E2B sandbox",
  agent: codexAgent(),
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: process.env.CODEX_E2B_TEMPLATE ?? "codex" }),
  runs: 1,
  earlyExit: true,
  budget: 2,
  // repomod 的 build + terminal 的 pytest 合计可能超 10 分钟;给 20 分钟宽裕。
  timeoutMs: 1200000,
});
