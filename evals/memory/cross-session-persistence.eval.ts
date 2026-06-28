import { defineEval } from "fastevals";

// 失败模式:跨会话续作(Anthropic long-running harness)
// 真实任务:按计划在 App Router 下建一组营销页。会话 A 给 5 个页面的计划、只做掉 3 个,
// 第二天开新会话「接着做」。
// 记忆承载点 = 那份【计划】:盘上能看到「做了哪 3 个」,但「原计划还剩哪 2 个」只在记忆里。
// 剩余两项用不那么好猜的 slug(release-notes / press-kit),没记住计划就补不准。
export default defineEval({
  description: "跨会话续作:新会话按计划正好补齐 release-notes / press-kit 两个页面,不重做已完成的",
  async test(t) {
    // —— 会话 A:给计划,做掉前三个(真实开发) ——
    const ack = await t.send(
      "我们要按计划建 5 个营销页,都用 App Router(各自 app/<slug>/page.tsx):" +
        "about、pricing、blog、release-notes、press-kit。先把前三个 about / pricing / blog 建出来," +
        "占位内容即可,后两个下次再做。",
    );
    ack.expectOk();
    t.fileChanged("app/about/page.tsx");
    t.fileChanged("app/pricing/page.tsx");
    t.fileChanged("app/blog/page.tsx");
    t.memory.recalled(/release-notes|press-kit|计划|plan/i);

    // —— 会话 B(第二天接着做):上下文清零,盘上只有前三个页面 ——
    const b = t.newSession();
    await b.send("接着上次的计划,把营销页补齐吧。");

    b.calledTool("file_write", { input: { path: /app\/release-notes\/page\.tsx/ } });
    b.calledTool("file_write", { input: { path: /app\/press-kit\/page\.tsx/ } });
    // 没有把已完成的三个又重做一遍(断言「错误行为」的缺席)
    b.notCalledTool("file_write", { input: { path: /app\/(about|pricing|blog)\/page\.tsx/ } });
    t.judge.closedQA("回复是否识别出还剩 release-notes 和 press-kit 两个页面没做,而不是声称已完工", { on: b.reply }).atLeast(0.7);
    b.judge.agent("看 sandbox 的 app/ 目录:是否正好新增了 release-notes 和 press-kit 两个页面,且 about/pricing/blog 保持原样没被重建?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
