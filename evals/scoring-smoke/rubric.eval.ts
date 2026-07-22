import { defineScoreEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 冒烟:核实 rubric 制的三种给分形态在真实 agent + 真实 judge 下都能跑通
// (照抄 docs/feature/eval/use-case/rubric-scoring.md「分值不等权时:rubric 大题」一节,
// 把「重构 async/await」换成几秒钟就能跑完的最小写作任务)。
export default defineScoreEval({
  description: "冒烟:按 rubric 给分(0/1 断言链 · t.score 自算分档 · judge 连续打分)",
  // 项目级 judge 默认模型(niceeval.config.ts 的 gpt-5.4-mini)这次冒烟时撞了代理 404
  // (账号分组当下不支持这个模型名),覆盖成 compare/ 组当前在用的 gpt-5.6-luna。
  judge: { model: "gpt-5.6-luna" },
  async test(t) {
    await t.send("在当前目录创建文件 NOTES.md,用一句话说明为什么 1+1 等于 2。");

    await t.group("正确性", async () => {
      const check = await t.sandbox.runShell("test -f NOTES.md && echo ok || echo missing");
      t.check(check, commandSucceeded()).points(60); // 文件存在值 60 分;同时是 gate
    });

    const notes = await t.sandbox.readFile("NOTES.md").catch(() => "");

    await t.group("代码质量", async () => {
      t.score("篇幅精简", notes.trim().length > 0 && notes.length <= 200 ? 20 : 0); // 分档自己算,直接累加

      t.judge.autoevals
        .closedQA("这句话是否清楚说明了 1+1=2 的原因?", { on: notes })
        .points(20); // judge 按连续分比例挣
    });
  },
});
