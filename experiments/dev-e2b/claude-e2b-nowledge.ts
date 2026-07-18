import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { nowledgeClaudeConfig, nowledgeFlags, nowledgeLifecycle } from "../shared/nowledge.ts";

// dev-e2b 的 Nowledge Mem 记忆条件冒烟(claude-code 侧):与 baseline(claude-e2b.ts)同任务同模型,
// 只叠加 Nowledge Mem 官方 claude-code 集成。codex 侧那些摩擦这里全不存在——插件官方 hooks.json
// 声明的 SessionStart(读)/UserPromptSubmit(读指引)/Stop(写)在 `claude plugin install` 后即生效,
// 读写都走 nmem CLI(client 配置由 nowledge.sandboxSetup() 指向隧道),不需 install 脚本 /
// hook-trust bypass / 远程 MCP 覆盖(插件根无 .mcp.json)。细节见 experiments/shared/nowledge.ts
// 的 Claude Code 段。
// mem 实例(容器 + cloudflared 隧道 + API key)由 nowledgeLifecycle() 工厂的 setup/teardown
// 自动激活/反激活,直接 `pnpm exec niceeval exp dev-e2b/claude-e2b-nowledge <eval>` 即可。
const nowledge = nowledgeLifecycle();

export default defineExperiment({
  evals: ["memory"],
  description: "claude-code · deepseek-v4-flash + Nowledge Mem(dev-e2b:E2B 上的记忆条件冒烟)",
  agent: claudeCodeAgent({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    ...nowledgeClaudeConfig(),
  }),
  flags: nowledgeFlags(),
  model: "deepseek-v4-flash",
  sandbox: e2bSandbox({ template: NICEEVAL_CLAUDE_CODE_E2B_TEMPLATE }).setup(nowledge.sandboxSetup()),
  setup: nowledge.setup,
  teardown: nowledge.teardown,
  runs: 1,
  earlyExit: true,
  budget: 5,
  // 与 codex 变体对齐:astropy eval 两阶段都要源码构建,别用全局 600s(冒烟只挑轻 eval 时用不满)
  timeoutMs: 2_700_000,
});
