import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { codexAgent } from "niceeval/adapter";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import {
  MEMPAL_VERSION,
  mempalFlags,
  mempalSetup,
  mempalSkill,
  mempalTeardown,
} from "../shared/mempal.ts";

// 基准对照:与 codex-gpt-5.4-mini--mempal 唯一的差别是没有预制 Mempal 模板——
// 沙箱从 NiceEval 公共 Codex 模板起步,mempal 二进制(crates.io 源码编译)和
// embedding 模型 cache(~507MB HuggingFace 下载)都在 attempt 的 sandbox.setup 里现做,
// 步骤等价于 scripts/mempal-template/ 两个构建脚本。它存在的目的只是量化
// 「预制模板 vs 运行时安装」在 sandbox.setup 阶段的耗时差,不用于正式比较。
const runtimeInstallMempal = e2bSandbox({ template: NICEEVAL_CODEX_E2B_TEMPLATE })
  .setup(async (sb, ctx) => {
    ctx.progress({ message: `[mempal] runtime install ${MEMPAL_VERSION} (rustup + cargo, no prebuilt template)` });
    const install = await sb.runShell(
      [
        "set -euo pipefail",
        "export CARGO_HOME=/root/.cargo RUSTUP_HOME=/root/.rustup",
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable",
        '. "$CARGO_HOME/env"',
        `cargo install mempal --version ${MEMPAL_VERSION} --locked`,
        "install -m 0755 /root/.cargo/bin/mempal /usr/local/bin/mempal",
        "rm -rf /root/.rustup /root/.cargo",
      ].join(" && "),
      { root: true },
    );
    if (install.exitCode !== 0) {
      throw new Error(`[mempal] runtime install failed (exit ${install.exitCode}): ${install.stderr.trim().slice(-500)}`);
    }
    ctx.progress({ message: "[mempal] warming embedding model cache (~507MB from HuggingFace)" });
    const warmup = await sb.runShell(
      [
        "set -euo pipefail",
        "warm_dir=/tmp/mempal-runtime-warm",
        'rm -rf "$warm_dir" "$HOME/.mempal"',
        'mkdir -p "$warm_dir"',
        `printf '%s\\n' 'niceeval runtime warmup' >"$warm_dir/warmup.md"`,
        'mempal init "$warm_dir"',
        'mempal ingest "$warm_dir" --wing niceeval-runtime',
        'test -n "$(find "$HOME/.cache/huggingface" -name "*.safetensors" 2>/dev/null | head -1)"',
        'rm -rf "$warm_dir" "$HOME/.mempal"',
      ].join(" && "),
    );
    if (warmup.exitCode !== 0) {
      throw new Error(`[mempal] runtime warmup failed (exit ${warmup.exitCode}): ${warmup.stderr.trim().slice(-500)}`);
    }
  })
  .setup(mempalSetup("codex"))
  .teardown(mempalTeardown("codex"));

export default defineExperiment({
  evals: ["memory"],
  description: "codex · gpt-5.4-mini · mempal(dev-e2b:运行时现装,预制模板对照基准)",
  agent: codexAgent({ skills: [mempalSkill] }),
  flags: mempalFlags(),
  model: "gpt-5.4-mini",
  sandbox: runtimeInstallMempal,
  runs: 1,
  earlyExit: true,
  budget: 5,
  maxConcurrency: 1,
  timeoutMs: 2_700_000,
});
