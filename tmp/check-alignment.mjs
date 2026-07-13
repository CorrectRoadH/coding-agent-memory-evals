// Read-only mechanical check of tmp/alignment-table-smoke.txt using niceeval/report's
// own stringWidth (display-column aware, not JS .length), per plan/docs-code-alignment-closeout.md
// lines 133-139. Does not modify any file.
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const { stringWidth } = await import(
  "/Users/ctrdh/Code/coding-agent-memory-evals/node_modules/niceeval/src/report/index.ts"
);

const raw = readFileSync("/Users/ctrdh/Code/coding-agent-memory-evals/tmp/alignment-table-smoke.txt", "utf8");
const lines = raw.split("\n");

// Table body: locate header line by its known first cell "任务" and the following two data rows.
const headerIdx = lines.findIndex((l) => l.startsWith("任务"));
if (headerIdx === -1) throw new Error("header line not found");
const header = lines[headerIdx];
const rowZh = lines[headerIdx + 1];
const rowEn = lines[headerIdx + 2];

console.log("header:", JSON.stringify(header));
console.log("rowZh :", JSON.stringify(rowZh));
console.log("rowEn :", JSON.stringify(rowEn));

// 1. .length vs stringWidth mismatch for the CJK cell value itself.
const cjk = "中文任务";
console.log("\n[check] 中文任务 .length =", cjk.length, "(expect 4)");
console.log("[check] 中文任务 stringWidth =", stringWidth(cjk), "(expect 8)");

// 2. Column start display-offsets: split each line into fields by run of >=2 spaces,
// then compute the display-column offset of each field's start via stringWidth of the prefix.
function fieldOffsets(line) {
  const offsets = [];
  const re = /\S+(?:\s\S+)*/g; // not used; do manual scan instead
  let i = 0;
  const fields = [];
  while (i < line.length) {
    // skip spaces
    while (i < line.length && line[i] === " ") i++;
    if (i >= line.length) break;
    const start = i;
    while (i < line.length && line[i] !== " ") i++;
    // allow single-space-separated tokens that are logically part of same field? Our columns
    // are separated by >=2 spaces (COLUMN_GAP=3, but compressed values may differ), so treat
    // consecutive non-double-space runs specially. For this fixture, values are single tokens
    // (任务/KIND/SCORE/MISSING/attempt headers, and cell values), so simple whitespace-run split
    // is sufficient except header "任务" vs value cells being single tokens too. Just record
    // start/end per whitespace-delimited token.
    fields.push({ text: line.slice(start, i), start });
  }
  return fields.map((f) => ({ text: f.text, displayOffset: stringWidth(line.slice(0, f.start)) }));
}

const hFields = fieldOffsets(header);
const zFields = fieldOffsets(rowZh);
const eFields = fieldOffsets(rowEn);

console.log("\nheader fields:", hFields);
console.log("rowZh fields :", zFields);
console.log("rowEn fields :", eFields);

// KIND is the 2nd field (index 1) in all three lines.
const kindOffsets = [hFields[1].displayOffset, zFields[1].displayOffset, eFields[1].displayOffset];
console.log("\n[check] KIND column display-offset in header/rowZh/rowEn:", kindOffsets);
console.log("[check] all equal:", kindOffsets.every((o) => o === kindOffsets[0]));

// 3. SCORE right-alignment: use the already-computed, stringWidth-accurate field offsets
// (index 2 = SCORE column) rather than re-deriving positions from indexOf, since indexOf
// operates on UTF-16 code units while the header line contains a CJK prefix ("任务") whose
// .length (2) differs from its display width (4) -- reusing raw indexOf offsets as display
// columns would silently misalign the window by that delta.
const scoreSlotStart = hFields[2].displayOffset; // header "SCORE" field's own slot start
const scoreSlotWidth = stringWidth("SCORE"); // natural column width: max(header, all values) = 5
console.log("\n[check] SCORE column slot: start=%d width=%d (dominated by header, since |SCORE|=5 > |123|=3 > |7|=1)", scoreSlotStart, scoreSlotWidth);
const zhPad = zFields[2].displayOffset - scoreSlotStart;
const enPad = eFields[2].displayOffset - scoreSlotStart;
console.log("[check] leading spaces before '7'   inside SCORE slot:", zhPad, "(slot width 5 - value width 1 = 4)");
console.log("[check] leading spaces before '123' inside SCORE slot:", enPad, "(slot width 5 - value width 3 = 2)");
console.log("[check] pad difference equals value-width difference (proves right-align):", zhPad - enPad === 3 - 1);

// 4. MISSING for zh row must be exactly "—".
const missingField = zFields[3];
console.log("\n[check] rowZh MISSING field text:", JSON.stringify(missingField.text), "(expect —)");

// 5. locator presence.
console.log("\n[check] rowZh contains @-locator:", /@\S+/.test(rowZh), rowZh.match(/@\S+/)?.[0]);
console.log("[check] rowEn attempt cell is — (no locator):", eFields[eFields.length - 1].text);
