// 把最近一次 fasteval 运行的 summary.json 快照进 site/data/summary.json(提交进仓库)。
//
// .fasteval/ 是 .gitignore 的、且每次跑都换时间戳目录。线上报告要可复现,就得有一份
// 提交进仓库的数据源。跑完新一轮 eval 后执行 `npm run snapshot && npm run report` 即可刷新线上。

import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fastevalDir = resolve(repoRoot, ".fasteval");
const dest = resolve(repoRoot, "site/data/summary.json");

const runs = readdirSync(fastevalDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join(fastevalDir, e.name, "summary.json"))
  .filter((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  })
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (runs.length === 0) {
  throw new Error(`${fastevalDir} 下没有任何带 summary.json 的运行;先跑一轮 eval`);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(runs[0], dest);
console.log(`已快照 ${runs[0]} -> ${dest}`);
