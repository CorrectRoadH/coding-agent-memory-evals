#!/usr/bin/env bash
# 只跑这个修复新增的两个测试(按测试名精确 scope),不跑整份 datepicker_test.test.tsx——
# 该文件在这个历史 commit 上还带着一个与本 issue 无关、后来才修好的 selectsRange/
# null-startDate flaky 测试,整档跑会污染 RED/GREEN 判读。
set -euo pipefail

NODE_ENV=test node_modules/.bin/jest --no-coverage \
  -t "should display the target month in the leftmost position when changeMonth is called with monthsShown|should reset monthSelectedIn to 0 when changeMonth is called from custom header" \
  src/test/calendar_test.test.tsx src/test/datepicker_test.test.tsx
