#!/usr/bin/env bash
# Runs just the placement-class spec that the hidden-test injection wrote at
# src/test/tooltip-place-class.spec.js, scoped to that single file so the rest of the
# (much larger) react-tooltip suite doesn't add noise/time to grading.
#
# 断言只看渲染出来的 DOM(消费者写 placement-specific CSS 时真正选中的东西),
# 不断言 computeTooltipPosition 等内部函数的返回形状,以免把上游的实现方式
# 当成通过条件。
set -euo pipefail

node_modules/.bin/jest src/test/tooltip-place-class.spec.js
