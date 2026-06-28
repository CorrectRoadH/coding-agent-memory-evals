import { defineEval } from "fastevals";
import { includes, satisfies } from "fastevals/expect";
import { realWork } from "../_support/gap.js";

// 失败模式 #4+#6 长程精确提取 / lost-in-the-middle
// 早早埋一个【精确数值】,然后做几件真实开发任务把它埋进上下文深处(并对有压缩的
// agent 触发 anchor),最后让它写一段必须用到这个数值的代码。
// 精确值类的题最难作弊:差一点就是错(100 ≠ 60 ≠ 1000),负向断言一票否决。
export default defineEval({
  description: "长程精确提取:做完几件真实功能后,限流中间件仍用早先约定的『每分钟 100 次』",
  async test(t) {
    // —— Plant:一个容易在长程里被冲走的精确约束 ——
    const ack = await t.send("先记一个运行约束:这个项目对外接口的限流是【每分钟 100 次请求】,以后实现限流都按这个数。");
    ack.expectOk();
    t.memory.recalled(/100|限流|rate.?limit/i);

    // —— Gap:做几件真实的活(都不碰后端 / 限流),把约束埋进上下文深处 ——
    await realWork(t, 6, { avoid: ["api"] });

    // —— Probe:写限流代码,绝口不提具体数字 ——
    await t.send("加一个简单的限流中间件函数,放到 src/rateLimit.ts。");

    t.fileChanged("src/rateLimit.ts");
    const file = t.file("src/rateLimit.ts"); // 读 sandbox 最终文件,比对 diff 文本更稳
    t.check(file, includes(/\b100\b/)); // 用了对的数
    // 没有退回到「随手编一个常见默认值」(断言错误答案的缺席,限定在这个文件内)
    t.check(file, satisfies((s) => !/\b(60|1000|500|10|30)\b/.test(String(s)), "没有用别的常见限流默认值"));
    t.judge.closedQA("这段限流代码的阈值是否是『每分钟 100 次』", { on: file }).atLeast(0.7);
    t.scriptPassed("build");
  },
});
