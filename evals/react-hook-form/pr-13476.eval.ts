import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自真实合入 PR react-hook-form/react-hook-form#13476(不让被测 agent 看到 PR 号/commit/URL):
// 当 field array 的 resolver 同一轮校验里既报了 root 级错误又报了带数字 index 的嵌套错误时
// (useFieldArray 内部 effect 会把这类错误存成一个"扁平对象"——root 的 type/message 和
// 数字 key 的嵌套错误共存于同一个 plain object),再叠加一次 remove() + trigger() 会把嵌套
// 错误整体丢失。真实根因:executeSchemaAndUpdateState() 对所有 plain-object 的 field-array
// 错误都无条件调用 updateFieldArrayRootError(),而后者用 convertToArrayPayload() 硬把已有
// 错误对象包成数组第 0 项,原本可用数字下标访问的嵌套错误全部错位消失。真实修复动了两处:
// createFormControl.ts 改成只在错误"纯 root、没有任何数字 key"时才走 updateFieldArrayRootError()
// 这条包装路径,混合错误(root+嵌套并存)直接原样 set 进 formState;updateFieldArrayRootError.ts
// 本身也把 convertToArrayPayload() 换成 Array.isArray() 判断,避免非数组的已有错误被再次包装。
// 隐藏测试只有一个新增用例(在 useFieldArray.test.tsx 里),本地验证过 Fix 1
// (createFormControl.ts)单独就能让该用例转绿,Fix 2 单独不够——不代表 Fix 2 是多余的,它保护的
// 是这个具体用例没有覆盖到的另一序列(先出现混合错误、后续 trigger 又只报 root-only 错误);
// 只是提醒:通过本 eval 不严格证明 agent 复刻了上游两处改动的完整语义。

const fixture = (path: string) => new URL(`../fixtures/react-hook-form/pr-13476/${path}`, import.meta.url);

const REPO_URL = "https://github.com/react-hook-form/react-hook-form.git";
const BASE_COMMIT = "889c7523d6c5c68bfc3c78142782cb0a3310729d";

export default defineEval({
  description:
    "react-hook-form pr-13476: trigger() after a field-array remove() can wipe out nested per-index errors when a mixed root+nested error object is present (real react-hook-form issue)",
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
    const installed = await t.sandbox.runShell("npm install -g --prefix /usr/local pnpm@10.34.5 && CYPRESS_INSTALL_BINARY=0 pnpm install --no-frozen-lockfile --ignore-scripts");
    if (installed.exitCode !== 0) {
      throw new Error(`pnpm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-hook-form repository at the commit where the bug below " +
          "reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: for a field array whose resolver can report both a root-level error on the array itself (e.g. " +
          "\"needs at least N items\") and nested per-index errors on individual items in the same validation pass, " +
          "calling trigger() alongside a field-array action such as remove() can wipe out the nested per-index " +
          "errors, leaving only (or none of) the root error behind.\n\n" +
          "Concretely: set up a form with useFieldArray where the resolver returns an errors object shaped like " +
          "{ test: { type: 'min', message: '...', 0: {...}, 2: {...} } } — a plain object that carries the root " +
          "error's type/message directly on itself while also carrying nested errors keyed by numeric index (this " +
          "is the shape useFieldArray's own internal effect leaves errors in after an array mutation). Trigger " +
          "validation once — both the root error and the nested per-index errors render correctly. Now call a " +
          "field-array mutator like remove(i) followed immediately by trigger('test') again. After this second " +
          "validation pass, the previously-visible nested per-index error(s) disappear from formState.errors, even " +
          "though the resolver is still reporting them and the indices have simply shifted after the removal.\n\n" +
          "Fix the library source so that when an existing field-array error is already a plain object carrying " +
          "nested numeric-indexed errors (not a bare root-only error, and not already an array), it is not " +
          "coerced/wrapped in a way that hides those nested indices — the root error info and the nested per-index " +
          "errors must both remain independently readable from formState.errors after subsequent trigger() calls. " +
          "Do not just add workarounds in test files.\n\n" +
          "Environment notes: dependencies are already installed (via `npm install -g pnpm@10.34.5 && CYPRESS_INSTALL_BINARY=0 " +
          "pnpm install --no-frozen-lockfile --ignore-scripts`). Run the relevant tests with `node_modules/.bin/jest --config " +
          "./scripts/jest/jest.config.js src/__tests__/useFieldArray.test.tsx`. Fix the library source; do not " +
          "just edit tests.",
      )
      .then((turn) => turn.expectOk());

    const hiddenTest = await readFile(fixture("tests/useFieldArray.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      // 真实仓库路径:覆盖掉 agent 可能留下的任何版本,判分对齐上游隐藏测试。
      "src/__tests__/useFieldArray.test.tsx": hiddenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
