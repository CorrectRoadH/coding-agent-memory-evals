// 把结果快照(site/data/run/)构建成可静态托管的站点:site/index.html + site/artifact/。
//
// niceeval 0.3.0 起 `view --out <目录>` 是目录式静态导出:index.html 加上查看器要 fetch 的
// 工件(sources/events/trace),线上和本地 `niceeval view` 是同一套体验(代码视图、transcript、
// trace 瀑布)。0.2.x 时代「剥掉 artifactBase 防 404」的 hack 不再需要。
//
// 数据来源刻意用提交进仓库的 site/data/run/,而不是 .gitignore 掉的 .niceeval/。
// 否则换台机器 / CI 上 .niceeval 不存在,会悄悄生成「空报告」覆盖掉线上数据。

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = resolve(repoRoot, process.argv[2] ?? "site/data/run");
const siteDir = resolve(repoRoot, process.argv[3] ?? "site");
const niceevalBin = resolve(repoRoot, "node_modules/niceeval/bin/niceeval.js");

execFileSync("node", [niceevalBin, "view", "--out", siteDir, snapshot], { stdio: "inherit" });

const indexPath = join(siteDir, "index.html");
const html = readFileSync(indexPath, "utf-8");
const marker = "window.__NICEEVAL_VIEW_DATA__ = ";
const dataStart = html.indexOf(marker);
if (dataStart === -1) throw new Error("找不到 __NICEEVAL_VIEW_DATA__ 标记,niceeval 模板可能变了");
const jsonStart = dataStart + marker.length;
const jsonEnd = html.indexOf(";</script>", jsonStart);
if (jsonEnd === -1) throw new Error("找不到内嵌数据的结束符");

const data = JSON.parse(html.slice(jsonStart, jsonEnd));
if (!Array.isArray(data.rows) || data.rows.length === 0) {
  throw new Error(`快照 ${snapshot} 聚合出 0 行,拒绝生成空报告`);
}

// error / assertions[].detail 里可能带 evaluation 失败时的 stack trace,其中的绝对路径
// 是构建机本地路径泄漏,裁掉 repoRoot 前缀但保留栈信息本身。
const repoRootPattern = new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?", "g");

// 模板用 JSON.stringify(data).replace(/</g, "\\u003c") 内嵌,这里复刻同样的转义。
const sanitized = JSON.stringify(data).replace(repoRootPattern, "").replace(/</g, "\\u003c");
writeFileSync(indexPath, html.slice(0, jsonStart) + sanitized + html.slice(jsonEnd), "utf-8");

const kb = (readFileSync(indexPath).length / 1024).toFixed(0);
console.log(`已写出 ${indexPath}(${kb} KB, ${data.rows.length} 行, ${data.resultCount} eval)+ ${siteDir}/artifact/`);
