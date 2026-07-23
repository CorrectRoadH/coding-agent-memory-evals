import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";

// dev/e2b 组:claude code CLI 接 deepseek 代理(ANTHROPIC_BASE_URL 覆盖),模型 deepseek-v4-flash。
// 用 NiceEval release-pinned 公共 Claude Code 模板,CLI 已烘焙,attempt 里零安装。
export default defineExperiment({
  description: "claude-code · deepseek-v4-flash · E2B sandbox",
  agent: claudeCodeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  }),
  flags: { memory: "baseline" },
  model: "deepseek-v4-flash",
  sandbox: e2bSandbox({ template: NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE }),
  evals: ["memory"],
  runs: 1,
  earlyExit: true,
  timeoutMs: 1200000,
});
