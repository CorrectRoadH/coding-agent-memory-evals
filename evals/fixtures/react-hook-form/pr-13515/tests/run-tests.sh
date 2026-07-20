#!/usr/bin/env bash
# Runs the hidden-test injection that the eval overwrote at
# src/__tests__/utils/deepEqual.test.ts and src/__tests__/useForm.test.tsx.
#
# deepEqual.test.ts runs IN FULL (not scoped by test name): it's the file
# that also contains the pre-existing circular-reference regression test.
# A cheat fix that just deletes the visited-object tracking entirely (instead
# of fixing it to track pairs) passes the new "reuses an object reference"
# assertions just fine but blows the stack on that circular test — so the
# full file, not just the new test, is what actually rejects that cheat.
#
# useForm.test.tsx is scoped by test name to just the new regression test:
# the file is 3000+ lines and running it unscoped would add a lot of
# unrelated time/noise without adding any extra rejection power (nothing in
# the rest of that file exercises deepEqual's circular-reference guard).
set -euo pipefail

node_modules/.bin/jest --config ./scripts/jest/jest.config.js src/__tests__/utils/deepEqual.test.ts
node_modules/.bin/jest --config ./scripts/jest/jest.config.js src/__tests__/useForm.test.tsx -t "rerendered values reuse an object reference"
