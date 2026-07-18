import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { codexAgent } from "niceeval/adapter";
import { mempalFlags, mempalSetup, mempalSkill, mempalTeardown, mempalTemplate } from "../shared/mempal.ts";

// codex-gpt-5.6-luna 的 mempal 变体:agent 用自带 shell 跑 mempal CLI(`search` / `ingest`),
// Skill 教它先搜索、后写入耐久决策。不走 MCP(见 shared/mempal.ts 文件头注)。
//
// 前提:先从 NiceEval release-pinned Codex 公共模板构建专用 Mempal 模板。
// 记忆按 ctx.experimentId(即本实验的路径推导 id `compare/codex-gpt-5.6-luna--mempal`)跨 eval /
// 跨 run 累积(host 侧 .cache/mempal/state/);做干净对照前先 `rm -rf .cache/mempal/state/`,
// 并在报告里注明状态起点(空库/带积累)。
export default defineExperiment({
  evals: ["memory"],
  description: "codex · gpt-5.6-luna · mempal",
  agent: codexAgent({ skills: [mempalSkill] }),
  flags: mempalFlags(),
  model: "gpt-5.6-luna",
  sandbox: e2bSandbox({ template: mempalTemplate("codex") }).setup(mempalSetup("codex")).teardown(mempalTeardown("codex")),
  runs: 1,
  earlyExit: false,
  budget: 15,
  // 串行跑(niceeval ≥0.4.5 按实验限流,不影响同批基线):attempt 的
  // [载入记忆态 … 回存] 是临界区,声明式串行取代 helper 手写锁。
  maxConcurrency: 1,
  // 与 claude 组对齐(重型题可能超 10 分钟),消除条件间超时偏置——2026-07-10 重跑里
  // 本实验 repomod/terminal-cancel 正是死于 600s 默认超时(setup 含 ~514MB 模型预热)。
  timeoutMs: 1200000,
});
