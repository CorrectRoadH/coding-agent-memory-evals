import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";
import { realWork } from "../_support/gap.js";

// 失败模式 #11 范围辨别 / 不过度泛化(记忆的「写入与作用域」一环)
// 同时立一条【全局规则】和一条【仅限某文件的一次性例外】。隔长程后在【另一个文件】做活。
// 正确行为:套用全局规则;那条「仅限 App.tsx」的例外【不能】泄漏到新文件上。
// 反向失败:把一次性例外误当成普遍规则,从此到处不写 JSDoc —— 记忆把范围记丢了。
// 这考的是「记得一条规则适用到多大范围」,比单纯记住规则本身更难。
export default defineEval({
  description: "范围辨别:全局『函数都要写 JSDoc』+ 仅限 App.tsx 的例外,新文件仍按全局写 JSDoc",
  async test(t) {
    // —— Plant:全局规则 ——
    (await t.send("立一条全局约定:这个项目里所有导出的函数,上方都要写一段 JSDoc 注释(/** ... */)。")).expectOk();
    // —— Plant:明确【仅限一个文件】的一次性例外 ——
    (await t.send("有个例外,仅限 src/App.tsx 这一个文件:它比较特殊,里面的东西就不用写 JSDoc 了。只有这个文件哦。")).expectOk();

    // —— Gap:做几件真实的活,逼它从记忆里取出『规则 + 例外的范围』 ——
    await realWork(t, 5);

    // —— Probe:在【另一个文件】做活,不重述任何约定 ——
    await t.send("加一个 formatName(first, last) 工具函数,放到 src/utils.ts。");

    t.fileChanged("src/utils.ts");
    // 套用了全局规则:新文件里的函数有 JSDoc(例外没有泄漏过来)。读 sandbox 最终文件
    t.check(t.file("src/utils.ts"), includes(/\/\*\*/));
    // agent-judge:同时核查【规则套用】和【例外保真】—— 新文件该有 JSDoc,App.tsx 仍不该被强加
    t.judge
      .agent("通读 sandbox:src/utils.ts 里新增的 formatName 函数是否有 JSDoc 注释块?同时确认 src/App.tsx 没有被强行加上 JSDoc(它是被豁免的那个文件)。")
      .atLeast(0.7);
    t.scriptPassed("build");
  },
});
