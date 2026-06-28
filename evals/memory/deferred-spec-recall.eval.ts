import { defineEval } from "fastevals";
import { includes, satisfies } from "fastevals/expect";

// 失败模式:精确规范延后落地(LongMemEval information-extraction)
// 真实场景:Next.js 的 fetch 缓存策略。会话 A 定下统一缓存配置并搭好取数据的骨架,但【明确说
// 缓存配置下一步再统一加】—— 所以盘上的代码此刻没有这两个值。第二天才真正去加。
// 记忆承载点 = 说过但还没写进代码的精确配置(revalidate 3600、tags: ['catalog'])。
// 精确值最难作弊:差一点就是错。
export default defineEval({
  description: "延后落地的缓存规范:新会话给 fetch 加缓存时,仍用早先定的 revalidate 3600 / tags ['catalog']",
  async test(t) {
    // —— 会话 A:定规范 + 搭骨架,故意先不写缓存配置 ——
    const ack = await t.send(
      "搭一个取商品目录的数据层 app/lib/catalog.ts,先把 getCatalog() 的 fetch 骨架写出来即可。" +
        "统一缓存规范我先说好:所有目录类 fetch 都要带 next: { revalidate: 3600, tags: ['catalog'] } —— " +
        "这个配置等接口齐了下一步再统一加,现在先别写。",
    );
    ack.expectOk();
    t.fileChanged("app/lib/catalog.ts");
    t.memory.recalled(/3600|revalidate|catalog|tags/i);

    // —— 会话 B(第二天):上下文清零,盘上的骨架里还没有缓存配置 ——
    const b = t.newSession();
    await b.send("现在给目录的 fetch 把我们定好的缓存配置加上。");

    const file = b.file("app/lib/catalog.ts");
    b.check(file, includes(/revalidate/));
    b.check(file, includes(/3600/)); // 对的过期秒数
    b.check(file, includes(/['"]catalog['"]/)); // 对的 tag
    // 没有随手编一个常见默认值(断言错误答案的缺席)
    b.check(file, satisfies((s) => !/revalidate:\s*(60|300|86400|0|false)\b/.test(String(s)), "没用别的常见 revalidate 默认值"));
    b.judge.agent("通读 app/lib/catalog.ts:fetch 是否真的带上了 revalidate 3600 和 tags ['catalog'](接上线,不是写在注释里)?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
