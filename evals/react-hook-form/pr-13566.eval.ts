import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/react-hook-form/pr-13566/${path}`, import.meta.url);

// real fix: react-hook-form PR #13566 (merge f89388f5f60b8a8222a42b340f49b38e77d9ed26),
// which lands on top of BASE_COMMIT (its first parent). Bug: flatten() recurses into
// any non-null object-typed field value, including Date instances, instead of keeping
// Date as a single leaf value.
const REPO_URL = "https://github.com/react-hook-form/react-hook-form.git";
const BASE_COMMIT = "46381fa8fe690fc16d17afde8a43738a55b2c6e6";

export default defineEval({
  description:
    "react-hook-form pr-13566: preserve Date values as leaf nodes in the flatten() utility (real react-hook-form issue)",
  // 装依赖只有 pnpm install,本地实测全程 < 1 分钟,scoped jest 跑单文件 < 2s;沿用全局默认 timeoutMs。
  diff: {
    ignore: ["coverage", "node_modules"],
  },
  async test(t) {
    // 没有单独的 workspace 起始目录——fixture 就是这个 base commit 本身:clone 真实 repo、
    // 退到 base commit、抹掉未来历史(remote/tags/reflog),agent 拿到带真实(截断)git 历史
    // 的 checkout。checkout 必须在 workdir 根——嵌套子目录会被 diff 分类账记成 gitlink,
    // agent 的改动就从证据里消失了。任务说明只通过下面的 t.send() 传给 agent。
    t.progress({ message: "cloning react-hook-form @ base commit" });
    const cloned = await t.sandbox.runShell(
      [
        "set -euo pipefail",
        `git clone -q -o origin --single-branch ${REPO_URL} .rhf-clone`,
        "mv .rhf-clone/.git .git",
        "rm -rf .rhf-clone",
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
      throw new Error(`react-hook-form checkout failed: ${(cloned.stderr || cloned.stdout).trim().slice(-500)}`);
    }

    t.progress({ message: "installing deps (pnpm)" });
    const installed = await t.sandbox.runShell("npm install -g pnpm@10.34.5 && CYPRESS_INSTALL_BINARY=0 pnpm install --no-frozen-lockfile --ignore-scripts");
    if (installed.exitCode !== 0) {
      throw new Error(`pnpm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-hook-form repository at the commit where the bug " +
          "below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: react-hook-form has an internal `flatten` utility that turns a nested form values object into a flat " +
          "map of dot-separated paths to leaf values (used internally for things like path-based dirty/touched " +
          "diffing). It decides whether to recurse into a value purely by checking whether the value is a non-null " +
          "object — it has no special case for `Date` instances. So when a field's value is a `Date`, `flatten` " +
          "treats it as a plain container and tries to recurse into it. A `Date` instance has no own enumerable " +
          "properties, so this recursion produces nothing, and the field silently disappears from the flattened " +
          "output instead of being kept as a single leaf value holding the original `Date`. For example, " +
          "`flatten({ name: 'Alice', createdAt: new Date('2024-01-01'), age: 30 })` should return an object with a " +
          "`createdAt` key holding that same `Date`, but the key is missing from the result entirely. The same " +
          "thing happens when the `Date` is nested inside another object, e.g. a `range: { start, end }` field " +
          "with `Date` values should flatten to `range.start` / `range.end` keys holding those `Date`s, but those " +
          "keys go missing too.\n\n" +
          "Environment notes: dependencies are already installed (Node, pnpm). You can scope the existing Jest " +
          "suite to whatever file you're iterating on with `node_modules/.bin/jest --config " +
          "./scripts/jest/jest.config.js <path-to-file>`. Fix the library source; do not just add workarounds in " +
          "test files.",
      )
      .then((turn) => turn.expectOk());

    const flattenTest = await readFile(fixture("tests/flatten.test.ts"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/__tests__/utils/flatten.test.ts": flattenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
