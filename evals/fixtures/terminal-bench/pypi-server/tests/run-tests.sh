#!/usr/bin/env bash
# 改编自 terminal-bench original-tasks/pypi-server 的 run-tests.sh:
# 上游用 uv venv;这里用 stdlib venv,行为一致——测试在干净 venv 里跑,
# 测试内的 `python -m pip install --index-url ...` 会装进这个 venv,不碰系统 Python。
set -euo pipefail

rm -rf .testing-venv
python3 -m venv .testing-venv
source .testing-venv/bin/activate
pip install --quiet pytest==8.4.1

python -m pytest tests/test_outputs.py -rA
