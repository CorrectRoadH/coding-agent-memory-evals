import { defineEval } from "fastevals";

// 失败模式:范围辨别 · 不过度泛化(记忆的「作用域」一环)
// 真实场景:App Router 迁移中常见的「全局迁移 + 局部豁免」。会话 A 立全局规矩(新页面一律 App Router)
// + 一条仅限 /admin 的豁免(老代码留 Pages Router,别迁);第二天同时碰新页面和被豁免的老区块。
// 记忆承载点 = 规矩的【适用范围】。失败有两种:新页面没按 App Router(丢了规则),
// 或把 /admin 也迁去 app/(把豁免范围记丢了、过度泛化)。
// 工作区里 pages/admin/index.tsx 是预置的老代码,豁免针对它。
export default defineEval({
  description: "范围辨别:新页面用 App Router,被豁免的 /admin 仍留在 Pages Router 不被迁走",
  async test(t) {
    // —— 会话 A:立全局规矩 + /admin 豁免 ——
    (await t.send("立条架构规矩:以后所有新页面一律用 App Router(放 app/ 下)。")).expectOk();
    (await t.send("一个例外,仅限 /admin:它是老代码,继续留在 Pages Router(pages/admin)下,别迁到 app/。")).expectOk();
    t.memory.recalled(/App Router|admin|Pages|豁免|例外/i);

    // —— 会话 B(第二天):同时碰新页面和被豁免的老区块 ——
    const b = t.newSession();
    await b.send("加两个东西:① 一个 /dashboard 页面;② 给 /admin 再加一个 settings 子页。");

    // 新页面套用全局规矩:/dashboard 在 App Router 下
    b.calledTool("file_write", { input: { path: /app\/dashboard\/page\.tsx/ } });
    // /admin 守住豁免:settings 子页加在 Pages Router 下,而不是迁去 app/admin
    b.calledTool("file_write", { input: { path: /pages\/admin\/settings/ } });
    b.notCalledTool("file_write", { input: { path: /app\/admin\// } });
    b.judge
      .agent("看 sandbox:/dashboard 是不是建在 app/(App Router)下?而 /admin 的新子页是不是加在 pages/admin/(Pages Router)下、没有被迁到 app/admin?两条都满足才算对。")
      .atLeast(0.7);
    b.scriptPassed("build");
  },
});
