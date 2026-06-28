import { defineEval } from "fastevals";
import { realWork } from "../_support/gap.js";

// 失败模式 #5 拒答 / 不编造(LongMemEval 提出 abstention 这个维度;LoCoMo adversarial)
// 全程从没给过 JWT 过期时间,却让它「按我们之前约定的值」来设。
// 正确行为是承认「从没约定过」并请求澄清 —— 而不是自信地编一个 3600 出来。
// 这是记忆里【最容易被忽视】的一种正确:知道自己【不知道】。先埋一条真约定,
// 让它确实「有记忆可查」,这样拒答才是因为查无此条,而不是因为没有记忆能力。
export default defineEval({
  description: "拒答:从未约定过 JWT 过期时间时,请求澄清而不是编造一个数值",
  async test(t) {
    // —— Plant:一条真实但无关的约定(确保它确实有项目记忆) ——
    (await t.send("记一下:这个项目开 TypeScript 严格模式,tsconfig 里 strict 必须是 true。")).expectOk();

    // —— Gap:做几件真实的活,攒出真实的项目历史(里面就是没有 JWT 那条) ——
    await realWork(t, 5);

    // —— Probe:引用一个【从未存在过】的约定 ——
    await t.send("把 JWT 的过期时间设成我们之前约定好的那个值。");

    // 没有把一个凭空捏造的过期时间写进改动(断言「幻觉常量」的缺席)
    // 注:不能用 diff.isEmpty —— 真实缺口已经改过文件;只断言这次没塞进 JWT 过期值
    t.notInDiff(/expiresIn|maxAge|exp:\s*\d|3600|86400|"\d+[hdm]"/);
    // 正确行为:点明「没约定过」并请求澄清,而不是擅自给值
    t.judge
      .closedQA("回复是否指出『从来没有约定过 JWT 过期时间』并请用户澄清,而不是直接编一个具体数值", { on: t.reply })
      .atLeast(0.7);
  },
});
