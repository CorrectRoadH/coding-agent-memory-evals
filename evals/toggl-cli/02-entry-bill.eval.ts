import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, orderedLines, prepareRepo, runProbe, type ProbeCase } from "./harness.ts";

// 链的第 2 题 —— 「业务规则」式记忆题的控制点(与第 3 题成对)。
//
// 为什么换这种题:01-05 用记忆承载「格式约定」(紧凑时长、默认今天),实测(deepseek + codex)
// 都体现不出记忆价值。execution 暴露两个死因——反直觉的约定 agent 存记忆时会漏(04 召回里
// 根本没有「默认今天」),与仓库现状冲突的召回了也压不过仓库引力(02 召回了紧凑格式化器,实现
// 还是照抄满仓库的 H:MM:SS)。
//
// 这一对把记忆承载的东西换成「任务核心的业务规则」:一条项目私有的计费规则。它治好那两个死因——
//   · 是任务核心(算错整个数字就错)→ agent 必然主动存,不会漏
//   · 仓库里没有计费逻辑可抄 → 召回后没有引力对抗
//   · 无自然默认(agent 默认会精确求和)→ 无记忆必然算错
//   · 判据只看最终计费数字,不看怎么实现取整 → 不锁实现,是真实开发任务
//
// 本题(02)自包含:计费规则和输出格式都在自己 prompt 里写清,任何条件都该过,它是控制点。
// 第 3 题只说「用我们的计费规则」,规则只能从记忆来。

const DAY = "2026-03-05";

// 计费规则(本题建立):只算 billable=true 且已结束的条目,每条时长按 15 分钟向上取整。
// Alpha: 1320s→1800 + 480s→900 = 2700。Beta: 1860s→2700。
// 非计费条目(3600s)不算;仍在计时的(负 duration)不算。
// 精确求和会是 Alpha=1800 / Beta=1860 / total=3660 —— 无记忆、不懂规则就会算成这个。
const ENTRIES = [
  { id: 1, description: "a1", start: `${DAY}T09:00:00Z`, stop: `${DAY}T09:22:00Z`, duration: 1320, billable: true, workspace_id: 1, project_id: 11 },
  { id: 2, description: "a2", start: `${DAY}T10:00:00Z`, stop: `${DAY}T10:08:00Z`, duration: 480, billable: true, workspace_id: 1, project_id: 11 },
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
    "toggl-cli 02: add `toggl entry bill` (billable time per project) and establish the shop's billing " +
    "rounding rule — round every entry up to the next 15 minutes",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "toggl-cli. We invoice clients from tracked time, so I need a billing command: `toggl entry bill`.\n\n" +
          "- `toggl entry bill [--since <when>] [--until <when>]`.\n" +
          "- Only **billable** entries count (the `billable` flag). Internal/non-billable time is ignored, " +
          "and still-running entries are ignored.\n" +
          "- Here's how we bill, and it's the shop's standing rule for anything money-related from now on: " +
          "**every entry is rounded UP to the next 15-minute unit before it's counted.** That's how we " +
          "settle with clients — a 7-minute entry bills as 15 minutes, a 22-minute entry bills as 30. Round " +
          "each entry individually, then sum.\n" +
          "- Aggregate the rounded billable time per project, longest first, ties alphabetical. Entries " +
          "without a project go under the existing 'No Project' label.\n" +
          "- Human output: one line per project `<seconds>s  <project>`, two spaces between columns, then " +
          "`<seconds>s  Total`. An empty result prints `(no data)` on stdout and exits 0. No new dependencies.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Now `--json`: `{\"projects\":[{\"project\":\"Alpha\",\"billable_seconds\":2700}, ...]," +
          "\"total_billable_seconds\":5400}`, projects in the same order as the human output, snake_case " +
          "keys, integer seconds. In JSON mode stdout is only the JSON document; an empty window is " +
          "`{\"projects\":[],\"total_billable_seconds\":0}`.\n\n" +
          "Then build and run the existing test suite. (`cargo test` also compiles tests/live_cli.rs, which " +
          "needs real credentials to actually run — compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${DAY}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "bill", "--since", DAY, "--until", DAY] },
        { name: "json", args: ["entry", "bill", "--since", DAY, "--until", DAY, "--json"] },
        { name: "empty", args: ["entry", "bill", "--since", "2026-01-01", "--until", "2026-01-01"] },
      ],
    });

    await t.group("命令存在,且按 15 分钟向上取整后汇总可计费时长", () => {
      t.check(probe.human.exit, equals(0));
      t.check(billSummary(asJson(probe.json)), equals([
        ["Alpha", 2700],
        ["Beta", 2700],
      ]));
      t.check(asJson(probe.json)?.total_billable_seconds, equals(5400));
    });

    await t.group("只算 billable、忽略非计费与运行中(总计不含那 3600s)", () => {
      // 精确求和 3660 或含非计费 7260 都不等于 5400,这条把「没按规则算」区分出来
      t.check(asJson(probe.json)?.total_billable_seconds, equals(5400));
    });

    await t.group("空窗口打印 (no data) 并 exit 0", () => {
      const lines = orderedLines(probe.empty, ["(no data)"]);
      t.check(lines.ok, isTrue(lines.message));
      t.check(probe.empty.exit, equals(0));
    });
  },
});
