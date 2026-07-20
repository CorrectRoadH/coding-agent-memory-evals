import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/react-datepicker/pr-6167/${path}`, import.meta.url);

const REPO_URL = "https://github.com/Hacker0x01/react-datepicker.git";
// PR #6167, merge commit 6667a40d339d8fb5a6c02263b08d366cf2cfc449. gh's reported
// baseRefOid matches BASE_COMMIT exactly, and the merge commit's first parent is also
// BASE_COMMIT — no discrepancy to reconcile here.
const BASE_COMMIT = "be355b09d8ba18eeed82fa70968b1708687603ab";

export default defineEval({
  description:
    "react-datepicker pr-6167: stop rendering an extra wrapper div around the portaled calendar when withPortal is set (real react-datepicker issue)",
  // 纯 Node 仓库,corepack+yarn 装依赖、跑单个 jest 文件都在数十秒内完成,用默认超时足够。
  diff: {
    // package.json 加入排除:corepack+yarn install 会把 package.json 里内联的数组
    // (files/sideEffects/keywords/lint-staged)重新格式化成多行,是 install 步骤本身的
    // 副作用,不是 agent 的改动;修复只在 src/index.tsx,agent 不需要碰 package.json。
    ignore: ["coverage", "node_modules", "package.json"],
  },
  async test(t) {
    // 没有单独的 workspace 起始目录——fixture 就是这个 base commit 本身:clone 真实 repo、
    // 退到 base commit、抹掉未来历史(remote/tags/reflog),agent 拿到带真实(截断)git 历史
    // 的 checkout。checkout 必须在 workdir 根——嵌套子目录会被 diff 分类账记成 gitlink,
    // agent 的改动就从证据里消失了。任务说明只通过下面的 t.send() 传给 agent。
    t.progress({ message: "cloning react-datepicker @ base commit" });
    const cloned = await t.sandbox.runShell(
      [
        "set -euo pipefail",
        "git clone -q -o origin --single-branch " + REPO_URL + " .rdp-clone",
        "mv .rdp-clone/.git .git",
        "rm -rf .rdp-clone",
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
      throw new Error(`react-datepicker checkout failed: ${(cloned.stderr || cloned.stdout).trim().slice(-500)}`);
    }

    t.progress({ message: "yarn install" });
    const installed = await t.sandbox.runShell("corepack enable && yarn install --immutable");
    if (installed.exitCode !== 0) {
      throw new Error(`yarn install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-datepicker repository at the commit where the " +
          "bug below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: react-datepicker supports a `withPortal` prop that renders the calendar into a React portal " +
          "instead of inline/popper-positioned next to the input. When `withPortal` is set (and no `portalId` " +
          "override is used), the component currently wraps its output in an extra, unnecessary `<div>` around " +
          "the input container and the portal — an element with no styling purpose that does not exist in the " +
          "equivalent non-portal render path. Concretely, rendering `<DatePicker withPortal />` produces a DOM " +
          "shape where the element with class `react-datepicker__input-container` is nested one level deeper " +
          "than it should be, inside a superfluous wrapping `<div>`, instead of being a direct child of whatever " +
          "container the caller rendered `DatePicker` into. The fix should make the input container a direct " +
          "child of the render container in the `withPortal` case too, with no extra wrapping element in " +
          "between (the portaled calendar content itself still renders elsewhere via React's portal mechanism — " +
          "only the unnecessary wrapper around the input container should go away).\n\n" +
          "Environment notes: no root access is needed. Dependencies are already installed via " +
          "`corepack enable && yarn install --immutable`. Run tests with Jest, e.g. " +
          "`node_modules/.bin/jest src/test/datepicker_test.test.tsx` to scope to the datepicker component " +
          "tests. Fix the library source (likely in `src/index.tsx`, wherever the portal render branch builds " +
          "its returned JSX); do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const hiddenTest = await readFile(fixture("tests/datepicker_test.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/datepicker_test.test.tsx": hiddenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
