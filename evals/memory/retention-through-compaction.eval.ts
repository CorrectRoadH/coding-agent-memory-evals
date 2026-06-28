import { defineEval } from "fastevals";
import { includes, satisfies } from "fastevals/expect";

// ★ regime:长程压缩(单会话,不 newSession)—— 这是记忆的另一半,之前被漏掉的那半。
//
// 记忆不只是「跨会话」。一个足够长的【单会话】里,上下文会被【反复压缩/摘要】;
// 一条早早定下的规范,得熬过这一次次压缩、在很后面才被需要时还在。对 bub 来说,
// 这直接考 tape 的 anchor(压缩检查点):压缩时把关键约束留下了吗?
//
// 任务:同一会话里把一个电商页面一步步搭起来。早期立一条精确规范(金额一律整数分 cents、
// 禁浮点),然后连做十几个【与金额无关】的真实功能(把会话拉长、触发多次压缩),
// 最后才做一个涉及金额的字段。这中间全是真实开发,不是合成填充。
export default defineEval({
  description: "长程压缩存活:十几个功能、多次压缩之后,购物车合计仍按早先定的『整数分 cents、禁浮点』来做",
  // 这条 eval 的 starter repo + 它的 prep 写在这里(不同 eval 可指不同 starter)。
  // session 开始时 workspace 被拷进沙箱当项目根、CWD 设到那儿;setup 只是补上拷贝不带的 node_modules
  //(否则 t.scriptPassed("build") 跑 next build 会挂),CWD 已是项目根,无需指定 workdir。
  workspace: "./workspaces/next-app",
  setup: async (sandbox) => {
    await sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);
  },
  async test(t) {
    // —— 早期:立一条精确规范 ——
    const ack = await t.send(
      "这个电商项目有条硬规范:所有金额一律用【整数分(cents)】存储和计算,禁止用浮点数表示钱" +
        "(浮点有精度问题)。以后任何涉及金额的字段、计算、展示都按整数分来。记住这条。",
    );
    ack.expectOk();

    // —— 长程:连做一串【与金额无关】的真实功能,把会话拉长、触发多次压缩 ——
    // 都是真实开发(在 next-app 上真的把店面搭起来),不碰金额这条轴。
    const features = [
      "加一个顶部 NavBar(Home / Products / About 三个链接)。",
      "加一个 ProductCard 组件:展示商品图片和名称(暂不显示价格)。",
      "建商品列表页 app/products/page.tsx,用 ProductCard 渲染一组占位商品。",
      "加一个搜索框组件 SearchBox,先只做受控输入、不接逻辑。",
      "加一个站点 Footer,放版权信息和几个链接。",
      "建一个 app/about/page.tsx 关于页。",
      "给商品列表加一个加载骨架屏组件 ProductSkeleton。",
      "加一个面包屑组件 Breadcrumbs。",
      "加一个 app/not-found.tsx 404 页面。",
      "加一个分页组件 Pagination(上一页/下一页 + 页码)。",
      "加一个空状态组件 EmptyState(没有商品时显示)。",
      "加一个亮/暗主题切换按钮 ThemeToggle。",
    ];
    for (const f of features) {
      (await t.send(f)).expectOk();
    }

    // —— 最后:第一个涉及金额的任务,绝口不提规范 ——
    await t.send("给购物车加一个 totalPrice 合计:把购物车里所有商品的价格加起来并显示出来。放 app/cart/total.ts。");

    // 元数据守卫:这一长会话必须真的压缩过 ≥2 次,否则不构成「长程压缩」题。
    // compactions() 由 transcript 派生、capability 门控:agent 不暴露压缩事件(返回 undefined)
    // 或上下文够大没触发 → skip(测试无效,不计入,不算 agent 挂)。
    const compactions = t.transcript.compactions();
    if ((compactions ?? 0) < 2) t.skip(`本会话压缩 ${compactions ?? "不可观测"} 次(< 2),不构成长程压缩题`);

    t.fileChanged("app/cart/total.ts");
    const file = t.file("app/cart/total.ts");
    // 行动轨:按整数分做(用 cents、展示时再 /100),没有用浮点表示钱
    t.check(file, includes(/cent/i));
    t.check(file, satisfies((s) => !/parseFloat|toFixed\(2\)|:\s*number\s*=\s*\d+\.\d|\b\d+\.\d{2}\b/.test(String(s)), "没有用浮点数表示金额"));
    t.judge.agent("通读 app/cart/total.ts:金额合计是不是用整数分(cents)做的(整数运算、展示时才除以 100),完全没有用浮点数表示钱?").atLeast(0.7);
    t.scriptPassed("build");
  },
});
