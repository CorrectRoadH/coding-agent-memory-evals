import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/react-tooltip/pr-970/${path}`, import.meta.url);

// real fix: react-tooltip PR #970. This PR was landed as a linear sequence of 4 commits
// fast-forwarded onto main (no distinct 2-parent merge commit was created), so gh's
// reported `mergeCommit` is really just the PR's tip commit and its immediate parent is
// itself part of the PR, not the base. base_sha here is `baseRefOid` instead (verified:
// it equals the parent of the PR's first commit exactly, no discrepancy to reconcile).
// FIX_COMMIT below is that tip (the final state of all 4 commits combined, i.e. what
// landed on main). Bug/feature gap: the tooltip's internal position-computation utility
// figures out which side of the anchor it actually ended up placing the tooltip on
// (which can differ from the requested `place` prop once auto-flip-on-overflow kicks
// in), but it only used that information to compute inline pixel styles -- it never
// returned the actual placement value, so nothing downstream (including the rendered
// tooltip element) had access to it.
const REPO_URL = "https://github.com/ReactTooltip/react-tooltip.git";
const BASE_COMMIT = "92bed214767a1110d5b6abd43643e73437833261";
const FIX_COMMIT = "f4d97476635cdc76bd86f22302e73131fa58f55d";
void FIX_COMMIT; // documents provenance of the hidden test fixture; not used at runtime

export default defineEval({
  description:
    "react-tooltip pr-970: expose the tooltip's actual computed placement so consumers can target it with " +
    "placement-specific CSS (real react-tooltip feature request)",
  // 纯 Node 仓库,yarn classic v1 装依赖、跑单个 jest 文件都在数十秒内完成,用默认超时足够。
  diff: {
    // yarn.lock 在 install 阶段可能被重写(元数据/排序变化,字节级差异,无实际依赖变更)——
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
    // --ignore-scripts skips native-module postinstall builds that are not needed to
    // run Jest and are not guaranteed to build on every host.
    t.progress({ message: "installing deps (yarn classic v1)" });
    const installed = await t.sandbox.runShell(
      "npm install -g yarn@1.22.22 && yarn install --ignore-scripts --ignore-engines",
    );
    if (installed.exitCode !== 0) {
      throw new Error(`yarn install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-tooltip repository at the commit where the " +
          "feature gap below applies. Implement it in the library source.\n\n" +
          "Feature request: react-tooltip positions its tooltip relative to an anchor element using a requested " +
          "`place` prop (e.g. `top`, `bottom`, `left`, `right`), but when there isn't enough room in that " +
          "direction the positioning logic automatically flips the tooltip to whichever side it actually fits, " +
          "so the side the tooltip ends up rendered on can differ from what was requested. The library computes " +
          "this actual, final placement internally (it needs it to calculate the inline pixel styles that " +
          "position the tooltip and its arrow), but that computed value is never exposed anywhere a consumer " +
          "could use it -- it's used once to derive coordinates and then discarded.\n\n" +
          "Add a CSS class to the tooltip's root DOM element that reflects the actual computed placement (for " +
          "example a class along the lines of `react-tooltip__place-<placement>`, with `<placement>` being " +
          "`top`, `bottom`, `left`, or `right` -- whatever the tooltip actually resolved to, not necessarily the " +
          "requested `place` prop), and keep it in sync whenever the tooltip recomputes its position (e.g. across " +
          "re-renders, anchor changes, or content/size changes). This lets consumers write placement-specific " +
          "CSS overrides (arrow direction, offsets, etc.) for tooltips that may auto-flip. The class should " +
          "always be present once the tooltip has computed a position at least once, so it doesn't flash " +
          "unstyled before the first flip decision.\n\n" +
          "Environment notes: no root access is needed. Dependencies are already installed via `npm install -g " +
          "yarn@1.22.22 && yarn install --ignore-scripts --ignore-engines`. Run tests with Jest, e.g. `node_modules/.bin/jest " +
          "src/test/utils.spec.js` to scope to the relevant utility tests. The position-computation logic lives " +
          "under `src/utils/`, and the tooltip component that renders the root element lives under " +
          "`src/components/Tooltip/`. Fix the library source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const utilsSpec = await readFile(fixture("tests/utils.spec.js"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/utils.spec.js": utilsSpec,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
