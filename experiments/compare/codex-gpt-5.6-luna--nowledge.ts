import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { withAgentsMd } from "../shared/agents-md.ts";
import { nowledgeCodexConfig, nowledgeFlags, nowledgeLifecycle } from "../shared/nowledge.ts";

// codex-gpt-5.6-luna 的 Nowledge Mem 变体:同模型同沙箱,只多一层 Nowledge Mem 记忆条件 ——
// 官方 codex 集成(远程 HTTP MCP 读路径 + 插件 lifecycle hooks 写路径 + nmem CLI),
// 全链路已在 dev-e2b/codex-gpt-5.4-mini-nowledge 冒烟闭环确认(Stop hook 落 thread、
// agent 主动 nmem m search/add),此前只差把它搬进 compare 组用真实对比模型 gpt-5.6-luna 跑。
// 对照 codex-gpt-5.6-luna.ts 看 pass 率与效率(时间/token/重复失败命令)的差异。
//
// 中心化 mem 服务端 + 隧道由 nowledgeLifecycle() 工厂的 setup/teardown 管理:niceeval 在本实验
// 第一个 attempt 前激活一个全新实例(空记忆库,状态起点干净),全部 attempt 收尾后 probe + down
// 反激活——`pnpm exec niceeval exp compare` 一条命令跑齐全部 config,无需 wrapper 脚本;激活失败
// 只让本实验记 errored,不污染同批其它实验。
// 隔离:中心化 server 下并行 attempt 共享同一记忆库,故 maxConcurrency:1 串行 —— 让跨 eval 的记忆
// 累积顺序确定(eval N 读得到 eval N-1 写的),与 claude-dp-v4--nowledge 语义对齐。
//
// 叠 withAgentsMd:理由同 claude-dp-v4--nowledge.ts。codex 侧 nowledgePostSetup() 本来就会把插件
// 自带的 AGENTS.md(教 agent 用 nmem/MCP 搜记忆,不含任何 Next.js 内容)`cat >>` 追加进项目
// AGENTS.md——withAgentsMd 的 writeFiles 落在更早的 sandbox.setup 阶段,postSetup 追加在后,
// 顺序上不会互相覆盖(实测轨迹已确认:`cat >> 'AGENTS.md' <<...` 命令 exitCode 0)。副作用:
// AGENTS.md 从此在 agent.setup 前就存在,appendProjectInstruction 的 `!existed` 分支不再触发,
// 那个本就失效的 excludeFromDiff(`test -d .git` 在真实 workspace 里恒为假,ledger 是独立
// git 仓库在 /tmp/.niceeval-ledger)被跳过——AGENTS.md 会稳定出现在 diff 里,便于核对写了什么。
const nowledge = nowledgeLifecycle();

export default defineExperiment({
  evals: ["memory"],
  description: "codex · gpt-5.6-luna · Nowledge Mem + AGENTS.md",
  labels: { line: "codex" },  // 报告归类:同 line 值连成一条线(baseline → 变体),见 niceeval docs「labels」
  agent: codexAgent(nowledgeCodexConfig(nowledge.endpoint)),
  flags: { ...nowledgeFlags(), agentsMdHint: true },
  model: "gpt-5.6-luna",
  sandbox: withAgentsMd(e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }).setup(nowledge.sandboxSetup())),
  setup: nowledge.setup,
  teardown: nowledge.teardown,
  runs: 1,
  earlyExit: false,
  budget: 15,
  // 串行:中心化记忆库跨 attempt 共享,串行让累积顺序确定(对齐 claude-dp-v4--nowledge 语义)。
  maxConcurrency: 1,
  // 与 codex baseline/mempal 对齐,astropy eval 两阶段都要源码构建。
  timeoutMs: 1200000,
});
