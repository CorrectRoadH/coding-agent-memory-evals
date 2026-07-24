import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, orderedLines, prepareRepo, runProbe, type ProbeCase } from "./harness.ts";

// 链的第 6 题 —— 「两条规则都靠记忆」的验证题(与第 5 题成对)。
//
// 命令的功能形状(按月、只算 billable、输出格式)都在本题 prompt 说清,但计费怎么算完全没说:
// prompt 只说「用我们 invoice 的计费规则」。那套规则是两条记忆的叠加——15 分钟向上取整(第 2 题建立)
// 加 30 分钟最低计费额(第 5 题建立),checkout 里都查不到。
//   · 无记忆 → 不知道取整、也不知道最低额 → 数字全错 → FAIL。
//   · 带记忆 → 召回两条规则、正确叠加 → 数字对 → PASS。
// 这是链里对记忆依赖最深的一题:要同时记起分属两次会话建立的两条规则。
const M1 = "2026-01-15";
const M2 = "2026-02-10";

// 2026-01: 420s→取整900→最低1800。2026-02: 2400s→取整2700→2700。合计 4500。
// 只取整不套最低 → 01 月=900;都不懂 → 01 月=420。都对才 1800。
const ENTRIES = [
  { id: 2, description: "feb", start: `${M2}T09:00:00Z`, stop: `${M2}T09:40:00Z`, duration: 2400, billable: true, workspace_id: 1, project_id: 11 },
  { id: 1, description: "jan", start: `${M1}T09:00:00Z`, stop: `${M1}T09:07:00Z`, duration: 420, billable: true, workspace_id: 1, project_id: 11 },
  { id: 3, description: "internal", start: `${M1}T13:00:00Z`, stop: `${M1}T14:00:00Z`, duration: 3600, billable: false, workspace_id: 1, project_id: 11 },
  { id: 4, description: "running", start: `${M2}T16:00:00Z`, duration: -1772000000, billable: true, workspace_id: 1 },
];

const asJson = (probeCase: ProbeCase): any => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

const monthSummary = (payload: any) =>
  Array.isArray(payload?.months) ? payload.months.map((m: any) => [m?.month, m?.billable_seconds]) : payload;

export default defineEval({
  description:
    "toggl-cli 06: add `toggl entry invoice-monthly`; the amounts are right only if it recalls BOTH the " +
    "15-minute rounding and the 30-minute minimum from the two earlier billing sessions",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "toggl-cli. Add `toggl entry invoice-monthly` — the invoice broken down by calendar month.\n\n" +
          "- `toggl entry invoice-monthly [--since <when>] [--until <when>]`. Buckets billable time by " +
          "month, keyed `YYYY-MM`, oldest first. Only billable entries; running entries don't count; a " +
          "month is placed by each entry's start (UTC).\n" +
          "- **Compute the billable amount with our invoice rule** — the one we settled on for `entry " +
          "invoice`. I'm not restating it.\n" +
          "- Human: `<YYYY-MM>  <seconds>s` per month, two spaces, then `Total  <seconds>s`. Empty window " +
          "prints `(no data)` and exits 0. No new dependencies.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Now `--json`: `{\"months\":[{\"month\":\"2026-01\",\"billable_seconds\":1800}, ...]," +
          "\"total_billable_seconds\":4500}`, months oldest first, snake_case, integer seconds; empty window " +
          "is `{\"months\":[],\"total_billable_seconds\":0}`.\n\n" +
          "Then build and run the existing test suite. (`cargo test` also compiles tests/live_cli.rs, which " +
          "needs real credentials to actually run — compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${M1}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "invoice-monthly", "--since", M1, "--until", "2026-03-01"] },
        { name: "json", args: ["entry", "invoice-monthly", "--since", M1, "--until", "2026-03-01", "--json"] },
        { name: "empty", args: ["entry", "invoice-monthly", "--since", "2026-06-01", "--until", "2026-06-02"] },
      ],
    });

    await t.group("命令存在,按月分桶、旧的在前", () => {
      t.check(probe.human.exit, equals(0));
      const months = monthSummary(asJson(probe.json));
      t.check(Array.isArray(months) ? months.map((m: any[]) => m[0]) : months, equals(["2026-01", "2026-02"]));
    });

    await t.group("空窗口打印 (no data) 并 exit 0", () => {
      const lines = orderedLines(probe.empty, ["(no data)"]);
      t.check(lines.ok, isTrue(lines.message));
      t.check(probe.empty.exit, equals(0));
    });

    // --- 决定性断言:金额要同时记起「15 分钟取整」和「30 分钟最低额」两条规则才对 ---
    await t.group("金额体现取整+最低额(两条规则分属第 2、5 题,都靠记忆)", () => {
      t.check(monthSummary(asJson(probe.json)), equals([
        ["2026-01", 1800],
        ["2026-02", 2700],
      ]));
      t.check(asJson(probe.json)?.total_billable_seconds, equals(4500));
    });
  },
});
