import { defineExperiment } from "fastevals";

// ★ 头号验证实验:bub 的 tape 记忆机制,到底有没有让「长程 / 多轮开发」变好?
//
// 方法对标 next-evals-oss 的「配对 A/B」(它用 <model>.ts vs <model>--agents-md.ts
// 量化一份 AGENTS.md 的增益)。这里 A/B 的是 tape 本身:
//   · 本实验   = tape ON  (treatment)
//   · tape-off = tape OFF (floor,经 flags.noTape 关掉持久记忆)
// 同一批记忆 eval 各跑一遍,bub 两次的通过率之差(delta)就是 tape 的净贡献。
// 这是因果证据:除 tape 外其余全相同(同 agent、同模型、同 eval、同沙箱)。
//
// claude-code / codex 作外部参照系 —— 看 bub+tape 站在业界 coding agent 的什么位置。
//
// runs=5 + earlyExit=false:要完整通过率分布,以便报 pass^k(k 次独立运行【全过】的概率,
// 对标 tau-bench)。记忆机制的价值在于【稳定复现】召回,而不是偶尔蒙对一次 —— pass@k 会奖励
// 「跑得多总有一次过」,pass^k 不会;它随 k 下降,正好逼出一致性。
export default defineExperiment({
  description: "tape 消融(treatment):bub 开 tape + claude-code/codex 参照,跑全部记忆 eval",

  agent: ["bub", "claude-code", "codex"],
  // model 省略 → 各 agent 用原生默认模型;flags 省略 → bub 默认开 tape

  runs: 5,
  earlyExit: false, // 要完整通过率分布以算 pass^k,不先过一次就停
  budget: 20,
});
