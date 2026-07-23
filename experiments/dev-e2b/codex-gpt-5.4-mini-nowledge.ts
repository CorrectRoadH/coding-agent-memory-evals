import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { nowledgeCodexConfig, nowledgeFlags, nowledgeLifecycle } from "../shared/nowledge.ts";

// dev-e2b 的 Nowledge Mem 记忆条件冒烟:与 baseline(codex-gpt-5.4-mini.ts)同任务同模型,
// 只叠加 Nowledge Mem 官方 codex 集成(远程 HTTP MCP + 插件 hooks + nmem CLI)。
// mem 实例(容器 + cloudflared 隧道 + API key)由 nowledgeLifecycle() 工厂的 setup/teardown
// 自动激活/反激活,直接 `pnpm exec niceeval exp dev-e2b/codex-gpt-5.4-mini-nowledge <eval>`
// 即可;MCP 的 url/headers 是惰性 getter,agent.setup(晚于实验 setup)才读,见 nowledgeMcpServer。
const nowledge = nowledgeLifecycle();

export default defineExperiment({
  evals: ["memory"],
  description: "codex · gpt-5.4-mini + Nowledge Mem(dev-e2b:E2B 上的记忆条件冒烟)",
  agent: codexAgent(nowledgeCodexConfig(nowledge.endpoint)),
  flags: nowledgeFlags(),
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }).setup(nowledge.sandboxSetup()),
  setup: nowledge.setup,
  teardown: nowledge.teardown,
  runs: 1,
  earlyExit: true,
  // 与 baseline 对齐:astropy eval 两阶段都要源码构建,别用全局 600s
  timeoutMs: 2_700_000,
});
