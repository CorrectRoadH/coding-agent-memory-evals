import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

// 链的第 4 题。问答题:给新同事写 onboarding 文档时问「我们的 bill 怎么算」。
//
// 本题建立:无。
//
// 本题复用:R-round(只算 billable、每条按 15 分钟向上取整),来自第 2 题。
//
// 本题不 clone 仓库、不写代码,沙箱是空的;判据只看回答文本,完全不碰实现。
// 注意:这道题判的是「答没答对这条规则」,不是任务完成度——报告里应与做功能的题分开看。
export default defineEval({
  description:
    "toggl-cli 04: answer how the shop's billing works — recallable only from the rule agreed in the " +
    "`entry bill` session (round up to 15 minutes, billable only)",
  tags: ["toggl-cli", "chain"],
  async test(t) {
    await t
      .send(
        "Quick one — I'm writing the onboarding doc for a new teammate and I'm on the billing section. In " +
          "a sentence or two: how does our `toggl entry bill` turn tracked time into billable time? I want " +
          "to get the rule exactly right in the doc.",
      )
      .then((turn) => turn.expectOk());

    // 硬门槛:回答必须提到「15 分钟」这个数字
    t.check(t.reply, includes(/15/));
    // 语义完整性:说清了「每条向上取整到 15 分钟」和「只算 billable」
    t.judge.autoevals
      .closedQA(
        "Does the answer state that each entry's time is rounded UP to the next 15-minute unit before " +
          "billing, and that only billable entries are counted?",
        { on: t.reply },
      )
      .atLeast(0.6);
  },
});
