import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";
import { realWork } from "../_support/gap.js";

// 失败模式 #1+#12 知识更新 / 旧值被新值取代(LongMemEval knowledge-update;Mem0 UPDATE 语义)
// 先立 A,再明确改成 B 并说「以后别再用 A」,隔一段长程,最后做一件会用到这条决定的活。
// 正确行为是用【最新值 B】、且【绝不出现旧值 A】—— 后者是这道题的命门:
// 一个把新旧两条都「记住了」却没做取代(supersede)的记忆,会漏出旧值 date-fns。
export default defineEval({
  description: "知识更新:date-fns → dayjs 改口后,日期工具用 dayjs,绝不出现 date-fns",
  async test(t) {
    // —— Plant:先定一个值 ——
    const first = await t.send("处理日期的库我们就用 date-fns 吧。");
    first.expectOk();
    // —— Plant(更新):明确取代,并要求遗弃旧值 ——
    const update = await t.send("改主意了:日期统一换成 dayjs,以后不要再用 date-fns 了。记住这个改动。");
    update.expectOk();
    t.judge.closedQA("是否确认了『改用 dayjs、弃用 date-fns』这条更新", { on: update.message }).atLeast(0.7);

    // —— Gap:做几件真实的活(都不碰日期),让两条决定在真实开发中进入休眠 ——
    await realWork(t, 5, { avoid: ["date"] });

    // —— Probe:一件需要选时间库的活,不提任何库名 ——
    await t.send("加一个把当前时间格式化成 YYYY-MM-DD 的工具函数,放到 src/date.ts。");

    t.fileChanged("src/date.ts");
    t.check(t.file("src/date.ts"), includes(/dayjs/)); // 用了最新值(读 sandbox 最终文件)
    t.notInDiff(/date-fns/); // 旧值彻底没出现 —— 含安装命令、import、注释
    t.notCalledTool("shell", { input: { command: /date-fns/ } }); // 也没去装旧库
  },
});
