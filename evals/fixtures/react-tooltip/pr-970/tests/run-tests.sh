#!/usr/bin/env bash
# Runs just the utils spec that the hidden-test injection overwrote at
# src/test/utils.spec.js, scoped to that single file so the rest of the
# (much larger) react-tooltip suite doesn't add noise/time to grading.
set -euo pipefail

node_modules/.bin/jest src/test/utils.spec.js
