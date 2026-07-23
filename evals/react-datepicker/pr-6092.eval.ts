import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自 react-datepicker PR #6092(feat/month-header-placement),base commit 是该 PR 的
// baseRefOid,与 merge commit 0e13929b428fdeb989a0886279a60f69dab0978e 的第一父提交精确
// 相等(已用 `gh pr view --json mergeCommit,baseRefOid` 核对,无出入)。merge commit 提供
// 隐藏测试的权威 post-fix 内容。这两个标识符只出现在代码注释里——被测 agent 永远看不到。
const fixture = (path: string) => new URL(`../fixtures/react-datepicker/pr-6092/${path}`, import.meta.url);

const REPO_URL = "https://github.com/Hacker0x01/react-datepicker.git";
const BASE_COMMIT = "11aeae6937191df9cb30f29a93fbdec63b0b61ef";

export default defineEval({
  description:
    "react-datepicker PR #6092: add a monthHeaderPosition prop (top/middle/bottom) so the month nav header " +
    "can render relative to each month's day grid instead of only at the top of the calendar (real react-datepicker feature request)",
  // 纯 Node/TS 仓库,没有编译产物散落进源码树的问题;node_modules/coverage 是测试期间
  // 产生的噪音,不该算进 agent 的归因 diff。
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
        `git clone -q -o origin --single-branch ${REPO_URL} .rdp-clone`,
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

    // 依赖在 agent 接手前就装好——这是纯 JS/TS 包管理器安装,不是任务本身要考察的能力,
    // 装好让 agent 能直接跑测试迭代,而不是把回合预算烧在 yarn install 上。
    t.progress({ message: "installing dependencies (corepack + yarn immutable)" });
    const installed = await t.sandbox.runShell("corepack enable && yarn install --immutable");
    if (installed.exitCode !== 0) {
      throw new Error(`yarn install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-datepicker repository (a React date-picker " +
          "component library) at the commit where the gap below applies. Find and fix this in the library " +
          "source.\n\n" +
          "Feature request: every rendered month in the calendar shows a navigation header (previous/next " +
          "month arrows plus the current month/year label, with optional month/year dropdowns). Today that " +
          "header always renders at the very top of the calendar, above the day grid, and there is no way to " +
          "change that. Some consumers want the header to sit visually closer to the day grid it controls " +
          "instead — for example in the middle of the calendar (between rows of days) or at the bottom (below " +
          "the day grid) — but no prop exists to request that.\n\n" +
          "Add a new `monthHeaderPosition` prop, accepted by `DatePicker` (and threaded through to the " +
          "underlying `Calendar`), with three possible string values: \"top\", \"middle\", and \"bottom\". It " +
          "should default to \"top\", which preserves today's only behavior (header above the grid, shared " +
          "navigation buttons at the top of the whole calendar).\n\n" +
          "When set to \"middle\" or \"bottom\", the navigation header for a month should be moved out of the " +
          "single, calendar-wide top header area and attached to that month's own container instead — for " +
          "\"middle\" it should read after that month's row of weekday names but before its rows of days, and " +
          "for \"bottom\" it should read after its rows of days — rather than living outside/above the grid. " +
          "It must remain fully functional in either position: the month/year " +
          "(and combined month-year, when in that mode) dropdowns still need to work, previous/next navigation " +
          "still needs to work including correctly disabling near a configured `minDate`/`maxDate`, and a " +
          "caller supplying a custom header via `renderCustomHeader` should still see their custom header " +
          "rendered in the requested position.\n\n" +
          "When multiple months are shown at once (via the `monthsShown` prop) and `monthHeaderPosition` is " +
          "\"middle\" or \"bottom\", each rendered month must get its own independent header in its own " +
          "container — not one shared header for the whole calendar.\n\n" +
          "This will touch more than one component: the calendar-level component currently owns rendering of " +
          "the single shared top header and the previous/next buttons, the per-month component will need the " +
          "ability to optionally render a header block around its own day grid, and the prop needs to be " +
          "threaded through from the public `DatePicker` API down through the popper/positioning wiring so " +
          "everything stays consistent.\n\n" +
          "Environment notes: this is a Node/TypeScript project managed with Yarn (Berry) via Corepack; " +
          "dependencies are already installed (re-run `corepack enable && yarn install --immutable` if you " +
          "ever need to). Tests use Jest — run a single file with `node_modules/.bin/jest <path>`. Fix the " +
          "library source under `src/`; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const hiddenTest = await readFile(fixture("tests/month_header_position.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/month_header_position.test.tsx": hiddenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
