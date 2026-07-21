#!/usr/bin/env bash
# Runs just the day unit test file that the hidden-test injection overwrote at
# src/test/day_test.test.tsx, scoped to that single file so the rest of the (much larger)
# react-datepicker suite doesn't add noise/time to grading. This test is calendar-grid
# positional (not time-of-day sensitive), so no TZ pinning is required.
set -euo pipefail

node_modules/.bin/jest src/test/day_test.test.tsx
