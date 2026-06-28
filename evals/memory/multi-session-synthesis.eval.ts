import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

// 失败模式:多会话综合 / multi-hop(LongMemEval multi-session;LoCoMo multi-hop)
//
// 真实任务:分三次把一个 API client 搭起来。答案的两半分别在【两个不同会话】里定下、
// 且都【还没写进代码】,第三个会话才要求合到一起。
//
// 记忆承载点 = 分散在两个会话、盘上都看不到的两条决定(base URL 用哪个 env、token 怎么放)。
// 没有任何单条上下文同时含这两半;盘上的骨架也不含它们 —— 只有跨会话持久的记忆能把它们重新合起来。
export default defineEval({
  description: "多会话综合:request() 同时用上会话A的 API_BASE_URL 和会话B的 Bearer token",
  async test(t) {
    // —— 会话 A:定第一半 + 建空骨架(骨架里先不写 env) ——
    (await t.send("搭 API client:基础地址放在环境变量 API_BASE_URL,别写死。先把 src/api/client.ts 建个空骨架,具体逻辑后面补。")).expectOk();

    // —— 会话 B(全新):定第二半(只记着,先不接) ——
    const b = t.newSession();
    (await b.send("再记一条鉴权方案:token 在环境变量 API_TOKEN 里,放进 Authorization: Bearer <token> 头。先记着,下一步再接。")).expectOk();

    // —— 会话 C(全新):要求把两半合成可用 ——
    const c = t.newSession();
    await c.send("把 client 里的 request(path) 函数补完,让它能直接拿来调后端。");

    const file = c.file("src/api/client.ts"); // 读 sandbox 最终文件
    c.check(file, includes(/API_BASE_URL/)); // 来自会话 A
    c.check(file, includes(/API_TOKEN/)); // 来自会话 B
    c.check(file, includes(/Bearer/)); // 来自会话 B 的细节
    c.check(file, includes(/process\.env/)); // 都从 env 读
    c.notInDiff(/https?:\/\/[^\s'"]+\.(com|io|net)/); // 没硬编码域名
    c.judge.agent("通读 src/api/client.ts:request 是否用 API_BASE_URL 拼地址、并把 API_TOKEN 放进 Authorization: Bearer 头?两条都要真正接上线。").atLeast(0.7);
    c.scriptPassed("build");
  },
});
