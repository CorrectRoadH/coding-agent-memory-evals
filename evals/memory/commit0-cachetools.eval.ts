import { defineEval } from "niceeval";
import { commandSucceeded, excludes } from "niceeval/expect";

export default defineEval({
  description: "Commit0-style cachetools: implement the full library from stub signatures + spec until the upstream test suite passes",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/commit0-cachetools");
    // runner 在 test() 之前已经打过一次空 git 基线;workspace 现在是 test() 里手工上传的,
    // 晚于那次空提交,所以重新 commit 一次,不然 starter 文件会被当成 agent 生成的文件进最终 diff。
    await t.sandbox.runShell('git add -A && git commit -q -m "workspace" --allow-empty || true');
    // 记住基线 SHA:后面「tests/ 不许动」要对着它 diff,agent 中途自己 commit 也藏不住改动。
    const baseline = (await t.sandbox.runCommand("git", ["rev-parse", "HEAD"])).stdout.trim();

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
        "Implement the `cachetools` library in the `cachetools/` package of this repository.\n\n" +
          "Every public class, function signature, and docstring is already stubbed out; all bodies currently raise " +
          "`NotImplementedError`. The full API specification is in `SPEC.rst`. Implement the package until the entire " +
          "upstream test suite passes: `python3 -m pytest tests -rA -q`.\n\n" +
          "Do not modify anything under `tests/`, and do not install or vendor the `cachetools` package from PyPI; " +
          "write the implementation yourself.",
      )
      .then((turn) => turn.expectOk());

    // 防作弊:实现必须在仓库里。不能用 `pip show` 判断——cachetools 是 google-auth 等
    // 常见包的传递依赖,基础镜像可能预装,会误伤诚实实现;改为断言 import 解析进仓库。
    await t.group("Implementation lives in the repo, not site-packages", async () => {
      t.check(
        await t.sandbox.runCommand("python3", [
          "-c",
          "import os, sys; sys.path.insert(0, os.getcwd()); import cachetools; " +
            "p = os.path.abspath(cachetools.__file__); assert p.startswith(os.getcwd() + os.sep), p",
        ]),
        commandSucceeded(),
      );
      const impl = t.sandbox.file("cachetools/__init__.py");
      t.check(impl, excludes(/raise\s+NotImplementedError/));
    });

    // 测试套件不许动:对 tests/ 的任何改动(包括已被 agent commit 的)都会让 diff 不为空。
    await t.group("Upstream test suite unmodified", async () => {
      t.check(
        await t.sandbox.runCommand("git", ["diff", "--exit-code", baseline, "--", "tests/"]),
        commandSucceeded(),
      );
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "test"]), commandSucceeded());
  },
});
