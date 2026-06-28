import { defineEval } from "fastevals";

// 失败模式 #8 跨会话持久 ——「接着上次没做完的继续」(Anthropic long-running harness 的经典失败)
//
// 会话 A 给一份具体的待办清单,只做掉前几项;开一条全新会话 B 说「继续」。
// 关键设计:磁盘上能看到「哪些做完了」,但「整张清单原本有哪几项」只存在记忆里。
// 所以剩余项里放两个【猜不到的】名字(UserBadge / ChangelogBanner)——
// 没记住清单的 agent 要么误以为已完工、要么瞎猜,不可能正好补上这两个。
// 这把「跨会话持久」做成了可硬断言的题(对 bub 就是 tape 的 handoff 跨会话带状态)。
export default defineEval({
  description: "跨会话续作:新会话里『接着上次』,正好补齐清单剩余的两个组件、不重做已完成的",
  async test(t) {
    // —— Plant(会话 A):一份 5 项清单,只做掉前 3 项 ——
    const ack = await t.send(
      "我们这轮要建 5 个组件,按这个清单来:Header、Footer、Sidebar、UserBadge、ChangelogBanner。" +
        "先把前三个(Header、Footer、Sidebar)建好,各自一个最简单的占位组件就行,剩下两个等会儿再说。",
    );
    ack.expectOk();
    t.fileChanged("src/Header.tsx");
    t.fileChanged("src/Footer.tsx");
    t.fileChanged("src/Sidebar.tsx");
    // 整张清单要进持久记忆 —— 这是 B 会话唯一能依赖的信息源
    t.memory.recalled(/UserBadge|ChangelogBanner|清单|checklist/i);

    // —— Gap:全新会话,上下文清零。只字不提清单内容 ——
    const b = t.newSession();

    // —— Probe(会话 B):一句话「继续」,逼它从记忆里取出剩余项 ——
    await b.send("接着上次没做完的继续吧,把该建的补齐。");

    // 正好补上剩余两个(用 path 正则,不假设它建在哪个目录)
    b.calledTool("file_write", { input: { path: /UserBadge/ } });
    b.calledTool("file_write", { input: { path: /ChangelogBanner/ } });
    // 没有把已经做完的三个又重做一遍(断言「错误行为」的缺席)
    b.notCalledTool("file_write", { input: { path: /Header|Footer|Sidebar/ } });
    // 也没有误判为「已经全做完了」
    t.judge.closedQA("回复是否识别出还剩 UserBadge 和 ChangelogBanner 两个没做,而不是声称已完工", { on: b.reply }).atLeast(0.7);
    b.scriptPassed("build");
  },
});
