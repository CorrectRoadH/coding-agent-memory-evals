#!/usr/bin/env bash
# Build whatever the agent left behind, then drive the binary through the probe.
# stdout must stay a single JSON document — everything else is routed to stderr.
set -euo pipefail

export PATH="/usr/local/cargo/bin:$HOME/.cargo/bin:$PATH"

cargo build --quiet >&2

# Ask cargo where it actually put the binary instead of assuming ./target: setup points
# build.target-dir outside the working copy so the ~1GB build tree cannot wreck the
# post-run diff capture.
TARGET_DIR="$(cargo metadata --no-deps --format-version 1 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])' 2>/dev/null || true)"
[ -n "${TARGET_DIR:-}" ] || TARGET_DIR="$PWD/target"

exec python3 tests/probe.py --plan tests/probe-plan.json --bin "$TARGET_DIR/debug/toggl"
