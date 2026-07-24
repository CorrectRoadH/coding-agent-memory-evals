import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, orderedLines, prepareRepo, runProbe, type ProbeCase } from "./harness.ts";

// 链的第 6 题。按月汇总的开票视图。
//
// 本题建立:无。
//
// 本题复用:R-round(15 分钟向上取整)来自第 2 题、R-min(30 分钟最低计费额)来自第 5 题,两条
// 叠加使用;本题 prompt 只说「用我们 invoice 的计费规则」,两条都不重述。R4 / R5 来自第 1 题。
//
// 命令的功能形状(按月分桶、键格式、排序、输出格式)在本题 prompt 里说清;计费口径不在。
// base commit 的仓库里没有任何计费或取整逻辑。判据只看最终计费数字,不锁实现。
const M1 = "2026-01-15";
const M2 = "2026-02-10";

// 2026-01: 420s→取整900→最低1800。2026-02: 2400s→取整2700→2700。合计 4500。
// 数据把三档拆得开:只套 R-round → 01 月=900;两条都不套 → 01 月=420;两条都套才 1800。
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

    // --- 计费口径:本题 prompt 未重述,规则见 R-round(第 2 题)+ R-min(第 5 题) ---
    await t.group("金额体现取整+最低额(两条规则分属第 2、5 题,都靠记忆)", () => {
      t.check(monthSummary(asJson(probe.json)), equals([
        ["2026-01", 1800],
        ["2026-02", 2700],
      ]));
      t.check(asJson(probe.json)?.total_billable_seconds, equals(4500));
    });
  },
});
