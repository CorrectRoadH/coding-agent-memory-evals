import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/yet-another-react-lightbox/commit-f63f6af/${path}`, import.meta.url);

// real fix: direct commit f63f6af90a2e0d70fe04a126001076151178eb78 to
// igordanchenko/yet-another-react-lightbox main (no associated PR — confirmed via
// `gh api repos/.../commits/<sha>/pulls` returning []), which lands on top of
// BASE_COMMIT (its first parent). Bug: the thumbnails plugin computed its preload
// window the same way regardless of carousel.finite, so in finite (non-looping) mode
// the thumbnail strip showed the wrong number of thumbnails and misplaced them near
// the start/end edges compared to the default infinite/looping mode.
const REPO_URL = "https://github.com/igordanchenko/yet-another-react-lightbox.git";
const BASE_COMMIT = "c0ec3709403a357b7c9e8a95f2645cf6bd808262";

export default defineEval({
  description:
    "yet-another-react-lightbox commit-f63f6af: fix thumbnail strip count/positioning in finite carousel mode (real yet-another-react-lightbox issue)",
  // 纯 npm 仓库,无 packageManager 字段(不用 corepack);package-lock.json 提交在根目录。
  // 本地实测 npm install 数秒,vitest 跑单文件 <2s;沿用全局默认 timeoutMs。
  diff: {
    ignore: ["coverage", "node_modules"],
  },
  async test(t) {
    // 没有单独的 workspace 起始目录——fixture 就是这个 base commit 本身:clone 真实 repo、
    // 退到 base commit、抹掉未来历史(remote/tags/reflog),agent 拿到带真实(截断)git 历史
    // 的 checkout。checkout 必须在 workdir 根——嵌套子目录会被 diff 分类账记成 gitlink,
    // agent 的改动就从证据里消失了。任务说明只通过下面的 t.send() 传给 agent。
    t.progress({ message: "cloning yet-another-react-lightbox @ base commit" });
    const cloned = await t.sandbox.runShell(
      [
        "set -euo pipefail",
        `git clone -q -o origin --single-branch ${REPO_URL} .yarl-clone`,
        "mv .yarl-clone/.git .git",
        "rm -rf .yarl-clone",
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
      throw new Error(
        `yet-another-react-lightbox checkout failed: ${(cloned.stderr || cloned.stdout).trim().slice(-500)}`,
      );
    }

    t.progress({ message: "npm install" });
    const installed = await t.sandbox.runShell("npm install");
    if (installed.exitCode !== 0) {
      throw new Error(`npm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real yet-another-react-lightbox repository at the commit " +
          "where the bug below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: this library renders a photo/video lightbox with an optional thumbnails plugin that shows a " +
          "strip of thumbnail images alongside the main carousel. The lightbox has a `carousel.finite` option: " +
          "when it is false (the default), the carousel loops/wraps around infinitely; when it is true, the " +
          "carousel is finite and does not wrap — navigating past the last slide or before the first slide is " +
          "not possible. The thumbnail strip is supposed to show a window of thumbnails around the current " +
          "slide, sized according to the carousel's `preload` setting — but the windowing rule near the edges " +
          "necessarily differs between the two modes, since infinite mode can wrap slides in from the other end " +
          "while finite mode cannot. In practice, when `carousel.finite` is true, the thumbnail strip's own edge " +
          "windowing is broken: it renders the wrong number of real thumbnails and/or misplaces them near the " +
          "start and end of the slide sequence, i.e. it does not correctly compute how many real (non-wrapped) " +
          "thumbnails should be visible in a non-wrapping window near an edge. This is specifically a finite-mode " +
          "bug — the default infinite/looping mode already computes its own (wrap-aware) edge window correctly; " +
          "the two modes are not expected to produce identical counts, since their windowing rules genuinely " +
          "differ, but finite mode's counts/positions should be internally correct for a non-wrapping window, " +
          "which right now they are not.\n\n" +
          "Environment notes: dependencies are already installed (Node, npm). You can scope the existing Vitest " +
          "suite to whatever file you're iterating on with `npx vitest run <path-to-file>`. Fix the library " +
          "source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const thumbnailsTest = await readFile(fixture("tests/Thumbnails.spec.ts"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "test/unit/plugins/Thumbnails.spec.ts": thumbnailsTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
