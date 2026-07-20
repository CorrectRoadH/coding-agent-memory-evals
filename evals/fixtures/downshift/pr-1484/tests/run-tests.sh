#!/usr/bin/env bash
# Runs just the useCombobox getInputProps unit tests that the hidden-test injection
# overwrote at src/hooks/useCombobox/__tests__/getInputProps.test.js, scoped to that
# single file so the rest of the (much larger) downshift suite doesn't add noise/time
# to grading.
set -euo pipefail

npx kcd-scripts test --no-watch src/hooks/useCombobox/__tests__/getInputProps.test.js
