import { defineExperiment } from "niceeval";
import { bubAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { NICEEVAL_BUB_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";

// dev/e2b 组:bub(tape 记忆)跑在 E2B 微 VM 上,用 NiceEval release-pinned 公共 Bub 模板。
// 该模板把 uv 安装规格指纹(bub 版本 + OTel 插件 + python plugin 集合)写进
// ~/.niceeval-bub-install;adapter 的 ensureBub 校验指纹命中就直接返回,运行时的 uv 安装
// 和 checkpoint 缓存整条路都不会走 —— 曾经因 checkpoint 并发上传打爆 e2b API 而不得不加的
// maxConcurrency: 2 因此退役(见 memory: bub-checkpoint-restore-thundering-herd)。
export default defineExperiment({
  description: "bub · gpt-5.4-mini · E2B sandbox",
  agent: bubAgent(),
  flags: { memory: "baseline" },
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: NICEEVAL_BUB_E2B_TEMPLATE }),
  evals: ["memory"],
  runs: 1,
  earlyExit: true,
  budget: 2,
  timeoutMs: 1200000,
});
