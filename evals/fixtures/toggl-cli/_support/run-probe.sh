#!/usr/bin/env bash
# Build whatever the agent left behind, then drive the binary through the probe.
# stdout must stay a single JSON document — everything else is routed to stderr.
set -euo pipefail

export PATH="/usr/local/cargo/bin:$HOME/.cargo/bin:$PATH"

cargo build --quiet >&2

exec python3 tests/probe.py --plan tests/probe-plan.json --bin "$PWD/target/debug/toggl"
