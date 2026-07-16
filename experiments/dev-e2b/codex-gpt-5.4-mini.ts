import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { codexAgent } from "niceeval/adapter";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";

// dev-e2b 组:和 dev/ 一样用最便宜的文本模型冒烟,但沙箱换成 E2B——
// 专门验证「只能在 E2B 上复现」的环节(模板内容、非 root 语义、网络、uv 安装)。
// dev/(docker)验证 eval 逻辑,dev-e2b/ 验证目标运行环境;正式结果仍看 compare/。
export default defineExperiment({
  evals: ["memory"],
  description: "codex · gpt-5.4-mini(dev-e2b:E2B 上的便宜冒烟)",
  agent: codexAgent(),
  flags: { memory: "baseline" },
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE }),
  runs: 1,
  earlyExit: true,
  budget: 5,
  // astropy eval 里 agent 和测试阶段都要从源码构建,别用全局 600s;与 eval 级 timeoutMs 对齐。
  timeoutMs: 2_700_000,
});
