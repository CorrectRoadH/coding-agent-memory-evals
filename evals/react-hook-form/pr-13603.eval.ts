import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自真实合入 PR react-hook-form/react-hook-form#13603(不让被测 agent 看到 PR 号/commit/URL):
// useController 里 field 的写路径(onChange/onBlur)通过 useRef 只捕获一次 control.register()
// 的返回值,`control` prop 运行期切换后读路径(useWatch)已经重新订阅了新 control,写路径却还在
// 往旧 control 上写。真实修复只改了 src/useController.ts 一行(把 register 调用的返回值存回
// _registerProps.current,挪到已经会随 control 变化重跑的 effect 里),隐藏测试见 fixtures。

const fixture = (path: string) => new URL(`../fixtures/react-hook-form/pr-13603/${path}`, import.meta.url);

const REPO_URL = "https://github.com/react-hook-form/react-hook-form.git";
const BASE_COMMIT = "a4f380249f12856feef787103f84f714ca84c98d";

export default defineEval({
  description:
    "react-hook-form pr-13603: useController keeps writing field updates to the old control after the control prop changes at runtime (real react-hook-form issue)",
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
          "Bug: `useController` has a bug where, when the `control` object passed to it changes at runtime (the " +
          "surrounding component re-renders with a different `control` prop, without unmounting), field *reads* " +
          "correctly switch over to the new control (`field.value` reflects the new control's state), but field " +
          "*writes* do not — calling the returned `field.onChange` (or `field.onBlur`) after the control prop has " +
          "changed still updates the OLD control's form state instead of the new one's. For example: render " +
          "`useController({ control: formA.control, name: 'name' })`, call `field.onChange('typed-in-a')` (formA " +
          "correctly gets `'typed-in-a'`), then re-render the same hook with `control: formB.control` (no unmount). " +
          "`field.value` correctly flips to formB's value, but calling `field.onChange('typed-in-b')` at this point " +
          "still writes to formA instead of formB. Reads and writes have gotten out of sync after a control switch. " +
          "Fix the library source under `src/` so writes always target whichever control is currently active, " +
          "matching what reads already do.\n\n" +
          "Environment notes: dependencies are already installed (via `npm install -g pnpm@10.34.5 && CYPRESS_INSTALL_BINARY=0 " +
          "pnpm install --no-frozen-lockfile --ignore-scripts`). Run the relevant tests with `node_modules/.bin/jest --config " +
          "./scripts/jest/jest.config.js src/__tests__/useController.test.tsx`. Fix the library source; do not just " +
          "edit tests.",
      )
      .then((turn) => turn.expectOk());

    const hiddenTest = await readFile(fixture("tests/useController.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      // 真实仓库路径:覆盖掉 agent 可能留下的任何版本,判分对齐上游隐藏测试。
      "src/__tests__/useController.test.tsx": hiddenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
