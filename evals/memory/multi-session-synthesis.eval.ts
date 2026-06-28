import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

// 失败模式 #3 多会话综合 / multi-hop(LongMemEval multi-session;LoCoMo multi-hop)
// 把答案拆成两半,分别埋在【两个不同的会话】里,第三个会话才要求把它们拼起来。
// 没有任何单条上下文同时含有这两半 —— 只有跨会话持久的记忆能把它们重新合到一起。
// 这比「跨会话持久」更狠:不是带过来一条,而是带过来两条、且要在新活里合成。
export default defineEval({
  description: "多会话综合:fetch 封装同时用上『会话A的 base URL』和『会话B的鉴权 token』两条记忆",
  async test(t) {
    // —— 会话 A:埋第一半 ——
    (await t.send("记一下:后端 API 的基础地址放在环境变量 API_BASE_URL 里,代码里别写死域名。")).expectOk();

    // —— 会话 B(全新):埋第二半 ——
    const b = t.newSession();
    (await b.send(
      "再记一条:调后端必须带鉴权,token 在环境变量 API_TOKEN 里,放进 Authorization: Bearer <token> 请求头。",
    )).expectOk();

    // —— 会话 C(全新):要求把两半合成 ——
    const c = t.newSession();
    await c.send("写一个 fetch 封装函数 request(path),以后调后端都走它。放到 src/api/client.ts。");

    c.fileChanged("src/api/client.ts");
    const file = c.diff.get("src/api/client.ts");
    // 两条记忆都用上了
    c.check(file, includes(/API_BASE_URL/)); // 来自会话 A
    c.check(file, includes(/API_TOKEN/)); // 来自会话 B
    c.check(file, includes(/Bearer/)); // 来自会话 B 的细节
    // 都从 env 读,没有把任意一半写死(断言错误做法的缺席)
    c.check(file, includes(/process\.env/));
    c.notInDiff(/https?:\/\/[^\s'"]+\.(com|io|net)/); // 没硬编码域名
    c.scriptPassed("build");
  },
});
