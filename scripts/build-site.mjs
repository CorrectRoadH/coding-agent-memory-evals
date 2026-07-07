// Vercel buildCommand:从提交进仓库的 .niceeval/ 现场构建静态站(site/)。
//
// 数据源就是 .niceeval/ 本身(.gitignore 只排除上百 MB 的 diff.json),所以跑完 eval
// 之后 push 即发布,本地不需要任何构建/快照命令。
//
// 用 npx 拉已发布的 niceeval 而不是本仓库依赖:pnpm-workspace.yaml 把 niceeval
// override 成 link:../fastevals 供本地跟 HEAD 开发,CI 上那个目录不存在,pnpm install
// 装不出来。升级发布版时只改下面的 NICEEVAL 一处。
//
// TODO(升级到含 niceeval/results 的发布版后):改用 openResults + latestPerExperiment
// + copyRun 先裁出「每个实验最新一份」再导出;现在的口径是全部历史 run 一起进站,
// 与本地 `niceeval view` 一致。

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NICEEVAL = "niceeval@0.3.0";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(repoRoot, ".niceeval");
const outDir = resolve(repoRoot, process.argv[2] ?? "site");

// 空数据保险:.niceeval 缺失或没有任何非空 summary 时让构建失败,
// 而不是把空报告部署上线(Vercel 构建失败会保留上一次部署)。
if (!existsSync(dataDir)) {
  throw new Error(`${dataDir} not found. The .niceeval/ data is committed to the repo; a missing directory means .gitignore or the checkout is broken.`);
}
const runsWithResults = readdirSync(dataDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join(dataDir, e.name, "summary.json"))
  .filter((p) => {
    try {
      return (JSON.parse(readFileSync(p, "utf-8")).results ?? []).length > 0;
    } catch {
      return false;
    }
  });
if (runsWithResults.length === 0) {
  throw new Error(`${dataDir} has no run with non-empty results. Refusing to build an empty report.`);
}

rmSync(outDir, { recursive: true, force: true });
execFileSync("npx", ["-y", NICEEVAL, "view", "--out", outDir], { cwd: repoRoot, stdio: "inherit" });
console.log(`site built from ${runsWithResults.length} runs -> ${outDir}`);
