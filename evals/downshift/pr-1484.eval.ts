import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/downshift/pr-1484/${path}`, import.meta.url);

// real fix: downshift PR #1484 (squash-merge 4ff13853df24803e9d07b0c90438e28b7c00a778,
// a single-parent commit whose parent equals BASE_COMMIT below, which also matches gh's
// reported baseRefOid exactly). Bug: the blur handler inside useCombobox's
// getInputProps() always dispatched InputBlur with `selectItem: true`, regardless of why
// the input lost focus. It never looked at the blur event's `relatedTarget`, so a blur
// caused by switching browser tabs (relatedTarget === null, since focus leaves the
// document entirely) was treated exactly like a deliberate click/tab-away confirmation,
// auto-selecting whatever item happened to be highlighted.
const REPO_URL = "https://github.com/downshift-js/downshift.git";
const BASE_COMMIT = "9b3199aa354f143617b148cf82f215f1e4986690";

export default defineEval({
  description:
    "downshift pr-1484: don't auto-select the highlighted combobox item when the input blurs because the browser " +
    "tab changed (real downshift issue)",
  // 装依赖只有 npm install(无锁文件,.npmrc 设 package-lock=false),本地实测 install ~1-2 分钟;
  // 这个 base commit 下 npm install 会把 @babel/plugin-proposal-private-property-in-object 和
  // @babel/plugin-proposal-private-methods 解析成 kcd-scripts/babel-preset-react-app 认不出的
  // "placeholder" 版本(babel 7.21 系的已知坑),导致 jest 在 transform 阶段直接报错、不到测试
  // 断言就整体失败——用显式版本号 --no-save 补装这两个包覆盖 placeholder 即可,本地在此 base
  // commit 上验证过 fail-to-pass 两个方向都干净通过。scoped jest 跑单文件 < 2s;沿用全局默认
  // timeoutMs。
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
    const installed = await t.sandbox.runShell(
      [
        "set -euo pipefail",
        "npm install",
        // See the diff-ignore comment above: pin real (non-placeholder) builds of these
        // two babel proposal plugins so Jest's babel transform doesn't blow up before any
        // test even runs. --no-save keeps package.json untouched (no diff noise).
        "npm install --no-save --save-exact " +
          "@babel/plugin-proposal-private-property-in-object@7.21.11 " +
          "@babel/plugin-proposal-private-methods@7.18.6",
      ].join("\n"),
    );
    if (installed.exitCode !== 0) {
      throw new Error(`npm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real downshift repository at the commit where the bug below " +
          "reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: `useCombobox`'s input keeps track of a currently highlighted item while its menu is open. When " +
          "the input loses focus (blurs) while the menu is open, downshift is supposed to distinguish between two " +
          "very different situations. If the user deliberately moved focus away — clicking somewhere else on the " +
          "page, or tabbing to the next focusable element — that counts as confirming their choice, so the " +
          "currently highlighted item should be auto-selected as the input blurs. But if focus left the input " +
          "only because the user switched to a different browser tab or window (so focus leaves the document " +
          "entirely, with no other element on the page actually receiving it), that is not a deliberate choice " +
          "and should NOT auto-select anything — the menu should just close, leaving the selection untouched. " +
          "Currently, the blur handler doesn't make this distinction at all: it always behaves as though the user " +
          "clicked/tabbed away, so switching tabs while an item is highlighted incorrectly selects that item, " +
          "even though the user never interacted with the page to confirm it.\n\n" +
          "Concretely: open the combobox's menu, highlight an item (without clicking it), then blur the input in " +
          "a way that mirrors a tab-switch — i.e. the blur event's `relatedTarget` is `null`, since no other " +
          "element on the page gains focus. The menu should close and the highlighted item should NOT become the " +
          "selected item. Blurring in a way that does have a `relatedTarget` (focus genuinely moving to another " +
          "element) should keep behaving exactly as it already does today — that path is correct and shouldn't " +
          "change.\n\n" +
          "Environment notes: dependencies are already installed (Node, npm). You can scope the existing Jest " +
          "suite to whatever file you're iterating on with `npx kcd-scripts test --no-watch <path-to-file>`. Fix " +
          "the library source (in the `useCombobox` hook); do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const getInputPropsTest = await readFile(fixture("tests/getInputProps.test.js"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/hooks/useCombobox/__tests__/getInputProps.test.js": getInputPropsTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
