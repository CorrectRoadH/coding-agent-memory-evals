import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/downshift/pr-1458/${path}`, import.meta.url);

// real fix: downshift-js/downshift, commit d1a7f67977e207a1f489af964c707a73e0763dc1
// ("fix(useMultipleSelection): prevent adding items on Backspace/Delete without
// activeIndex (#1458)"), which lands on top of BASE_COMMIT (its first parent — this
// was a squash merge, so the merge commit itself has exactly one parent). Bug: the
// useMultipleSelection reducer handled SelectedItemKeyDownBackspace/Delete without
// checking whether an item was actually focused (activeIndex >= 0), so Backspace/
// Delete on a non-focused selected item could still remove/duplicate items.
const REPO_URL = "https://github.com/downshift-js/downshift.git";
const BASE_COMMIT = "d822530f6b3eebe34c3dc8249353b61dd237d78b";

export default defineEval({
  description:
    "downshift pr-1458: only react to Backspace/Delete on a selected item when that item is actually focused (real downshift issue)",
  // 装依赖只有 npm install(该仓库 .npmrc 关了 lockfile),本地实测 CYPRESS_INSTALL_BINARY=0
  // 跳过 cypress 二进制下载后 install ~25s;两条 babel devDependency 补丁各几秒;scoped jest
  // 跑两个文件 < 2s。沿用全局默认 timeoutMs。
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
    // plain npm — no packageManager field pinned in this repo, so corepack is skipped
    // entirely (see repo CLAUDE.md-adjacent eval-authoring notes on the corepack/Node 20
    // crash). CYPRESS_INSTALL_BINARY=0 skips the (unused-by-this-eval) Cypress browser
    // download. The two explicit @babel/plugin-proposal-* devDependencies work around a
    // real npm flat-tree hoisting bug in this unlocked (package-lock=false) repo: without
    // them, npm resolves a Babel "placeholder" package (or nothing at all) for the two
    // legacy proposal plugins that this repo's own babel.config.js references directly,
    // and Jest's transform step fails before any test can run.
    const installed = await t.sandbox.runShell(
      [
        "set -euo pipefail",
        "CYPRESS_INSTALL_BINARY=0 npm install",
        "npm install --save-dev @babel/plugin-proposal-private-property-in-object@7.21.11 @babel/plugin-proposal-private-methods@7.18.6",
      ].join("\n"),
    );
    if (installed.exitCode !== 0) {
      throw new Error(`npm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real downshift repository (the accessible dropdown/combobox " +
          "primitive library) at the commit where the bug below reproduces. Find and fix the bug in the library " +
          "source.\n\n" +
          "Bug: downshift ships a `useMultipleSelection` hook for building multi-select widgets (e.g. a tag input " +
          "where each selected item renders as its own focusable chip). Each selected-item chip gets keydown " +
          "handling so that, when that specific chip is focused, pressing Backspace or Delete removes it. " +
          "Internally the hook tracks which selected item (if any) is currently the focused/active one via an " +
          "`activeIndex` piece of state; `activeIndex` is `-1` whenever no selected item currently has focus. The " +
          "reducer's handling of the Backspace/Delete keydown action does not check `activeIndex` at all before " +
          "acting — it just goes ahead and removes an item (or, in edge cases, ends up duplicating item removal " +
          "logic) using whatever `activeIndex` happens to hold, including `-1` or a stale index left over from a " +
          "previous interaction. As a result, dispatching a Backspace/Delete keydown on a selected-item chip that " +
          "does NOT currently have focus can still incorrectly mutate the selected-items list — items can be " +
          "removed (or the internal bookkeeping otherwise corrupted) even though the user never focused that chip " +
          "before pressing the key. The correct behavior is that Backspace/Delete keydown on a selected item " +
          "should only remove anything when an item is actually focused/active (i.e. only when `activeIndex` " +
          "points at a real, currently-focused selected item) — if nothing is focused, the keydown should be a " +
          "no-op and the selected items should be left completely unchanged.\n\n" +
          "Environment notes: dependencies are already installed (Node, npm). You can scope the existing Jest " +
          "suite to whatever file you're iterating on with `npx kcd-scripts test --no-watch <path-to-file>`. Fix " +
          "the library source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const getSelectedItemPropsTest = await readFile(fixture("tests/getSelectedItemProps.test.js"), "utf8");
    const propsTest = await readFile(fixture("tests/props.test.js"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/hooks/useMultipleSelection/__tests__/getSelectedItemProps.test.js": getSelectedItemPropsTest,
      "src/hooks/useMultipleSelection/__tests__/props.test.js": propsTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
