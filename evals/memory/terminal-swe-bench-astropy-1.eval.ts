import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/terminal-bench/swe-bench-astropy-1/${path}`, import.meta.url);

const BASE_COMMIT = "d16bfe05a744909de4b27f5875fe0d4ed41ce607";

export default defineEval({
  description:
    "terminal-bench swe-bench-astropy-1: fix separability_matrix for nested CompoundModels (real SWE-bench astropy issue)",
  // agent 要从源码构建 astropy(数分钟),测试阶段还要在干净 venv 里再构建一次;600s 全局默认必超。
  timeoutMs: 2_700_000,
  // 编辑安装会把编译产物散在源码树里;修复本身在 .py,排掉归因噪音。
  // 注意默认排除表里的 __pycache__ 是顶层 pathspec,不带通配符匹配不到嵌套目录,
  // 所以要自己加 "*.pyc";wcs/include 和 version.py 是构建期生成的。
  diff: {
    ignore: ["*.so", "*.c", "*.pyc", "*.egg-info", ".eggs", ".hypothesis", ".pytest_cache", "astropy/wcs/include", "astropy/version.py"],
  },
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/swe-bench-astropy-1");

    // 装系统依赖需要 root;gcc/patch 是构建 astropy C 扩展和应用隐藏 test_patch 的前提。
    await t.sandbox.runShell(
      "{ command -v gcc && command -v patch && command -v curl; } >/dev/null 2>&1 || {\n" +
        "  apt-get update &&\n" +
        "  apt-get install -y git gcc patch curl ca-certificates ;\n" +
        "}",
      { root: true },
    );

    // 非 root 装 uv + CPython 3.9:上游镜像就是 python3.9,模板 apt 的 python 编不动
    // 这个 2021 年 commit 里 pin 死的 cython==0.29.22。
    t.progress({ message: "installing uv + CPython 3.9" });
    await t.sandbox.runShell(
      'export PATH="$HOME/.local/bin:$PATH"\n' +
        "command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh\n" +
        "uv python install 3.9",
    );

    // 照上游 Dockerfile:clone 真实 repo、退到 base commit、抹掉未来历史(remote/tags/reflog),
    // agent 拿到带真实(截断)git 历史的 checkout。checkout 必须在 workdir 根——嵌套子目录
    // 会被 diff 分类账记成 gitlink,agent 的改动就从证据里消失了。
    t.progress({ message: "cloning astropy @ base commit" });
    const cloned = await t.sandbox.runShell(
      [
        "set -euo pipefail",
        "git clone -q -o origin --single-branch https://github.com/astropy/astropy.git .astropy-clone",
        "mv .astropy-clone/.git .git",
        "rm -rf .astropy-clone",
        `git reset -q --hard ${BASE_COMMIT}`,
        "git remote remove origin",
        "git tag -l | xargs -r git tag -d >/dev/null",
        "git reflog expire --expire=now --all",
        "git gc -q --prune=now",
        // 上游同款自检:base commit 之后不应再有任何 commit 可见
        `TS=$(git show -s --format=%ci ${BASE_COMMIT})`,
        'COUNT=$(git log --oneline --since="$TS" | wc -l)',
        '[ "$COUNT" -eq 1 ]',
      ].join("\n"),
    );
    if (cloned.exitCode !== 0) {
      throw new Error(`astropy checkout failed: ${(cloned.stderr || cloned.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real astropy repository at the commit where the bug below reproduces. " +
          "Find and fix the bug in the astropy source code (see README.md for the full report).\n\n" +
          "Bug: modeling's `separability_matrix` does not compute separability correctly for nested CompoundModels. " +
          "For example with `cm = m.Linear1D(10) & m.Linear1D(5)`, `separability_matrix(m.Pix2Sky_TAN() & cm)` reports the " +
          "two Linear1D inputs/outputs as NOT separable (a 2x2 block of True), while the equivalent un-nested model " +
          "`m.Pix2Sky_TAN() & m.Linear1D(10) & m.Linear1D(5)` correctly reports them as separable.\n\n" +
          "Environment notes: you do not have root. A Python 3.9 toolchain is available through `uv` (already installed): " +
          "`uv venv --python 3.9 --seed .venv && source .venv/bin/activate`, then `pip install -e .` to build astropy " +
          "(gcc is available). Fix the library source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const testPatch = await readFile(fixture("tests/test_patch.diff"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "tests/test_patch.diff": testPatch,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "test"]), commandSucceeded());
  },
});
