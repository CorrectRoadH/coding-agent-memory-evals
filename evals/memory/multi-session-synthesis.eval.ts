import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";

// 失败模式:多会话综合 / multi-hop(LongMemEval multi-session;LoCoMo multi-hop)
// 真实场景:Next.js 鉴权,两条关键事实分别在两个会话里定下、且都还没写进代码:
//   会话 A:读 cookie 用 next/headers 的 cookies();注意 Next 15 起 cookies() 是【异步】的、必须 await。
//   会话 B:session id 存在名为 'sid' 的 cookie 里。
// 第三个会话才要求把鉴权读取写出来。记忆承载点 = 这两条分散、都没落地的决定。
// 没有任何单条上下文同时含它们,盘上骨架也不含 —— 只有跨会话记忆能合到一起。
export default defineEval({
  description: "多会话综合:getCurrentUser 同时用上『await cookies()(会话A)』和『cookie 名 sid(会话B)』",
  // starter repo + prep 写在 eval 里(见 retention-through-compaction 的说明)。
  workspace: "./workspaces/next-app",
  setup: async (sandbox) => {
    await sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);
  },
  async test(t) {
    // —— 会话 A:第一半 + 空骨架(骨架里先不写实现) ——
    (await t.send("搭鉴权:读 cookie 用 next/headers 的 cookies() —— 注意 Next 15 起 cookies() 是异步的,必须 await。先把 app/lib/auth.ts 建个空骨架。")).expectOk();

    // —— 会话 B(全新):第二半(只记着,先不接) ——
    const b = t.newSession();
    (await b.send("再记一条:登录态的 session id 存在名为 'sid' 的 cookie 里。先记着,下一步再用。")).expectOk();

    // —— 会话 C(全新):要求把两半合成 ——
    const c = t.newSession();
    await c.send("在 app/lib/auth.ts 写一个 getCurrentUser(),读取当前登录用户。");

    const file = c.file("app/lib/auth.ts");
    c.check(file, includes(/cookies\(\)/)); // 来自会话 A
    c.check(file, includes(/await\s+cookies\(\)/)); // 来自会话 A 的关键细节:异步要 await
    c.check(file, includes(/['"]sid['"]/)); // 来自会话 B
    c.judge.agent("通读 app/lib/auth.ts:getCurrentUser 是否用 `await cookies()` 读取、并取名为 'sid' 的 cookie?两条都要真正接上(不是写在注释里)。").atLeast(0.7);
    c.scriptPassed("build");
  },
});
