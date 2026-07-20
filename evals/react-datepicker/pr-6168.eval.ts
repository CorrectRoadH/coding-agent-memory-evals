import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/react-datepicker/pr-6168/${path}`, import.meta.url);

// react-datepicker#6168 (https://github.com/Hacker0x01/react-datepicker/pull/6168):
// Safari's page auto-translate feature mutates the DOM of the open calendar popup,
// which fights React's reconciliation of the same nodes and corrupts/breaks the
// calendar. Fix adds translate="no" to the calendar dialog element in
// src/calendar_container.tsx. base_sha below is the merge commit's direct first
// parent (more precise than the PR's baseRefOid, which is an older ancestor since
// main advanced past the PR's branch point before merge -- normal, not a discrepancy).
const BASE_COMMIT = "6667a40d339d8fb5a6c02263b08d366cf2cfc449";

export default defineEval({
  description:
    "react-datepicker pr-6168: calendar dialog must opt out of browser auto-translation so Safari's translate feature doesn't corrupt it (real react-datepicker issue)",
  // 纯 Node 仓库,yarn install + 单文件 jest 本地验证都在数秒到数十秒量级,用默认 timeout 即可。
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
        "git clone -q -o origin --single-branch https://github.com/Hacker0x01/react-datepicker.git .rdp-clone",
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

    t.progress({ message: "yarn install --immutable" });
    const installed = await t.sandbox.runShell("corepack enable && yarn install --immutable");
    if (installed.exitCode !== 0) {
      throw new Error(`yarn install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-datepicker repository at the commit where the " +
          "bug below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: Safari has a built-in \"Translate this page\" feature. When a user has it enabled (or triggers it " +
          "manually) while the datepicker's calendar popup is open, Safari's translation pass walks the DOM and " +
          "rewrites text nodes inside whatever is currently on screen -- including the open calendar dialog. That " +
          "DOM rewrite fights with React's own reconciliation of the same nodes: users report the calendar " +
          "breaking, freezing, or throwing errors on any interaction (clicking a day, changing month, etc.) once " +
          "the page has been auto-translated by Safari while the calendar was open.\n\n" +
          "The calendar popup is exactly the kind of live, interactive, non-prose UI that should never be " +
          "rewritten by a browser's page-translation pass -- unlike static article text, mutating it out from " +
          "under React corrupts the widget. Browsers support an opt-out for this on a per-element basis; the " +
          "calendar dialog element should use it so Safari (and other browsers with similar auto-translate " +
          "features) leaves the calendar's DOM alone entirely.\n\n" +
          "Fix the library source so the rendered calendar dialog element opts out of browser auto-translation. " +
          "Do not just add a workaround in a test file -- change the actual component that renders the calendar " +
          "dialog.\n\n" +
          "Environment notes: package manager is Yarn (Berry, via corepack) -- already installed and " +
          "`yarn install --immutable` already run for you. Existing tests can be run as a regression check with " +
          "`NODE_ENV=test yarn test` (or `NODE_ENV=test node_modules/.bin/jest` to run the whole suite directly). " +
          "This is a TypeScript + React codebase; the calendar dialog markup lives under `src/`.",
      )
      .then((turn) => turn.expectOk());

    const hiddenTest = await readFile(fixture("tests/calendar_container.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/calendar_container.test.tsx": hiddenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
