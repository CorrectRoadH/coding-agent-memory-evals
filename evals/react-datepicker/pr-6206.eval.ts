import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自 react-datepicker PR #6206(修复 GitHub issue #6193),base commit 是该 PR 的
// baseRefOid,merge commit 3d53acb06b7374bbf4d4d496a7871b656da7115e 提供隐藏测试的
// 权威 post-fix 内容。这两个标识符只出现在代码注释里——被测 agent 永远看不到。
const fixture = (path: string) => new URL(`../fixtures/react-datepicker/pr-6206/${path}`, import.meta.url);

const REPO_URL = "https://github.com/Hacker0x01/react-datepicker.git";
const BASE_COMMIT = "e1ce24549f030bd159829dbbad077abe1b60cb52";

export default defineEval({
  description:
    "react-datepicker PR #6206: fix DatePicker's day-click / input-display / selectsMultiple all going off-by-one-day when the explicit timeZone prop differs from the local timezone (real GitHub issue #6193)",
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
          "component library) at the commit where the bug below reproduces. Find and fix the bug in the library " +
          "source.\n\n" +
          "Bug: `DatePicker` accepts an explicit `timeZone` prop (an IANA zone name such as " +
          '"Pacific/Kiritimati") meant to pin the picker to a timezone different from the browser\'s local ' +
          "timezone. When that `timeZone` differs significantly from the local/browser timezone, the picker " +
          "gets the calendar day wrong in three places: (1) clicking a day in the calendar grid produces an " +
          "`onChange` date, and a visually 'selected' day, that are off by one day (in the configured timeZone) " +
          "from the day the user actually clicked; (2) the formatted value shown in the text input is off by " +
          "one day because it reflects UTC/browser-local time instead of the configured timeZone; (3) with " +
          "`selectsMultiple`, the calendar does not consistently highlight the correct set of days as selected " +
          "in the target timezone. In short, calendar day-highlighting, the input's formatted display value, " +
          "and multi-date-selection highlighting must all consistently interpret `selected` / `startDate` / " +
          "`endDate` / `selectedDates` (and the values handed to `onChange`) in terms of the configured " +
          "`timeZone`, not the browser's local timezone. Fix the library source (under `src/`); do not just " +
          "add workarounds in test files.\n\n" +
          "Environment notes: this is a Node/TypeScript project managed with Yarn (Berry) via Corepack; " +
          "dependencies are already installed (re-run `corepack enable && yarn install --immutable` if you " +
          "ever need to). Tests use Jest — run a single file with `node_modules/.bin/jest <path>`.",
      )
      .then((turn) => turn.expectOk());

    const testFile = await readFile(fixture("tests/timezone_test.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/timezone_test.test.tsx": testFile,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
