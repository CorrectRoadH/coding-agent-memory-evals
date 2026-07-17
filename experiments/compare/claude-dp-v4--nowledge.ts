import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { nowledgeClaudeConfig, nowledgeFlags, nowledgeSetup } from "../shared/nowledge.ts";

// claude-dp-v4 的 Nowledge Mem 变体:同模型同沙箱,只多一层 Nowledge Mem 记忆条件 ——
// 官方 claude-code 插件(装上即挂 SessionStart 读 / UserPromptSubmit 指引 / Stop 写 的 lifecycle
// hooks,无 install 脚本、无 hook-trust、插件根无 .mcp.json 故不叠远程 MCP,读写都走 nmem CLI)。
// 对照 claude-dp-v4.ts 看 pass 率与效率(时间/token/重复失败命令)的差异。dev-e2b/claude-e2b-nowledge
// 已冒烟跑通(probe 实锤 Stop hook 落 thread 到服务端)。
//
// 前提:先起中心化 mem 服务端 + 隧道,经 NMEM_URL/NMEM_API_KEY 注入 ——
//   scripts/exp-nowledge.sh compare/claude-dp-v4--nowledge   (up 时间戳实例 → 跑 → trap 必 down)
// 隔离:中心化 server 下并行 attempt 共享同一记忆库,故 maxConcurrency:1 串行 —— 让跨 eval 的记忆
// 累积顺序确定(eval N 读得到 eval N-1 写的),与 mempal 条件语义对齐。做干净对照前用全新实例(exp-nowledge.sh
// 每次 up 即空库),并在报告里注明状态起点。正式对比要 pro license(free tier memory 上限 50);
// seat 偶发用尽会降级 free,正式跑设 NOWLEDGE_REQUIRE_PRO=1 硬失败以保证条件一致。
export default defineExperiment({
  evals: ["memory"],
  description: "claude-code · deepseek-v4-flash · Nowledge Mem",
  agent: claudeCodeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    ...nowledgeClaudeConfig(),
  }),
  flags: nowledgeFlags(),
  model: "deepseek-v4-flash",
  sandbox: e2bSandbox({ template: NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE }).setup(nowledgeSetup()),
  runs: 1,
  earlyExit: true,
  budget: 2,
  // 串行:中心化记忆库跨 attempt 共享,串行让累积顺序确定(对齐 claude-dp-v4--mempal 语义)。
  maxConcurrency: 1,
  timeoutMs: 1200000,
});
