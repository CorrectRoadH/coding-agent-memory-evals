import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { mempalMcp, mempalSetup, mempalTeardown, mempalTemplate } from "../shared/mempal.ts";

// dev/e2b 组的 mempal 变体:验证 claude-code 侧全链路(构造期 MCP + 沙箱 setup
// 装的 Stop hook + 记忆态跨 eval 累积)用的便宜配置,正式对比走 compare/ 组。
// 记忆按 ctx.experimentId(即本实验的路径推导 id `dev-e2b/claude-e2b--mempal`)跨 eval /
// 跨 run 累积;干净验证前 rm -rf .cache/mempal/state/。
export default defineExperiment({
  description: "claude-code · deepseek-v4-flash · E2B · mempal",
  agent: claudeCodeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    mcpServers: [mempalMcp],
  }),
  model: "deepseek-v4-flash",
  sandbox: e2bSandbox({ template: mempalTemplate("claude") }).setup(mempalSetup("claude")).teardown(mempalTeardown("claude")),
  runs: 1,
  earlyExit: true,
  budget: 2,
  // 串行跑(niceeval ≥0.4.5 按实验限流):记忆态载入/回存的临界区靠它,不再用锁。
  maxConcurrency: 1,
  timeoutMs: 1200000,
});
