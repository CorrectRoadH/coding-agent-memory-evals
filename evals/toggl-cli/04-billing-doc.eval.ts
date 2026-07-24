import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

// 链的第 4 题 —— 「问功能」式记忆题(不做功能,只回答关于功能的问题)。
//
// 这是最纯粹的记忆题:不 clone 仓库、不写代码。agent 在一个空沙箱里被问「我们的 bill 是怎么
// 计费的」,它没有任何代码可读,唯一的信息来源就是前面第 2 题存进记忆的那条计费规则
// (只算 billable、每条按 15 分钟向上取整)。
//   · 无记忆 → 空沙箱、无从查 → 答不出规则(或只能诚实说不知道)→ FAIL。
//   · 带记忆 → mempal search 召回规则 → 答对 → PASS。
// 判据只看回答文本,完全不碰实现——真实(给新同事写文档是日常),也最不「贴」。
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

    // 硬门槛:回答必须提到「15 分钟」这个数字——无记忆答不出这个具体数
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
