// Vercel buildCommand(pnpm exec tsx scripts/build-site.ts):
// 从提交进仓库的 .niceeval/ 现场构建静态站(site/)。跑完 eval 后 push 即发布,
// 本地不需要任何构建/快照命令。
//
// 口径:每个实验取最新一份快照(latestPerExperiment),copyRun 瘦身出一个临时 run 目录
// (只带查看器要 fetch 的 sources/events/trace;diff 被 .gitignore、o11y 查看器不读),
// 再用内置查看器整站导出。数据缺失或为空时直接抛错让构建失败 —— Vercel 会保留上一次部署,
// 而不是把空报告顶上线。

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openResults, latestPerExperiment, copyRun } from "niceeval/results";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(repoRoot, process.argv[2] ?? "site");

const results = await openResults(join(repoRoot, ".niceeval"));
const { snapshots, warnings } = latestPerExperiment(results.snapshots);
for (const w of [...results.warnings, ...warnings]) console.warn(w);
if (snapshots.length === 0) {
  throw new Error("No snapshots found in .niceeval/ — refusing to build an empty report. The data is committed to the repo; an empty directory means .gitignore or the checkout is broken.");
}

const stage = mkdtempSync(join(tmpdir(), "niceeval-site-data-"));
const copied = await copyRun(snapshots, stage, { artifacts: ["sources", "events", "trace"] });
for (const w of copied.warnings) console.warn(w);
if ((copied.summary.results ?? []).length === 0) {
  throw new Error("Copied snapshot has no results — refusing to build an empty report.");
}

rmSync(outDir, { recursive: true, force: true });
const niceevalBin = join(repoRoot, "node_modules/niceeval/bin/niceeval.js");
execFileSync("node", [niceevalBin, "view", "--out", outDir, copied.dir], { stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
console.log(`site built: ${snapshots.length} experiment snapshots, ${copied.summary.results.length} results -> ${outDir}`);
