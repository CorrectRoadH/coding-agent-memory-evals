#!/usr/bin/env bash
# Runs just the close-and-delay-behavior suite that the hidden-test injection overwrote
# at src/test/tooltip-close-and-delay-behavior.spec.js, scoped to that single file so
# the rest of the (much larger) react-tooltip suite doesn't add noise/time to grading.
set -euo pipefail

npx jest src/test/tooltip-close-and-delay-behavior.spec.js
