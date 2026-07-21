#!/usr/bin/env bash
# Runs just the interaction-behavior spec that the hidden-test injection overwrote at
# src/test/tooltip-interaction-behavior.spec.js, scoped to that single file so the rest of
# the (much larger) react-tooltip suite doesn't add noise/time to grading.
set -euo pipefail

node_modules/.bin/jest src/test/tooltip-interaction-behavior.spec.js
