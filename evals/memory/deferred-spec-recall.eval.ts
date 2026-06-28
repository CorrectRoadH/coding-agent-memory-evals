import { defineEval } from "fastevals";
import { includes, satisfies } from "fastevals/expect";

// 失败模式:精确数值规范的延后落地(LongMemEval information-extraction)
//
// 这是一次真实开发:搭一个 API client 模块,分几次长出来。会话 A 先定下统一规范
// (超时 8000ms、失败重试 2 次)并搭好骨架,但【明确说这两条逻辑下一步再统一加】——
// 所以盘上的代码此刻【还没有】这两个值。第二天的会话才真正去加。
//
// 记忆承载点 = 那个【说过但还没写进代码的精确规范】。代码里看不到 8000 / 2,
// agent 没法从现有文件重新推导,只能靠记住。精确值类最难作弊:差一点就是错。
export default defineEval({
  description: "延后落地的精确规范:新会话给 client 加超时/重试时,仍用早先定的 8000ms / 2 次",
  async test(t) {
    // —— 会话 A:定规范 + 搭骨架,但故意先不写超时/重试 ——
    const ack = await t.send(
      "搭一个 API client 模块 src/api/client.ts。先把 get(path) 的骨架写出来即可。" +
        "统一规范我先说好:所有请求超时 8000ms、失败自动重试 2 次 —— 这两条逻辑等接口都齐了下一步再统一加,现在先别写。",
    );
    ack.expectOk();
    t.fileChanged("src/api/client.ts");
    // 规范要进持久记忆(盘上的骨架里还没有这两个值)
    t.memory.recalled(/8000|重试|retry|超时|timeout/i);

    // —— 会话 B(第二天接着做):上下文清零,盘上只有不含超时/重试的骨架 ——
    const b = t.newSession();
    await b.send("现在给 client 的请求把我们定好的超时和重试逻辑加上。");

    const file = b.file("src/api/client.ts"); // 读 sandbox 最终文件
    b.check(file, includes(/8000/)); // 用了对的超时值
    b.check(file, includes(/\b2\b/)); // 用了对的重试次数
    // 没有随手编一个常见默认值(断言错误答案的缺席,限定在这个文件内)
    b.check(file, satisfies((s) => !/\b(3000|5000|10000|30000)\b/.test(String(s)), "没用别的常见超时默认值"));
    b.judge.agent("通读 src/api/client.ts:请求是否真的应用了 8000ms 超时和 2 次重试(接上线了,不是写在注释里)?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
