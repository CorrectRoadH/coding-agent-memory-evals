import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { nowledgeCodexConfig, nowledgeFlags, NOWLEDGE_PROVENANCE_FLAGS, nowledgeSandboxSetup } from "../shared/nowledge.ts";

// dev-e2b 的 Nowledge Mem 记忆条件冒烟:与 baseline(codex-gpt-5.4-mini.ts)同任务同模型,
// 只叠加 Nowledge Mem 官方 codex 集成(远程 HTTP MCP + 插件 hooks + nmem CLI)。
// mem 服务端是 .env 里的固定远程实例(见 shared/nowledge.ts 文件头),无生命周期,直接
// `pnpm exec niceeval exp dev-e2b/codex-gpt-5.4-mini-nowledge <eval>` 即可;MCP 的 url/headers
// 是惰性 getter,agent.setup 才现读 .env,见 nowledgeMcpServer。注意:冒烟写入与正式 compare
// 实验进的是同一个积累库。
export default defineExperiment({
  evals: ["memory"],
  description: "codex · gpt-5.4-mini + Nowledge Mem(dev-e2b:E2B 上的记忆条件冒烟)",
  agent: codexAgent(nowledgeCodexConfig()),
  flags: nowledgeFlags(),
  provenanceFlags: NOWLEDGE_PROVENANCE_FLAGS,
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }).setup(nowledgeSandboxSetup()),
  runs: 1,
  earlyExit: true,
  // 与 baseline 对齐:astropy eval 两阶段都要源码构建,别用全局 600s
  timeoutMs: 2_700_000,
});
