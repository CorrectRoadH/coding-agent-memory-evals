import { defineReport, Table } from "niceeval/report";

export default defineReport(async ({ selection }) => {
  const locator = selection.snapshots.flatMap((s) => s.attempts)[0]?.locator;
  return (
    <Table
      columns={[
        { key: "name", header: "任务" },
        { key: "kind", header: "KIND" },
        { key: "score", header: "SCORE", align: "right" },
        { key: "missing", header: "MISSING" },
      ]}
      rows={[
        { key: "zh", cells: { name: "中文任务", kind: "cjk", score: "7", missing: null }, ...(locator ? { locator } : {}) },
        { key: "en", cells: { name: "ascii", kind: "latin", score: "123", missing: "present" } },
      ]}
    />
  );
});
