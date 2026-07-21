import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自真实合入 PR react-hook-form/react-hook-form#13579(修复 issue #13575;不让被测 agent 看到
// PR 号/commit)。Bug:`form.subscribe({ formState, callback })` 的回调 payload 会带上触发该次
// 通知的字段 `name`。`createFormControl.ts` 把单次事件的元数据(name/type)持久化进了 form state,
// 于是先 `clearErrors('firstName')` 之后,再触发一次与该字段无关的更新(如提交),订阅回调仍拿到
// 上次遗留的 `name: 'firstName'` 而不是 `undefined`——事件元数据跨通知泄漏。真实修复让 per-event
// 元数据不再被写进持久 state。隐藏测试是 subscribe.test.tsx 里新增的一个用例,base_sha 下必失败
// (1 failed / 13 passed),打上真实修复后 14 全绿——本地 Node 20.9.0 双向验证过。
const fixture = (path: string) => new URL(`../fixtures/react-hook-form/pr-13579/${path}`, import.meta.url);

const REPO_URL = "https://github.com/react-hook-form/react-hook-form.git";
const BASE_COMMIT = "cae5dfe2d60f1f19e2d9e40314ddef858064347f";

export default defineEval({
  description:
    "react-hook-form pr-13579: per-event metadata (the field `name`) leaks across subscribe() notifications — a " +
    "later, unrelated update reports a stale `name` from an earlier clearErrors() call instead of undefined " +
    "(real react-hook-form issue #13575)",
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

    // --ignore-scripts:同兄弟 rhf eval,让 pnpm 安装结果不依赖 build-approval store 状态,
    // 不影响 jest(经 @swc/jest 现场转译)判分。
    t.progress({ message: "installing dependencies" });
    const installed = await t.sandbox.runShell(
      "npm install -g pnpm@10.34.5 && CYPRESS_INSTALL_BINARY=0 pnpm install --no-frozen-lockfile --ignore-scripts",
    );
    if (installed.exitCode !== 0) {
      throw new Error(`pnpm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-hook-form repository at the commit where the " +
          "bug below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: a subscription created via `form.subscribe({ formState: { ... }, callback })` receives a payload " +
          "that includes the `name` of the field involved in the event that triggered it. If you call " +
          "`clearErrors('firstName')` and then, later, trigger an unrelated form-state update that has no field " +
          "name of its own (for example submitting the form via `handleSubmit`), the subscriber's callback " +
          "fires with `name` still set to `'firstName'` — a stale value left over from the earlier " +
          "`clearErrors` call — instead of `undefined`. In other words, the per-event metadata (`name`/`type`) " +
          "from one notification is being persisted into form state and bleeding into later, unrelated " +
          "notifications. Fix the library source so that per-event metadata is not persisted across updates and " +
          "each subscriber notification reports only the name (if any) of the event that actually triggered it. " +
          "Fix the library source (under `src/`); do not just add workarounds in test files.\n\n" +
          "Environment notes: dependencies are already installed (via `npm install -g pnpm@10.34.5 && " +
          "CYPRESS_INSTALL_BINARY=0 pnpm install --no-frozen-lockfile --ignore-scripts`). Run tests with " +
          "`node_modules/.bin/jest --config ./scripts/jest/jest.config.js src/__tests__/useForm/subscribe.test.tsx`.",
      )
      .then((turn) => turn.expectOk());

    const hiddenTest = await readFile(fixture("tests/subscribe.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      // 真实仓库路径:覆盖掉 agent 可能留下的任何版本,判分对齐上游隐藏测试。
      "src/__tests__/useForm/subscribe.test.tsx": hiddenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
