#!/usr/bin/env bash
# Runs just the useCombobox getItemProps unit-test file that the hidden-test injection
# overwrote, scoped so the rest of the (much larger) downshift suite doesn't add noise/time
# to grading.
set -euo pipefail

npx kcd-scripts test --no-watch src/hooks/useCombobox/__tests__/getItemProps.test.js
