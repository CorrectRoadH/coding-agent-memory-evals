#!/usr/bin/env bash
# Runs just the useMultipleSelection unit tests that the hidden-test injection
# overwrote at src/hooks/useMultipleSelection/__tests__/{getSelectedItemProps,props}.test.js,
# scoped to those two files so the rest of the (much larger) downshift suite doesn't
# add noise/time to grading.
set -euo pipefail

npx kcd-scripts test --no-watch \
  src/hooks/useMultipleSelection/__tests__/getSelectedItemProps.test.js \
  src/hooks/useMultipleSelection/__tests__/props.test.js
