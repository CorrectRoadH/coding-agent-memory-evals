import { defineEval } from "niceeval";
import { commandSucceeded, equals, isTrue } from "niceeval/expect";

import { installRustToolchain, prepareRepo, runProbe, today, orderedLines, type ProbeCase } from "./harness.ts";

// Chain link 5 of 5 — the longest reach back. Same base commit as every other link, so
// none of the four earlier commands exists here. The prompts below introduce exactly one
// new thing (which hour an entry belongs to) and lean on the whole accumulated ruleset:
//
//   R1  compact `1h 02m` / `45m` durations                     (link 1)
//   R2  --json with integer `seconds` + `total_seconds`        (link 1)
//   R3  shared helper lives in src/utilities.rs                (link 1)
//   R4  `(no data)` on stdout + exit 0                         (link 1)
//   R5  no new dependencies                                    (link 1)
//   R6  no window flags means today, not report's Monday→today (link 2)
//   R7  oldest first                                           (link 2)

const DAY = today();

// hour 9: 1800 + 2700 = 4500s. hour 11: 2700s. hour 14: 3720s. Tracked total 10920s.
// The last entry is still running and must not be counted.
const ENTRIES = [
  { id: 3, description: "review", start: `${DAY}T14:00:00Z`, stop: `${DAY}T15:02:00Z`, duration: 3720, billable: false, workspace_id: 1, project_id: 12 },
  { id: 1, description: "spec", start: `${DAY}T09:00:00Z`, stop: `${DAY}T09:30:00Z`, duration: 1800, billable: false, workspace_id: 1, project_id: 11 },
  { id: 2, description: "pairing", start: `${DAY}T09:30:00Z`, stop: `${DAY}T10:15:00Z`, duration: 2700, billable: false, workspace_id: 1, project_id: 11 },
  { id: 4, description: "inbox", start: `${DAY}T11:00:00Z`, stop: `${DAY}T11:45:00Z`, duration: 2700, billable: false, workspace_id: 1 },
  { id: 5, description: "still going", start: `${DAY}T16:00:00Z`, duration: -1772000000, billable: false, workspace_id: 1, project_id: 11 },
];

const asJson = (probeCase: ProbeCase): any => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

/** [hour, duration-value] pairs — an extra key per row is fine, a formatted duration is not. */
const hourSummary = (payload: any) =>
  Array.isArray(payload?.hours) ? payload.hours.map((row: any) => [row?.hour, row?.seconds]) : payload;

export default defineEval({
  description:
    "toggl-cli 05: add `toggl entry hours` (time-of-day distribution), following every convention " +
    "established across the earlier sessions",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "toggl-cli. I want to see what time of day I actually get work done, so: `toggl entry hours`.\n\n" +
          "- `toggl entry hours [--since <when>] [--until <when>]`.\n" +
          "- Buckets the tracked time by hour of day (UTC). One line per hour that has anything in it: " +
          "`<HH>:00  <duration>`, two spaces between the columns. Hours with nothing tracked are simply " +
          "absent.\n" +
          "- The one new rule here: an entry counts in full towards the hour its **start** falls in. " +
          "An entry running 09:30→10:15 belongs entirely to hour 09; we're not splitting entries across " +
          "buckets.\n" +
          "- A closing line `Total  <duration>`.\n" +
          "- Still-running entries don't count.\n\n" +
          "Everything else is our usual: window flags and their default, ordering, how a duration is " +
          "rendered, where the shared helper goes, no new dependencies. Nothing to decide there.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Now `--json`: an `hours` array, one object per hour, each carrying the hour as a plain integer " +
          "0-23 under `hour` plus that hour's tracked time, and the grand total alongside the array. " +
          "How a duration and the total appear in JSON: our usual rules, don't reinvent them.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "And the empty window behaves the way it does in all our commands.\n\n" +
          "Then build and run the existing test suite to confirm nothing else broke. (`cargo test` also " +
          "compiles tests/live_cli.rs, which needs real credentials to actually run — compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${DAY}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "hours", "--since", DAY, "--until", DAY] },
        { name: "json", args: ["entry", "hours", "--since", DAY, "--until", DAY, "--json"] },
        // No window flags: this one case carries the "defaults to today" convention on its own.
        { name: "default-window", args: ["entry", "hours"] },
        { name: "empty", args: ["entry", "hours", "--since", "2026-01-01", "--until", "2026-01-01"] },
        { name: "empty-json", args: ["entry", "hours", "--since", "2026-01-01", "--until", "2026-01-01", "--json"] },
      ],
    });

    const dependenciesUntouched = await t.sandbox.runShell("git diff --quiet -- Cargo.toml Cargo.lock");

    await t.group("the command exists and buckets time by hour of day", () => {
      t.check(probe.human.exit, equals(0));
      t.check(hourSummary(asJson(probe.json)), equals([
        [9, 4500],
        [11, 2700],
        [14, 3720],
      ]));
    });

    await t.group("compact duration style, recalled", () => {
      const lines1 = orderedLines(probe.human, ["09:00 1h 15m", "11:00 45m", "14:00 1h 02m", "Total 3h 02m"]);
      t.check(lines1.ok, isTrue(lines1.message));
    });

    await t.group("JSON reports integer seconds under total_seconds, recalled", () => {
      t.check(asJson(probe.json)?.total_seconds, equals(10920));
    });

    await t.group("no window flags means today, recalled", () => {
      t.check(
        probe["default-window"].requests.some(
          (path) => path.startsWith("/me/time_entries") && path.includes(`start_date=${DAY}`),
        ),
        isTrue(`the CLI should have asked for ${DAY}; it asked for ${JSON.stringify(probe["default-window"].requests)}`),
      );
    });

    await t.group("no new dependencies, recalled", () => {
      t.check(dependenciesUntouched, commandSucceeded());
    });

    await t.group("empty window prints (no data) and exits 0, recalled", () => {
      const lines2 = orderedLines(probe.empty, ["(no data)"]);
      t.check(lines2.ok, isTrue(lines2.message));
      t.check(probe.empty.exit, equals(0));
      t.check(hourSummary(asJson(probe["empty-json"])), equals([]));
      t.check(asJson(probe["empty-json"])?.total_seconds, equals(0));
    });
  },
});
