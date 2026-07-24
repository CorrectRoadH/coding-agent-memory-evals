import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { nowledgeCodexCliOnlyConfig, nowledgeFlags, nowledgeSandboxSetup } from "../shared/nowledge.ts";

// 诊断变体:codex-gpt-5.4-mini-nowledge 实测 MCP 调用率极低(compare/ 里 8 个 attempt 只 1 个
// 碰过 nowledge-mem MCP 工具)。这个变体彻底不给 MCP(nowledgeCodexCliOnlyConfig 装完插件后
// 把 install_hooks.py 写的托管 MCP 段删掉),同时在 AGENTS.md 追加一段 override,把原文档里
// "优先用 MCP" 的指引改成"只有 nmem CLI"。目的是拿到一个可以直接在 events.json 里 grep `nmem`
// 就能实锤的信号,不用像 claude 那边一样只能靠拆实例前 probe 服务端。
// 只跑一个 eval 冒烟,确认能不能观测到 agent 主动敲 nmem 命令,再决定要不要挪进 compare/。
// mem 服务端是 .env 里的固定远程实例(无生命周期);注意冒烟写入与正式 compare 进同一个积累库。
export default defineExperiment({
  evals: ["memory"],
  description: "codex · gpt-5.4-mini + Nowledge Mem CLI-only(诊断:MCP 拿掉后 agent 会不会自己敲 nmem)",
  agent: codexAgent(nowledgeCodexCliOnlyConfig()),
  flags: { ...nowledgeFlags(), nowledgeMode: "cli-only" },
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }).setup(nowledgeSandboxSetup()),
  runs: 1,
  earlyExit: true,
  timeoutMs: 2_700_000,
});
