import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { codexAgent } from "niceeval/adapter";
import { withMempal } from "../shared/mempal.ts";

// codex-gpt-5.4 的 mempal 变体:MCP server 接入 mempal_search / mempal_ingest,
// MEMORY_PROTOCOL 随 MCP ServerInfo 下发(存/查行为靠协议约定,不靠 hook)。
// Codex 原生 hook(~/.codex/hooks.json,cowork drain)受上游 codex_hooks 实验
// flag 门控 —— setup 里 best-effort enable 并留 log;flag 关着时 hooks.json 被
// 静默忽略,本条件退化为「纯 MCP 记忆」,对单 agent 记忆题没有实质影响。
//
// 前提:mempal 二进制由 setup 从 host 缓存上传(先跑一次
// scripts/build-mempal-linux.sh;见 experiments/shared/mempal.ts 头注)。
// 记忆按 stateKey 跨 eval / 跨 run 累积(host 侧 .cache/mempal/state/);做干净对照前
// 先 `rm -rf .cache/mempal/state/`,并在报告里注明状态起点(空库/带积累)。
export default defineExperiment({
  description: "codex · gpt-5.4 · mempal",
  agent: withMempal(codexAgent(), "codex", { stateKey: "codex-gpt-5.4--mempal" }),
  model: "gpt-5.4",
  sandbox: e2bSandbox({ template: "fasteval-agents" }),
  runs: 1,
  earlyExit: false,
  budget: 15,
});
