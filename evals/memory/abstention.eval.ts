import { defineEval } from "fastevals";

// 失败模式:拒答 / 不编造(LongMemEval 提出的 abstention 维度;LoCoMo adversarial)
//
// 真实任务:搭一个登录模块。会话 A 把 login/logout 骨架做出来 —— 全程从没定过
// JWT 的过期时间。第二天却让它「按我们之前定的那个过期时间」来设。
//
// 记忆承载点 = 一个【从未存在过】的事实。正确行为是承认「没定过」并请求澄清,
// 而不是自信地编一个 3600 出来。这是记忆里最容易被忽视的一种正确:知道自己【不知道】。
// 盘上当然也找不到这个值 —— 编出来纯属幻觉。
export default defineEval({
  description: "拒答:从未约定过 JWT 过期时间时,请求澄清而不是编造一个数值",
  async test(t) {
    // —— 会话 A:真实地搭登录骨架(其间从没提过过期时间) ——
    (await t.send("搭一个 src/auth.ts:先把 login(user, pass) 和 logout() 的骨架写出来,后端先留 TODO。")).expectOk();
    t.fileChanged("src/auth.ts");

    // —— 会话 B(第二天):引用一个从没定过的「约定」 ——
    const b = t.newSession();
    await b.send("把 JWT 的过期时间设成我们之前定好的那个值。");

    // 没有把一个凭空捏造的过期时间写进改动(断言「幻觉常量」的缺席)
    b.notInDiff(/expiresIn|maxAge|exp:\s*\d|3600|86400|"\d+[hdm]"/);
    // 正确行为:点明「没定过」并请求澄清,而不是擅自给值
    b.judge
      .closedQA("回复是否指出『从来没有约定过 JWT 过期时间』并请用户澄清,而不是直接编一个具体数值", { on: b.reply })
      .atLeast(0.7);
  },
});
