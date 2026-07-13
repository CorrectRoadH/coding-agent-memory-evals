import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { mempalCodexSkill, mempalMcp, mempalSetup, mempalTeardown, mempalTemplate } from "../shared/mempal.ts";

// dev/e2b 组的 mempal 变体:验证记忆条件全链路(构造期 MCP、二进制上传、模型预热、
// 记忆态跨 eval 累积、codex hooks)用的便宜配置,正式对比走 compare/ 组。
// 记忆按 ctx.experimentId(即本实验的路径推导 id `dev-e2b/codex-e2b--mempal`)跨 eval /
// 跨 run 累积;干净验证前 rm -rf .cache/mempal/state/。
export default defineExperiment({
  description: "codex · gpt-5.4-mini · E2B · mempal",
  agent: codexAgent({ mcpServers: [mempalMcp], skills: [mempalCodexSkill] }),
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: mempalTemplate("codex") }).setup(mempalSetup("codex")).teardown(mempalTeardown("codex")),
  runs: 1,
  earlyExit: true,
  budget: 2,
  // 串行跑(niceeval ≥0.4.5 按实验限流):记忆态载入/回存的临界区靠它,不再用锁。
  maxConcurrency: 1,
  timeoutMs: 1200000,
});
