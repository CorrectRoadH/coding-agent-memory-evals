import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/yet-another-react-lightbox/commit-5578052/${path}`, import.meta.url);

// real fix: direct commit 557805264799d436f8dae40414faf3318b468954 to
// igordanchenko/yet-another-react-lightbox main (no associated PR — confirmed via
// `gh api repos/.../commits/<sha>/pulls` returning []), which lands on top of
// BASE_COMMIT (its first parent). Bug: LightboxRoot detected RTL direction only once,
// via a ref callback that ran at initial mount (`getComputedStyle(node).direction`).
// If the page's `dir` (or whatever controls computed direction) changed after mount,
// the lightbox kept using the direction it detected at mount and never re-checked.
const REPO_URL = "https://github.com/igordanchenko/yet-another-react-lightbox.git";
const BASE_COMMIT = "3ae28d1fca631f7dc31fc9d56a9c43551f9afd21";

// base commit sits right after this repo's dev-deps were bumped (jsdom 29 / vite 7 /
// html-encoding-sniffer 6, which all declare `engines.node` >= 20.19 / >= 22.12) — the
// sandbox's default Node (20.9.0) can install these fine but throws ERR_REQUIRE_ESM
// (and then a fake-timer hook timeout that cascades into every test) the moment jsdom
// is actually instantiated. Confirmed locally: identical failure on the *unmodified*
// pre-fix RTL.spec.ts under Node 20.9.0, and a clean 10-pass/11-pass RED→GREEN under
// Node 22.13.0. So install bumps the sandbox's global Node to 22.13.0 via `n` before
// `npm install`, with a fail-fast version assertion in between so a PATH-precedence
// surprise in the real sandbox (untested there — only verified locally on darwin-arm64)
// fails loudly here instead of silently leaving the agent-under-test on 20.9.0, unable
// to run its own tests.
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 13;

export default defineEval({
  description:
    "yet-another-react-lightbox commit-5578052: re-detect RTL direction on every render instead of only at mount (real yet-another-react-lightbox issue)",
  // 纯 npm 仓库,无 packageManager 字段(不用 corepack);package-lock.json 提交在根目录。
  // 本地实测(Node 22.13 后)npm install 数秒,vitest 跑单文件 <1s;沿用全局默认 timeoutMs。
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

    // this base commit's dependency tree needs Node >= 20.19 / >= 22.12 (see comment
    // above) — the sandbox default doesn't satisfy that, so swap the global Node via
    // `n` (a plain npm package, no corepack involved) before installing dependencies.
    t.progress({ message: "installing Node 22.13 runtime (test tooling needs it, sandbox default is older)" });
    const nodeSwapped = await t.sandbox.runShell(
      ["set -euo pipefail", "npm install -g n@10.2.0", "n 22.13.0"].join("\n"),
    );
    if (nodeSwapped.exitCode !== 0) {
      throw new Error(`Node runtime swap failed: ${(nodeSwapped.stderr || nodeSwapped.stdout).trim().slice(-500)}`);
    }

    // fail fast in a *separate* shell so a PATH-precedence surprise (old Node still
    // resolving first) is caught here with a clear message instead of silently leaving
    // the agent-under-test unable to run its own tests.
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
          "where the bug below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: this library's root component figures out whether the page/container it is rendered into uses " +
          "right-to-left (RTL) text direction, and uses that to decide things like which arrow key means " +
          "'next slide'. It detects the direction by reading the computed CSS `direction` of its own root " +
          "element (via `getComputedStyle`). The problem is that this detection only ever runs once, at the " +
          "moment the lightbox's root element is first attached to the DOM — the result is then cached in " +
          "component state for the lifetime of that mount and never rechecked. So when the direction changes " +
          "while the lightbox stays mounted — for example the application re-renders the still-mounted " +
          "lightbox with a different `dir` on its container, switching it from `ltr` to `rtl` — the lightbox " +
          "does not notice. It keeps behaving as if the direction were still whatever it detected at mount " +
          "time (e.g. arrow keys keep working in the old direction's sense) instead of picking up the new, " +
          "current direction. The direction must stay correct in both directions of change (ltr→rtl and " +
          "rtl→ltr), for as long as the component remains mounted.\n\n" +
          "Environment notes: dependencies are already installed (Node, npm). You can scope the existing Vitest " +
          "suite to whatever file you're iterating on with `npx vitest run <path-to-file>`. Fix the library " +
          "source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const rtlTest = await readFile(fixture("tests/RTL.spec.ts"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "test/unit/RTL.spec.ts": rtlTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
