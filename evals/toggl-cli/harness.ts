// Shared plumbing for the toggl-cli chain. Not an eval file (no `.eval.ts` suffix), so
// the runner ignores it during discovery.
//
// Every eval in this folder starts from the SAME base commit of the real repository —
// none of them builds on the code an earlier eval produced. That is deliberate: the only
// thing that carries over between evals is what was said in the conversation (naming,
// output style, defaults, rejected options), so a memory-equipped agent has an edge and a
// memory-less one has nothing in the checkout to reverse-engineer it from.

import { readFile } from "node:fs/promises";

import { commandSucceeded } from "niceeval/expect";
import type { TestContext } from "niceeval";
// Sandbox / SandboxHookContext (the two arguments eval.setup receives) are not re-exported
// from the package root — only the narrower SandboxHandle is — so they come from the
// sandbox subpath. Candidate upstream FR: export them where `setup` is declared.
import type { Sandbox, SandboxHookContext } from "niceeval/sandbox";

const REPO_URL = "https://github.com/CorrectRoadH/toggl-cli.git";

/** toggl-cli @ 8646f29 — the tip at the time these evals were written. */
export const BASE_COMMIT = "8646f29c87242b06eab974793a999d35b5a85b5e";

/** Today in UTC (YYYY-MM-DD). The probe pins TZ=UTC so the CLI agrees with us. */
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * eval.setup: system packages + Rust toolchain, installed as root so they land outside
 * the working copy and never show up in the agent diff.
 *
 * `keyring` needs libdbus, `reqwest`/`openssl-sys` need libssl + pkg-config (documented in
 * the repo's own AGENTS.md). The toolchain goes to /usr/local/{rustup,cargo} rather than a
 * user home so that every shell the agent opens — and the grading shell — sees the same
 * cargo, regardless of whether it is a login shell that sources ~/.profile.
 */
export const installRustToolchain = async (sandbox: Sandbox, ctx: SandboxHookContext) => {
  ctx.progress({ message: "installing build deps + rust toolchain" });
  const script = [
    "set -euo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "if command -v apt-get >/dev/null 2>&1; then",
    "  apt-get update -qq",
    "  apt-get install -y -qq --no-install-recommends pkg-config libssl-dev libdbus-1-dev build-essential curl ca-certificates >/dev/null",
    "fi",
    "if ! command -v cargo >/dev/null 2>&1 && [ ! -x /usr/local/cargo/bin/cargo ]; then",
    "  export RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo",
    // profile=default matches the repo's rust-toolchain.toml, so `cargo fmt` and
    // `cargo clippy` (which AGENTS.md tells the agent to run) are actually present.
    "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile default --default-toolchain stable --no-modify-path >/dev/null",
    "  chmod -R a+rwX /usr/local/rustup /usr/local/cargo",
    "fi",
    'CARGO_BIN_DIR="$(dirname "$(command -v cargo || echo /usr/local/cargo/bin/cargo)")"',
    "for tool in cargo rustc rustup rustfmt cargo-fmt cargo-clippy clippy-driver; do",
    '  [ -x "$CARGO_BIN_DIR/$tool" ] && ln -sf "$CARGO_BIN_DIR/$tool" /usr/local/bin/$tool',
    "done",
    "printf 'export PATH=\"%s:$PATH\"\\n' \"$CARGO_BIN_DIR\" > /etc/profile.d/rust.sh",
    "chmod +x /etc/profile.d/rust.sh",
    // Keep cargo's build directory OUT of the working copy. A debug build of this crate is
    // ~1GB, and leaving it under the workdir made the post-run diff capture flaky (attempts
    // died with "capturing diff · fetch failed"). A cargo config file is used rather than an
    // env var so it applies to every cargo invocation — ours and the agent's — regardless of
    // whether that shell sourced /etc/profile.d.
    "mkdir -p /tmp/cargo-target && chmod 1777 /tmp/cargo-target",
    'for home in /root /home/*; do',
    '  [ -d "$home" ] || continue',
    '  mkdir -p "$home/.cargo"',
    "  printf '[build]\\ntarget-dir = \"/tmp/cargo-target\"\\n' > \"$home/.cargo/config.toml\"",
    '  chmod -R a+rwX "$home/.cargo" 2>/dev/null || true',
    "done",
    'if [ -n "${CARGO_HOME:-}" ] || [ -d /usr/local/cargo ]; then',
    "  printf '[build]\\ntarget-dir = \"/tmp/cargo-target\"\\n' > \"${CARGO_HOME:-/usr/local/cargo}/config.toml\"",
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
 * Clone the real repository at BASE_COMMIT into the workdir root and warm the build cache.
 *
 * The checkout has to sit at the workdir root: a nested subdirectory is recorded as a
 * gitlink by the diff ledger and the agent's changes disappear from the evidence.
 * History after the base commit is erased (remote/tags/reflog) so the agent cannot read
 * the future of the project out of its own checkout.
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
      // same self-check the other real-repo evals use: nothing after the base commit is visible
      `TS=$(git show -s --format=%ci ${BASE_COMMIT})`,
      'COUNT=$(git log --oneline --since="$TS" | wc -l)',
      '[ "$COUNT" -eq 1 ]',
    ].join("\n"),
  );
  if (cloned.exitCode !== 0) {
    throw new Error(`toggl-cli checkout failed: ${(cloned.stderr || cloned.stdout).trim().slice(-500)}`);
  }

  // Warm the dependency build once, up front. Without it the agent pays a multi-minute
  // cold `cargo build` out of its own time budget — a difference between memory conditions
  // that has nothing to do with memory.
  t.progress({ message: "warming cargo build cache (cold dependency build)" });
  const built = await t.sandbox.runShell(
    ['export PATH="/usr/local/cargo/bin:$PATH"', "cargo build --tests --quiet"].join("\n"),
  );
  if (built.exitCode !== 0) {
    throw new Error(`baseline cargo build failed: ${(built.stderr || built.stdout).trim().slice(-800)}`);
  }
};

/** One fake-API window: entries served when the request path contains `contains`. */
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
  /** null when the invocation timed out. */
  exit: number | null;
  stdout: string;
  stderr: string;
  /** Non-empty stdout lines with runs of whitespace collapsed to one space. */
  lines: string[];
  /** API paths the CLI requested during this case, query string included. */
  requests: string[];
}

/**
 * Build the agent's code, run every planned CLI invocation against a throwaway HTTP stub,
 * and hand back what each one did. Assertions stay in the eval file — one per agreed
 * convention — so a failing run shows which convention was missed, not just "tests failed".
 *
 * Gated: if the crate does not build, or the probe cannot run, the eval stops here.
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
  // Belt and braces alongside the cargo target-dir redirect in setup: if anything did land
  // in a workdir-local target/, drop it before niceeval walks the tree for the diff.
  await t.sandbox.runShell("rm -rf target");
  await t.require(probe, commandSucceeded());

  const parsed = JSON.parse(probe.stdout) as { cases: ProbeCase[] };
  return Object.fromEntries(parsed.cases.map((probeCase) => [probeCase.name, probeCase]));
};
