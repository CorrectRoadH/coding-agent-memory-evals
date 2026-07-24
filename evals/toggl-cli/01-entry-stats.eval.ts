import { defineEval } from "niceeval";
import { commandSucceeded, equals, isTrue } from "niceeval/expect";

import { installRustToolchain, prepareRepo, runProbe, orderedLines, type ProbeCase } from "./harness.ts";

// 链的第 1 题。三轮对话用大白话说清一组项目级约定,这些约定从 checkout 里推不出来。
//
// 本题建立:
//   R1  所有新命令用紧凑时长 `1h 02m` / `45m` / `0m`
//       (仓库自己只会渲染 `H:MM:SS`,而且是两处复制粘贴的 helper)
//   R2  每个新命令都带 --json;JSON 里时长一律整数秒放在 `seconds`,总计是 `total_seconds`,键全 snake_case
//   R3  共享 helper 放 src/utilities.rs —— 不要再出现第三份时长格式化函数
//   R4  空结果在 stdout 打 `(no data)` 并 exit 0
//   R5  不加新依赖
//
// 本题复用:无(链的起点)。约定与命令形状都在本题 prompt 里写清。
//
// 后续各题都从这同一个 base commit 起步——上面这些代码一行都不在——只会含糊提一句这些约定
// (「照我们上次定的」「照我们惯用的风格」)。

const DAY = "2026-03-05";

// Alpha: 3600 + 1800 = 5400s。Beta: 3720s。无项目: 2700s。合计 11820s。
// 最后一条仍在计时(负 duration),不能计入。
const ENTRIES = [
  { id: 1, description: "spec", start: `${DAY}T09:00:00Z`, stop: `${DAY}T10:00:00Z`, duration: 3600, billable: false, workspace_id: 1, tags: ["deep"], project_id: 11 },
  { id: 2, description: "review", start: `${DAY}T10:30:00Z`, stop: `${DAY}T11:00:00Z`, duration: 1800, billable: false, workspace_id: 1, project_id: 11 },
  { id: 3, description: "standup", start: `${DAY}T13:00:00Z`, stop: `${DAY}T14:02:00Z`, duration: 3720, billable: false, workspace_id: 1, project_id: 12 },
  { id: 4, description: "inbox", start: `${DAY}T15:00:00Z`, stop: `${DAY}T15:45:00Z`, duration: 2700, billable: false, workspace_id: 1 },
  { id: 5, description: "still going", start: `${DAY}T16:00:00Z`, duration: -1772000000, billable: false, workspace_id: 1, project_id: 11 },
];

const asJson = (probeCase: ProbeCase): unknown => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

export default defineEval({
  description:
    "toggl-cli 01: add `toggl entry stats` (per-project totals) and establish the project's " +
    "output/JSON/duration conventions for new commands",
  tags: ["toggl-cli", "chain"],
  // 一次冷依赖构建加多轮编码任务塞不进默认的 10 分钟;光 setup 钩子(apt + rustup + cargo build)
  // 就可能好几分钟。
  timeoutMs: 1_800_000,
  diff: {
    // cargo 的构建目录已经在 gitignore 里,但显式列出来,免得某个游离的 CARGO_TARGET_DIR
    // 或增量产物落进 diff 分类账。
    ignore: ["target"],
  },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "You're in a checkout of toggl-cli, our unofficial Rust CLI for Toggl Track. I want a new " +
          "command: `toggl entry stats`.\n\n" +
          "What it does: pull the time entries in a date window and show where the time went, per project.\n\n" +
          "Contract:\n" +
          "- `toggl entry stats [--since <when>] [--until <when>]`, where <when> takes the same date " +
          "vocabulary the existing commands already accept (today / yesterday / this_week / last_week / " +
          "YYYY-MM-DD).\n" +
          "- One line per project, longest first, ties broken alphabetically. Line format is " +
          "`<duration>  <project name>` — two spaces between the columns. Entries without a project go " +
          "under the existing 'No Project' label.\n" +
          "- A final line `<duration>  Total`.\n" +
          "- Skip entries that are still running (negative duration) — they have no final duration yet.\n" +
          "- Durations in this command use a compact style: hours only when non-zero, minutes padded to " +
          "two digits once hours are shown, never seconds. 5400s -> `1h 30m`, 3720s -> `1h 02m`, " +
          "2700s -> `45m`, 0s -> `0m`.\n\n" +
          "Two things I want to be explicit about, because they're standing rules and not just this " +
          "command's business:\n" +
          "1. That compact duration style is what every NEW command of ours uses from here on. The old " +
          "`report` / `search` / `list` commands keep their `H:MM:SS` rendering — leave them alone.\n" +
          "2. Put the duration formatter in `src/utilities.rs`. `report.rs` and `search.rs` have already " +
          "each grown their own private copy of `format_duration_hms` and I don't want a third one — " +
          "shared helpers belong in utilities.\n\n" +
          "And no new dependencies: everything you need is already in Cargo.toml. Follow the repo's " +
          "existing structure for adding a command (AGENTS.md describes it).",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Good. Now give it `--json`.\n\n" +
          'Shape: `{"groups":[{"project":"Alpha","seconds":5400}, ...],"total_seconds":11820}`, groups in ' +
          "the same order as the human output. In JSON mode stdout carries the JSON document and nothing " +
          "else.\n\n" +
          "Write this one down as a standing rule too, it applies to everything we add from now on: every " +
          "new command gets `--json`; inside JSON a duration is always an integer number of seconds under " +
          "a `seconds` key — never a formatted string, formatting is for humans only; the grand total is " +
          "`total_seconds`; and every key is snake_case.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Last piece. When the window contains no entries at all, `toggl entry stats` should print " +
          "`(no data)` on stdout and exit 0 — not an error, not silence. In `--json` mode that case is " +
          '`{"groups":[],"total_seconds":0}`.\n\n' +
          "Same rule for every command of this kind we add later: nothing to show means the `(no data)` " +
          "line on stdout and exit code 0.\n\n" +
          "Then build and run the existing test suite to confirm you haven't broken anything else. Note " +
          "`cargo test` also compiles tests/live_cli.rs, which needs real credentials to actually run — " +
          "compiling it is enough, you don't need those tests to pass.",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${DAY}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "stats", "--since", DAY, "--until", DAY] },
        { name: "json", args: ["entry", "stats", "--since", DAY, "--until", DAY, "--json"] },
        { name: "empty", args: ["entry", "stats", "--since", "2026-03-01", "--until", "2026-03-01"] },
        { name: "empty-json", args: ["entry", "stats", "--since", "2026-03-01", "--until", "2026-03-01", "--json"] },
      ],
    });

    const dependenciesUntouched = await t.sandbox.runShell("git diff --quiet -- Cargo.toml Cargo.lock");

    await t.group("the command exists and aggregates per project", () => {
      t.check(probe.human.exit, equals(0));
      t.check(asJson(probe.json), equals({
        groups: [
          { project: "Alpha", seconds: 5400 },
          { project: "Beta", seconds: 3720 },
          { project: "No Project", seconds: 2700 },
        ],
        total_seconds: 11820,
      }));
    });

    await t.group("compact duration style (1h 02m / 45m)", () => {
      const lines1 = orderedLines(probe.human, ["1h 30m Alpha", "1h 02m Beta", "45m No Project", "3h 17m Total"]);
      t.check(lines1.ok, isTrue(lines1.message));
    });

    await t.group("no new dependencies", () => {
      t.check(dependenciesUntouched, commandSucceeded());
    });

    await t.group("empty window prints (no data) and exits 0", () => {
      const lines2 = orderedLines(probe.empty, ["(no data)"]);
      t.check(lines2.ok, isTrue(lines2.message));
      t.check(probe.empty.exit, equals(0));
      t.check(asJson(probe["empty-json"]), equals({ groups: [], total_seconds: 0 }));
    });
  },
});
