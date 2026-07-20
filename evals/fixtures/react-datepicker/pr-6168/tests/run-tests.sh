#!/usr/bin/env bash
# 隐藏测试(calendar_container.test.tsx 的 post-fix 版本)已由 eval.ts 在 agent 回合结束后
# 写到 src/test/calendar_container.test.tsx,这里只负责跑它。deps 已在 eval setup 阶段
# `yarn install --immutable` 装好,无需再装。
set -euo pipefail

NODE_ENV=test node_modules/.bin/jest src/test/calendar_container.test.tsx
