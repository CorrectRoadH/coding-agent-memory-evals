import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自真实合入 PR react-hook-form/react-hook-form#13512(不让被测 agent 看到 PR 号/commit/URL):
// validateField.ts 里给 shouldUseNativeValidation 用的 setCustomValidity 闭包只对
// `inputRef`(取自 `refs ? refs[0] : ref`,即多 ref 字段——单选框组共享同一个 name 时的第一个
// ref)调用 setCustomValidity()/reportValidity(),同一字段名下的其余 radio ref 从未被设置过原生
// validity,导致浏览器原生校验气泡只锚定在组里的第一个单选按钮上。真实修复只动了这一处:message
// 消息本身照旧算,但当 `refs` 存在(多 ref 字段)时改成对 `refs.forEach()` 逐个调用
// `setCustomValidity()`,没有 refs 时才退回原来单 `inputRef` 分支。
// 隐藏测试是新增的两个用例(validateField.test.tsx 里的 "with Browser native validation"
// describe 块下),覆盖设置和清除两个方向;本地验证过 base_sha 下这两个用例必然失败(2 failed /
// 20 passed),打上真实修复后 22 全绿。
//
// gotcha 记录(供 review/复用):react-hook-form 的 devDependencies 里 @swc/core / cypress /
// unrs-resolver 都带 postinstall 脚本,pnpm 10+ 默认要求先批准依赖的构建脚本才会运行。本地
// 实测朴素的 `pnpm install --no-frozen-lockfile` 是否会以 ERR_PNPM_IGNORED_BUILDS 退出码 1
// 失败取决于本机 pnpm store 是否"热"(之前跑过 `pnpm approve-builds` 的旧 store 不再提示,全新
// --store-dir 反而没触发过这条阻断)——本地复现是非确定的,不能保证 E2B 沙箱那份 store 恰好是
// 已批准状态。加 `--ignore-scripts` 让安装结果不再依赖 store 是否曾被批准过:本地验证过
// @swc/core 的原生绑定来自平台 optionalDependency 预编译包而非 postinstall 构建,jest(经
// @swc/jest 转译)在 --ignore-scripts 下跑同一份 base_sha 源码结果不变(20/20 通过);husky 的
// prepare 钩子也一并跳过,sandbox 里不需要 git hooks。兄弟 react-hook-form eval(pr-13476/
// 13515/13566/13599/13603)目前仍是朴素 `pnpm install`,建议一并回补这个 flag。

const fixture = (path: string) => new URL(`../fixtures/react-hook-form/pr-13512/${path}`, import.meta.url);

const REPO_URL = "https://github.com/react-hook-form/react-hook-form.git";
const BASE_COMMIT = "bb2ce17575bd410cae6859e2878f9108a93bd6bc";

export default defineEval({
  description:
    "react-hook-form pr-13512: with shouldUseNativeValidation, the native setCustomValidity()/reportValidity() " +
    "call for a multi-ref field (radio group) only ever lands on the first ref, leaving the browser's native " +
    "validation bubble anchored to a single radio button instead of the whole group (real react-hook-form issue)",
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

    // --ignore-scripts: 见文件顶部 gotcha 注释——真正第一次跑的 pnpm store 会因为
    // @swc/core/cypress/unrs-resolver 的未批准 postinstall 脚本以 ERR_PNPM_IGNORED_BUILDS
    // 退出码 1 失败;跳过脚本本地验证过不影响 jest 结果,且顺带跳过不需要的 husky prepare 钩子。
    t.progress({ message: "installing dependencies" });
    const installed = await t.sandbox.runShell(
      "npm install -g pnpm@10.34.5 && CYPRESS_INSTALL_BINARY=0 pnpm install --no-frozen-lockfile --ignore-scripts",
    );
    if (installed.exitCode !== 0) {
      throw new Error(`pnpm install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-hook-form repository at the commit where the bug " +
          "below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: when a form is created with `shouldUseNativeValidation: true`, react-hook-form is supposed to " +
          "drive the browser's own native validation UI (via `reportValidity()`/`setCustomValidity()`) for every " +
          "input under a field. For a plain single `<input>` this works. But for a radio button group — several " +
          "`<input type=\"radio\">` elements registered under the same field name, so react-hook-form tracks " +
          "multiple DOM refs for one field — the native validity message is only ever applied to the *first* " +
          "radio ref in the group. The other radio inputs sharing that name never get `setCustomValidity()` " +
          "called on them, whether setting an invalid-state message or clearing it back to valid. So the " +
          "browser's native validation bubble ends up anchored to a single radio button instead of reflecting " +
          "the group as a whole, which does not match how native HTML radio-group validation behaves.\n\n" +
          "Fix the library source so that when a field has multiple refs (a radio/checkbox group sharing one " +
          "name), the native `setCustomValidity()` call — both for setting a message and for clearing it — is " +
          "applied to every ref in that group, not just the first one. Do not just add workarounds in test " +
          "files.\n\n" +
          "Environment notes: dependencies are already installed (via `npm install -g pnpm@10.34.5 && " +
          "CYPRESS_INSTALL_BINARY=0 pnpm install --no-frozen-lockfile --ignore-scripts`). Run the relevant tests " +
          "with `node_modules/.bin/jest --config ./scripts/jest/jest.config.js " +
          "src/__tests__/logic/validateField.test.tsx`. Fix the library source; do not just edit tests.",
      )
      .then((turn) => turn.expectOk());

    const hiddenTest = await readFile(fixture("tests/validateField.test.tsx"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      // 真实仓库路径:覆盖掉 agent 可能留下的任何版本,判分对齐上游隐藏测试。
      "src/__tests__/logic/validateField.test.tsx": hiddenTest,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
