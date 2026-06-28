import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

// 失败模式:干扰下的精确检索(LoCoMo single-hop / needle 精度)
//
// 真实任务:先登记项目要用的几个环境变量名,后面再逐个接线。会话 A 一次性记下四个
// 【长得很像】的 env 名,但此刻都还没在代码里用过;第二天的会话只接其中一个。
//
// 记忆承载点 = 那张【环境变量登记表】。四个名字都没进代码,agent 没法从盘上推导,
// 必须从记忆里检索出【正好那一个】,而不是取到相邻的、似是而非的兄弟项,也不能现编一个。
export default defineEval({
  description: "干扰下检索:四个相似 env 名里,Sentry 初始化准确用上 SENTRY_DSN",
  async test(t) {
    // —— 会话 A:登记四个相似的环境变量名(还不接线) ——
    const ack = await t.send(
      "先把这个项目要用的环境变量名记一下,后面逐个接:\n" +
        "· API_BASE_URL —— 后端基础地址\n" +
        "· API_TOKEN —— 后端鉴权 token\n" +
        "· SENTRY_DSN —— 错误上报\n" +
        "· FLAG_BETA —— 灰度开关\n现在先别写代码,记着就行。",
    );
    ack.expectOk();
    t.memory.recalled(/SENTRY_DSN|API_BASE_URL|API_TOKEN|FLAG_BETA/);

    // —— 会话 B(第二天):上下文清零,盘上没有任何 env 用法可参考 ——
    const b = t.newSession();
    await b.send("加一个把错误上报到 Sentry 的初始化函数,放 src/sentry.ts。");

    const file = b.file("src/sentry.ts");
    b.check(file, includes(/SENTRY_DSN/)); // 检索到正好那一个
    // 没有串到相邻的兄弟项、也没现编一个别的名字(断言错误答案的缺席)
    b.notInDiff(/API_BASE_URL|API_TOKEN|FLAG_BETA/);
    b.judge.agent("通读 src/sentry.ts:Sentry 初始化读取的环境变量是不是恰好是 SENTRY_DSN(而非别的或自创的名字)?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
