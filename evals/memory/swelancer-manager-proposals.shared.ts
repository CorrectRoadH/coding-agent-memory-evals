import { readFile } from "node:fs/promises";

import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

type IssueId = "15193" | "14268" | "25901";
type Expected = Record<IssueId, { selected_proposal_id: number; question_id: string }>;

const expectedUrl = new URL("../fixtures/swelancer/manager-proposals/expected.json", import.meta.url);

export function managerProposalEval(issue: IssueId) {
  return defineEval({
    description: `SWE-Lancer manager task ${issue}: pick the proposal the maintainers actually accepted`,
    async test(t) {
      await t.sandbox.uploadDirectory("../../workspaces/swelancer-manager-proposals");

      await t
        .send(
          `You are the engineering manager for issue ${issue}. Read tasks/${issue}/issue.md and ` +
            `tasks/${issue}/proposals.md, decide which single proposal should be accepted, and write ` +
            `manager_decisions.json at the repo root as {"${issue}": {"selected_proposal_id": NUMBER}}. ` +
            "Judge root-cause analysis and fix quality the way a maintainer would.",
        )
        .then((turn) => turn.expectOk());

      const expected: Expected = JSON.parse(await readFile(expectedUrl, "utf8"));
      const exists = await t.sandbox.fileExists("manager_decisions.json");
      t.check(exists, isTrue("manager_decisions.json exists"));

      let raw = "{}";
      if (exists) raw = await t.sandbox.readFile("manager_decisions.json");
      let decisions: Record<string, { selected_proposal_id?: unknown }> = {};
      try {
        decisions = JSON.parse(raw);
      } catch {
        t.check(false, isTrue(`manager_decisions.json is valid JSON (got: ${raw.slice(0, 200)})`));
      }

      t.check(
        Number(decisions[issue]?.selected_proposal_id),
        equals(expected[issue].selected_proposal_id),
      );
    },
  });
}
