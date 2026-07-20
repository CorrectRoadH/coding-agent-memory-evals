#!/usr/bin/env bash
# Runs just the flatten() unit test that the hidden-test injection overwrote at
# src/__tests__/utils/flatten.test.ts, scoped to that single file so the rest of
# the (much larger) react-hook-form suite doesn't add noise/time to grading.
set -euo pipefail

node_modules/.bin/jest --config ./scripts/jest/jest.config.js src/__tests__/utils/flatten.test.ts
