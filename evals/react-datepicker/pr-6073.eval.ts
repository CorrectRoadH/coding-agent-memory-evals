import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自真实合入 PR Hacker0x01/react-datepicker#6073(不让被测 agent 看到 PR 号/commit)。merge
// commit 649af62fee622afbda7db7ec3f935efbf6fd9676 提供隐藏测试的权威 post-fix 内容。Bug:范围选择、
// 多月展示时,选了起始日后 hover 预览范围,`src/day.tsx` 会把「属于相邻月份、但作为填充格渲染在当前
// 月网格里的日子(前导/后随日)」也加上 in-selecting-range 高亮。真实修复让某个日格只有在确实属于它
// 所在网格代表的那个月份时才参与范围预览高亮(复用 Day 上已有的 isBeforeMonth/isAfterMonth,不引入
// 新导出)。隐藏测试是 day_test.test.tsx 里新增的行为用例,断言只查渲染 DOM 的 class(class 名是测试
// 文件内的字符串字面量,不 import 任何新符号),base_sha 下必失败(3 failed / 103 passed),打上真实
// 修复后 106 全绿——本地 Node 20.9.0 双向验证过。
const fixture = (path: string) => new URL(`../fixtures/react-datepicker/pr-6073/${path}`, import.meta.url);

const REPO_URL = "https://github.com/Hacker0x01/react-datepicker.git";
const BASE_COMMIT = "4f3d75298c20884f5c5634ff04971260233af7c5";

export default defineEval({
  description:
    "react-datepicker pr-6073: in range mode across multiple months, the in-selecting-range hover highlight is " +
    "wrongly applied to filler day cells that belong to an adjacent month; a cell must only join the " +
    "selecting-range highlight when it actually belongs to the month its grid represents (real react-datepicker issue)",
  // yarn (Berry) 装依赖会把 package.json 内联数组重排(install 副作用,非 agent 改动),排掉避免假噪音。
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

    // 依赖在 agent 接手前就装好——纯 JS/TS 包管理器安装,不是任务本身要考察的能力。
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
          "Bug: in a range-selection date picker (e.g. `selectsRange`) that displays more than one month at a " +
          "time, after a start date has been chosen the user hovers over a date to preview the range that would " +
          "be selected. Each month's calendar grid also renders a few 'filler' day cells that actually belong " +
          "to the adjacent month (the leading days from the previous month and the trailing days from the next " +
          "month, shown to fill out the first/last week rows). The bug is that these out-of-month filler cells " +
          "incorrectly receive the in-selecting-range preview highlight. A day cell that falls outside the " +
          "month its grid represents should never participate in the selecting-range highlight — only cells " +
          "that genuinely belong to the displayed month should. Fix the day-rendering logic so the " +
          "in-selecting-range highlight is applied only to cells belonging to the month being displayed. Fix " +
          "the library source (under `src/`); do not just add workarounds in test files.\n\n" +
          "Environment notes: this is a Node/TypeScript project managed with Yarn (Berry) via Corepack; " +
          "dependencies are already installed (re-run `corepack enable && yarn install --immutable` if you " +
          "ever need to). Tests use Jest — run a single file with `node_modules/.bin/jest <path>`.",
      )
      .then((turn) => turn.expectOk());

    const testFile = await readFile(fixture("tests/day_test.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      // 真实仓库路径:覆盖掉 agent 可能留下的任何版本,判分对齐上游隐藏测试。
      "src/test/day_test.test.tsx": testFile,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
