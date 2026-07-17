import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { nowledgeCodexConfig, nowledgeConfigured, nowledgeFlags, nowledgeSetup } from "../shared/nowledge.ts";

// dev-e2b 的 Nowledge Mem 记忆条件冒烟:与 baseline(codex-gpt-5.4-mini.ts)同任务同模型,
// 只叠加 Nowledge Mem 官方 codex 集成(远程 HTTP MCP + 插件 hooks + nmem CLI)。
// 前置:宿主机先 `scripts/nowledge-mem.sh up`(容器 + cloudflared 隧道 + API key)。
// env(或 default 实例文件)不可解析时不参与,避免裸 `niceeval exp dev-e2b` 扫进来硬挂。
// 见 nowledgeConfigured;正规跑法 scripts/exp-nowledge.sh dev-e2b/codex-gpt-5.4-mini-nowledge。
export default nowledgeConfigured()
  ? defineExperiment({
  evals: ["memory"],
  description: "codex · gpt-5.4-mini + Nowledge Mem(dev-e2b:E2B 上的记忆条件冒烟)",
  agent: codexAgent(nowledgeCodexConfig()),
  flags: nowledgeFlags(),
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }).setup(nowledgeSetup()),
  runs: 1,
  earlyExit: true,
  budget: 5,
  // 与 baseline 对齐:astropy eval 两阶段都要源码构建,别用全局 600s
  timeoutMs: 2_700_000,
    })
  : undefined;
