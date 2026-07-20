import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/yet-another-react-lightbox/pr-408/${path}`, import.meta.url);

// real fix: yet-another-react-lightbox PR #408 (squash-merged as
// 2861732969a182075ba19d3a001b34c3a38a3081), which lands on top of BASE_COMMIT (its first
// parent -- this was a squash merge, so the merge commit itself has exactly one parent, and
// that parent is an ancestor of the PR's baseRefOid, which had gone stale by the time this
// merged). Feature: the Zoom plugin only ever wrapped image slides (isImageSlide(slide)) in
// its interactive zoom container -- any other slide `type` (custom render functions, video,
// etc.) silently got no zoom support at all, with no way to opt in. The fix adds a `supports`
// list (of slide `type` strings) and a `maxZoom` prop (number, or a function of the slide
// returning a number | undefined, defaulting to 8) to the Zoom plugin's options so custom
// slide types can opt into the same zoom wrapper/gesture handling that image slides get.
const REPO_URL = "https://github.com/igordanchenko/yet-another-react-lightbox.git";
const BASE_COMMIT = "c1c704426607e3eaceb1b1d7794df1235e4adf8a";

// this base commit's dependency tree (vite@^8 / vitest@^4.1 / jsdom@^29) needs Node >= 20.19
// / >= 22.12 (vite's rolldown dependency imports `util.styleText`, which doesn't exist before
// Node 20.12, and jsdom declares `engines.node: ^20.19.0 || ^22.13.0 || >=24.0.0`) -- the
// sandbox's default Node (20.9.0) installs fine but throws a SyntaxError on `node:util` the
// moment vitest starts up. Confirmed locally: identical failure on the *unmodified* pre-fix
// Zoom.spec.ts under Node 20.9.0, and a clean RED (2 fail / 2 pass) -> GREEN (4 pass) under
// Node 20.19.0 and Node 22.13.0 alike. So install bumps the sandbox's global Node to 22.13.0
// via `n` before `npm install`, with a fail-fast version assertion in between so a
// PATH-precedence surprise in the real sandbox (untested there -- only verified locally on
// darwin-arm64, mirroring the same workaround already used by the commit-5578052 eval in this
// same repo) fails loudly here instead of silently leaving the agent-under-test on 20.9.0,
// unable to run its own tests.
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 13;

export default defineEval({
  description:
    "yet-another-react-lightbox pr-408: let the Zoom plugin opt custom slide types into zoom via supports/maxZoom props (real yet-another-react-lightbox issue)",
  // 纯 npm 仓库,无 packageManager 字段(不用 corepack);package-lock.json 提交在根目录。
  // Node 换成 22.13 后本地实测 npm install 数秒,vitest 跑单文件 <2s;沿用全局默认 timeoutMs。
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

    // this base commit's dependency tree needs Node >= 20.19 / >= 22.12 (see comment above)
    // -- the sandbox default doesn't satisfy that, so swap the global Node via `n` (a plain
    // npm package, no corepack involved) before installing dependencies.
    t.progress({ message: "installing Node 22.13 runtime (test tooling needs it, sandbox default is older)" });
    const nodeSwapped = await t.sandbox.runShell(
      ["set -euo pipefail", "npm install -g n@10.2.0", "n 22.13.0"].join("\n"),
    );
    if (nodeSwapped.exitCode !== 0) {
      throw new Error(`Node runtime swap failed: ${(nodeSwapped.stderr || nodeSwapped.stdout).trim().slice(-500)}`);
    }

    // fail fast in a *separate* shell so a PATH-precedence surprise (old Node still
    // resolving first) is caught here with a clear message instead of silently leaving the
    // agent-under-test unable to run its own tests.
    const nodeChecked = await t.sandbox.runShell(
      [
        "set -euo pipefail",
        `MAJOR=$(node -p "process.versions.node.split('.')[0]")`,
        `MINOR=$(node -p "process.versions.node.split('.')[1]")`,
        `if [ "$MAJOR" -lt ${MIN_NODE_MAJOR} ] || { [ "$MAJOR" -eq ${MIN_NODE_MAJOR} ] && [ "$MINOR" -lt ${MIN_NODE_MINOR} ]; }; then`,
        `  echo "expected Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}, got $(node -p process.version)" >&2`,
        "  exit 1",
        "fi",
      ].join("\n"),
    );
    if (nodeChecked.exitCode !== 0) {
      throw new Error(
        `Node version check failed after swap: ${(nodeChecked.stderr || nodeChecked.stdout).trim().slice(-500)}`,
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
          "where the feature gap below needs closing. Implement the feature in the library source.\n\n" +
          "Context: this library renders a photo/video lightbox carousel. It ships a Zoom plugin that adds " +
          "pinch/scroll/double-click zoom interactions to the currently displayed slide. Right now the Zoom " +
          "plugin only ever recognizes image slides -- internally it decides whether to wrap a slide in its " +
          "interactive zoom container purely by checking whether that slide is an image slide, with no way to " +
          "opt any other kind of slide into zoom. Consumers can render arbitrary custom slide types through the " +
          "lightbox's `render.slide` render-prop (keyed by a slide's `type` field, e.g. a custom map view, a " +
          "video player, a PDF page, etc.), but none of those custom slide types can ever get zoom behavior, no " +
          "matter what the consumer configures -- the plugin just renders them completely unwrapped, with no " +
          "zoom UI, no pinch/scroll/double-click handling, nothing.\n\n" +
          "Feature request: add a way for a consumer to opt specific custom slide types into the same zoom " +
          "wrapper/gesture handling that image slides already get. Concretely, the Zoom plugin's options object " +
          "(the `zoom` prop passed to the lightbox) should grow two new optional properties:\n\n" +
          "- `supports`: a list of slide `type` strings. When the currently displayed slide's `type` is included " +
          "in this list, the plugin should wrap it in the same interactive zoom container an image slide gets " +
          "(so it participates in zoom in/out, pinch, scroll-to-zoom, double-click/double-tap, etc., exactly " +
          "like an image slide does) -- even though the slide itself isn't an image slide. A slide whose `type` " +
          "is not image and not listed in `supports` (or when `supports` is not configured at all) should " +
          "continue to render completely unwrapped, exactly as today.\n\n" +
          "- `maxZoom`: controls how far a non-image slide can be zoomed in. For image slides the maximum zoom " +
          "level is already computed automatically from the image's natural resolution vs. its displayed size, " +
          "but that computation is meaningless for a non-image custom slide (there's no natural image resolution " +
          "to compare against), so it needs its own configurable ceiling. `maxZoom` may be a plain number, or a " +
          "function that receives the current slide and returns either a number or `undefined`; returning " +
          "`undefined` (or omitting `maxZoom` entirely) should fall back to a sensible default maximum zoom " +
          "level of 8x. This setting only affects non-image slides -- image slides keep using their existing " +
          "resolution-based maximum zoom calculation unchanged.\n\n" +
          "Environment notes: dependencies are already installed (Node, npm). You can scope the existing Vitest " +
          "suite to whatever file you're iterating on with `npx vitest run <path-to-file>`. Implement the " +
          "feature in the library source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const zoomTest = await readFile(fixture("tests/Zoom.spec.ts"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "test/unit/plugins/Zoom.spec.ts": zoomTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
