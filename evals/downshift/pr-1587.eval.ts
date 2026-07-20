import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/downshift/pr-1587/${path}`, import.meta.url);

// real fix: downshift PR #1587 (merge 87a8137e6c69d4d0086bd2a2b333367762ce477a),
// which lands on top of BASE_COMMIT (its first parent). Bug: getHighlightedIndexOnOpen()
// in src/hooks/utils.js picks initialHighlightedIndex / defaultHighlightedIndex without
// ever checking isItemDisabled(), so opening useCombobox/useSelect can initially highlight
// a disabled item.
const REPO_URL = "https://github.com/downshift-js/downshift.git";
const BASE_COMMIT = "57981b297cfab75e0b11c8685195ad17cbf928d5";

export default defineEval({
  description:
    "downshift pr-1587: skip disabled items when computing the initial highlighted index on menu open (real downshift issue)",
  // 装依赖是 npm install(需 --legacy-peer-deps,root devDependency react-native 与 react
  // 版本冲突,和 Node 版本无关;CYPRESS_INSTALL_BINARY=0 跳过 cypress postinstall 冷下载,
  // 与 scoped jest 跑测试无关),本地实测 install ~2 分钟,scoped jest 跑两个文件 < 3s;
  // 沿用全局默认 timeoutMs。
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
    // CYPRESS_INSTALL_BINARY=0 + --ignore-scripts: repo has cypress as a devDependency
    // purely for its own e2e/docs scripts (test:cypress); without this its postinstall
    // cold-downloads a multi-hundred-MB binary that the scoped jest run never touches.
    // --ignore-scripts additionally skips every other lifecycle script so there is no
    // local-cache-vs-sandbox-cold-fetch divergence for any other package either (mirrors
    // the same flag in the react-hook-form template).
    const installed = await t.sandbox.runShell(
      "CYPRESS_INSTALL_BINARY=0 npm install --legacy-peer-deps --ignore-scripts",
    );
    if (installed.exitCode !== 0) {
      throw new Error(`npm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real downshift repository at the commit where the bug below " +
          "reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: downshift's `useCombobox` and `useSelect` hooks both accept an `isItemDisabled(item, index)` prop " +
          "that marks certain items as disabled — disabled items are supposed to be skipped during keyboard " +
          "navigation and are never selectable. Separately, both hooks accept `initialHighlightedIndex` and " +
          "`defaultHighlightedIndex` props that control which item is highlighted the first time the menu opens " +
          "(`initialHighlightedIndex` seeds the very first open only; `defaultHighlightedIndex` is the fallback " +
          "used whenever there's no other value to highlight, e.g. on every open where nothing else was " +
          "selected). The logic that computes this initial highlight on open currently reads " +
          "`initialHighlightedIndex` / `defaultHighlightedIndex` and returns whichever one applies without ever " +
          "consulting `isItemDisabled` — so if the configured index happens to point at an item the caller has " +
          "marked disabled, the menu still opens with that disabled item highlighted, exactly as if it weren't " +
          "disabled at all. Expected behavior: opening the menu should never initially highlight a disabled item. " +
          "If `initialHighlightedIndex` points at a disabled item, it should be skipped (falling through to " +
          "`defaultHighlightedIndex` if that one points at a non-disabled item, otherwise falling through to " +
          "whatever the next rule in the existing fallback chain is). Likewise, if `defaultHighlightedIndex` " +
          "points at a disabled item, it should not be used as the initial highlight either.\n\n" +
          "Environment notes: dependencies are already installed (Node, npm). You can scope the existing Jest " +
          "suite to whatever file you're iterating on with `node_modules/.bin/jest <path-to-file>` (or " +
          "`npx kcd-scripts test --no-watch <path-to-file>`). Fix the library source; do not just add " +
          "workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const comboboxPropsTest = await readFile(fixture("tests/useCombobox/props.test.js"), "utf8");
    const selectPropsTest = await readFile(fixture("tests/useSelect/props.test.js"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/hooks/useCombobox/__tests__/props.test.js": comboboxPropsTest,
      "src/hooks/useSelect/__tests__/props.test.js": selectPropsTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
