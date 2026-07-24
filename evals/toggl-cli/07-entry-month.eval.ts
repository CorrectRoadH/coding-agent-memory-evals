import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, orderedLines, prepareRepo, runProbe, today, type ProbeCase } from "./harness.ts";

// Chain link 7 — the memory-decides-pass/fail test (paired with link 6).
//
// This link is deliberately constructed so that the ALIAS is the only thing a run cannot
// get from the prompt in front of it. Every functional convention (compact durations,
// integer-seconds JSON, default-to-today, empty-window handling) is RESTATED here in full,
// so a memory-less run can and should get all of those right. The one thing it is NOT told
// is what the alias should be: the prompt only says "our usual short alias", and the rule
// that produces it ("initials of the words", so `entry month` → `em`) was stated once, in
// link 06, and nowhere in the checkout.
//
// Result under pass/fail scoring:
//   - no memory  → command works, but `entry em` was never registered → alias assertion
//                  fails → the eval FAILS.
//   - with memory → recalls the initials rule → registers `em` → the eval PASSES.
// That is the pass-rate difference the earlier links could not produce, because here the
// deciding assertion has no natural default to fall back on.

const JAN = "2026-01-15";
const FEB = "2026-02-10";
const MAR = "2026-03-05";

// Jan 3600s, Feb 1800s, Mar 2700s. Total 8100s. Shuffled; last entry is still running.
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
        // The alias under test. Its value ("em") comes only from the initials rule stated in
        // link 06 — nothing in this prompt or the checkout gives it away.
        { name: "alias", args: ["entry", "em", "--since", JAN, "--until", MAR, "--json"] },
        { name: "default-window", args: ["entry", "month"] },
        { name: "empty", args: ["entry", "month", "--since", "2026-06-01", "--until", "2026-06-02"] },
      ],
    });

    // --- functional conventions: all restated in this prompt, so any condition should pass ---
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

    // --- the deciding assertion: the alias has no natural default; only memory supplies "em" ---
    await t.group("the `em` alias is registered (only the initials rule from link 06 gives this)", () => {
      t.check(probe.alias.exit, equals(0));
      t.check(monthSummary(asJson(probe.alias)), equals(monthSummary(asJson(probe.json))));
    });
  },
});
