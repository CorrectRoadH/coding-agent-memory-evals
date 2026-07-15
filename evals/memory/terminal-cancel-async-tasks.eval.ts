import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/terminal-bench/cancel-async-tasks/${path}`, import.meta.url);

export default defineEval({
  description: "terminal-bench cancel-async-tasks: implement cancellable bounded async task runner",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/terminal-cancel-async-tasks");

    // 装系统依赖需要 root(apt / 系统级 pip);{ root: true } 跨后端一致。agent 阶段仍默认非 root。
    // 幂等预检按「末态」guard——目标是 pytest 可导入,不是 python3 存在。
    // python3 在 ≠ pip/pytest 在:若照 `command -v python3` 短路,模板只烘焙了 python3 时会静默漏装。
    // `import pytest` 成功已蕴含 python3+pip 就位,是正确的跳过键;失败(含 python3 缺失)才跑整段安装。
    await t.sandbox.runShell(
      "python3 -c 'import pytest' 2>/dev/null || {\n" +
        "  apt-get update &&\n" +
        "  apt-get install -y python3 python3-pip &&\n" +
        "  python3 -m pip install --break-system-packages pytest==8.4.1 ;\n" +
        "}",
      { root: true },
    );

    await t
      .send(
        "Implement `run_tasks` in `run.py`.\n\n" +
          "It must accept a list of async zero-argument callables and a `max_concurrent` limit. " +
          "It should run no more than `max_concurrent` tasks at once. If the run is cancelled, including by KeyboardInterrupt/SIGINT through `asyncio.run`, cleanup code in tasks that have already started must still run. " +
          "Queued tasks that have not started should not be started after cancellation begins.",
      )
      .then((turn) => turn.expectOk());

    const testPy = await readFile(fixture("tests/test.py"), "utf8");
    const rawOutputs = await readFile(fixture("tests/test_outputs.py"), "utf8");
    const testOutputs = rawOutputs
      .replaceAll('Path("/app/run.py")', 'Path("run.py")')
      .replaceAll('"python",', '"python3",');

    await t.sandbox.writeFiles({
      "test.py": testPy,
      "tests/test_outputs.py": testOutputs,
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "test"]), commandSucceeded());
  },
});
