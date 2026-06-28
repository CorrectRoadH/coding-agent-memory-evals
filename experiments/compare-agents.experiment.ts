import { defineExperiment } from "fastevals";

// 主实验:同一批 memory eval 跨三个 coding agent 跑,出「质量 × 成本」对比。
// experiment = 运行矩阵(跑哪些 agent/model、几次、过滤、预算),不掺评分细节
// ——「怎么算对」是 eval 自己的事(每个 *.eval.ts 的 test 里)。
export default defineExperiment({
  description: "三个 coding agent 的记忆能力 + 成本对比",

  // 数组 → 笛卡尔展开成三套运行,结果可在 `fastevals view` 里并列对比
  agent: ["claude-code", "codex", "bub"],
  // model 省略 → 各 agent 用自己的原生默认模型

  runs: 5,            // 每个 (agent × eval) 跑 5 次取通过率
  earlyExit: false,   // 要完整通过率分布,不先过一次就停

  budget: 10,         // 整个实验估算成本上限 $10,超了停止派发新 attempt

  // evals 省略 → 默认 '*',跑 evals/ 下全部 memory eval
  // sandbox / workspace / judge / pricing 走 fastevals.config.ts
});
