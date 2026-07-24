// toggl-cli 链的共享底座。不是 eval 文件(没有 `.eval.ts` 后缀),所以 runner 发现阶段会忽略它。
//
// 本文件夹里每道 eval 都从同一个 base commit clone 真实仓库——谁也不建立在前一道的产出之上,
// 所以跨 eval 传递的只有对话里说过的话(命名、输出风格、计费口径、被否掉的选项)。每道题各自
// 建立与复用了哪些约定,见各 eval 文件头。

import { readFile } from "node:fs/promises";

import { commandSucceeded } from "niceeval/expect";
import type { TestContext } from "niceeval";
// Sandbox / SandboxHookContext(eval.setup 收到的两个参数)不从包根导出——包根只导出了更窄的
// SandboxHandle,所以它们要从 sandbox 子路径拿。候选上游 FR:在 `setup` 声明的地方也导出它们。
import type { Sandbox, SandboxHookContext } from "niceeval/sandbox";

const REPO_URL = "https://github.com/CorrectRoadH/toggl-cli.git";

/** toggl-cli @ 8646f29 —— 写这些 eval 时的仓库 tip。 */
export const BASE_COMMIT = "8646f29c87242b06eab974793a999d35b5a85b5e";

/** UTC 当天(YYYY-MM-DD)。探针把 TZ 钉成 UTC,好让 CLI 跟我们对齐。 */
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * eval.setup:系统包 + Rust 工具链,以 root 装,好让它们落在工作副本之外、永不进 agent diff。
 *
 * `keyring` 需要 libdbus,`reqwest`/`openssl-sys` 需要 libssl + pkg-config(仓库自己的 AGENTS.md
 * 里有记)。工具链装到 /usr/local/{rustup,cargo} 而不是某个用户 home,这样 agent 开的每个 shell、
 * 以及判分用的 shell,看到的都是同一个 cargo,不管它是不是 source 过 ~/.profile 的登录 shell。
 */
export const installRustToolchain = async (sandbox: Sandbox, ctx: SandboxHookContext) => {
  ctx.progress({ message: "installing build deps + rust toolchain" });
  const script = [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "if command -v apt-get >/dev/null 2>&1; then",
    "  apt-get update -qq",
    "  apt-get install -y -qq --no-install-recommends pkg-config libssl-dev libdbus-1-dev build-essential curl ca-certificates >/dev/null",
    // 回收 apt 包列表:有 attempt 中途死于一句光秃秃的 "terminated",最可能的解读是沙箱空间耗尽,
    // 所以每一百 MB 都值得抠。
    "  apt-get clean && rm -rf /var/lib/apt/lists/*",
    "fi",
    "if ! command -v cargo >/dev/null 2>&1 && [ ! -x /usr/local/cargo/bin/cargo ]; then",
    "  export RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo",
    // profile=default 与仓库的 rust-toolchain.toml 一致,这样 `cargo fmt` 和 `cargo clippy`
    // (AGENTS.md 让 agent 跑的)才真的存在。
    "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile default --default-toolchain stable --no-modify-path >/dev/null",
    "  chmod -R a+rwX /usr/local/rustup /usr/local/cargo",
    "fi",
    'CARGO_BIN_DIR="$(dirname "$(command -v cargo || echo /usr/local/cargo/bin/cargo)")"',
    "for tool in cargo rustc rustup rustfmt cargo-fmt cargo-clippy clippy-driver; do",
    '  [ -x "$CARGO_BIN_DIR/$tool" ] && ln -sf "$CARGO_BIN_DIR/$tool" /usr/local/bin/$tool',
    "done",
    "printf 'export PATH=\"%s:$PATH\"\\n' \"$CARGO_BIN_DIR\" > /etc/profile.d/rust.sh",
    "chmod +x /etc/profile.d/rust.sh",
    // 让 cargo 的构建目录留在工作副本之外。这个 crate 的 debug build 约 1GB,留在 workdir 下面会
    // 让收尾抓 diff 的阶段变得不稳(attempt 死于 "capturing diff · fetch failed" 和
    // "export agent windows failed")。放 /opt 而不是 /tmp 是刻意的:若沙箱把 /tmp 挂成 tmpfs,
    // 1GB 构建树会记在内存上、把沙箱 OOM 掉。用配置文件而不是环境变量,好让它对每一次 cargo 调用
    // (我们的和 agent 的)都生效,不管那个 shell 有没有 source 过 /etc/profile.d。
    "mkdir -p /opt/cargo-target && chmod 1777 /opt/cargo-target",
    'for home in /root /home/*; do',
    '  [ -d "$home" ] || continue',
    '  mkdir -p "$home/.cargo"',
    "  printf '[build]\\ntarget-dir = \"/opt/cargo-target\"\\n\\n[profile.dev]\\ndebug = false\\n' > \"$home/.cargo/config.toml\"",
    '  chmod -R a+rwX "$home/.cargo" 2>/dev/null || true',
    "done",
    'if [ -n "${CARGO_HOME:-}" ] || [ -d /usr/local/cargo ]; then',
    "  printf '[build]\\ntarget-dir = \"/opt/cargo-target\"\\n\\n[profile.dev]\\ndebug = false\\n' > \"${CARGO_HOME:-/usr/local/cargo}/config.toml\"",
    "fi",
    "cargo --version",
    "python3 --version",
  ].join("\n");

  const installed = await sandbox.runCommand("bash", ["-lc", script], { root: true });
  if (installed.exitCode !== 0) {
    throw new Error(`rust toolchain setup failed: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
  }
};

/**
 * 把真实仓库在 BASE_COMMIT clone 到 workdir 根目录,并预热构建缓存。
 *
 * checkout 必须落在 workdir 根:嵌套子目录会被 diff 分类账记成 gitlink,agent 的改动就从证据里
 * 消失了。base commit 之后的历史(remote/tags/reflog)全抹掉,这样 agent 没法从自己的 checkout 里
 * 读到这个项目的"未来"。
 */
export const prepareRepo = async (t: TestContext) => {
  t.progress({ message: "cloning toggl-cli @ base commit" });
  const cloned = await t.sandbox.runShell(
    [
      "set -euo pipefail",
      `git clone -q -o origin ${REPO_URL} .toggl-clone`,
      "mv .toggl-clone/.git .git",
      "rm -rf .toggl-clone",
      `git reset -q --hard ${BASE_COMMIT}`,
      "git remote remove origin",
      "git tag -l | xargs -r git tag -d >/dev/null",
      "git reflog expire --expire=now --all",
      "git gc -q --prune=now",
      // 与其它真实仓库 eval 同款的自检:base commit 之后不应有任何东西可见
      `TS=$(git show -s --format=%ci ${BASE_COMMIT})`,
      'COUNT=$(git log --oneline --since="$TS" | wc -l)',
      '[ "$COUNT" -eq 1 ]',
    ].join("\n"),
  );
  if (cloned.exitCode !== 0) {
    throw new Error(`toggl-cli checkout failed: ${(cloned.stderr || cloned.stdout).trim().slice(-500)}`);
  }

  // 预先把依赖构建预热一次。不预热的话,agent 要从自己的时间预算里付一次数分钟的冷 `cargo build`
  // ——那会变成一个与记忆无关的条件间差异。
  t.progress({ message: "warming cargo build cache (cold dependency build)" });
  const built = await t.sandbox.runShell(
    ['export PATH="/usr/local/cargo/bin:$PATH"', "cargo build --tests --quiet"].join("\n"),
  );
  if (built.exitCode !== 0) {
    throw new Error(`baseline cargo build failed: ${(built.stderr || built.stdout).trim().slice(-800)}`);
  }

  // 有 attempt 中途死于一句光秃秃的 "terminated",没有更多线索。把预热之后沙箱还剩多少空间记下来,
  // 下次再出就能坐实(或排除)是空间问题,而不是接着猜。
  const disk = await t.sandbox.runShell(
    "df -Pk / /opt 2>/dev/null | tail -n +2 | awk '{printf \"%s: %s KB free of %s KB; \", $6, $4, $2}'; " +
      "du -sk /opt/cargo-target 2>/dev/null | awk '{printf \"build tree %s KB\", $1}'",
  );
  t.diagnostic({
    code: "sandbox-space-after-warmup",
    level: "warning",
    message: disk.stdout.trim() || "df/du produced no output",
  });
};

/** 一个假 API 窗口:请求路径含 `contains` 时返回 `entries`。 */
export interface ProbeWindow {
  contains: string;
  entries: unknown[];
}

export interface ProbePlan {
  windows?: ProbeWindow[];
  default_entries?: unknown[];
  projects?: unknown[];
  cases: { name: string; args: string[] }[];
}

export interface ProbeCase {
  name: string;
  args: string[];
  /** 命令超时时为 null。 */
  exit: number | null;
  stdout: string;
  stderr: string;
  /** 非空的 stdout 行,连续空白折叠成一个空格。 */
  lines: string[];
  /** 本 case 里 CLI 请求过的 API 路径(含 query string)。 */
  requests: string[];
}

/**
 * 检查 `expected` 这几行是否按顺序出现在某个 case 的 stdout 里。
 *
 * 刻意用「按序子序列」而不是「逐行精确匹配」:标题行、`------` 分隔线、`── 2026-07-23 Thursday ──`
 * 这类分组头,都是实现可以合理添加的东西,跟这些 eval 要考的约定毫无关系。逐行精确匹配曾把一次
 * 渲染完全正确的运行判成失败。仍然抓得住的:时长渲染错、顺序错、缺行、空结果没打 `(no data)`
 * ——因为那些改的是行本身,而不是行周围。
 */
export const orderedLines = (probeCase: ProbeCase, expected: string[]) => {
  let cursor = 0;
  for (const line of probeCase.lines) {
    if (line === expected[cursor]) cursor += 1;
  }
  return {
    ok: cursor === expected.length,
    message:
      `expected these lines, in this order: ${JSON.stringify(expected)}\n` +
      `actual stdout lines: ${JSON.stringify(probeCase.lines)}`,
  };
};

/**
 * 构建 agent 留下的代码,把计划里每条 CLI 调用都对着一个一次性 HTTP stub 跑一遍,把每条干了什么
 * 交回来。断言留在 eval 文件里——一条约定一条——这样失败的运行能显示是哪条约定没做到,而不是
 * 笼统一句"测试失败"。
 *
 * 前置门:crate 编译不过、或探针跑不起来,eval 就在这里停住。
 */
export const runProbe = async (t: TestContext, plan: ProbePlan): Promise<Record<string, ProbeCase>> => {
  const fixture = (path: string) => new URL(`../fixtures/toggl-cli/${path}`, import.meta.url);
  await t.sandbox.writeFiles({
    "tests/probe.py": await readFile(fixture("_support/probe.py"), "utf8"),
    "tests/run-probe.sh": await readFile(fixture("_support/run-probe.sh"), "utf8"),
    "tests/probe-plan.json": JSON.stringify(plan, null, 2),
  });

  t.progress({ message: "building the agent's code and probing the CLI" });
  const probe = await t.sandbox.runShell("bash tests/run-probe.sh");
  // 与 setup 里那个 cargo target-dir 重定向双保险:万一真有东西落进了 workdir 本地的 target/,
  // 在 niceeval 遍历工作树抓 diff 之前先删掉。
  await t.sandbox.runShell("rm -rf target");
  await t.require(probe, commandSucceeded());

  const parsed = JSON.parse(probe.stdout) as { cases: ProbeCase[] };
  return Object.fromEntries(parsed.cases.map((probeCase) => [probeCase.name, probeCase]));
};
