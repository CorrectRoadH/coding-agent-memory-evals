import { defineEval } from "fastevals";
import { includes, satisfies } from "fastevals/expect";

// 失败模式:复述 ≠ 落地;约定要压过模型先验,且只看产出不看嘴
// 真实场景 = next-evals-oss 的 agent-021-avoid-fetch-in-effect:数据获取该用 Server Component +
// async/await,而模型先验老爱在 client component 里 useEffect + useState 拉数据。
//
// 会话 A 立项目约定(数据获取一律 Server Component,禁止 useEffect 拉数据);第二天让它加一个
// 取数据的组件。记忆承载点 = 这条约定(盘上还没有同类组件可抄、且与模型先验相反)。
// 评分照搬 next-oss 的签名:断言【正确写法存在 + 错误写法缺席】,而且只验产出文件、不验它的回复。
export default defineEval({
  description: "Server Component 约定落地:新会话取数据用 async/await,绝无 'use client' / useEffect / useState",
  async test(t) {
    // —— 会话 A:立约定(纯决定,不落代码) ——
    const ack = await t.send(
      "定个项目约定:所有数据获取一律用 Server Component + async/await 直接在组件里 await," +
        "禁止在 client component 里用 useEffect + useState 拉数据。以后都这样。",
    );
    ack.expectOk();
    t.memory.recalled(/Server Component|use client|useEffect|async/i);

    // —— 会话 B(第二天):上下文清零,盘上没有同类取数据组件可参照 ——
    const b = t.newSession();
    await b.send("加一个 UserProfile 组件(放 app/UserProfile.tsx),从 /api/users/profile 取数据,显示用户的 name 和 email。");

    b.fileChanged("app/UserProfile.tsx");
    const file = b.file("app/UserProfile.tsx"); // 读 sandbox 最终文件
    // 正确写法在(Server Component + async/await)
    b.check(file, includes(/async\s+function|export\s+default\s+async/));
    b.check(file, includes(/await/));
    // 错误写法缺席(next-oss 的命门:不是 client component、没用 useEffect/useState 拉数据)
    b.check(file, satisfies((s) => !/["']use client["']/.test(String(s)), "不是 client component"));
    b.check(file, satisfies((s) => !/useEffect|useState/.test(String(s)), "没用 useEffect/useState 拉数据"));
    b.judge.agent("通读 app/UserProfile.tsx:它是不是一个用 async/await 取数据的 Server Component,完全没有 'use client'、useEffect 或 useState?").atLeast(0.7);
    b.scriptPassed("build");
  },
});
