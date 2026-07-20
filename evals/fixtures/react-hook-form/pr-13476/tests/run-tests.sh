#!/usr/bin/env bash
# Runs the useFieldArray unit test file that the hidden-test injection overwrote at
# src/__tests__/useFieldArray.test.tsx, scoped to that single file so the rest of the
# (much larger) react-hook-form suite doesn't add noise/time to grading.
set -euo pipefail

node_modules/.bin/jest --config ./scripts/jest/jest.config.js src/__tests__/useFieldArray.test.tsx
