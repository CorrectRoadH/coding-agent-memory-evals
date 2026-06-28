import { defineEval } from "fastevals";
import { includes, satisfies } from "fastevals/expect";

// 失败模式:干扰下的精确检索(LoCoMo single-hop)
// 真实场景:Next.js 每个路由段的渲染配置(revalidate / dynamic)。会话 A 一次性登记四条
// 【长得很像】的 per-route 配置,但此刻都还没写进任何页面;第二天只给其中一个页面接上。
// 记忆承载点 = 那张【还没落地】的渲染配置登记表。四条都「相关」,必须检索出博客页对应的那一条
// (revalidate 3600),不能串到兄弟项(60 / force-dynamic / force-static)。
export default defineEval({
  description: "干扰下检索:四条相似渲染配置里,博客页准确用上 revalidate 3600",
  async test(t) {
    // —— 会话 A:登记四条相似的 per-route 渲染配置(还不落地) ——
    const ack = await t.send(
      "先把各页面的渲染配置约定记一下,后面逐个接:\n" +
        "· 产品页:export const revalidate = 60\n" +
        "· 博客页:export const revalidate = 3600\n" +
        "· 搜索页:export const dynamic = 'force-dynamic'\n" +
        "· 关于页:export const dynamic = 'force-static'\n现在先别写,记着就行。",
    );
    ack.expectOk();
    t.memory.recalled(/revalidate|force-dynamic|force-static|3600/i);

    // —— 会话 B(第二天):上下文清零,盘上没有任何渲染配置可参照 ——
    const b = t.newSession();
    await b.send("给博客页 app/blog/page.tsx 加上我们约定的渲染配置(页面本身放个占位即可)。");

    const file = b.file("app/blog/page.tsx");
    b.check(file, includes(/revalidate\s*=\s*3600/)); // 检索到正好那一条
    // 没有串到相邻的兄弟项(断言错误答案的缺席)
    b.check(file, satisfies((s) => !/revalidate\s*=\s*60\b|force-dynamic|force-static/.test(String(s)), "没串到别的页面的配置"));
    b.judge.agent("通读 app/blog/page.tsx:它导出的渲染配置是不是恰好 revalidate = 3600(而非 60 或 force-dynamic/force-static)?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
