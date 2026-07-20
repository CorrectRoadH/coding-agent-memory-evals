#!/usr/bin/env bash
# 隐藏测试(date_utils_test.test.ts 的上游 post-fix 版本)已在 eval.ts 里
# 通过 t.sandbox.writeFiles 落到 src/test/date_utils_test.test.ts,覆盖 agent
# 可能改过的同名文件。这里只需要跑本地已验证过的 scoped jest 调用。
set -euo pipefail

NODE_ENV=test node_modules/.bin/jest src/test/date_utils_test.test.ts
