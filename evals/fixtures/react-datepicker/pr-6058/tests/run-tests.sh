#!/usr/bin/env bash
# 只跑这个修复对应的两个行为测试(按测试名精确 scope),不跑整份 datepicker_test.test.tsx——
# 该文件在这个历史 commit 上还带着一个与本 issue 无关、后来才修好的 selectsRange/
# null-startDate flaky 测试,整档跑会污染 RED/GREEN 判读。
#
# 断言只看用户可见行为(哪个可见面板渲染了目标月份,通过 .react-datepicker__month 的
# aria-label 读取),不碰组件内部 state 字段名,以免把上游的实现方式当成通过条件。
set -euo pipefail

NODE_ENV=test node_modules/.bin/jest --no-coverage \
  -t "should display the target month in the leftmost panel after a day was selected in the second panel|should keep the target month in the leftmost panel on repeated changeMonth calls" \
  src/test/datepicker_test.test.tsx
