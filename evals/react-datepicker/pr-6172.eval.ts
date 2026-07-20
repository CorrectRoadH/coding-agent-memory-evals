import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/react-datepicker/pr-6172/${path}`, import.meta.url);

const REPO_URL = "https://github.com/Hacker0x01/react-datepicker.git";
// PR #6172 (fix/restore-native-date-fallback-6164), merge commit 75a4ed1fd2d45f4af5cbb2c9e533ae7c0a793c34.
// gh's reported baseRefOid (df8a91d9) is 13 commits behind this — that's just the branch point at
// PR-creation time, before the base branch moved on. The merge commit's actual first parent is
// d4625d425ae31b15ed13de98446ffb6431f82659, which matches BASE_COMMIT below exactly, so this is not
// a real discrepancy.
const BASE_COMMIT = "d4625d425ae31b15ed13de98446ffb6431f82659";

export default defineEval({
  description:
    "react-datepicker pr-6172: restore native Date() fallback in parseDate when strictParsing is false (real react-datepicker issue)",
  // 纯 Node 仓库,corepack+yarn 装依赖、跑单个 jest 文件都在数十秒内完成,用默认超时足够。
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
          "Bug: react-datepicker's date parser accepts a `strictParsing` prop. Previously, when `strictParsing` " +
          "is false and a typed/pasted date string doesn't exactly match the configured `dateFormat`, the parser " +
          "fell back to the JS engine's native `new Date(string)` constructor, which understands many common " +
          "date/time formats regardless of `dateFormat`. That fallback is currently missing: with `strictParsing` " +
          "false, `parseDate` (exported from `src/date_utils.ts`) now returns `null` for such flexible input " +
          "instead of a valid `Date`. For example `parseDate(\"2025-12-16\", \"MM/dd/yyyy\", undefined, false)` " +
          "should resolve to December 16, 2025 (native `Date` can parse the ISO string even though it doesn't " +
          "match `dateFormat`), but currently returns null. Two things must NOT regress while fixing this: when " +
          "`strictParsing` is true there should be no native-parsing fallback (non-matching input still returns " +
          "null), and when the input does match `dateFormat` exactly, that strict format-based result should " +
          "still be preferred over the native fallback.\n\n" +
          "Environment notes: no root access is needed. Dependencies are already installed via " +
          "`corepack enable && yarn install --immutable`. Run tests with Jest, e.g. " +
          "`node_modules/.bin/jest src/test/date_utils_test.test.ts` to scope to the date-parsing tests. " +
          "Fix the library source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const hiddenTest = await readFile(fixture("tests/date_utils_test.test.ts"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/date_utils_test.test.ts": hiddenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
