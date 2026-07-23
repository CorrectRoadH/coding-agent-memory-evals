import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/react-tooltip/pr-1269/${path}`, import.meta.url);

// real fix: react-tooltip PR #1269 (merge 42251977e06f81cb1f467b89cb51bf11b1794e6d),
// which lands on top of BASE_COMMIT (its first parent; matches gh's reported baseRefOid
// exactly, no discrepancy to reconcile here). Bug: the effect in use-tooltip-events.tsx
// that attaches mouseover/mouseout listeners to the tooltip element (used to track
// whether the pointer is hovering the tooltip body, for the clickable/interactive-content
// case) has a dependency array that never changes between initial mount and the moment
// the tooltip is first actually rendered into the DOM. So the effect runs once, on
// mount, while the tooltip ref is still null, the optional-chained addEventListener
// calls silently no-op, and the listeners never get attached (the effect never re-runs
// after the tooltip mounts). The "pointer is over the tooltip" flag therefore never
// flips true, so the close-delay timer that starts when the pointer leaves the anchor
// is never suppressed, and the tooltip closes before the pointer can reach content
// inside it.
const REPO_URL = "https://github.com/ReactTooltip/react-tooltip.git";
const BASE_COMMIT = "c519e9440d1c081141ff74c552f98cb10f5dac54";

export default defineEval({
  description:
    "react-tooltip pr-1269: keep a clickable tooltip open while the pointer moves from the anchor onto the " +
    "tooltip body itself (real react-tooltip issue)",
  // 纯 Node 仓库,yarn classic v1 装依赖、跑单个 jest 文件都在数十秒内完成,用默认超时足够。
  diff: {
    // yarn.lock 在 install 阶段会被重写(元数据/排序变化,字节级差异,无实际依赖变更)——
    // 这是 install 步骤本身的副作用,不是 agent 的改动。
    ignore: ["coverage", "node_modules", "yarn.lock"],
  },
  async test(t) {
    // 没有单独的 workspace 起始目录——fixture 就是这个 base commit 本身:clone 真实 repo、
    // 退到 base commit、抹掉未来历史(remote/tags/reflog),agent 拿到带真实(截断)git 历史
    // 的 checkout。checkout 必须在 workdir 根——嵌套子目录会被 diff 分类账记成 gitlink,
    // agent 的改动就从证据里消失了。任务说明只通过下面的 t.send() 传给 agent。
    t.progress({ message: "cloning react-tooltip @ base commit" });
    const cloned = await t.sandbox.runShell(
      [
        "set -euo pipefail",
        `git clone -q -o origin --single-branch ${REPO_URL} .rt-clone`,
        "mv .rt-clone/.git .git",
        "rm -rf .rt-clone",
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
      throw new Error(`react-tooltip checkout failed: ${(cloned.stderr || cloned.stdout).trim().slice(-500)}`);
    }

    // No packageManager field pinned in this repo's package.json, so corepack is unsafe
    // on the sandbox's Node 20.9.0 (crashes with ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING
    // when invoking an unpinned package manager). Install yarn classic v1 explicitly
    // instead; its engines range (node >=4.0.0) comfortably covers Node 20.9.0.
    // --ignore-scripts skips native-module postinstall builds (e.g. the old brotli
    // binding pulled in transitively by the bundlesize devDependency) that are not
    // needed to run Jest and are not guaranteed to build on every host.
    t.progress({ message: "installing deps (yarn classic v1)" });
    const installed = await t.sandbox.runShell(
      "npm install -g --prefix /usr/local yarn@1.22.22 && yarn install --ignore-scripts --ignore-engines",
    );
    if (installed.exitCode !== 0) {
      throw new Error(`yarn install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-tooltip repository at the commit where the bug " +
          "below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: react-tooltip supports a `clickable` mode where the tooltip's own content is meant to be " +
          "interactive (e.g. it can contain a button or a link the user should be able to click). When a tooltip " +
          "configured this way is open and the user moves the mouse pointer off the anchor element and onto the " +
          "body of the tooltip itself, the tooltip should stay open so the pointer can reach that interactive " +
          "content. Instead, the tooltip closes the moment the pointer leaves the anchor, regardless of whether " +
          "the pointer immediately moves onto the tooltip. This makes any interactive content inside a clickable " +
          "tooltip effectively unreachable by mouse — by the time the pointer arrives over the tooltip, it has " +
          "already started (or finished) closing.\n\n" +
          "Concretely: render a `clickable` tooltip, hover the anchor so it opens, then move the pointer from the " +
          "anchor onto the tooltip element itself. After the normal close-delay has elapsed, the tooltip should " +
          "still be in its fully-open state (carrying its 'show' styling class), not in a closing/closed state — " +
          "the pointer being over the tooltip body should suppress the close that would otherwise happen after " +
          "leaving the anchor.\n\n" +
          "Environment notes: no root access is needed. Dependencies are already installed via `npm install -g " +
          "yarn@1.22.22 && yarn install --ignore-scripts --ignore-engines`. Run tests with Jest, e.g. `node_modules/.bin/jest " +
          "src/test/tooltip-interaction-behavior.spec.js` to scope to the relevant interaction-behavior tests. " +
          "Fix the library source (likely in the tooltip component and/or its event-handling hook under " +
          "`src/components/Tooltip/`); do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const interactionSpec = await readFile(fixture("tests/tooltip-interaction-behavior.spec.js"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/tooltip-interaction-behavior.spec.js": interactionSpec,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
