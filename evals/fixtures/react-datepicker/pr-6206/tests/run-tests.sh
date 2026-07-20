#!/usr/bin/env bash
# Pin TZ=UTC for a stable baseline closest to upstream CI (verified locally to also
# be robust under TZ=Asia/Shanghai, but standardize on UTC regardless).
set -euo pipefail
export TZ=UTC

node_modules/.bin/jest src/test/timezone_test.test.tsx
