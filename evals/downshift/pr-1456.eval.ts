import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/downshift/pr-1456/${path}`, import.meta.url);

// real fix: downshift-js/downshift, commit d822530f6b3eebe34c3dc8249353b61dd237d78b
// ("feat(useSelect): improve highlight by character keys algorithm (#1456)"), which
// lands on top of BASE_COMMIT (its first parent — this was a squash merge, so the
// merge commit itself has exactly one parent, and that parent matches the PR's
// baseRefOid). Bug: useSelect's character-key type-ahead search treated the Space
// key inconsistently (it dispatched a dedicated "toggle button space" action instead
// of feeding into the character-search buffer like every other printable key,
// *unless* a search was already in progress), and the offset search in
// getItemIndexByCharacterKey always started scanning one position past the
// currently highlighted item — even when a query was already 2+ characters long and
// the currently highlighted item might still be a valid match for the next
// character typed — so repeating/continuing a rapid-succession character search
// could skip over an item that still matched or restart from the wrong index.
const REPO_URL = "https://github.com/downshift-js/downshift.git";
const BASE_COMMIT = "99bd9d936b46620d0e8f27dd3a35ca15149ec7b5";

export default defineEval({
  description:
    "downshift pr-1456: fix character-key type-ahead search to treat Space as a normal search character and to correctly advance through repeated-key matches (real downshift issue)",
  // 装依赖只有 npm install(该仓库 .npmrc 关了 lockfile),本地实测(Node 20.9.0,与沙箱一致)
  // CYPRESS_INSTALL_BINARY=0 跳过 cypress 二进制下载后 install ~1min;两条 babel
  // devDependency 补丁在同一条 install 命令里几秒内完成;scoped jest 跑单文件 < 2s。
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
    // plain npm — no packageManager field pinned in this repo, so corepack is skipped
    // entirely (a bare `corepack enable` reliably crashes on the sandbox's Node
    // 20.9.0 when no packageManager field pins a version). CYPRESS_INSTALL_BINARY=0
    // skips the (unused-by-this-eval) Cypress browser download. The two explicit
    // @babel/plugin-proposal-* devDependencies work around a real npm flat-tree
    // hoisting bug in this unlocked (package-lock=false) repo: without them, npm
    // resolves either a Babel "placeholder" package or nothing at all for the two
    // legacy proposal plugins that this repo's own babel.config.js references
    // directly, and Jest's transform step fails before any test can run. This is an
    // environment fix, not part of the task — verified on Node 20.9.0 / npm 10.1.0
    // (matching the sandbox) end to end (RED without the library fix, GREEN with it).
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
          "Bug: the `useSelect` hook supports character-key type-ahead search on its toggle button — the user " +
          "types printable characters and the currently highlighted item jumps to the next item whose label " +
          "starts with the characters typed so far (characters typed in quick succession accumulate into a single " +
          "search query; if the user pauses, the next character starts a brand-new query). This has two bugs:\n\n" +
          "1. The Space character (`' '`) is not treated the same as other printable characters. Every other " +
          "printable key gets appended to the in-progress search query, but Space is special-cased to instead " +
          "toggle/select behavior (as if no search were active), even while the user is in the middle of typing a " +
          "multi-character query that happens to contain a space. So typing a query like `1 2 3` — where the " +
          "matching item's label literally contains spaces — does not work: as soon as the space character is " +
          "typed, the search buffer is not extended the way it is for a letter or digit, and the wrong item ends " +
          "up highlighted.\n\n" +
          "2. When continuing to add characters to an already-in-progress search query (i.e. the query so far is " +
          "already 2 or more characters long), the search for the next matching item always starts scanning from " +
          "one position *after* the currently highlighted item, unconditionally. That's correct for the very " +
          "first character of a new query (you don't want to just re-match the item you're already on), but once " +
          "a multi-character query is already in progress, the currently highlighted item itself is still a valid " +
          "candidate — it may still match the longer query being typed, or it may be exactly the item that should " +
          "be reached next. Always skipping past it means the search can land one item too far forward, or skip " +
          "over an item that should have matched, so repeated/rapid-succession character searches don't reliably " +
          "advance through all matching items in the order the user would expect.\n\n" +
          "Environment notes: dependencies are already installed (Node, npm). You can scope the existing Jest " +
          "suite to whatever file you're iterating on with `npx kcd-scripts test --no-watch <path-to-file>`. Fix " +
          "the library source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const getToggleButtonPropsTest = await readFile(fixture("tests/getToggleButtonProps.test.js"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/hooks/useSelect/__tests__/getToggleButtonProps.test.js": getToggleButtonPropsTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
