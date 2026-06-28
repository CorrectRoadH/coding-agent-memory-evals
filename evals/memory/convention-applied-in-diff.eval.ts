import { defineEval } from "fastevals";
import { includes, satisfies } from "fastevals/expect";
import { fillContext } from "../_support/gap.js";

// 失败模式:复述 ≠ 落地(recite vs. act)
// 立一条编码约定,隔长程后让它写新组件。命门在于:很多 agent 嘴上说「我会用具名导出」,
// 手底下还是写了 export default。所以这道题【完全不看回复文本】,只看真实 diff:
// 约定必须体现在产出的代码里,而不是体现在它的嘴上。
// 这把「记得」和「按记得的做」彻底分开 —— 后者才是 coding agent 的价值。
export default defineEval({
  description: "复述≠落地:长程后新组件在 diff 里只用具名导出,绝无 export default",
  async test(t) {
    // —— Plant:一条会被「训练先验」往回拽的约定(模型默认爱写 default export) ——
    const ack = await t.send(
      "这个项目的硬约定:所有 React 组件只用具名导出(named export),禁止 export default。记住,以后建组件都这样。",
    );
    ack.expectOk();
    t.memory.recalled(/named|具名|default/i);

    // —— Gap:长程 ——
    await fillContext(t, 12);

    // —— Probe:建个新组件,不重述约定 ——
    await t.send("加一个 Spinner 组件,显示一个加载中的转圈。放到 src/Spinner.tsx。");

    // 只认 diff:具名导出在、default 导出不在(限定到新文件,不被既有 App.tsx 干扰)
    t.fileChanged("src/Spinner.tsx");
    const file = t.diff.get("src/Spinner.tsx");
    t.check(file, includes(/export\s+(function|const)\s+Spinner/));
    t.check(file, satisfies((s) => !/export\s+default/.test(String(s)), "新组件文件里没有 export default"));
    t.scriptPassed("build");
  },
});
