import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/downshift/pr-1603/${path}`, import.meta.url);

// real fix: downshift PR #1603 (squash-merge ee2a828ac70035c1e6156523b72c11abae4c07e4,
// a single-parent commit whose parent equals BASE_COMMIT below). Bug: getItemProps() in
// both src/hooks/useCombobox/index.js and src/hooks/useSelect/index.js builds
// `aria-selected` via a template-string interpolation of the boolean comparison
// (`` `${cond}` ``), so it returns the *string* "true"/"false" instead of a real boolean,
// even though the documented/typed return value is boolean.
const REPO_URL = "https://github.com/downshift-js/downshift.git";
const BASE_COMMIT = "4bf894ba355f8c281bf4cea98fc32d01fbc3f8d7";

export default defineEval({
  description:
    "downshift pr-1603: return a real boolean (not a stringified boolean) for aria-selected from useCombobox/useSelect (real downshift issue)",
  // 装依赖只有 npm install(无锁文件,.npmrc 设 package-lock=false),本地实测 install ~2 分钟,
  // scoped jest 跑两个文件 < 2s;沿用全局默认 timeoutMs。
  diff: {
    ignore: ["coverage", "node_modules"],
  },
  async test(t) {
    // 没有单独的 workspace 起始目录——fixture 就是这个 base commit 本身:clone 真实 repo、
    // 退到 base commit、抹掉未来历史(remote/tags/reflog),agent 拿到带真实(截断)git 历史
    // 的 checkout。checkout 必须在 workdir 根——嵌套子目录会被 diff 分类账记成 gitlink,
    // agent 的改动就从证据里消失了。任务说明只通过下面的 t.send() 传给 agent。
    t.progress({ message: "cloning downshift @ base commit" });
    const cloned = await t.sandbox.runShell(
      [
        "set -euo pipefail",
        `git clone -q -o origin --single-branch ${REPO_URL} .downshift-clone`,
        "mv .downshift-clone/.git .git",
        "rm -rf .downshift-clone",
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
      throw new Error(`downshift checkout failed: ${(cloned.stderr || cloned.stdout).trim().slice(-500)}`);
    }

    t.progress({ message: "installing deps (npm)" });
    const installed = await t.sandbox.runShell("npm install");
    if (installed.exitCode !== 0) {
      throw new Error(`npm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real downshift repository at the commit where the bug below " +
          "reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: both the `useCombobox` and `useSelect` hooks return an `aria-selected` prop from their " +
          "`getItemProps()` function for each list item, and this prop is documented/typed as a plain boolean " +
          "(`true` or `false`). In practice, the value that comes back is not a real boolean at all — it's the " +
          "*string* `\"true\"` or `\"false\"` instead. So `itemProps['aria-selected']` is truthy in both cases " +
          "(even the 'not selected' case is a non-empty string), and any code or test that does a strict " +
          "comparison — `itemProps['aria-selected'] === true`, `itemProps['aria-selected'] === false`, or a deep-" +
          "equality assertion like `expect(itemProps['aria-selected']).toEqual(true)` — gets the wrong answer, " +
          "even though the item's highlighted/selected state itself is being computed correctly. For example, " +
          "for an item that IS currently highlighted (in `useCombobox`) or selected (in `useSelect`), " +
          "`getItemProps()` should return `aria-selected: true` (the boolean), not `aria-selected: \"true\"` (the " +
          "string) — and likewise it should return the boolean `false`, not the string `\"false\"`, for an item " +
          "that is not. Fix both hooks so `getItemProps()` always hands back a real boolean for `aria-selected`, " +
          "matching the documented type. (Rendered DOM markup like `aria-selected=\"true\"` is unaffected by this " +
          "bug and unaffected by the fix — this is purely about the type of the value in the JS props object " +
          "returned by `getItemProps()`.)\n\n" +
          "Environment notes: dependencies are already installed (Node, npm). You can scope the existing Jest " +
          "suite to whatever file you're iterating on with `npx kcd-scripts test --no-watch <path-to-file>`. Fix " +
          "the library source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const comboboxGetItemPropsTest = await readFile(fixture("tests/useCombobox-getItemProps.test.js"), "utf8");
    const selectGetItemPropsTest = await readFile(fixture("tests/useSelect-getItemProps.test.js"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/hooks/useCombobox/__tests__/getItemProps.test.js": comboboxGetItemPropsTest,
      "src/hooks/useSelect/__tests__/getItemProps.test.js": selectGetItemPropsTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
