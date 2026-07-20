#!/usr/bin/env bash
# Runs just the two getItemProps unit-test files that the hidden-test injection
# overwrote (useCombobox and useSelect), scoped so the rest of the (much larger)
# downshift suite doesn't add noise/time to grading.
set -euo pipefail

npx kcd-scripts test --no-watch \
  src/hooks/useCombobox/__tests__/getItemProps.test.js \
  src/hooks/useSelect/__tests__/getItemProps.test.js
