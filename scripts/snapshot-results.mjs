// 把最近一次 niceeval 运行快照成一个自包含、可直接 `niceeval view` 的 run 目录:
// site/data/run/(summary.json + 每个 attempt 的 sources/events/trace)。提交进仓库。
//
// .niceeval/ 是 .gitignore 的、且每次跑都换时间戳目录。线上报告要可复现,就得有一份
// 提交进仓库的数据源。跑完新一轮 eval 后执行 `npm run snapshot && npm run report` 即可刷新线上。
//
// 只快照查看器会 fetch 的三类工件;diff.json(单轮可达上百 MB)和 o11y.json 查看器不读,
// 不进仓库。

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const niceevalDir = resolve(repoRoot, ".niceeval");
const destDir = resolve(repoRoot, "site/data/run");
const VIEWER_ARTIFACTS = ["sources.json", "events.json", "trace.json"];

const runs = readdirSync(niceevalDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join(niceevalDir, e.name, "summary.json"))
  .filter((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  })
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (runs.length === 0) {
  throw new Error(`${niceevalDir} 下没有任何带 summary.json 的运行;先跑一轮 eval`);
}

const runDir = dirname(runs[0]);

// 先清掉旧快照再整体重建,避免上一轮的 attempt 目录残留在新快照里。
rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });
copyFileSync(runs[0], join(destDir, "summary.json"));

const summary = JSON.parse(readFileSync(runs[0], "utf-8"));
let copied = 0;
for (const result of summary.results ?? []) {
  if (!result.artifactsDir) continue;
  for (const name of VIEWER_ARTIFACTS) {
    const src = join(runDir, result.artifactsDir, name);
    if (!existsSync(src)) continue;
    const dest = join(destDir, result.artifactsDir, name);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
    copied++;
  }
}

console.log(`已快照 ${runDir} -> ${destDir}(summary.json + ${copied} 个工件文件)`);
