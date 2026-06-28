import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

// 失败模式:知识更新 · 旧值被取代(LongMemEval knowledge-update;Mem0 UPDATE 语义)
//
// 这是一次真实开发:先用 date-fns 写了 formatDate;中途团队决定弃用 date-fns、改用
// 原生 Intl,但【明确说现有代码先别动,下次重构再换】。所以盘上的代码此刻【仍是
// date-fns】—— 它会主动误导:谁照着现有文件「跟随现有写法」,就会接着用 date-fns。
//
// 记忆承载点 = 那条「以后弃用 date-fns、改原生」的【决定】,它和盘上的代码相反。
// 只有记住决定的 agent 才会用原生;靠读代码重新推导的会用错。这正是 update 失败的核心:
// 记住了新决定,却没让它取代旧状态。
export default defineEval({
  description: "知识更新:代码里还留着 date-fns,但新会话的重构按『改用原生』来,绝不沿用 date-fns",
  async test(t) {
    // —— 会话 A:先用 date-fns 实现,再宣布弃用(但暂不动代码) ——
    (await t.send("加一个 src/date.ts,实现 formatDate(d),用 date-fns 来做。")).expectOk();
    const update = await t.send(
      "团队决定了:以后不用 date-fns,日期统一改用原生 Intl.DateTimeFormat。现有代码先别动,等下次重构再换;但这条决定记住。",
    );
    update.expectOk();
    t.judge.closedQA("是否确认了『以后弃用 date-fns、改用原生 Intl』这条决定", { on: update.message }).atLeast(0.7);
    t.memory.recalled(/date-fns|Intl|原生|native/i);

    // —— 会话 B(第二天重构):上下文清零;盘上的 date.ts 此刻还在用 date-fns(误导项) ——
    const b = t.newSession();
    await b.send("按我们定的方向把 src/date.ts 重构一下,顺便加一个 formatRelative(d)(显示『3 天前』这种)。");

    const file = b.file("src/date.ts"); // 读 sandbox 最终文件
    b.check(file, includes(/Intl|toLocale/)); // 用了决定里的原生方案
    b.notInDiff(/date-fns/); // 旧值彻底没出现(含 import / 安装命令 / 注释)
    b.notCalledTool("shell", { input: { command: /date-fns/ } }); // 也没再去装旧库
    b.judge.agent("通读 src/date.ts:是否已彻底改用原生日期 API、不再 import 或依赖 date-fns?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
