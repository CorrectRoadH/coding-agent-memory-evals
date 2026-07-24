import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, orderedLines, prepareRepo, runProbe, type ProbeCase } from "./harness.ts";

// 链的第 3 题 —— 「业务规则决定通过/失败」的验证题(与第 2 题成对)。
//
// 本题构造成:计费规则是唯一一个「无法从眼前 prompt 拿到」的东西。命令的功能形状(按周汇总、
// 只算 billable、输出格式)都在这里说清,所以无记忆的运行能把这些做对。唯独没告诉它计费怎么算:
// prompt 只说「用我们的计费规则」,而那条规则(每条按 15 分钟向上取整)只在第 2 题说过一次,
// checkout 里没有——仓库根本没有任何计费/取整逻辑可抄。
//
// 通过制下的结果:
//   · 无记忆 → 命令能跑,但不知道要向上取整 → 精确求和 → 每周数字都错 → 整题 FAIL。
//   · 带记忆 → 记起「15 分钟向上取整」→ 数字对 → 整题 PASS。
// 与别名题(06/07)不同,这里承载记忆的是一条真实业务规则、判据只看最终计费数字、不锁实现,
// 是一道更贴近真实开发的记忆题。

// 两周数据。week1(周一 2026-03-02)、week2(周一 2026-03-09)。
// week1: 1320s→1800 + 480s→900 = 2700。week2: 1860s→2700。
// 非计费/运行中不算。精确求和会是 week1=1800 / week2=1860,含非计费会更大——都不等于 2700。
const W1 = "2026-03-02";
const W2 = "2026-03-09";
const ENTRIES = [
  { id: 3, description: "w2", start: `${W2}T09:00:00Z`, stop: `${W2}T09:31:00Z`, duration: 1860, billable: true, workspace_id: 1, project_id: 12 },
  { id: 1, description: "w1a", start: `${W1}T09:00:00Z`, stop: `${W1}T09:22:00Z`, duration: 1320, billable: true, workspace_id: 1, project_id: 11 },
  { id: 2, description: "w1b", start: `${W1}T10:00:00Z`, stop: `${W1}T10:08:00Z`, duration: 480, billable: true, workspace_id: 1, project_id: 11 },
  { id: 4, description: "internal", start: `${W1}T13:00:00Z`, stop: `${W1}T14:00:00Z`, duration: 3600, billable: false, workspace_id: 1, project_id: 11 },
  { id: 5, description: "running", start: `${W2}T16:00:00Z`, duration: -1772000000, billable: true, workspace_id: 1 },
];

const asJson = (probeCase: ProbeCase): any => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

const weekSummary = (payload: any) =>
  Array.isArray(payload?.weeks) ? payload.weeks.map((w: any) => [w?.week, w?.billable_seconds]) : payload;

export default defineEval({
  description:
    "toggl-cli 03: add `toggl entry bill-weekly` (billable time per week); the amounts are only right " +
    "if it recalls the 15-minute rounding rule from the billing session",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "toggl-cli. Client wants a weekly invoice breakdown, so: `toggl entry bill-weekly`.\n\n" +
          "- `toggl entry bill-weekly [--since <when>] [--until <when>]`.\n" +
          "- Buckets billable time by ISO week, keyed by that week's Monday date (`YYYY-MM-DD`), oldest " +
          "first. Only billable entries count; still-running entries don't. A week is placed by each " +
          "entry's start (UTC).\n" +
          "- **Compute the billable amount with our billing rule** — the same rule we use for `entry bill`. " +
          "I'm not going to restate it; it's how the shop bills everything.\n" +
          "- Human output: one line per week `<YYYY-MM-DD>  <seconds>s`, two spaces between columns, then " +
          "`Total  <seconds>s`. Empty window prints `(no data)` on stdout and exits 0. No new dependencies.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Now `--json`: `{\"weeks\":[{\"week\":\"2026-03-02\",\"billable_seconds\":2700}, ...]," +
          "\"total_billable_seconds\":5400}`, weeks oldest first, snake_case keys, integer seconds. In JSON " +
          "mode stdout is only the JSON document; empty window is `{\"weeks\":[],\"total_billable_seconds\":0}`.\n\n" +
          "Then build and run the existing test suite. (`cargo test` also compiles tests/live_cli.rs, which " +
          "needs real credentials to actually run — compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${W1}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "bill-weekly", "--since", W1, "--until", "2026-03-15"] },
        { name: "json", args: ["entry", "bill-weekly", "--since", W1, "--until", "2026-03-15", "--json"] },
        { name: "empty", args: ["entry", "bill-weekly", "--since", "2026-01-01", "--until", "2026-01-02"] },
      ],
    });

    // --- 功能形状:都在本题 prompt 里说清,任何条件都该过 ---
    await t.group("命令存在,按周分桶、周一为键、旧的在前", () => {
      t.check(probe.human.exit, equals(0));
      const weeks = weekSummary(asJson(probe.json));
      t.check(Array.isArray(weeks) ? weeks.map((w: any[]) => w[0]) : weeks, equals([W1, W2]));
    });

    await t.group("空窗口打印 (no data) 并 exit 0", () => {
      const lines = orderedLines(probe.empty, ["(no data)"]);
      t.check(lines.ok, isTrue(lines.message));
      t.check(probe.empty.exit, equals(0));
    });

    // --- 决定性断言:计费金额只有记起「15 分钟向上取整」规则才对 ---
    await t.group("计费金额体现 15 分钟向上取整(只能从第 2 题的规则回忆)", () => {
      t.check(weekSummary(asJson(probe.json)), equals([
        [W1, 2700],
        [W2, 2700],
      ]));
      t.check(asJson(probe.json)?.total_billable_seconds, equals(5400));
    });
  },
});
