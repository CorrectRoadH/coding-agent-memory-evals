import { defaultBuildLogger, Template } from "e2b";
import { MEMPAL_VERSION, mempalBaseTemplate, mempalTemplate } from "../experiments/shared/mempal.ts";

// 本仓库唯一需要自建的 E2B 模板。基底是 NiceEval 的 release-pinned 公共 Agent 模板
// (CLI 已烘焙),这里在构建期补两样每个 attempt 都相同、稳定、体积大的东西:
//   1. mempal 二进制 —— 直接 `cargo install`(crates.io 官方源)。在 base 模板里编译,
//      glibc ABI 与运行时天然一致,不再需要 host 侧 docker 交叉编译对 ABI。
//   2. embedding 模型 cache —— 跑一次 warmup ingest,让 mempal 自己从 HuggingFace 官方拉
//      model2vec 模型(minishlab/potion-multilingual-128M ≈507 MB)灌进 ~/.cache/huggingface,
//      烘焙进镜像;运行时命中 cache、零下载。
//
// 【为什么可以构建期现下,不再 host 预取】旧方案的前提「HF xet CDN 对 E2B 恒 403」已被实测
// 推翻:那是旧 mempal/hf-hub 的下载器不发 xet 预签名 URL 要的 Range 头(客户端 bug)。当前
// mempal 0.9.0(model2vec-rs 0.1.4 → 新 hf-hub)在 E2B 里 ingest 直接成功、cache 落到
// ~/.cache/huggingface;裸 `curl -L` 该模型在 E2B 也是 200。所以整套 host docker 交叉编译 +
// 64 MB 分片 + `.copy` 重组的 workaround 全部删掉,输入全来自官方源(crates.io / HF)。
const agent = process.argv[2];
if (agent !== "claude" && agent !== "codex") {
  throw new Error("Usage: pnpm template:mempal <claude|codex>");
}
const baseTemplate = mempalBaseTemplate(agent);
const templateName = mempalTemplate(agent);

const template = Template()
  .fromTemplate(baseTemplate)
  // 1. cargo install mempal(root)。装完把二进制挪到 /usr/local/bin,再删掉 rustup
  //    toolchain 和 cargo registry —— 编译副产物有 GB 级,不该留在镜像里。
  .runCmd(
    "set -euo pipefail; " +
      "export CARGO_HOME=/root/.cargo RUSTUP_HOME=/root/.rustup; " +
      "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable; " +
      '. "$CARGO_HOME/env"; ' +
      `cargo install mempal --version ${MEMPAL_VERSION} --locked; ` +
      "install -m 0755 /root/.cargo/bin/mempal /usr/local/bin/mempal; " +
      "rm -rf /root/.rustup /root/.cargo; " +
      "mempal --help >/dev/null",
    { user: "root" },
  )
  // 2. warmup ingest(user):触发 mempal 从 HF 官方拉模型,把 cache 烘焙进 /home/user/.cache
  //    ——运行时 HOME 也是这里,attempt 命中即用。warmup 库本身删掉:每个 attempt 从空库起步,
  //    记忆只来自 mempalSetup 恢复的状态。
  .runCmd(
    "set -euo pipefail; " +
      'rm -rf /tmp/mempal-template-warm "$HOME/.mempal"; ' +
      "mkdir -p /tmp/mempal-template-warm; " +
      "printf '%s\\n' 'niceeval template warmup' >/tmp/mempal-template-warm/warmup.md; " +
      "mempal init /tmp/mempal-template-warm; " +
      "mempal ingest /tmp/mempal-template-warm --wing niceeval-template; " +
      // 不用 `... | grep -q`，避免 grep 提前关管道令 Rust stdout 吃 SIGPIPE。
      "out=$(mempal search 'niceeval template warmup' --json); " +
      "case \"$out\" in *'niceeval template warmup'*) ;; *) echo \"$out\" >&2; exit 1 ;; esac; " +
      // 自检:cache 已落盘就该有模型文件;没有就是没烘上,构建当场失败。
      'test -n "$(find "$HOME/.cache/huggingface" -name "*.safetensors" 2>/dev/null | head -1)"; ' +
      'rm -rf /tmp/mempal-template-warm "$HOME/.mempal"',
    { user: "user" },
  );

const built = await Template.build(template, templateName, {
  cpuCount: 4,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
});

console.log(
  `Built ${built.name} (${built.templateId}) from ${baseTemplate} with mempal ${MEMPAL_VERSION}; ` +
    `use e2bSandbox({ template: ${JSON.stringify(templateName)} }).`,
);
