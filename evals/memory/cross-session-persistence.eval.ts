import { defineEval } from "fastevals";

// 失败模式:跨会话持久 ·「接着上次继续」(Anthropic long-running harness 的经典失败)
//
// 这是一次真实开发:按一份计划搭组件。会话 A 给 5 个组件的计划、只做掉前 3 个;
// 第二天开一条新会话说「接着做」。
//
// 记忆承载点 = 那份【计划】——盘上能看到「做了哪 3 个」,但「原计划还有哪 2 个」
// 只存在记忆里。所以剩余两项用【猜不到的】名字(UserBadge / ChangelogBanner):
// 没记住计划的 agent 只能误判完工或瞎猜,不可能正好补上这两个。这也正是 tape on/off
// 能拉开差距的原因——关了 tape 的 bub 能读盘上的文件,却读不到只在记忆里的计划。
export default defineEval({
  description: "跨会话续作:新会话里『接着上次』,正好补齐计划剩余两个组件、不重做已完成的",
  async test(t) {
    // —— 会话 A:给计划,做掉前三个(真实开发) ——
    const ack = await t.send(
      "我们这轮要按计划建 5 个组件:Header、Footer、Sidebar、UserBadge、ChangelogBanner。" +
        "先把前三个(Header、Footer、Sidebar)建出来,各做一个最简单的占位组件即可,剩下两个下次再说。",
    );
    ack.expectOk();
    t.fileChanged("src/Header.tsx");
    t.fileChanged("src/Footer.tsx");
    t.fileChanged("src/Sidebar.tsx");
    // 整份计划要进持久记忆 —— 这是会话 B 唯一能依赖、盘上看不到的信息
    t.memory.recalled(/UserBadge|ChangelogBanner|计划|清单|plan/i);

    // —— 会话 B(真实的「第二天接着做」):上下文清零,盘上只有那三个文件 ——
    const b = t.newSession();
    await b.send("接着上次的计划把没做完的补齐吧。");

    // 正好补上剩余两个(用 path 正则,不假设它建在哪个目录)
    b.calledTool("file_write", { input: { path: /UserBadge/ } });
    b.calledTool("file_write", { input: { path: /ChangelogBanner/ } });
    // 没有把已经做完的三个又重做一遍(断言「错误行为」的缺席)
    b.notCalledTool("file_write", { input: { path: /Header|Footer|Sidebar/ } });
    // 也没误判为「已经全做完了」
    t.judge.closedQA("回复是否识别出还剩 UserBadge 和 ChangelogBanner 两个没做,而不是声称已完工", { on: b.reply }).atLeast(0.7);
    // agent-judge:通读 sandbox,核实最终状态正好等于「续作完成」
    b.judge.agent("看 sandbox 的 src 目录:是否正好新增了 UserBadge 和 ChangelogBanner,且 Header/Footer/Sidebar 保持原样没被重建?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
