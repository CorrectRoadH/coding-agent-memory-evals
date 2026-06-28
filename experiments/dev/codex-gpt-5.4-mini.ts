import { defineExperiment } from "fastevals";

// dev/smoke 组:用代理上最便宜的文本模型(gpt-5.4-mini)快速跑通验证。
// 开发期先用它确认「整条管线真的能跑」—— 便宜、快;要正式结果再上 compare/(gpt-5.4)。
//
// 注意:多轮 coding eval 很贵的根因是【轮数 × 上下文滚雪球】(尤其 bub 全量重放),
// 换便宜模型主要降「每 token 单价」(mini ≈ gpt-5.4 的 ~1/5)、也更快;
// 想再快就只跑最便宜那条:`fastevals exp dev memory/multi-session-synthesis`。
export default defineExperiment({
  description: "codex · gpt-5.4-mini(dev/smoke,便宜快速验证)",
  agent: "codex",
  model: "gpt-5.4-mini", // → ctx.model → agents/codex.ts 写进 ~/.codex/config.toml
  sandbox: "docker",
  runs: 1,
  earlyExit: true,
  budget: 2, // 估算成本上限 $2,超了停止派发(避免烧爆)
});
