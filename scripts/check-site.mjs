// 校验提交进仓库的 site/index.html 是「带数据的报告」,而不是空报告 / 泄漏本地路径。
// 供 CI(.github/workflows/site.yml)调用,也可本地 `node scripts/check-site.mjs` 自查。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(repoRoot, "site/index.html");

const html = readFileSync(file, "utf-8");
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (html.includes("/Users/") || html.includes("/home/runner/")) {
  fail("site/index.html 内嵌了构建机的绝对路径(本地路径泄漏)");
}

const marker = "window.__FASTEVAL_VIEW_DATA__ = ";
const start = html.indexOf(marker);
if (start === -1) fail("找不到 __FASTEVAL_VIEW_DATA__,site/index.html 不是 fasteval 生成的报告");
const jsonStart = start + marker.length;
const jsonEnd = html.indexOf(";</script>", jsonStart);
if (jsonEnd === -1) fail("内嵌数据没有结束符,site/index.html 可能损坏");

let data;
try {
  data = JSON.parse(html.slice(jsonStart, jsonEnd));
} catch (e) {
  fail(`内嵌数据不是合法 JSON:${e.message}`);
}

if (!Array.isArray(data.rows) || data.rows.length === 0) {
  fail('内嵌数据为空("rows":[]) —— 这是空报告,先 `npm run snapshot && npm run report`');
}
if (!data.resultCount || Number(data.resultCount) === 0) {
  fail("eval 结果数为 0,空报告");
}

console.log(`✓ site/index.html 正常:${data.rows.length} 行 / ${data.resultCount} eval / 通过率 ${data.passRate}`);
