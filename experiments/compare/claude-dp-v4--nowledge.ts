import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { nowledgeClaudeConfig, nowledgeFlags, NOWLEDGE_PROVENANCE_FLAGS, nowledgeSandboxSetup } from "../shared/nowledge.ts";

// claude-dp-v4 的 Nowledge Mem 变体:同模型同沙箱,只多一层 Nowledge Mem 记忆条件 ——
// 官方 claude-code 插件(装上即挂 SessionStart 读 / UserPromptSubmit 指引 / Stop 写 的 lifecycle
// hooks,无 install 脚本、无 hook-trust、插件根无 .mcp.json 故不叠远程 MCP,读写都走 nmem CLI)。
// 对照 claude-dp-v4.ts 看 pass 率与效率(时间/token/重复失败命令)的差异。dev-e2b/claude-e2b-nowledge
// 已冒烟跑通(probe 实锤 Stop hook 落 thread 到服务端)。
//
// mem 服务端是长期运行的固定远程实例(连接坐标在 .env,见 shared/nowledge.ts 文件头):
// niceeval 侧无任何生命周期,沙箱钩子只做接线,记忆跨 run / 跨实验持续积累,与 mempal
// 「状态跨 run 存续」对齐。同批的 codex-gpt-5.6-luna--nowledge 共用同一个库;正式对比要说清
// 起点库状态。license 在服务端侧一次性激活(device 固定,seat 稳定占一个,不再随 run 增长);
// free tier memory 上限 50,持久积累库容易撞上限,正式跑前确认服务端是 pro。
// 隔离:中心化 server 下并行 attempt 共享同一记忆库,故 maxConcurrency:1 串行 —— 让跨 eval 的记忆
// 累积顺序确定(eval N 读得到 eval N-1 写的),与 mempal 条件语义对齐。
export default defineExperiment({
  evals: ["react-hook-form/", "react-datepicker/", "downshift/", "react-tooltip/", "yet-another-react-lightbox/", "toggl-cli/"],
  description: "claude-code · deepseek-v4-flash · Nowledge Mem",
  labels: { line: "claude" },  // 报告归类:同 line 值连成一条线(baseline → 变体),见 niceeval docs「labels」
  agent: claudeCodeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    ...nowledgeClaudeConfig(),
  }),
  flags: { ...nowledgeFlags() },
  provenanceFlags: NOWLEDGE_PROVENANCE_FLAGS,
  model: "deepseek-v4-flash",
  sandbox: e2bSandbox({ template: NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE }).setup(nowledgeSandboxSetup()),
  runs: 1,
  earlyExit: true,
  // 串行:中心化记忆库跨 attempt 共享,串行让累积顺序确定(对齐 claude-dp-v4--mempal 语义)。
  maxConcurrency: 1,
  timeoutMs: 1200000,
});
