import { defineEval } from "fastevals";
import { satisfies } from "fastevals/expect";

// ★ regime:长程压缩(单会话,不 newSession)
// 失败模式:知识更新 · 项目决定要压过模型先验,并且熬过多次压缩。
// 真实场景 = next-evals-oss 的 agent-031:Next 16 把 middleware.ts 改名 proxy.ts。
// 模型的训练先验仍是「中间件写 middleware.ts」—— 这就是要被取代的旧值。
//
// 会话早期把项目决定讲清(用 proxy.ts、弃 middleware.ts),然后做一串真实功能(把会话拉长、
// 触发压缩),最后才让它加中间件。记忆承载点 = 这条决定:它与模型先验相反、盘上也没有
// proxy.ts 可抄,且必须熬过中间的多次压缩。只有把它留住的 agent 会写 proxy.ts。
export default defineEval({
  description: "更新熬过压缩:一串功能、多次压缩后,中间件仍用项目定的 proxy.ts,不退回模型先验的 middleware.ts",
  async test(t) {
    // —— 早期:讲清项目决定 ——
    const ack = await t.send(
      "提醒一下项目现状:我们已升到 Next 16,中间件统一写在根目录的 proxy.ts 里," +
        "不要再用旧的 middleware.ts(那是 16 之前的写法)。记住这条。",
    );
    ack.expectOk();
    t.memory.recalled(/proxy\.ts|middleware/i);

    // —— 长程:连做一串【与中间件无关】的真实功能,触发多次压缩 ——
    const features = [
      "加一个顶部 NavBar。",
      "建一个 app/about/page.tsx 关于页。",
      "加一个 Footer 组件。",
      "加一个 Card 展示组件。",
      "建一个 app/blog/page.tsx 博客列表占位页。",
      "加一个亮/暗主题切换 ThemeToggle。",
      "加一个 app/not-found.tsx 404 页。",
      "加一个面包屑组件 Breadcrumbs。",
      "加一个站内搜索框 SearchBox(只做受控输入)。",
      "加一个回到顶部按钮 BackToTop。",
    ];
    for (const f of features) {
      (await t.send(f)).expectOk();
    }

    // —— 最后:加中间件,绝口不提 proxy/middleware ——
    await t.send("加一段中间件:把未登录用户重定向到 /login。");

    // 用了项目决定的 proxy.ts
    t.calledTool("file_write", { input: { path: /(^|\/)proxy\.ts$/ } });
    // 没有退回模型先验的 middleware.ts(断言错误答案的缺席)
    t.notCalledTool("file_write", { input: { path: /(^|\/)middleware\.ts$/ } });
    t.notInDiff(/middleware\.ts/);
    t.judge.agent("看 sandbox 根目录:重定向中间件是写在 proxy.ts 里吗?有没有(错误地)新建 middleware.ts?").atLeast(0.7);
    // 确认这一长会话里确实压缩过 —— 否则不算「熬过压缩」
    t.check(t.memory.compactions(), satisfies((n) => Number(n) >= 1, "会话里发生过 ≥1 次上下文压缩"));
    t.scriptPassed("build");
  },
});
