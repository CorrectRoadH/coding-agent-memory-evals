#!/usr/bin/env bash
# Runs just the props tests that the hidden-test injection overwrote at
# src/hooks/useCombobox/__tests__/props.test.js and
# src/hooks/useSelect/__tests__/props.test.js, scoped to those two files so the
# rest of the (much larger) downshift suite doesn't add noise/time to grading.
set -euo pipefail

npx kcd-scripts test --no-watch src/hooks/useCombobox/__tests__/props.test.js src/hooks/useSelect/__tests__/props.test.js
