import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, prepareRepo, runProbe, today, type ProbeCase } from "./harness.ts";

// Chain link 3 of 4. Same base commit as the others: neither `entry stats` nor
// `entry daily` exists here.
//
// Recalled from links 1-2 (not restated in the prompts):
//   R1  compact `1h 02m` / `45m` durations
//   R2  --json with integer `seconds` and `total_seconds`
//   R4  `(no data)` on stdout + exit 0
//   R6  no window flags means today (NOT report's Monday→today)
//   R7  oldest first
//
// Established here for link 4 to recall:
//   R8  bad argument values fail with exit code 2, before any API call is made

const DAY = today();

// 09:00-10:00, 10:30-11:00, 13:00-14:00 (UTC), shuffled in the payload.
// Gaps: 10:00-10:30 (1800s) and 11:00-13:00 (7200s) — 9000s in total.
const ENTRIES = [
  { id: 2, description: "review", start: `${DAY}T10:30:00Z`, stop: `${DAY}T11:00:00Z`, duration: 1800, billable: false, workspace_id: 1, project_id: 11 },
  { id: 1, description: "spec", start: `${DAY}T09:00:00Z`, stop: `${DAY}T10:00:00Z`, duration: 3600, billable: false, workspace_id: 1, project_id: 11 },
  { id: 3, description: "pairing", start: `${DAY}T13:00:00Z`, stop: `${DAY}T14:00:00Z`, duration: 3600, billable: false, workspace_id: 1, project_id: 12 },
];

const asJson = (probeCase: ProbeCase): any => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

/** [start, end, duration-value] triples — extra keys per gap are fine, a formatted duration is not. */
const gapSummary = (payload: any) =>
  Array.isArray(payload?.gaps) ? payload.gaps.map((gap: any) => [gap?.start, gap?.end, gap?.seconds]) : payload;

export default defineEval({
  description:
    "toggl-cli 03: add `toggl entry gaps` (untracked windows between entries), following the " +
    "conventions established in the earlier sessions",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "toggl-cli again. I keep losing track of the time I *didn't* log, so: `toggl entry gaps`.\n\n" +
          "It looks at the entries in the window and reports the untracked holes between them — from one " +
          "entry's end to the next entry's start, within the same UTC day.\n\n" +
          "- `toggl entry gaps [--since <when>] [--until <when>] [--min <minutes>]`.\n" +
          "- `--min` is the smallest hole worth reporting, default 15. A hole shorter than that is noise " +
          "(you got coffee), not a gap.\n" +
          "- One line per gap: `<HH:MM>-<HH:MM>  <duration>`, clock times in UTC, two spaces before the " +
          "duration. Then a closing line `Total  <duration>`.\n" +
          "- Entries that overlap or touch produce no gap. Still-running entries are ignored.\n\n" +
          "Everything else — window flags and their default, ordering, duration rendering, where shared " +
          "helpers live, no new dependencies — follows what we already settled on for the other commands. " +
          "Don't invent anything new there.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Now `--json`: a `gaps` array where each gap carries its start and end as RFC3339 UTC timestamps " +
          "(e.g. `2026-03-05T10:00:00Z`) plus how long the gap is, and the usual grand total alongside " +
          "the array. Duration representation and key naming in JSON: our usual rules.\n\n" +
          "Empty result: the usual behaviour too.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "One more rule while we're here, and it's a general one: a bad argument value must be rejected " +
          "with exit code 2, before we make any network call. `--min 0` is nonsense for this command " +
          "(every pair of entries is 'at least 0 minutes apart'), so require at least 1 and fail with " +
          "exit code 2 when it isn't — no API request, no partial output. Put the message text in " +
          "`src/constants.rs` with the other user-facing strings rather than inlining it at the call " +
          "site.\n\n" +
          "From now on that's how every new command treats invalid arguments: validate first, exit 2, " +
          "don't touch the network.\n\n" +
          "Then build and run the existing test suite. (`cargo test` also compiles tests/live_cli.rs, " +
          "which needs real credentials to actually run — compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${DAY}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "gaps", "--since", DAY, "--until", DAY] },
        { name: "json", args: ["entry", "gaps", "--since", DAY, "--until", DAY, "--json"] },
        { name: "min-45", args: ["entry", "gaps", "--since", DAY, "--until", DAY, "--min", "45"] },
        { name: "min-180", args: ["entry", "gaps", "--since", DAY, "--until", DAY, "--min", "180"] },
        { name: "min-zero", args: ["entry", "gaps", "--min", "0"] },
        // No window flags: this one case carries the "defaults to today" convention, so a
        // miss there does not drag the formatting assertions down with it.
        { name: "default-window", args: ["entry", "gaps"] },
      ],
    });

    await t.group("the command exists and finds the untracked windows", () => {
      t.check(probe.human.exit, equals(0));
      t.check(gapSummary(asJson(probe.json)), equals([
        [`${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`, 1800],
        [`${DAY}T11:00:00Z`, `${DAY}T13:00:00Z`, 7200],
      ]));
    });

    await t.group("compact duration style, recalled", () => {
      t.check(probe.human.lines, equals(["10:00-10:30 30m", "11:00-13:00 2h 00m", "Total 2h 30m"]));
    });

    await t.group("JSON reports integer seconds under total_seconds, recalled", () => {
      t.check(asJson(probe.json)?.total_seconds, equals(9000));
    });

    await t.group("no window flags means today, recalled", () => {
      t.check(
        probe["default-window"].requests.some(
          (path) => path.startsWith("/me/time_entries") && path.includes(`start_date=${DAY}`),
        ),
        isTrue(`the CLI should have asked for ${DAY}; it asked for ${JSON.stringify(probe["default-window"].requests)}`),
      );
    });

    await t.group("--min filters, and an empty result prints (no data), recalled", () => {
      t.check(probe["min-45"].lines, equals(["11:00-13:00 2h 00m", "Total 2h 00m"]));
      t.check(probe["min-180"].lines, equals(["(no data)"]));
      t.check(probe["min-180"].exit, equals(0));
    });

    await t.group("--min 0 is an argument error: exit 2, no API call", () => {
      t.check(probe["min-zero"].exit, equals(2));
      t.check(probe["min-zero"].requests, equals([]));
    });
  },
});
