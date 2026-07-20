import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/react-tooltip/pr-1271/${path}`, import.meta.url);

// real fix: react-tooltip PR #1271 (merge 013931f2c362d8971e578f41a3b7c739ea74b520),
// which lands on top of BASE_COMMIT (its first parent, == baseRefOid here). Bug 1: the
// delegated mouseout/focusout close listeners only look at whether the event target is
// inside whatever anchor is currently marked "active", instead of resolving which
// anchor the event's own target actually belongs to, so anchor detection during
// hover/focus transitions between related anchor elements is unreliable. Bug 2: the
// delayed-show callback checks "is the tooltip already rendered, so skip the delay"
// against a value captured in its memoized closure instead of a ref read at call time,
// so that check can be stale by the time a deferred delayShow timer actually fires.
const REPO_URL = "https://github.com/ReactTooltip/react-tooltip.git";
const BASE_COMMIT = "f93a090aa10101f6cf7490ae8f4db1e7f39f7b47";

export default defineEval({
  description:
    "react-tooltip pr-1271: fix inaccurate anchor detection during hover/focus transitions and stale-state " +
    "delayShow timing (real react-tooltip issue)",
  // 纯 Node 仓库,不用 Dockerfile/apt;install+单文件 jest 本地实测数秒,默认 600s 够用。
  // yarn.lock 在本仓库现状下本来就跟 package.json 的 caret range 对不上(--frozen-lockfile
  // 直接报错),任何一次 `yarn install`(不管 agent 有没有改代码)都会把它重写成实际解析到
  // 的版本——这是安装期噪音,不是 agent 的改动,故忽略。
  diff: {
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

    // No packageManager field in this repo's package.json, so corepack is unsafe on the
    // sandbox's Node 20.9.0 (crashes with ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING for any
    // unpinned package manager). Install yarn classic v1 explicitly instead; its
    // `engines.node` is `>=4.0.0`, well within range. `--ignore-scripts` skips a native
    // node-gyp build (iltorb, a transitive dep of the unused `bundlesize` dev script)
    // that isn't needed for the test suite and isn't guaranteed to build cleanly.
    // `--ignore-engines` is required here: at this base commit one transitive devDep
    // (eslint-visitor-keys@5, pulled in via eslint tooling, unrelated to the library
    // source or its tests) declares a `node` engine range that excludes 20.9.0, and
    // yarn classic hard-fails the install (not just a warning) without this flag.
    t.progress({ message: "installing deps (yarn classic)" });
    const installed = await t.sandbox.runShell(
      "npm install -g yarn@1 && yarn install --ignore-scripts --ignore-engines",
    );
    if (installed.exitCode !== 0) {
      throw new Error(`yarn install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-tooltip repository at the commit where the bugs " +
          "below reproduce. Find and fix the bugs in the library source.\n\n" +
          "Bug 1 (anchor detection during hover/focus transitions): react-tooltip supports several anchor " +
          "elements that share the same tooltip id, where the tooltip's position and content follow whichever " +
          "anchor the pointer/focus is currently on. Internally the component tracks one anchor as the current " +
          "'active' anchor, and it uses global, delegated `mouseout`/`focusout` listeners to decide when to hide " +
          "the tooltip or switch it to a different anchor. That decision only looks at whether the event's own " +
          "target is inside whichever anchor happens to be marked active right now, and only checks whether that " +
          "same 'active' anchor contains the event's related target when deciding whether the pointer moved " +
          "somewhere that should still count as staying put. This is unreliable while the pointer is transitioning " +
          "between two different but related anchor elements bound to the same tooltip id (for example, quickly " +
          "moving from one anchor to a sibling anchor and back, or moving between anchors before a pending delayed " +
          "show has applied) — the anchor that the mouseout/focusout event actually happened on can be a different, " +
          "still-valid anchor for the same tooltip that just hasn't become the 'active' one yet, and the current " +
          "logic doesn't account for that. The practical symptom is that the tooltip's displayed content can fail " +
          "to switch to the anchor the pointer is actually over, or the tooltip can be hidden/kept from appearing " +
          "even though the pointer is still within a valid anchor for it.\n\n" +
          "Bug 2 (delayShow relies on stale state): when a tooltip is configured with a show delay (the " +
          "`data-tooltip-delay-show` attribute, i.e. the `delayShow` prop), showing it goes through a delayed-show " +
          "code path: it starts a timer for `delayShow` milliseconds and, once that timer fires (or immediately, " +
          "if the tooltip happens to already be visible when the show is requested), triggers the actual show. " +
          "The check for 'is the tooltip already visible right now, so the delay can be skipped' reads a value " +
          "that was captured when this delayed-show function was (re)created, not the value at the moment the " +
          "function actually runs — so if the tooltip's visibility changes in between, that check can act on " +
          "stale information. Combined with bug 1, this makes show/hide behavior around a configured delayShow " +
          "unreliable: for example, moving between two anchors that share a tooltip id and then away from both " +
          "before the delay elapses can still leave the tooltip visible, or leave it showing the wrong anchor's " +
          "content, even though by the time the delay fires the pointer isn't hovering anything anymore.\n\n" +
          "Environment notes: dependencies are already installed (Node, yarn classic v1). You can scope the " +
          "existing Jest suite to whatever file you're iterating on with `npx jest <path-to-file>`. Fix the " +
          "library source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const closeAndDelayTest = await readFile(fixture("tests/tooltip-close-and-delay-behavior.spec.js"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/tooltip-close-and-delay-behavior.spec.js": closeAndDelayTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
