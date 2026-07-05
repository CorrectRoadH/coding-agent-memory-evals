// 把一份结果快照(site/data/summary.json)构建成可直接静态托管的 site/index.html。
//
// 为什么不直接 `niceeval view --out`:
//   1. niceeval 会给每条 result 注入 artifactAbsBase —— 构建机的绝对路径(/Users/...),
//      直接进了公开 HTML,既泄漏本地路径又毫无用处。
//   2. transcript / timing-trace 展开块靠 `/artifact?p=` 这个 dev server 端点取数据;
//      Vercel 纯静态托管没有这个端点,展开只会 404。
//   这里在生成后把这些「仅 server 端有意义」的字段剥掉:报告自包含、无泄漏、无死链。
//
// 数据来源刻意用提交进仓库的 site/data/summary.json,而不是 .gitignore 掉的 .niceeval/。
// 否则换台机器 / CI 上 .niceeval 不存在,会悄悄生成「空报告」覆盖掉线上数据 —— 这正是本次的 bug。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = resolve(repoRoot, process.argv[2] ?? "site/data/summary.json");
const out = resolve(repoRoot, process.argv[3] ?? "site/index.html");
const niceevalBin = resolve(repoRoot, "node_modules/niceeval/bin/niceeval.js");

const tmp = join(mkdtempSync(join(tmpdir(), "niceeval-site-")), "report.html");
execFileSync("node", [niceevalBin, "view", "--out", tmp, snapshot], { stdio: "inherit" });

const html = readFileSync(tmp, "utf-8");
const marker = "window.__NICEEVAL_VIEW_DATA__ = ";
const dataStart = html.indexOf(marker);
if (dataStart === -1) throw new Error("找不到 __NICEEVAL_VIEW_DATA__ 标记,niceeval 模板可能变了");
const jsonStart = dataStart + marker.length;
const jsonEnd = html.indexOf(";</script>", jsonStart);
if (jsonEnd === -1) throw new Error("找不到内嵌数据的结束符");

const data = JSON.parse(html.slice(jsonStart, jsonEnd));
for (const row of data.rows ?? []) {
  for (const r of row.results ?? []) {
    delete r.artifactAbsBase; // 构建机绝对路径,泄漏 + 无用
    delete r.artifactBase; // 指向静态托管不存在的 /artifact 端点
    r.hasTrace = false; // 没有 artifactBase 时前端不再渲染会 404 的展开块
    r.hasEvents = false;
  }
}

if (!Array.isArray(data.rows) || data.rows.length === 0) {
  throw new Error(`快照 ${snapshot} 聚合出 0 行,拒绝生成空报告`);
}

// error / assertions[].detail 里可能带 evaluation 失败时的 stack trace,其中的绝对路径
// 也是构建机本地路径泄漏(和 artifactAbsBase 同类问题),裁掉 repoRoot 前缀但保留栈信息本身。
const repoRootPattern = new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?", "g");

// 模板用 JSON.stringify(data).replace(/</g, "\\u003c") 内嵌,这里复刻同样的转义。
const sanitized = JSON.stringify(data).replace(repoRootPattern, "").replace(/</g, "\\u003c");
writeFileSync(out, html.slice(0, jsonStart) + sanitized + html.slice(jsonEnd), "utf-8");

const kb = (readFileSync(out).length / 1024).toFixed(0);
console.log(`已写出 ${out}(${kb} KB, ${data.rows.length} 行, ${data.resultCount} eval)`);
