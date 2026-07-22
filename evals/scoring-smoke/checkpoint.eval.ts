import { defineScoreEval } from "niceeval";
import { commandSucceeded, includes, isTrue } from "niceeval/expect";

// 冒烟:核实 niceeval defineScoreEval 全链路(照抄 docs/feature/eval/use-case/rubric-scoring.md
// 「全流程」一节的检查点制写法,把 DB-GPT 换成一个几秒钟就能跑完的最小任务)。
// 五个检查点各值 1 分,前置用 t.require 中止——挂了照实记 0 分,不连坐后面。
export default defineScoreEval({
  description: "冒烟:创建配置文件、跑两条命令,按检查点计分",
  async test(t) {
    await t.send(
      "在当前目录创建文件 SMOKE.md,写入一行文字:niceeval scoring smoke。" +
        "然后运行 `echo done > /tmp/smoke-marker.txt`,最后运行 `cat SMOKE.md` 确认内容。",
    );

    // 前置:文件都没建,后面的检查点无从谈起
    const created = await t.sandbox.fileExists("SMOKE.md");
    await t.require(created, isTrue("SMOKE.md created"));

    t.sandbox.fileChanged("SMOKE.md").points(1); // ① 建了文件
    t.calledTool("shell", { input: { command: /echo done/ } }).points(1); // ② 跑了 echo 标记命令

    const cat = await t.sandbox.runShell("cat SMOKE.md");
    t.check(cat, commandSucceeded()).points(1); // ③ cat 命令本身成功
    t.check(cat.stdout, includes("niceeval scoring smoke")).points(1); // ④ 内容确实写对了
  },
});
