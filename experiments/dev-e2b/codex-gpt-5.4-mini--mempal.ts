import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { codexAgent } from "niceeval/adapter";
import { mempalFlags, mempalSetup, mempalSkill, mempalTeardown, mempalTemplate } from "../shared/mempal.ts";

// dev-e2b 组的 codex+mempal 冒烟:配置与 compare/codex-gpt-5.4--mempal 同构,但用最便宜的
// 文本模型。沙箱直接从预制 Mempal 模板起步(mempal 二进制 + embedding cache 已烘焙),
// attempt 级 setup 只做探针 + 状态恢复。预制模板 vs 运行时现装的耗时对照已在
// 2026-07-17 测完(每 attempt 省约 3m45s,全在 sandbox.setup,瓶颈是 cargo 编译),
// runtime-install 那个一次性基准配置已移除,结论记入 memory。
export default defineExperiment({
  evals: ["memory"],
  description: "codex · gpt-5.4-mini · mempal(dev-e2b:预制模板)",
  agent: codexAgent({ skills: [mempalSkill] }),
  flags: mempalFlags(),
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: mempalTemplate("codex") }).setup(mempalSetup("codex")).teardown(mempalTeardown("codex")),
  runs: 1,
  earlyExit: true,
  maxConcurrency: 1, // 载入记忆态…回存是临界区,与 compare 组同款声明式串行
  timeoutMs: 2_700_000,
});
