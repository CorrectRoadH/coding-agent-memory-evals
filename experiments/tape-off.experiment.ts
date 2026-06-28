import { defineExperiment } from "fastevals";

// tape 消融的「下限(floor)」运行,与 tape-ablation 配对。
// 同一批记忆 eval,只跑 bub、且关掉 tape(flags.noTape → agents/bub.ts 不 resume tape、不落盘)。
//
// 预期:跨「记忆缺口」(干扰长程 / 跨会话)的题在这里大面积挂掉 —— 因为植入的事实
// 已经离开实时上下文,而 bub 此时没有持久记忆能把它捞回来。
//
// 对照读法:把这次的 bub 通过率,与 tape-ablation 里的 bub 通过率逐 eval 相减:
//   delta(eval) = passRate(tape on) − passRate(tape off)
// delta 大的那些 eval,正是 tape 真正在发力的地方;delta≈0 的(比如无缺口的控制项)
// 说明那条题本来就不依赖记忆 —— 这反过来验证了缺口设计的有效性。
export default defineExperiment({
  description: "tape 消融(floor):bub 关掉 tape,跑全部记忆 eval,作为对照下限",

  agent: "bub",
  flags: { noTape: true }, // → agents/bub.ts 读 ctx.flags.noTape,关掉持久记忆机制

  runs: 5,
  earlyExit: false,
  budget: 10,
});
