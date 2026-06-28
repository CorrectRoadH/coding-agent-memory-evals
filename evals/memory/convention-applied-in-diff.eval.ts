import { defineEval } from "fastevals";
import { includes, satisfies } from "fastevals/expect";

// 失败模式:复述 ≠ 落地,且约定【没有代码先例】可抄
//
// 真实场景:技术负责人在动手写代码【之前】先立一条规矩,下一个会话团队才开始写第一个模块。
// 规矩:禁止 export default,只用具名导出 —— 这恰好和模型的训练先验相反(模型爱写 default)。
//
// 记忆承载点 = 这条规矩本身。它【只在对话里说过,没写进任何文件】(没有 .eslintrc、没有
// 已有模块可参照)。所以盘上没有先例可「跟随现有写法」,agent 必须靠记住规矩来压过自己的默认。
// 而且只看产出的 diff,不看它嘴上说什么 —— 复述会用具名导出,不等于真写成了具名导出。
export default defineEval({
  description: "无先例的约定落地:新会话写第一个模块,只用具名导出、绝无 export default",
  async test(t) {
    // —— 会话 A:动手前先立规矩(纯约定,不落任何文件) ——
    const ack = await t.send(
      "开工前先定个项目规矩:禁止 export default,所有模块一律只用具名导出。从下一个文件开始就这么执行。",
    );
    ack.expectOk();
    t.memory.recalled(/named|具名|default/i);

    // —— 会话 B(开始写第一个模块):上下文清零,盘上没有任何模块可参照导出风格 ——
    const b = t.newSession();
    await b.send("写 src/storage.ts,封装一下 localStorage 的读写(get/set/remove)。");

    b.fileChanged("src/storage.ts");
    const file = b.file("src/storage.ts"); // 读 sandbox 最终文件
    b.check(file, includes(/export\s+(function|const)\s/)); // 用了具名导出
    b.check(file, satisfies((s) => !/export\s+default/.test(String(s)), "没有 export default"));
    b.judge.agent("通读 src/storage.ts:它是否只用具名导出、完全没有 export default?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
