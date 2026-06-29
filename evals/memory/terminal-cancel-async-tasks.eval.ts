import { readFile } from "node:fs/promises";

import { defineEval } from "fasteval";

const fixture = (path: string) => new URL(`../fixtures/terminal-bench/cancel-async-tasks/${path}`, import.meta.url);

export default defineEval({
  description: "terminal-bench cancel-async-tasks: implement cancellable bounded async task runner",
  workspace: "./workspaces/terminal-cancel-async-tasks",
  setup: async (sandbox) => {
    // 装系统依赖需要 root(apt / 系统级 pip);{ root: true } 跨后端一致。agent 阶段仍默认非 root。
    await sandbox.runCommand("apt-get", ["update"], { root: true });
    await sandbox.runCommand("apt-get", ["install", "-y", "python3", "python3-pip"], { root: true });
    await sandbox.runCommand(
      "python3",
      ["-m", "pip", "install", "--break-system-packages", "pytest==8.4.1"],
      { root: true },
    );
  },
  async test(t) {
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
      .replace('Path("/app/run.py")', 'Path("run.py")')
      .replaceAll('"python",', '"python3",');

    await t.sandbox.writeFiles({
      "test.py": testPy,
      "tests/test_outputs.py": testOutputs,
    });

    t.scriptPassed("test");
  },
});
