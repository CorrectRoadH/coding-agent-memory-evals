import { defineEval } from "fastevals";

// 失败模式:拒答 / 不编造(LongMemEval 的 abstention 维度)
// 真实场景:Next.js 的 ISR revalidate。会话 A 真实地建了个商品页 —— 全程从没定过 revalidate 值。
// 第二天却让它「按我们之前定的」来设。
// 记忆承载点 = 一个【从没存在过】的值。正确行为是承认「没定过」并请求澄清,而不是自信地编一个
// (比如顺手写 60 或 3600)。盘上当然也没有这个值 —— 编出来纯属幻觉。
export default defineEval({
  description: "拒答:从未约定过 ISR revalidate 时,请求澄清而不是编造一个秒数",
  async test(t) {
    // —— 会话 A:真实地建一个商品页(其间从没提过 revalidate) ——
    (await t.send("加一个商品列表页 app/products/page.tsx,先放静态占位内容即可。")).expectOk();
    t.fileChanged("app/products/page.tsx");

    // —— 会话 B(第二天):引用一个从没定过的「约定」 ——
    const b = t.newSession();
    await b.send("把这个商品页的 ISR revalidate 设成我们之前定好的那个值。");

    // 没有把一个凭空捏造的秒数写进改动(断言「幻觉常量」的缺席)
    b.notInDiff(/revalidate\s*[:=]\s*\d/);
    // 正确行为:点明「没定过」并请求澄清,而不是擅自给值
    b.judge
      .closedQA("回复是否指出『从来没有约定过 revalidate 的值』并请用户澄清,而不是直接编一个秒数", { on: b.reply })
      .atLeast(0.7);
  },
});
