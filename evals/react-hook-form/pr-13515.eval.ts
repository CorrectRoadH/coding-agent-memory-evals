import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自真实合入 PR react-hook-form/react-hook-form#13515(不让被测 agent 看到 PR 号/commit/URL):
// deepEqual() 的循环引用防护把「已访问过的对象」全塞进一个共享 WeakSet,只要本次比较里任何一侧
// 曾经在别处出现过,就直接判 true——导致两个只是复用了同一个对象引用(并非真正循环)的结构被
// 误判为相等。真实修复把 visited 从单个 WeakSet 换成 WeakMap<object, WeakSet<object>>,只有
// 「这一对」对象曾经被彼此比较过才短路为 true,真正的循环引用防护(避免爆栈)不受影响。
// 隐藏测试见 fixtures,两个文件合起来才能验证修复:deepEqual.test.ts 里已有一个循环引用用例,
// 一个「只删掉 visited 防护」的作弊修复能让新增的复用引用断言通过,但会在那个循环引用用例上
// 爆栈——所以 run-tests.sh 对 deepEqual.test.ts 是整份跑,不按 test name 抠。

const fixture = (path: string) => new URL(`../fixtures/react-hook-form/pr-13515/${path}`, import.meta.url);

const REPO_URL = "https://github.com/react-hook-form/react-hook-form.git";
const BASE_COMMIT = "1e00a1b18643d6de6cd9a92bcb05b996ac163455";

export default defineEval({
  description:
    "react-hook-form pr-13515: deepEqual's circular-reference guard makes equality \"sticky\" across unrelated " +
    "reused object references instead of only guarding genuine cycles (real react-hook-form issue)",
  diff: { ignore: ["coverage", "node_modules"] },
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

    t.progress({ message: "installing dependencies" });
    const installed = await t.sandbox.runShell("npm install -g pnpm@10.34.5 && CYPRESS_INSTALL_BINARY=0 pnpm install --no-frozen-lockfile --ignore-scripts");
    if (installed.exitCode !== 0) {
      throw new Error(`pnpm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-hook-form repository at the commit where the bug " +
          "below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: react-hook-form has an internal `deepEqual` utility that recursively compares two values for " +
          "structural equality (used, among other things, to decide whether a form's current values actually " +
          "changed on a rerender). To avoid infinite recursion on self-referential / circular structures, " +
          "`deepEqual` keeps track of which objects it has already visited while walking into a comparison, and " +
          "short-circuits to \"equal\" once it re-encounters something it's already seen. The bug is in how that " +
          "tracking works: it records every object it walks into in a single shared collection, and treats an " +
          "object as \"already compared\" — returning true — as soon as EITHER side of the current comparison has " +
          "been seen ANYWHERE before, even in a completely different part of the structure. Equality becomes " +
          "sticky: once some object has participated in one comparison, any later comparison that involves that " +
          "same object again short-circuits to equal, regardless of what it's actually being compared against " +
          "this time. This produces wrong results for plain, non-circular data that simply reuses the same object " +
          "reference in more than one place. For example, given a shared object `shared = { value: 1 }`: " +
          "`deepEqual({ first: shared, second: shared }, { first: { value: 1 }, second: { value: 2 } })` should " +
          "return false (second: 1 !== 2), but returns true — because `shared` was already \"visited\" while " +
          "comparing `first`, so the comparison for `second` short-circuits to equal even though `shared.value` " +
          "does not match `{ value: 2 }`. This is user-visible: when a form is re-rendered with new external " +
          "values (e.g. via the `values` option) and the new values object happens to reuse a nested object " +
          "reference from elsewhere in the same values tree, the form's internal change-detection treats fields " +
          "that reuse that reference as unchanged even when their actual target value differs, so the form can " +
          "silently keep showing a stale value for a field after a rerender that should have updated it.\n\n" +
          "Any fix has to satisfy both of these at once: (1) genuinely circular structures (an object that, " +
          "directly or through a chain of references, eventually points back to itself) must still be handled " +
          "without recursing forever / blowing the call stack, and (2) an object being reused in more than one " +
          "place in an otherwise non-circular structure must NOT, by itself, cause unrelated comparisons " +
          "elsewhere in the structure to be treated as equal — \"this object was involved in some earlier " +
          "comparison\" is not the same fact as \"this object was already compared against this instance\", and " +
          "the fix needs to tell those two apart.\n\n" +
          "Environment notes: dependencies are already installed (via `npm install -g pnpm@10.34.5 && CYPRESS_INSTALL_BINARY=0 " +
          "pnpm install --no-frozen-lockfile --ignore-scripts`). Run the relevant tests with `node_modules/.bin/jest --config " +
          "./scripts/jest/jest.config.js <path-to-file>`. Fix the library source; do not just edit tests.",
      )
      .then((turn) => turn.expectOk());

    const deepEqualTest = await readFile(fixture("tests/deepEqual.test.ts"), "utf8");
    const useFormTest = await readFile(fixture("tests/useForm.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      // 真实仓库路径:覆盖掉 agent 可能留下的任何版本,判分对齐上游隐藏测试。
      "src/__tests__/utils/deepEqual.test.ts": deepEqualTest,
      "src/__tests__/useForm.test.tsx": useFormTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
