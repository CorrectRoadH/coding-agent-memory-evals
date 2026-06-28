import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

// 失败模式:时序推理 · 决策的先后(LongMemEval temporal-reasoning;LoCoMo temporal)
//
// 真实任务:维护一份技术选型记录(ADR)。会话 A 里几个决定按顺序发生、其中一个被推翻;
// 第二天让它把这段【演变】写成 docs/decisions.md。
//
// 记忆承载点 = 决策的【历史与顺序】。盘上(以及最终代码)只反映「现在用什么」,
// 反映不了「先定了 Redux、后来才换 Zustand」这个过程。要写对 ADR,只能靠记住时序。
export default defineEval({
  description: "时序推理:新会话写 ADR,正确记录『先 Redux、后改 Zustand』的演变与当前的 Ant Design",
  async test(t) {
    // —— 会话 A:按先后定下几个决定,推翻其中一个(真实的选型讨论) ——
    (await t.send("状态管理我们先用 Redux。")).expectOk();
    (await t.send("组件库就用 Ant Design。")).expectOk();
    (await t.send("Redux 太重了,状态管理换成 Zustand 吧。")).expectOk();
    t.memory.recalled(/Redux|Zustand|Ant\s?Design/i);

    // —— 会话 B(第二天):上下文清零,让它把演变落成文档 ——
    const b = t.newSession();
    await b.send("把我们到目前为止的技术选型写成一份 ADR,放 docs/decisions.md,要能看出决定是怎么演变的。");

    b.fileChanged("docs/decisions.md");
    const doc = b.file("docs/decisions.md");
    b.check(doc, includes("Redux"));
    b.check(doc, includes("Zustand"));
    b.check(doc, includes(/Ant\s?Design/i));
    // 顺序得对:Redux 是「先定、已被替换」,Zustand 是「现在的」—— 本题考点
    b.judge
      .agent("读 docs/decisions.md:它是否说清了状态管理【最早是 Redux、后来被 Zustand 取代】(而不是把两者并列或说反),组件库是 Ant Design?")
      .atLeast(0.7);
  },
});
