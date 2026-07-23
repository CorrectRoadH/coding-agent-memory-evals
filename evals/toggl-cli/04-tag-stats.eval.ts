import { defineEval } from "niceeval";
import { commandSucceeded, equals, isTrue } from "niceeval/expect";

import { installRustToolchain, prepareRepo, runProbe, today, type ProbeCase } from "./harness.ts";

// Chain link 4 of 4 — the cumulative check. Same base commit again; none of the three earlier
// commands exists in this checkout. The prompts state only what is genuinely new (tags
// can overlap, `--top`), and lean on everything else:
//
//   R1  compact `1h 02m` / `45m` durations                     (link 1)
//   R2  --json with integer `seconds` + `total_seconds`        (link 1)
//   R4  `(no data)` on stdout + exit 0                         (link 1)
//   R6  no window flags means today, not report's Monday→today (link 2)
//   R8  bad argument value -> exit 2 before any API call       (link 3)

const DAY = today();

// code = 3600 + 1800 = 5400s, deep = 3600 + 600 = 4200s, untagged = 2700s.
// Tracked time overall is 8700s — tags overlap, so the total is not the sum of the rows.
const ENTRIES = [
  { id: 1, description: "spec", start: `${DAY}T09:00:00Z`, stop: `${DAY}T10:00:00Z`, duration: 3600, billable: false, workspace_id: 1, tags: ["deep", "code"], project_id: 11 },
  { id: 2, description: "review", start: `${DAY}T10:30:00Z`, stop: `${DAY}T11:00:00Z`, duration: 1800, billable: false, workspace_id: 1, tags: ["code"], project_id: 11 },
  { id: 3, description: "inbox", start: `${DAY}T11:00:00Z`, stop: `${DAY}T11:45:00Z`, duration: 2700, billable: false, workspace_id: 1 },
  { id: 4, description: "reading", start: `${DAY}T13:00:00Z`, stop: `${DAY}T13:10:00Z`, duration: 600, billable: false, workspace_id: 1, tags: ["deep"] },
];

const asJson = (probeCase: ProbeCase): any => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

/** [tag, duration-value] pairs — an extra key per row is fine, a formatted duration is not. */
const tagSummary = (payload: any) =>
  Array.isArray(payload?.tags) ? payload.tags.map((row: any) => [row?.tag, row?.seconds]) : payload;

export default defineEval({
  description:
    "toggl-cli 04: add `toggl tag stats` (per-tag totals with --top), following every convention " +
    "established across the earlier sessions",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "toggl-cli. Last one in this batch: `toggl tag stats`, the tag-side counterpart of the " +
          "per-project stats command.\n\n" +
          "- `toggl tag stats [--since <when>] [--until <when>]`.\n" +
          "- One line per tag, longest first, ties alphabetical: `<duration>  <tag>`, two spaces between " +
          "the columns. Entries carrying several tags count in full towards each of them. Entries with no " +
          "tags at all are collected under the literal label `(no tag)`.\n" +
          "- A closing line `<duration>  Total`. Careful: because a tagged entry can appear in several " +
          "rows, the total is the tracked time itself, not the sum of the rows.\n" +
          "- Still-running entries don't count.\n\n" +
          "Window flags and their default, ordering, duration rendering, shared helper placement, no new " +
          "dependencies — all as established. Nothing new to decide there.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Add `--top <N>`: show only the N longest tags. It cuts the rows, not the total — the Total line " +
          "still reflects all tracked time in the window. And N below 1 is meaningless, so treat it the " +
          "way we treat any bad argument value.\n\n" +
          "Then the `--json` variant: a `tags` array of one object per tag carrying the tag and its " +
          "tracked time, plus the grand total alongside it. `--top` applies to the JSON array the same " +
          "way it applies to the rows. Usual rules for how a duration and the total appear in JSON.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "And handle the empty window the way all our commands do.\n\n" +
          "Then build and run the existing test suite to confirm nothing else broke. (`cargo test` also " +
          "compiles tests/live_cli.rs, which needs real credentials to actually run — compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${DAY}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["tag", "stats", "--since", DAY, "--until", DAY] },
        { name: "json", args: ["tag", "stats", "--since", DAY, "--until", DAY, "--json"] },
        { name: "top-2", args: ["tag", "stats", "--since", DAY, "--until", DAY, "--top", "2"] },
        { name: "top-zero", args: ["tag", "stats", "--top", "0"] },
        // No window flags: this one case carries the "defaults to today" convention on its own.
        { name: "default-window", args: ["tag", "stats"] },
        { name: "empty", args: ["tag", "stats", "--since", "2026-01-01", "--until", "2026-01-01"] },
        { name: "empty-json", args: ["tag", "stats", "--since", "2026-01-01", "--until", "2026-01-01", "--json"] },
      ],
    });

    const dependenciesUntouched = await t.sandbox.runShell("git diff --quiet -- Cargo.toml Cargo.lock");

    await t.group("the command exists and totals per tag without double-counting the total", () => {
      t.check(probe.human.exit, equals(0));
      t.check(tagSummary(asJson(probe.json)), equals([
        ["code", 5400],
        ["deep", 4200],
        ["(no tag)", 2700],
      ]));
      t.check(asJson(probe.json)?.total_seconds, equals(8700));
    });

    await t.group("compact duration style, recalled", () => {
      t.check(probe.human.lines, equals(["1h 30m code", "1h 10m deep", "45m (no tag)", "2h 25m Total"]));
    });

    await t.group("--top cuts rows but not the total", () => {
      t.check(probe["top-2"].lines, equals(["1h 30m code", "1h 10m deep", "2h 25m Total"]));
    });

    await t.group("no window flags means today, recalled", () => {
      t.check(
        probe["default-window"].requests.some(
          (path) => path.startsWith("/me/time_entries") && path.includes(`start_date=${DAY}`),
        ),
        isTrue(`the CLI should have asked for ${DAY}; it asked for ${JSON.stringify(probe["default-window"].requests)}`),
      );
    });

    await t.group("--top 0 is an argument error: exit 2, no API call, recalled", () => {
      t.check(probe["top-zero"].exit, equals(2));
      t.check(probe["top-zero"].requests, equals([]));
    });

    await t.group("no new dependencies", () => {
      t.check(dependenciesUntouched, commandSucceeded());
    });

    await t.group("empty window prints (no data) and exits 0, recalled", () => {
      t.check(probe.empty.lines, equals(["(no data)"]));
      t.check(probe.empty.exit, equals(0));
      t.check(tagSummary(asJson(probe["empty-json"])), equals([]));
      t.check(asJson(probe["empty-json"])?.total_seconds, equals(0));
    });
  },
});
