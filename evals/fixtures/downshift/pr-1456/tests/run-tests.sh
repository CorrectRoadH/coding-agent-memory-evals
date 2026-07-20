#!/usr/bin/env bash
# Runs just the useSelect toggle-button unit tests that the hidden-test injection
# overwrote at src/hooks/useSelect/__tests__/getToggleButtonProps.test.js, scoped to
# that single file so the rest of the (much larger) downshift suite doesn't add
# noise/time to grading.
set -euo pipefail

npx kcd-scripts test --no-watch \
  src/hooks/useSelect/__tests__/getToggleButtonProps.test.js
