import { defineEval } from "niceeval";
import { equals, isTrue } from "niceeval/expect";

import { installRustToolchain, orderedLines, prepareRepo, runProbe, today, type ProbeCase } from "./harness.ts";

// Chain link 6 — the CONTROL point for the alias mechanism (paired with link 7).
//
// Why this pair exists: under pass/fail scoring the earlier links (01-05) show no
// difference between memory conditions, because every convention they lean on has a
// "natural default" — an agent that ignores memory and just copies the repo's existing
// style gets most assertions right and only trips on a few. That is real signal, but it
// lives at the assertion level, not the pass/fail level.
//
// An alias has NO natural default. The repo's own command aliases are all synonyms
// (`running`→`current`, `resume`, `edit`→`update`); nothing in the checkout suggests
// "initials". So the rule established here — every command also answers to the initials
// of its words — is pure memory: a run that remembers it passes link 7, a run that does
// not cannot guess it and fails. That is how the alias turns a recalled fact into a
// pass/fail difference.
//
// This link STATES the rule in full (and gives this command's alias outright), so every
// condition should pass it. Link 07 only gestures at it.

const MON = "2026-03-02"; // a Monday
const TUE = "2026-03-03";
const WED = "2026-03-04";

// Mon 3600s, Tue 1800s, Wed 2700s. Total 8100s. Shuffled; the last entry is still running.
const ENTRIES = [
  { id: 2, description: "tue", start: `${TUE}T09:00:00Z`, stop: `${TUE}T09:30:00Z`, duration: 1800, billable: false, workspace_id: 1, project_id: 11 },
  { id: 1, description: "mon", start: `${MON}T09:00:00Z`, stop: `${MON}T10:00:00Z`, duration: 3600, billable: false, workspace_id: 1, project_id: 11 },
  { id: 3, description: "wed", start: `${WED}T13:00:00Z`, stop: `${WED}T13:45:00Z`, duration: 2700, billable: false, workspace_id: 1, project_id: 12 },
  { id: 4, description: "running", start: `${WED}T16:00:00Z`, duration: -1772000000, billable: false, workspace_id: 1 },
];

const asJson = (probeCase: ProbeCase): any => {
  try {
    return JSON.parse(probeCase.stdout.trim());
  } catch {
    return { parseError: probeCase.stdout };
  }
};

const daySummary = (payload: any) =>
  Array.isArray(payload?.days) ? payload.days.map((day: any) => [day?.weekday, day?.seconds]) : payload;

export default defineEval({
  description:
    "toggl-cli 06: add `toggl entry weekday` (per-weekday totals) and establish the project's " +
    "command-alias convention (initials of the words)",
  tags: ["toggl-cli", "chain"],
  timeoutMs: 1_800_000,
  diff: { ignore: ["target"] },
  setup: installRustToolchain,
  async test(t) {
    await prepareRepo(t);

    await t
      .send(
        "toggl-cli. New command: `toggl entry weekday` — totals tracked time by day of the week.\n\n" +
          "- `toggl entry weekday [--since <when>] [--until <when>]`.\n" +
          "- One line per weekday that has time in it, in calendar order Mon→Sun: `<Mon|Tue|…>  <duration>`, " +
          "two spaces between the columns. Weekdays with nothing are absent.\n" +
          "- The weekday is taken from each entry's start, in UTC. Still-running entries don't count.\n" +
          "- A closing line `Total  <duration>`.\n\n" +
          "Output style, duration rendering, the shared helper's home, window flags and their default, " +
          "no new dependencies — all our usual conventions. Nothing new to decide there.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "Now `--json`: a `days` array, one object per weekday carrying the three-letter weekday under " +
          "`weekday` (Mon, Tue, …) plus that weekday's tracked time, and the grand total alongside. " +
          "Duration representation and key naming: our usual rules.",
      )
      .then((turn) => turn.expectOk());

    await t
      .send(
        "One more thing, and it's a standing project convention from here on, not just this command: " +
          "every command also answers to a short alias made of the INITIALS of its words. `entry weekday` " +
          "gets the alias `ew`, so `toggl entry ew` does exactly what `toggl entry weekday` does. (Yes, I " +
          "know the repo's older aliases are synonyms like `update`/`current` — we're not doing that " +
          "anymore; the rule for anything new is initials.) Register `ew` for this one now.\n\n" +
          "Handle the empty window the way all our commands do, then build and run the existing test " +
          "suite. (`cargo test` also compiles tests/live_cli.rs, which needs real credentials to actually " +
          "run — compiling is enough.)",
      )
      .then((turn) => turn.expectOk());

    const probe = await runProbe(t, {
      windows: [{ contains: `start_date=${MON}`, entries: ENTRIES }],
      default_entries: [],
      cases: [
        { name: "human", args: ["entry", "weekday", "--since", MON, "--until", WED] },
        { name: "json", args: ["entry", "weekday", "--since", MON, "--until", WED, "--json"] },
        // The alias this link registers outright — every condition should have it.
        { name: "alias", args: ["entry", "ew", "--since", MON, "--until", WED, "--json"] },
        { name: "default-window", args: ["entry", "weekday"] },
        { name: "empty", args: ["entry", "weekday", "--since", "2026-01-01", "--until", "2026-01-02"] },
      ],
    });

    await t.group("the command exists and totals per weekday, Mon→Sun", () => {
      t.check(probe.human.exit, equals(0));
      t.check(daySummary(asJson(probe.json)), equals([
        ["Mon", 3600],
        ["Tue", 1800],
        ["Wed", 2700],
      ]));
    });

    await t.group("compact duration style", () => {
      const lines = orderedLines(probe.human, ["Mon 1h 00m", "Tue 30m", "Wed 45m", "Total 2h 15m"]);
      t.check(lines.ok, isTrue(lines.message));
    });

    await t.group("JSON reports integer seconds under total_seconds", () => {
      t.check(asJson(probe.json)?.total_seconds, equals(8100));
    });

    await t.group("the `ew` alias is registered (stated in this session)", () => {
      t.check(probe.alias.exit, equals(0));
      t.check(daySummary(asJson(probe.alias)), equals(daySummary(asJson(probe.json))));
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
  },
});
