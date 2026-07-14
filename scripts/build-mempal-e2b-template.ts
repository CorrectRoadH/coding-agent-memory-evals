import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultBuildLogger, Template } from "e2b";
import { NICEEVAL_PUBLIC_E2B_TEMPLATES } from "niceeval/sandbox/e2b-template";
import { NICEEVAL_E2B_RELEASE } from "../experiments/shared/e2b-templates.ts";
import { mempalTemplate } from "../experiments/shared/mempal.ts";

// 本仓库唯一需要自建的 E2B 模板。基底是 NiceEval 的 release-pinned 公共 Agent 模板
// (CLI 已烘焙),这里只补 mempal 二进制 + 预热 embedding cache —— 两者稳定、体积大、
// 每个 attempt 都相同,正好属于该进模板而不该留在 .setup() 里的东西。
const projectRoot = resolve(import.meta.dirname, "..");
const binary = ".cache/mempal/mempal";
const partsDir = ".cache/mempal/hf-cache-parts";
const agent = process.argv[2];
if (agent !== "claude" && agent !== "codex") {
  throw new Error("Usage: pnpm template:mempal <claude|codex>");
}
const base = agent === "claude" ? NICEEVAL_PUBLIC_E2B_TEMPLATES["claude-code"] : NICEEVAL_PUBLIC_E2B_TEMPLATES.codex;
const baseTemplate = `${base}:${NICEEVAL_E2B_RELEASE}`;
const templateName = mempalTemplate(agent);

await access(resolve(projectRoot, binary)).catch(() => {
  throw new Error(`Missing ${binary}. Run \`bash scripts/build-mempal-linux.sh\` before building the E2B template.`);
});
const parts = (await readdir(resolve(projectRoot, partsDir)).catch(() => [])).filter((f) => f.startsWith("hf-cache.part-")).sort();
if (parts.length === 0) {
  throw new Error(`No model cache parts in ${partsDir}. Run \`bash scripts/build-mempal-linux.sh\` first.`);
}

// 模型 cache 是 host 预取的(E2B 里下不到,见 build-mempal-linux.sh),而 E2B SDK 会把每个
// copy 的文件整个读进内存再 PUT —— 单文件 484 MB 必 `fetch failed`,所以按 64 MB 分片逐个
// 上传、在模板里 cat 回来。
let template = Template({ fileContextPath: projectRoot, fileIgnorePatterns: [".git", "node_modules", ".niceeval"] })
  .fromTemplate(baseTemplate)
  .copy(binary, "/usr/local/bin/mempal", { user: "root", mode: 0o755, forceUpload: true });
// 分片不加 forceUpload:E2B 按内容 hash 存文件,第二个模板(以及上传失败后的重试)直接复用
// 已上传的分片,不必再传一遍 462 MB。
for (const part of parts) {
  template = template.copy(`${partsDir}/${part}`, `/tmp/hf-parts/${part}`, { user: "user" });
}
template = template
  .runCmd(
    "set -euo pipefail; " +
      "mkdir -p \"$HOME/.cache\"; " +
      "cat /tmp/hf-parts/hf-cache.part-* | tar -xz -C \"$HOME/.cache\"; " +
      // 自检:真跑一次 ingest。命中预取的 cache 就不该碰网络;碰了就会 403,构建当场失败。
      "rm -rf /tmp/mempal-template-warm \"$HOME/.mempal\"; " +
      "mkdir -p /tmp/mempal-template-warm; " +
      "printf '%s\\n' 'niceeval template warmup' >/tmp/mempal-template-warm/warmup.md; " +
      "mempal init /tmp/mempal-template-warm; " +
      "mempal ingest /tmp/mempal-template-warm --wing niceeval-template; " +
      // warmup 库本身不留下:每个 attempt 从空库起步,记忆只来自 mempalSetup 恢复的状态。
      "rm -rf /tmp/mempal-template-warm \"$HOME/.mempal\"",
    { user: "user" },
  )
  // 分片是 root 属主(copy 的 user 选项管不到 /tmp 里的文件属主),user 删不掉,单独用 root 清。
  .runCmd("rm -rf /tmp/hf-parts", { user: "root" });

const built = await Template.build(template, templateName, {
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
});

console.log(
  `Built ${built.name} (${built.templateId}) from ${baseTemplate}; ` +
    `use e2bSandbox({ template: ${JSON.stringify(templateName)} }).`,
);
