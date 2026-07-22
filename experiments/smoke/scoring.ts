import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { dockerSandbox } from "niceeval/sandbox";

// 冒烟实验:核实 niceeval defineScoreEval 计分制全链路——不进正式对比矩阵,只用来验证
// 节点 1.5(计分制题型)在真实 agent + 真实 judge 下能跑通,niceeval show 显示总分而不是
// 通过率。本地 docker(不占 e2b 并发,也不需要预制模板——两条冒烟 eval 都不依赖仓库
// fixture,首次跑现装 CLI 完全可接受)。model 用 compare/ 组当前在用的 gpt-5.6-luna——
// dev/dev-e2b 组默认的 gpt-5.4-mini 这次冒烟时撞了代理 404(该账号分组当下不支持这个
// 模型名,基础设施侧的临时状况,与 niceeval 本身无关)。
export default defineExperiment({
  description: "冒烟:defineScoreEval 计分制全链路(codex · gpt-5.6-luna · docker)",
  agent: codexAgent(),
  model: "gpt-5.6-luna",
  sandbox: dockerSandbox(),
  evals: ["scoring-smoke/"],
  runs: 1,
  earlyExit: false,
  budget: 2,
  timeoutMs: 600_000,
});
