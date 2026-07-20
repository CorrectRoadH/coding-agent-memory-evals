#!/usr/bin/env bash
# Scoped jest run for the react-hook-form pr-13603 eval. The hidden test file
# has already been written to its real repo path (src/__tests__/useController.test.tsx)
# by the time this runs; deps were installed during eval setup via
# `corepack enable && CYPRESS_INSTALL_BINARY=0 pnpm install --no-frozen-lockfile`.
set -euo pipefail

node_modules/.bin/jest --config ./scripts/jest/jest.config.js src/__tests__/useController.test.tsx
