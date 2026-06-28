import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

// 失败模式:范围辨别 · 不过度泛化(记忆的「作用域」一环)
//
// 真实任务:立一条全局文档规矩 + 一条仅限某文件的豁免,第二天接着写代码。
// 规矩:所有导出函数都要写 JSDoc;例外:src/legacy.ts 这个老文件豁免。
//
// 记忆承载点 = 规矩的【适用范围】。盘上看不出「该不该写 JSDoc」这条规则存在
// (legacy.ts 没有 JSDoc,既可能是『被豁免』也可能是『根本没这规矩』—— 全靠记忆区分)。
// 第二天同时碰两个文件:新文件该套全局规矩(写 JSDoc),legacy 该守豁免(不写)。
// 失败有两种:新文件忘了写(丢了规则),或给 legacy 也加上(把豁免范围记丢了、过度泛化)。
export default defineEval({
  description: "范围辨别:新文件按全局规矩写 JSDoc,被豁免的 legacy.ts 不被强加",
  async test(t) {
    // —— 会话 A:立规矩 + 豁免,并建好那个被豁免的老文件 ——
    (await t.send("立条文档规矩:项目里所有【导出函数】上方都要写 JSDoc(/** ... */)。")).expectOk();
    (await t.send("一个例外,仅限 src/legacy.ts:它是老代码,豁免 JSDoc。先把这个文件建出来,放一个 oldHelper() 占位即可(按豁免,不用写 JSDoc)。")).expectOk();
    t.fileChanged("src/legacy.ts");
    t.memory.recalled(/JSDoc|legacy|豁免|例外/i);

    // —— 会话 B(第二天):同时碰新文件和被豁免的老文件 ——
    const b = t.newSession();
    await b.send("加两个东西:① src/string.ts 里的 slugify(s);② 给 src/legacy.ts 再补一个 oldHelper2()。");

    // 新文件套用了全局规矩:slugify 有 JSDoc
    b.check(b.file("src/string.ts"), includes(/\/\*\*/));
    // agent-judge:同时核查【规则套用】与【豁免保真】—— string.ts 该有 JSDoc,legacy.ts 仍不该被强加
    b.judge
      .agent("通读 sandbox:src/string.ts 的 slugify 是否有 JSDoc 注释块?而 src/legacy.ts(被豁免的老文件)是否仍然没有被加上 JSDoc?两条都满足才算对。")
      .atLeast(0.7);
    b.scriptPassed("build");
  },
});
