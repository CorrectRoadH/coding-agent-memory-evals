import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, orderedLines, prepareRepo, runProbe, type ProbeCase } from "./harness.ts";

// 链的第 5 题。开票口径:在计费取整之上再加一条最低计费额。
//
// 本题建立:
//   R-min  invoice 的最低计费额——每条不足 30 分钟按 30 分钟计,在 R-round 取整之后套用
//
// 本题复用:R-round 来自第 2 题,但本题 prompt 把它重述了一遍(自包含);R4 / R5 来自第 1 题。
//
// 两条规则都在自己 prompt 里写清。判据只看最终计费数字,不锁实现。
const DAY = "2026-03-05";

// 规则:只算 billable、每条先按 15 分钟向上取整、再套最低计费额(不足 30 分钟按 30 分钟)。
// Alpha: 420s→取整900→最低1800 ; 2400s→取整2700→>1800不变2700 = 4500。Beta: 1860s→2700。
// 数据把三档拆得开:只套 R-round → Alpha=3600;两条都不套 → Alpha=2820;两条都套才 4500。
const ENTRIES = [
  { id: 1, description: "a1", start: `${DAY}T09:00:00Z`, stop: `${DAY}T09:07:00Z`, duration: 420, billable: true, workspace_id: 1, project_id: 11 },
  { id: 2, description: "a2", start: `${DAY}T10:00:00Z`, stop: `${DAY}T10:40:00Z`, duration: 2400, billable: true, workspace_id: 1, project_id: 11 },
  { id: 3, description: "b1", start: `${DAY}T11:00:00Z`, stop: `${DAY}T11:31:00Z`, duration: 1860, billable: true, workspace_id: 1, project_id: 12 },
  { id: 4, description: "internal", start: `${DAY}T13:00:00Z`, stop: `${DAY}T14:00:00Z`, duration: 3600, billable: false, workspace_id: 1, project_id: 11 },
  { id: 5, description: "running", start: `${DAY}T16:00:00Z`, duration: -1772000000, billable: true, workspace_id: 1 },
];

const asJson = (probeCase: ProbeCase): any => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

const billSummary = (payload: any) =>
  Array.isArray(payload?.projects) ? payload.projects.map((p: any) => [p?.project, p?.billable_seconds]) : payload;

export default defineEval({
  description:
    "toggl-cli 05: add `toggl entry invoice` (per-project invoice) and establish the 30-minute minimum " +
    "billing increment",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "toggl-cli. I need a proper invoice command: `toggl entry invoice`, per project.\n\n" +
          "- `toggl entry invoice [--since <when>] [--until <when>]`. Only billable entries; running " +
          "entries ignored.\n" +
          "- Same rounding we bill by: **each entry rounded up to the next 15 minutes**. On top of that, an " +
          "invoice has a **minimum billing increment: any entry shorter than 30 minutes is charged as 30 " +
          "minutes** — that minimum is a new standing rule for invoicing from here on. Apply the rounding, " +
          "then the 30-minute floor, per entry, then sum per project.\n" +
          "- Per project, longest first, ties alphabetical; 'No Project' for entries without one.\n" +
          "- Human: `<seconds>s  <project>` then `<seconds>s  Total`; empty result prints `(no data)` and " +
          "exits 0. No new dependencies.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Now `--json`: `{\"projects\":[{\"project\":\"Alpha\",\"billable_seconds\":4500}, ...]," +
          "\"total_billable_seconds\":7200}`, same order as human, snake_case, integer seconds; empty window " +
          "is `{\"projects\":[],\"total_billable_seconds\":0}`. Stdout is only the JSON document in JSON mode.\n\n" +
          "Then build and run the existing test suite. (`cargo test` also compiles tests/live_cli.rs, which " +
          "needs real credentials to actually run — compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${DAY}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "invoice", "--since", DAY, "--until", DAY] },
        { name: "json", args: ["entry", "invoice", "--since", DAY, "--until", DAY, "--json"] },
        { name: "empty", args: ["entry", "invoice", "--since", "2026-01-01", "--until", "2026-01-01"] },
      ],
    });

    await t.group("命令存在,取整 + 30 分钟最低额都应用后按项目汇总", () => {
      t.check(probe.human.exit, equals(0));
      t.check(billSummary(asJson(probe.json)), equals([
        ["Alpha", 4500],
        ["Beta", 2700],
      ]));
      t.check(asJson(probe.json)?.total_billable_seconds, equals(7200));
    });

    await t.group("空窗口打印 (no data) 并 exit 0", () => {
      const lines = orderedLines(probe.empty, ["(no data)"]);
      t.check(lines.ok, isTrue(lines.message));
      t.check(probe.empty.exit, equals(0));
    });
  },
});
