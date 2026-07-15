import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { e2bSandbox } from "niceeval/sandbox";
import { withAgentsMd } from "../shared/agents-md.ts";

// dev/e2b 组:claude code CLI 接 deepseek 代理(ANTHROPIC_BASE_URL 覆盖),模型 deepseek-v4-flash。
// 使用 NiceEval release-pinned 公共 Claude Code template；环境变量可切换到项目派生版本。
//
// --agents-md 变体只改变沙箱环境里的静态说明文件，不包装官方 adapter，也不运行时安装依赖。

export default defineExperiment({
  evals: ["memory"],
  description: "claude-code · deepseek-v4-flash · E2B sandbox · AGENTS.md",
  agent: claudeCodeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  }),
  flags: { memory: "agents-md" },
  model: "deepseek-v4-flash",
  sandbox: withAgentsMd(e2bSandbox({ template: NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE })),
  runs: 1,
  earlyExit: true,
  budget: 2,
  timeoutMs: 1200000,
});
