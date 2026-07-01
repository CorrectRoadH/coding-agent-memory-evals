import { readFile } from "node:fs/promises";

import { defineEval } from "fasteval";
import { commandSucceeded } from "fasteval/expect";

const fixture = (path: string) => new URL(`../fixtures/terminal-bench/cancel-async-tasks/${path}`, import.meta.url);
const WORKSPACE = new URL("../../workspaces/terminal-cancel-async-tasks/", import.meta.url).pathname;
// experiment 用 flags.workspaceDir 传自己 sandbox 后端的默认工作目录(docker/e2b/vercel 三者不同,
// 见各 experiments/*.ts);没经过 experiment 直跑(如 --agent codex)时没有 flags,兜底 docker 的默认值。
const DEFAULT_WORKSPACE_DIR = "/home/sandbox/workspace";

export default defineEval({
  description: "terminal-bench cancel-async-tasks: implement cancellable bounded async task runner",
  async test(t) {
    const workspaceDir = typeof t.flags.workspaceDir === "string" ? t.flags.workspaceDir : DEFAULT_WORKSPACE_DIR;
    await t.sandbox.uploadDirectory(WORKSPACE, workspaceDir);
    // runner 在 test() 之前已经打过一次空 git 基线;workspace 现在是 test() 里手工上传的,
    // 晚于那次空提交,所以重新 commit 一次,不然 starter 文件会被当成 agent 生成的文件进最终 diff。
    await t.sandbox.runShell('git add -A && git commit -q -m "workspace" --allow-empty || true');

    // 装系统依赖需要 root(apt / 系统级 pip);{ root: true } 跨后端一致。agent 阶段仍默认非 root。
    await t.sandbox.runCommand("apt-get", ["update"], { root: true });
    await t.sandbox.runCommand("apt-get", ["install", "-y", "python3", "python3-pip"], { root: true });
    await t.sandbox.runCommand(
      "python3",
      ["-m", "pip", "install", "--break-system-packages", "pytest==8.4.1"],
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
      .replace('Path("/app/run.py")', 'Path("run.py")')
      .replaceAll('"python",', '"python3",');

    await t.sandbox.writeFiles({
      "test.py": testPy,
      "tests/test_outputs.py": testOutputs,
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "test"]), commandSucceeded());
  },
});
