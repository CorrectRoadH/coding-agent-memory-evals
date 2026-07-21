import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

// 挖自真实合入 PR ReactTooltip/react-tooltip#1278(不让被测 agent 看到 PR 号/commit)。merge commit
// a12511545da3789511a78bdd555bb0061c119acd 提供隐藏测试的权威 post-fix 内容。Bug:tooltip 用文档级
// 委托监听处理事件,anchor 解析逻辑假设每个事件 target 都是元素、直接读元素独有属性;当某个事件
// (如 mouseover)的 target 是 document 本身而非元素节点时,就会抛异常、打断 tooltip 事件处理。真实
// 修复让 anchor 解析安全地忽略非元素 target(源码在 src/utils/resolve-data-tooltip-anchor.ts 与
// src/components/Tooltip/use-tooltip-events.tsx)。隐藏测试是 interaction-behavior spec 里新增的一个
// 用例(断言 dispatch 到 document 的 mouseover 不抛错、且不误挂 tooltip),断言全在可观察行为上、不
// import 任何新符号,base_sha 下必失败(1 failed / 9 passed),打上真实修复后 10 全绿——本地 Node
// 20.9.0 双向验证过。
const fixture = (path: string) => new URL(`../fixtures/react-tooltip/pr-1278/${path}`, import.meta.url);

const REPO_URL = "https://github.com/ReactTooltip/react-tooltip.git";
const BASE_COMMIT = "af0a01aa326d04cf3330423a41acfe62e725f9bb";

export default defineEval({
  description:
    "react-tooltip pr-1278: the delegated document-level event handler assumes every event target is an " +
    "element; an event whose target is the document itself (not an element node) makes anchor resolution read " +
    "element-only properties and throw, breaking tooltip event handling — non-element targets must be ignored " +
    "safely (real react-tooltip issue)",
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

    // No packageManager field pinned, so corepack is unsafe on the sandbox's Node 20.9.0.
    // Install yarn classic v1 explicitly. --ignore-engines covers Node 20.9.0 against
    // devDependencies that declare stricter ranges; --ignore-scripts skips native-module
    // postinstall builds (e.g. an old brotli addon) that are not needed to run Jest.
    t.progress({ message: "installing deps (yarn classic v1)" });
    const installed = await t.sandbox.runShell(
      "npm install -g yarn@1.22.22 && yarn install --ignore-scripts --ignore-engines",
    );
    if (installed.exitCode !== 0) {
      throw new Error(`yarn install failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }

    await t
      .send(
        "Your working directory is a checkout of the real react-tooltip repository at the commit where the bug " +
          "below reproduces. Find and fix the bug in the library source.\n\n" +
          "Bug: react-tooltip attaches delegated event listeners at the document level and, for each incoming " +
          "event, resolves which anchor element (if any) the event relates to. That anchor-resolution logic " +
          "assumes the event's `target` is always an element node and reads element-only properties/methods off " +
          "it (such as attribute lookups or `closest(...)`). But some events have a `target` that is not an " +
          "element at all — for example a `mouseover` dispatched with the `document` itself as its target. When " +
          "that happens, the code throws, which breaks the library's delegated event handling. The correct " +
          "behavior is to safely ignore event targets that are not element nodes: such an event should be a " +
          "no-op (no thrown exception, and no tooltip incorrectly attached). Fix the library source so that " +
          "non-element event targets are handled gracefully. Fix the library source (under `src/`); do not just " +
          "add workarounds in test files.\n\n" +
          "Environment notes: no root access is needed. Dependencies are already installed via `npm install -g " +
          "yarn@1.22.22 && yarn install --ignore-scripts --ignore-engines`. Run tests with Jest, e.g. " +
          "`node_modules/.bin/jest src/test/tooltip-interaction-behavior.spec.js`. The event-delegation and " +
          "anchor-resolution logic lives under `src/components/Tooltip/` and `src/utils/`. Fix the library " +
          "source; do not just add workarounds in test files.",
      )
      .then((turn) => turn.expectOk());

    const spec = await readFile(fixture("tests/tooltip-interaction-behavior.spec.js"), "utf8");
    const runTests = await readFile(fixture("tests/run-tests.sh"), "utf8");
    await t.sandbox.writeFiles({
      "src/test/tooltip-interaction-behavior.spec.js": spec,
      "tests/run-tests.sh": runTests,
    });

    t.check(await t.sandbox.runCommand("bash", ["tests/run-tests.sh"]), commandSucceeded());
  },
});
