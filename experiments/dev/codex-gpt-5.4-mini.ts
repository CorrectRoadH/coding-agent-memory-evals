import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

// dev/smoke 组:用代理上最便宜的文本模型(gpt-5.4-mini)快速跑通验证。
// 开发期先用它确认「整条管线真的能跑」—— 便宜、快;要正式结果再上 compare/(gpt-5.4)。
//
// 注意:这些 Next coding eval 会执行真实安装和 build,成本主要来自 agent 改代码与构建反馈。
// dev 期先跑较小的 cache eval;正式结果再跑 compare 组的完整三条。
export default defineExperiment({
  description: "codex · gpt-5.4-mini(dev/smoke,便宜快速验证)",
  agent: codexAgent(),
  model: "gpt-5.4-mini", // → ctx.model → agents/codex.ts 写进 ~/.codex/config.toml
  sandbox: "docker",
  runs: 1,
  earlyExit: true,
  budget: 2, // 估算成本上限 $2,超了停止派发(避免烧爆)
});
