import { defineEval } from "fastevals";

// 失败模式:知识更新 · 项目决定要压过模型的过时先验
// 真实场景 = next-evals-oss 的 agent-031-proxy-middleware:Next 16 把 middleware.ts 改名 proxy.ts。
// 绝大多数模型的训练先验仍是「中间件写 middleware.ts」—— 这就是要被取代的【旧值】。
//
// 会话 A 把项目决定讲清楚(已迁到 Next 16,一律用 proxy.ts,别再建 middleware.ts);
// 第二天让它加一段中间件逻辑。记忆承载点 = 这条决定,它与模型先验相反、盘上也没有 proxy.ts 可抄。
// 只有记住决定的 agent 会写 proxy.ts;靠先验的会习惯性新建 middleware.ts。
export default defineEval({
  description: "知识更新:加中间件逻辑时用项目定的 proxy.ts(Next 16),不退回模型先验的 middleware.ts",
  async test(t) {
    // —— 会话 A:讲清项目决定 ——
    const ack = await t.send(
      "提醒一下项目现状:我们已经升到 Next 16,中间件统一写在根目录的 proxy.ts 里," +
        "不要再用旧的 middleware.ts(那是 16 之前的写法)。记住这条。",
    );
    ack.expectOk();
    t.judge.closedQA("是否确认了『中间件用 proxy.ts、不用 middleware.ts』这条决定", { on: ack.message }).atLeast(0.7);
    t.memory.recalled(/proxy\.ts|middleware/i);

    // —— 会话 B(第二天):上下文清零,盘上没有 proxy.ts / middleware.ts 可参照 ——
    const b = t.newSession();
    await b.send("加一段中间件:把未登录用户重定向到 /login。");

    // 用了项目决定的 proxy.ts
    b.calledTool("file_write", { input: { path: /(^|\/)proxy\.ts$/ } });
    // 没有退回模型先验的 middleware.ts(断言错误答案的缺席)
    b.notCalledTool("file_write", { input: { path: /(^|\/)middleware\.ts$/ } });
    b.notInDiff(/middleware\.ts/);
    b.judge.agent("看 sandbox 根目录:重定向中间件是写在 proxy.ts 里吗?有没有(错误地)新建 middleware.ts?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
