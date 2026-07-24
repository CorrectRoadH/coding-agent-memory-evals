import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

// 链的第 7 题 —— 「问功能」式记忆题(算术版,链的收尾综合)。
//
// 同样是空沙箱、不写代码。问一道具体的计费算术题,答案唯一,只有记起第 2 题的计费规则
// (每条按 15 分钟向上取整)才算得对:
//   7 分钟 → 15 分钟,40 分钟 → 45 分钟,合计 60 分钟。
//   · 无记忆 → 不知道要向上取整 → 会算成 7+40=47 分钟(或答不出)→ FAIL。
//   · 带记忆 → 15+45=60 分钟 → PASS。
// 判据只看回答里的数字,不碰实现。算术题让答案唯一、判据精确,是最干净的记忆信号。
export default defineEval({
  description:
    "toggl-cli 07: compute a billable total by our rounding rule — 7min + 40min bills as 60min only if " +
    "the 15-minute round-up rule is recalled",
  tags: ["toggl-cli", "chain"],
  async test(t) {
    await t
      .send(
        "Quick sanity check for an invoice. A client has two billable entries this week: one is 7 minutes, " +
          "the other is 40 minutes. By our billing rule, how many billable minutes do we charge for the " +
          "week? Just give me the number of minutes.",
      )
      .then((turn) => turn.expectOk());

    // 正确答案 60 分钟(15+45)。无记忆会给 47(7+40 未取整),不含 60。
    t.check(t.reply, includes(/\b60\b/));
    // judge 兜住「恰好结论是 60 分钟」——排除回答里 60 只是顺带出现、真正结论是别的数(如 47)。
    t.judge.autoevals
      .closedQA(
        "Does the answer conclude the billable total is 60 minutes (one hour), and NOT 47 minutes or any " +
          "other number?",
        { on: t.reply },
      )
      .atLeast(0.6);
  },
});
