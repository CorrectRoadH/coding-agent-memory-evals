#!/usr/bin/env bash
# Runs just the Thumbnails plugin unit test that the hidden-test injection overwrote at
# test/unit/plugins/Thumbnails.spec.ts, scoped to that single file so the rest of the
# (much larger) yet-another-react-lightbox suite doesn't add noise/time to grading.
set -euo pipefail

npx vitest run test/unit/plugins/Thumbnails.spec.ts
