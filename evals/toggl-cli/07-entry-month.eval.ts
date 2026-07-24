import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, orderedLines, prepareRepo, runProbe, today, type ProbeCase } from "./harness.ts";

// 链的第 7 题 —— 「记忆决定通过/失败」的验证题(与第 6 题成对)。
//
// 本题刻意构造成:别名是唯一一个「运行无法从眼前 prompt 里拿到」的东西。所有功能约定(紧凑时长、
// 整数秒 JSON、默认今天、空窗口处理)都在这里完整重述,所以无记忆的运行能、也应该把这些全做对。
// 唯独没告诉它别名该是什么:prompt 只说「照我们惯用的短别名」,而产出它的规则(「各单词首字母」,
// 于是 `entry month` → `em`)只在第 06 题说过一次,checkout 里哪儿都没有。
//
// 通过制下的结果:
//   - 无记忆   → 命令能跑,但 `entry em` 从没被注册 → 别名断言挂 → 整题 FAIL。
//   - 带记忆   → 记起首字母规则 → 注册 `em` → 整题 PASS。
// 这正是前面几题产生不出来的「通过率差异」,因为这里那条决定性断言没有自然默认可退。

const JAN = "2026-01-15";
const FEB = "2026-02-10";
const MAR = "2026-03-05";

// Jan 3600s、Feb 1800s、Mar 2700s。合计 8100s。故意打乱;最后一条仍在计时。
const ENTRIES = [
  { id: 3, description: "mar", start: `${MAR}T09:00:00Z`, stop: `${MAR}T09:45:00Z`, duration: 2700, billable: false, workspace_id: 1, project_id: 12 },
  { id: 1, description: "jan", start: `${JAN}T09:00:00Z`, stop: `${JAN}T10:00:00Z`, duration: 3600, billable: false, workspace_id: 1, project_id: 11 },
  { id: 2, description: "feb", start: `${FEB}T09:00:00Z`, stop: `${FEB}T09:30:00Z`, duration: 1800, billable: false, workspace_id: 1, project_id: 11 },
  { id: 4, description: "running", start: `${MAR}T16:00:00Z`, duration: -1772000000, billable: false, workspace_id: 1 },
];

const asJson = (probeCase: ProbeCase): any => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

const monthSummary = (payload: any) =>
  Array.isArray(payload?.months) ? payload.months.map((m: any) => [m?.month, m?.seconds]) : payload;

export default defineEval({
  description:
    "toggl-cli 07: add `toggl entry month` (per-month totals); its short alias can only come from " +
    "the initials convention agreed in the weekday session",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "toggl-cli. New command: `toggl entry month` — totals tracked time by calendar month.\n\n" +
          "- `toggl entry month [--since <when>] [--until <when>]`.\n" +
          "- One line per month that has time in it, oldest first: `<YYYY-MM>  <duration>`, two spaces " +
          "between the columns. Months with nothing are absent. A closing line `Total  <duration>`.\n" +
          "- The month is taken from each entry's start, in UTC. Still-running entries don't count.\n" +
          "- Durations use our compact style (`1h 00m`, `30m`, never seconds). The shared formatter lives " +
          "in `src/utilities.rs` — don't add another copy. No new dependencies.\n" +
          "- With no `--since/--until`, the window is today (not report's Monday-of-this-week default).\n" +
          "- An empty window prints `(no data)` on stdout and exits 0.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Now `--json`: a `months` array, one object per month carrying the `YYYY-MM` string under `month` " +
          "plus that month's tracked time as integer seconds under `seconds`, and the grand total under " +
          "`total_seconds`. In JSON mode stdout is only the JSON document. Empty window is " +
          '`{"months":[],"total_seconds":0}`.',
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Last thing: register this command's short alias, the usual way we do it for every command. Then " +
          "build and run the existing test suite. (`cargo test` also compiles tests/live_cli.rs, which " +
          "needs real credentials to actually run — compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${JAN}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "month", "--since", JAN, "--until", MAR] },
        { name: "json", args: ["entry", "month", "--since", JAN, "--until", MAR, "--json"] },
        // 被考的别名。它的值("em")只来自第 06 题说过的首字母规则——本题 prompt 和 checkout 都不给。
        { name: "alias", args: ["entry", "em", "--since", JAN, "--until", MAR, "--json"] },
        { name: "default-window", args: ["entry", "month"] },
        { name: "empty", args: ["entry", "month", "--since", "2026-06-01", "--until", "2026-06-02"] },
      ],
    });

    // --- 功能约定:都在本题 prompt 里重述过,任何条件都该过 ---
    await t.group("the command exists and totals per month, oldest first", () => {
      t.check(probe.human.exit, equals(0));
      t.check(monthSummary(asJson(probe.json)), equals([
        ["2026-01", 3600],
        ["2026-02", 1800],
        ["2026-03", 2700],
      ]));
    });

    await t.group("compact duration style", () => {
      const lines = orderedLines(probe.human, ["2026-01 1h 00m", "2026-02 30m", "2026-03 45m", "Total 2h 15m"]);
      t.check(lines.ok, isTrue(lines.message));
    });

    await t.group("JSON reports integer seconds under total_seconds", () => {
      t.check(asJson(probe.json)?.total_seconds, equals(8100));
    });

    await t.group("no window flags means today", () => {
      t.check(
        probe["default-window"].requests.some(
          (path) => path.startsWith("/me/time_entries") && path.includes(`start_date=${today()}`),
        ),
        isTrue(`the CLI should have asked for ${today()}; it asked for ${JSON.stringify(probe["default-window"].requests)}`),
      );
    });

    await t.group("empty window prints (no data) and exits 0", () => {
      const lines = orderedLines(probe.empty, ["(no data)"]);
      t.check(lines.ok, isTrue(lines.message));
      t.check(probe.empty.exit, equals(0));
    });

    // --- 决定性断言:别名没有自然默认;只有记忆能提供 "em" ---
    await t.group("the `em` alias is registered (only the initials rule from link 06 gives this)", () => {
      t.check(probe.alias.exit, equals(0));
      t.check(monthSummary(asJson(probe.alias)), equals(monthSummary(asJson(probe.json))));
    });
  },
});
