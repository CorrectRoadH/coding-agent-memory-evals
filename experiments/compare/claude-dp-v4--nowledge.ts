import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { withAgentsMd } from "../shared/agents-md.ts";
import { nowledgeClaudeConfig, nowledgeFlags, nowledgeLifecycle } from "../shared/nowledge.ts";

// claude-dp-v4 的 Nowledge Mem 变体:同模型同沙箱,只多一层 Nowledge Mem 记忆条件 ——
// 官方 claude-code 插件(装上即挂 SessionStart 读 / UserPromptSubmit 指引 / Stop 写 的 lifecycle
// hooks,无 install 脚本、无 hook-trust、插件根无 .mcp.json 故不叠远程 MCP,读写都走 nmem CLI)。
// 对照 claude-dp-v4.ts 看 pass 率与效率(时间/token/重复失败命令)的差异。dev-e2b/claude-e2b-nowledge
// 已冒烟跑通(probe 实锤 Stop hook 落 thread 到服务端)。
//
// 中心化 mem 服务端 + 隧道由 nowledgeLifecycle() 工厂的 setup/teardown 管理:niceeval 在本实验
// 第一个 attempt 前激活一个全新实例(空记忆库,状态起点干净),全部 attempt 收尾后 probe + down
// 反激活——`pnpm exec niceeval exp compare` 一条命令跑齐 9 个 config,无需 wrapper 脚本;激活失败
// 只让本实验记 errored,不污染同批其它实验。
// 隔离:中心化 server 下并行 attempt 共享同一记忆库,故 maxConcurrency:1 串行 —— 让跨 eval 的记忆
// 累积顺序确定(eval N 读得到 eval N-1 写的),与 mempal 条件语义对齐。正式对比要 pro license
// (free tier memory 上限 50);seat 偶发用尽会降级 free,正式跑设 NOWLEDGE_REQUIRE_PRO=1 硬失败
// 以保证条件一致。
//
// 叠 withAgentsMd:agents-md 变体唯一多出的东西是 NEXT_DOCS_RULES(读 node_modules 里已装的
// Next.js 文档)——本 eval 集 ~7/11 是 Next.js canary 题,agents-md/mempal/nowledge 三条线
// 在三个 agent 家族上都是同一形状(agents-md = baseline+1 eval,mempal/nowledge = 打平 baseline),
// 说明「有没有这条 docs 提示」和「有没有记忆系统」被绑在一起测混了。这里叠上去把变量拆开:
// claude 侧 nowledge 本身不写 CLAUDE.md/AGENTS.md(读写都走插件 hooks 直接注入会话,见
// shared/nowledge.ts 头部注释),故没有覆盖/追加冲突——withAgentsMd 的 writeFiles 直接落地。
const nowledge = nowledgeLifecycle();

export default defineExperiment({
  evals: ["memory"],
  description: "claude-code · deepseek-v4-flash · Nowledge Mem + AGENTS.md",
  labels: { line: "claude" },  // 报告归类:同 line 值连成一条线(baseline → 变体),见 niceeval docs「labels」
  agent: claudeCodeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    ...nowledgeClaudeConfig(),
  }),
  flags: { ...nowledgeFlags(), agentsMdHint: true },
  model: "deepseek-v4-flash",
  sandbox: withAgentsMd(e2bSandbox({ template: NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE }).setup(nowledge.sandboxSetup())),
  setup: nowledge.setup,
  teardown: nowledge.teardown,
  runs: 1,
  earlyExit: true,
  budget: 2,
  // 串行:中心化记忆库跨 attempt 共享,串行让累积顺序确定(对齐 claude-dp-v4--mempal 语义)。
  maxConcurrency: 1,
  timeoutMs: 1200000,
});
