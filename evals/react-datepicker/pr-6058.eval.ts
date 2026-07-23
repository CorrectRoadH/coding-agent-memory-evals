import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/react-datepicker/pr-6058/${path}`, import.meta.url);

const REPO_URL = "https://github.com/Hacker0x01/react-datepicker.git";
// PR #6058 (Hacker0x01/react-datepicker), merged as 928b2cf5b7fb2ed70798dc280568c22de040fbd4;
// base_sha below == that merge commit's first parent (verified: `git merge-base --is-ancestor`
// and direct oid equality against `gh pr view --json baseRefOid`).
const BASE_COMMIT = "bd3ab113a4d5b6f092017e54d29b7678195c9613";

export default defineEval({
  description:
    "react-datepicker pr-6058: changeMonth from a custom header doesn't reset monthSelectedIn back to the first panel with monthsShown=2 (real react-datepicker issue)",
  // 纯 Node 仓库,不用 Dockerfile/apt;install+单文件 jest 本地实测数十秒,默认 600s 够用。
  diff: {
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
        `git clone -q -o origin --single-branch ${REPO_URL} .rd-clone`,
        "mv .rd-clone/.git .git",
        "rm -rf .rd-clone",
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
          "Bug: when a `DatePicker` is rendered with `monthsShown={2}` and a `renderCustomHeader` render prop, the " +
          "component internally tracks which of the two visible month panels the user most recently picked a day " +
          "in. Once the user clicks a day inside the second (rightmost) panel, that tracked panel index gets " +
          "stuck: if the user then uses the custom header's own month-jump control (i.e. calls the `changeMonth` " +
          "callback that `renderCustomHeader` receives) to navigate to a different month, the newly selected " +
          "month renders starting in the second panel instead of the first, and every subsequent `changeMonth` " +
          "call from the custom header keeps landing in the wrong panel until the component remounts or a day is " +
          "clicked back in the first panel. Expected: calling the custom header's `changeMonth` callback should " +
          "always place the target month in the first (leftmost) panel, regardless of which panel the user's most " +
          "recent day-selection came from.\n\n" +
          "Environment notes: package manager is yarn (yarn@4.9.2, already installed via corepack). Run a single " +
          "test file with `node_modules/.bin/jest <path-to-file>` (or `yarn test <path-to-file>`). Fix the " +
          "library source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const datepickerTest = await readFile(fixture("tests/datepicker_test.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/datepicker_test.test.tsx": datepickerTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
