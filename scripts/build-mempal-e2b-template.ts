import { defaultBuildLogger, Template } from "e2b";
import { MEMPAL_VERSION, mempalBaseTemplate, mempalTemplate } from "../experiments/shared/mempal.ts";

// 本仓库唯一需要自建的 E2B 模板。基底是 NiceEval 的 release-pinned 公共 Agent 模板
// (CLI 已烘焙),构建期补两样每个 attempt 都相同、稳定、体积大的东西:mempal 二进制
// 和 embedding 模型 cache。构建步骤本体在 scripts/mempal-template/ 的两个 .sh 里,
// 输入全来自官方源(crates.io / HuggingFace),不做 host 侧预取——HF 直下在 E2B 可行,
// 早年的 403 是旧 hf-hub 客户端不发 Range 头的 bug,mempal 0.9.0 已带修复版。
const agent = process.argv[2];
if (agent !== "claude" && agent !== "codex") {
  throw new Error("Usage: pnpm template:mempal <claude|codex>");
}
const baseTemplate = mempalBaseTemplate(agent);
const templateName = mempalTemplate(agent);

const BUILD_DIR = "/opt/mempal-template-build";

const template = Template({ fileContextPath: import.meta.dirname })
  .fromTemplate(baseTemplate)
  .copy(
    ["mempal-template/install-mempal.sh", "mempal-template/warmup-model-cache.sh"],
    `${BUILD_DIR}/`,
    { user: "root", mode: 0o755 },
  )
  .runCmd(`bash ${BUILD_DIR}/install-mempal.sh ${MEMPAL_VERSION}`, { user: "root" })
  .runCmd(`bash ${BUILD_DIR}/warmup-model-cache.sh`, { user: "user" })
  .remove(BUILD_DIR, { recursive: true, force: true, user: "root" });

const built = await Template.build(template, templateName, {
  cpuCount: 4,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
});

console.log(
  `Built ${built.name} (${built.templateId}) from ${baseTemplate} with mempal ${MEMPAL_VERSION}; ` +
    `use e2bSandbox({ template: ${JSON.stringify(templateName)} }).`,
);
