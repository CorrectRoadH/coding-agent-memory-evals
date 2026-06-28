import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

// 失败模式:时序推理 · 决策先后(LongMemEval temporal;LoCoMo temporal)
// 真实场景:Next.js 项目的架构选型几经演变(典型 next-oss 主题:Pages Router → App Router 迁移)。
// 会话 A 按顺序定下几个决定、推翻其一;第二天让它把演变写成 ADR。
// 记忆承载点 = 决策的【历史与顺序】——代码只反映「现在用什么」,反映不了「先 Pages、后来才换 App」。
export default defineEval({
  description: "时序推理:新会话写 ADR,正确记录『先 Pages Router、后改 App Router』的演变,样式现用 Tailwind",
  async test(t) {
    // —— 会话 A:按先后定决定,推翻其一 ——
    (await t.send("路由我们先用 Pages Router 起步。")).expectOk();
    (await t.send("样式方案用 Tailwind。")).expectOk();
    (await t.send("路由改一下:迁到 App Router,以后新页面都走 app/。")).expectOk();
    t.memory.recalled(/Pages Router|App Router|Tailwind/i);

    // —— 会话 B(第二天):上下文清零,让它把演变落成文档 ——
    const b = t.newSession();
    await b.send("把我们到目前为止的架构选型写成一份 ADR,放 docs/decisions.md,要能看出决定是怎么演变的。");

    b.fileChanged("docs/decisions.md");
    const doc = b.file("docs/decisions.md");
    b.check(doc, includes(/Pages Router/i));
    b.check(doc, includes(/App Router/i));
    b.check(doc, includes(/Tailwind/i));
    // 顺序得对:Pages 是「先用、已被替换」,App Router 是「现在的」—— 本题考点
    b.judge
      .agent("读 docs/decisions.md:它是否说清了路由【最早是 Pages Router、后来迁到 App Router】(而非说反或并列),样式现用 Tailwind?")
      .atLeast(0.7);
  },
});
