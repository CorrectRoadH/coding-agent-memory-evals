import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

const fixture = (path: string) => new URL(`../fixtures/swelancer/manager-proposals/${path}`, import.meta.url);

type Expected = Record<string, { selected_proposal_id: number; question_id: string }>;

export default defineEval({
  description: "SWE-Lancer manager tasks: pick the proposal the maintainers actually accepted, across 3 real Expensify issues",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/swelancer-manager-proposals");
    // runner 在 test() 之前已经打过一次空 git 基线;workspace 现在是 test() 里手工上传的,
    // 晚于那次空提交,所以重新 commit 一次,不然 starter 文件会被当成 agent 生成的文件进最终 diff。
    await t.sandbox.runShell('git add -A && git commit -q -m "workspace" --allow-empty || true');

    await t
      .send(
        "You are the engineering manager for this project. For each task under `tasks/`, read `issue.md` and `proposals.md`, " +
          "decide which single proposal should be accepted, and write your decisions to `manager_decisions.json` at the repo root " +
          "in the format described in README.md. Judge each proposal's root-cause analysis and fix quality the way a maintainer would.",
      )
      .then((turn) => turn.expectOk());

    const expected: Expected = JSON.parse(await readFile(fixture("expected.json"), "utf8"));

    t.check(await t.sandbox.fileExists("manager_decisions.json"), isTrue("manager_decisions.json exists"));
    const raw = await t.sandbox.readFile("manager_decisions.json");
    let decisions: Record<string, { selected_proposal_id?: unknown }> = {};
    try {
      decisions = JSON.parse(raw);
    } catch {
      // 留空对象让下面的逐题断言挂掉并展示原始内容,而不是让整个 eval errored。
      t.check(false, isTrue(`manager_decisions.json is valid JSON (got: ${raw.slice(0, 200)})`));
    }

    for (const [issue, label] of Object.entries(expected)) {
      await t.group(`Issue ${issue}: selected proposal matches the one maintainers accepted`, () => {
        t.check(Number(decisions[issue]?.selected_proposal_id), equals(label.selected_proposal_id));
      });
    }
  },
});
