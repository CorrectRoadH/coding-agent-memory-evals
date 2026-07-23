import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { e2bSandbox } from "niceeval/sandbox";

// dev/e2b 组:claude code CLI 接 deepseek 代理(ANTHROPIC_BASE_URL 覆盖),模型 deepseek-v4-flash。
// 使用 NiceEval release-pinned 公共 Claude Code template；环境变量可切换到项目派生版本。
export default defineExperiment({
  evals: ["react-hook-form/", "react-datepicker/", "downshift/", "react-tooltip/", "yet-another-react-lightbox/", "toggl-cli/"],
  description: "claude-code · deepseek-v4-flash · E2B sandbox",
  labels: { line: "claude" },  // 报告归类:同 line 值连成一条线(baseline → 变体),见 niceeval docs「labels」
  agent: claudeCodeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  }),
  flags: { memory: "baseline" },
  model: "deepseek-v4-flash",
  sandbox: e2bSandbox({ template: NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE }),
  runs: 1,
  earlyExit: true,
  timeoutMs: 1200000,
});
