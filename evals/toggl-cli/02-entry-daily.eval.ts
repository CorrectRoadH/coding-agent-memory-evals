import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, prepareRepo, runProbe, today, orderedLines, type ProbeCase } from "./harness.ts";

// Chain link 2 of 5. Starts from the same base commit as link 1 — `entry stats` does not
// exist in this checkout, so nothing below can be reverse-engineered from the code.
//
// Recalled from link 1 (deliberately not restated in the prompts):
//   R1  compact `1h 02m` / `45m` durations — every command in the repo renders H:MM:SS,
//       so an agent without memory has every reason to copy that instead
//   R2  --json with integer `seconds` and `total_seconds`
//   R4  `(no data)` on stdout + exit 0 for an empty result
//
// Established here for links 3-5 to recall:
//   R6  new commands default to TODAY when no window is given (report's Monday→today
//       default is legacy and deliberately not followed)
//   R7  chronological order, oldest first

const FIRST_DAY = "2026-03-03";
const LAST_DAY = "2026-03-05";

// 03-03: 5400s. 03-04: 2700s. 03-05: 1800 + 1920 = 3720s. Total 11820s.
// Deliberately shuffled: the API makes no ordering promise.
const ENTRIES = [
  { id: 3, description: "standup", start: "2026-03-05T09:00:00Z", stop: "2026-03-05T09:30:00Z", duration: 1800, billable: false, workspace_id: 1, project_id: 12 },
  { id: 1, description: "spec", start: "2026-03-03T09:00:00Z", stop: "2026-03-03T10:30:00Z", duration: 5400, billable: false, workspace_id: 1, project_id: 11 },
  { id: 4, description: "pairing", start: "2026-03-05T13:00:00Z", stop: "2026-03-05T13:32:00Z", duration: 1920, billable: false, workspace_id: 1, project_id: 11 },
  { id: 2, description: "inbox", start: "2026-03-04T14:00:00Z", stop: "2026-03-04T14:45:00Z", duration: 2700, billable: false, workspace_id: 1 },
];

const asJson = (probeCase: ProbeCase): any => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

/** [date, duration-value] pairs, so an extra key per day is fine but a formatted duration is not. */
const daySummary = (payload: any) =>
  Array.isArray(payload?.days) ? payload.days.map((day: any) => [day?.date, day?.seconds]) : payload;

export default defineEval({
  description:
    "toggl-cli 02: add `toggl entry daily` (per-day totals), reusing the output/JSON conventions " +
    "agreed in the entry-stats session",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "Back in toggl-cli. Next command: `toggl entry daily` — same idea as the stats command we did, " +
          "but sliced by day instead of by project.\n\n" +
          "- `toggl entry daily [--since <when>] [--until <when>]`, same date vocabulary as everywhere " +
          "else.\n" +
          "- One line per day that has tracked time: `<YYYY-MM-DD>  <duration>`, two spaces between the " +
          "columns. Days with nothing tracked are simply absent.\n" +
          "- A closing line `Total  <duration>`.\n" +
          "- An entry belongs to the day its start timestamp falls on, in UTC. Still-running entries " +
          "don't count.\n\n" +
          "Output style, how a duration is rendered, where the shared helper goes, no new deps — all the " +
          "same as what we agreed for `entry stats`. I don't want to repeat myself on those.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Two things about ordering and defaults — project-wide from now on, not just this command:\n\n" +
          "1. Days come out oldest first. Anything we list chronologically goes in chronological order, " +
          "oldest first. That's the default from here on and I won't spell it out again.\n" +
          "2. With no `--since`/`--until`, the window is TODAY. I know `report` defaults to 'Monday of " +
          "this week through today' — that's legacy, it surprises people, and new commands don't copy it. " +
          "Every new command we add defaults to today.\n\n" +
          "Make `entry daily` follow both.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Now the `--json` variant. Top level gets a `days` array with one object per day carrying the " +
          "date and that day's tracked time, plus the grand total alongside it. Key names and the way we " +
          "represent a duration in JSON: same rules as `entry stats`, no need to reinvent them.\n\n" +
          "An empty window behaves the way it does everywhere else too.\n\n" +
          "When it's done, build and run the existing test suite to check you didn't break anything. " +
          "(`cargo test` also compiles tests/live_cli.rs, which needs real credentials to actually run — " +
          "compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [
        // Checked first: the default-window case must not be answered by the fixed-date payload.
        {
          contains: `start_date=${today()}`,
          entries: [
            { id: 9, description: "today", start: `${today()}T08:00:00Z`, stop: `${today()}T08:10:00Z`, duration: 600, billable: false, workspace_id: 1, project_id: 11 },
          ],
        },
        { contains: `start_date=${FIRST_DAY}`, entries: ENTRIES },
      ],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "daily", "--since", FIRST_DAY, "--until", LAST_DAY] },
        { name: "json", args: ["entry", "daily", "--since", FIRST_DAY, "--until", LAST_DAY, "--json"] },
        { name: "default-window", args: ["entry", "daily"] },
        { name: "empty", args: ["entry", "daily", "--since", "2026-01-01", "--until", "2026-01-01"] },
        { name: "empty-json", args: ["entry", "daily", "--since", "2026-01-01", "--until", "2026-01-01", "--json"] },
      ],
    });

    await t.group("the command exists and totals each day, oldest first", () => {
      t.check(probe.human.exit, equals(0));
      t.check(daySummary(asJson(probe.json)), equals([
        ["2026-03-03", 5400],
        ["2026-03-04", 2700],
        ["2026-03-05", 3720],
      ]));
    });

    await t.group("compact duration style, recalled from the entry-stats session", () => {
      const lines1 = orderedLines(probe.human, [
        "2026-03-03 1h 30m",
        "2026-03-04 45m",
        "2026-03-05 1h 02m",
        "Total 3h 17m",
      ]);
      t.check(lines1.ok, isTrue(lines1.message));
    });

    await t.group("JSON reports integer seconds under total_seconds, recalled", () => {
      t.check(asJson(probe.json)?.total_seconds, equals(11820));
    });

    await t.group("no window flags means today", () => {
      t.check(
        probe["default-window"].requests.some(
          (path) => path.startsWith("/me/time_entries") && path.includes(`start_date=${today()}`),
        ),
        isTrue(`the CLI should have asked for ${today()}; it asked for ${JSON.stringify(probe["default-window"].requests)}`),
      );
      const lines2 = orderedLines(probe["default-window"], [`${today()} 10m`, "Total 10m"]);
      t.check(lines2.ok, isTrue(lines2.message));
    });

    await t.group("empty window prints (no data) and exits 0, recalled", () => {
      const lines3 = orderedLines(probe.empty, ["(no data)"]);
      t.check(lines3.ok, isTrue(lines3.message));
      t.check(probe.empty.exit, equals(0));
      t.check(daySummary(asJson(probe["empty-json"])), equals([]));
      t.check(asJson(probe["empty-json"])?.total_seconds, equals(0));
    });
  },
});
