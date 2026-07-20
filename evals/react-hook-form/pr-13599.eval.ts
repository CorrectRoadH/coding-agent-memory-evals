import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自真实合入 PR react-hook-form/react-hook-form#13599(不让被测 agent 看到 PR 号/commit/URL):
// 内部 _setValid() 是 fire-and-forget(9 处调用点都不 await),对乱序完成毫无防护——如果一次更早
// 发起的校验(等待 resolver 或字段自己的 async validate)在一次更晚发起的校验already resolve 之后
// 才 resolve,前者仍会把自己现在已经过期的 isValid/isValidating 结果提交上去,悄悄覆盖掉后者刚提交
// 的正确结果。真实修复给每次 _setValid() 调用发一个单调递增的 call id,提交前检查自己是不是仍是
// 最新一次调用,只改了 src/logic/createFormControl.ts 几行。隐藏测试见 fixtures(两个用例:一个测
// isValid 的整表校验,一个测 resolver 表单下 isValidating 的同款竞态)。

const fixture = (path: string) => new URL(`../fixtures/react-hook-form/pr-13599/${path}`, import.meta.url);

const REPO_URL = "https://github.com/react-hook-form/react-hook-form.git";
const BASE_COMMIT = "521adfcbd7e6c99e0253af574006c6e26077887b";

export default defineEval({
  description:
    "react-hook-form pr-13599: stale out-of-order _setValid() calls can overwrite a newer, correct isValid/isValidating result (real react-hook-form issue)",
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
        "Your working directory is a checkout of the real react-hook-form repository at the commit where the bug below " +
          "reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: react-hook-form recomputes the form's overall `isValid` (and, for resolver-based forms, " +
          "`isValidating`) through an internal routine that is triggered fire-and-forget from many places (mount, " +
          "`setValue`, `unregister`, `trigger`, `resetField`, disabled-state changes, etc.) and is never awaited by " +
          "whatever triggered it. There is no guard against out-of-order completion: if an earlier one of these " +
          "validity checks is still waiting on async validation (either a resolver or a field's own `validate` " +
          "function) when a later one starts and finishes first, the earlier check can still commit its result " +
          "afterward — even though it's now stale — silently overwriting the correct, current `isValid`/`isValidating` " +
          "value that the later check already committed. For example: a field with an async `validate` function is " +
          "still pending when an unrelated form change (editing an adjacent field with no validation rules of its " +
          "own) re-triggers a whole-form validity check; that second, later check resolves first and correctly " +
          "reports the form valid, but when the first (now-stale) check's `validate` eventually resolves, its " +
          "result still gets committed and can flip `isValid` back to an incorrect value even though nothing " +
          "meaningful has changed since the newer, correct result landed. The same kind of staleness problem " +
          "separately affects `isValidating` for forms configured with a `resolver`: an internal helper " +
          "unconditionally clears the in-flight validating state and reports `isValidating: false` whenever a " +
          "resolver-driven validity check completes, with no check for whether a newer validity check (started " +
          "after this one) is still actually in flight — so a superseded resolver pass finishing late can wrongly " +
          "report validation as finished while a newer pass is still genuinely running.\n\n" +
          "Fix the library source so a validity check that has been superseded by a newer one (of either kind " +
          "above) does not commit its now-stale result — mirroring the staleness check react-hook-form already " +
          "does per-field elsewhere for value updates. Do not just add workarounds in test files.\n\n" +
          "Environment notes: dependencies are already installed (via `npm install -g pnpm@10.34.5 && CYPRESS_INSTALL_BINARY=0 " +
          "pnpm install --no-frozen-lockfile --ignore-scripts`). Run the relevant tests with `node_modules/.bin/jest --config " +
          "./scripts/jest/jest.config.js src/__tests__/useForm/formState.test.tsx`. Fix the library source; do not " +
          "just edit tests.",
      )
      .then((turn) => turn.expectOk());

    const hiddenTest = await readFile(fixture("tests/formState.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      // 真实仓库路径:覆盖掉 agent 可能留下的任何版本,判分对齐上游隐藏测试。
      "src/__tests__/useForm/formState.test.tsx": hiddenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
