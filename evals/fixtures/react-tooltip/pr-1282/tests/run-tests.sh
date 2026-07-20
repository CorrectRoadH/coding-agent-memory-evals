#!/usr/bin/env bash
# Runs just the anchor-selection suite that the hidden-test injection overwrote at
# src/test/tooltip-anchor-selection.spec.js, scoped to that single file so the rest of
# the (much larger) react-tooltip suite doesn't add noise/time to grading.
set -euo pipefail

npx jest src/test/tooltip-anchor-selection.spec.js
