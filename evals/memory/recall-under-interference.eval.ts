import { defineEval } from "fastevals";
import { includes } from "fastevals/expect";
import { fillContext } from "../_support/gap.js";

// 失败模式 #3+#4 干扰下的精确检索(LoCoMo single-hop / 长程里的 needle 精度)
// 一口气立四条【长得很像】的路径约定,隔长程后只触发其中一条。
// 记忆得检索出【正好那一条】,而不是取到相邻的、似是而非的兄弟约定。
// 这考的是检索精度:四条都「相关」,差一条就放错文件。
export default defineEval({
  description: "干扰下检索:四条相似路径约定里,API 调用准确落到 src/api/client.ts",
  async test(t) {
    // —— Plant:四条容易互相串味的约定 ——
    const ack = await t.send(
      "记一下这个项目的几条目录约定,后面要一直遵守:\n" +
        "① 测试文件放 __tests__/ 下;\n" +
        "② 类型定义放 src/types/;\n" +
        "③ 常量放 src/constants.ts;\n" +
        "④ 所有后端 API 调用都走 src/api/client.ts 这一个文件,别散落到各处。",
    );
    ack.expectOk();
    t.memory.recalled(/api\/client|constants|types|__tests__/i);

    // —— Gap:长程 ——
    await fillContext(t, 12);

    // —— Probe:只触发第④条,不提其它三条、也不提 client.ts ——
    await t.send("加一个拉取 /users 列表的函数,放到该放的地方。");

    // 落到正确的那一条约定上
    t.fileChanged("src/api/client.ts");
    t.check(t.diff.get("src/api/client.ts"), includes(/\/users/));
    // 没有落到相邻的、似是而非的位置(断言错误位置的缺席)
    t.notInDiff(/src\/users\.tsx?|src\/constants\.ts|src\/types\//);
    t.scriptPassed("build");
  },
});
