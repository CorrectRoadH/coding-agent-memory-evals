import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";
import { fillContext } from "../_support/gap.js";

// 失败模式 #2 时序推理(LongMemEval temporal-reasoning;LoCoMo temporal)
// 跨多轮按顺序立下几个决定,中途改掉其中一个,然后问「最早定的是什么、后来换成了什么」。
// 这跟「知识更新」不同:那条考的是『在代码里用最新值』,这条考的是『能不能区分先后』——
// 两个值都「相关」,光检索不够,必须保住顺序信息。纯对话题,不写文件。
export default defineEval({
  description: "时序推理:正确区分状态管理『最早定 Redux、后来换 Zustand』,组件库始终是 Ant Design",
  async test(t) {
    // —— Plant:带明确先后的几个决定 ——
    (await t.send("先定个技术选型:状态管理用 Redux。")).expectOk();
    (await t.send("组件库就用 Ant Design。")).expectOk();
    (await t.send("状态管理改一下吧,Redux 太重,换成 Zustand。")).expectOk();

    // —— Gap:长程,逼它从记忆而非上文回答 ——
    await fillContext(t, 12);

    // —— Probe:同时问「最早 / 后来」,逼出顺序 ——
    await t.send("帮我回顾一下:状态管理我们最早定的是哪个、后来换成了哪个?组件库呢?");

    // 三个关键词都得在(检索到了)
    t.check(t.reply, includes("Redux"));
    t.check(t.reply, includes("Zustand"));
    t.check(t.reply, includes(/Ant\s?Design/i));
    // 顺序得对:Redux 是「最早/被换掉的」,Zustand 是「现在的」—— 这才是本题的考点
    t.judge
      .closedQA("是否把 Redux 说成『最早定的/已被替换』、把 Zustand 说成『现在用的』,且组件库说成 Ant Design", { on: t.reply })
      .atLeast(0.7);
  },
});
