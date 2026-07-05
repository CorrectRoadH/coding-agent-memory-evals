import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";

// dev/e2b 组:claude code CLI 接 deepseek 代理(ANTHROPIC_BASE_URL 覆盖),模型 deepseek-v4-flash。
// 复用预制模板 fasteval-agents(已烘焙 claude-code),setup 跳过安装。
export default defineExperiment({
  description: "claude-code · deepseek-v4-flash · E2B sandbox",
  agent: claudeCodeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  }),
  model: "deepseek-v4-flash",
  sandbox: e2bSandbox({ template: "fasteval-agents" }),
  runs: 1,
  earlyExit: true,
  budget: 2,
  timeoutMs: 1200000,
});
