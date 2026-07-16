#!/usr/bin/env bash
# 改编自 terminal-bench original-tasks/swe-bench-astropy-1 的 run-tests.sh:
# 上游镜像自带 python3.9;E2B 模板没有,改用 uv 管理的 CPython 3.9(与上游同 minor 版本,
# eval setup 已预装 uv 并 `uv python install 3.9`)。测试在干净 venv 里从 agent 改过的
# 源码重新构建 astropy,与上游语义一致;test_patch(隐藏测试)在 agent 结束后才落盘应用。
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

rm -rf tests-venv
uv venv --python 3.9 --seed tests-venv
source tests-venv/bin/activate

patch --fuzz=5 -p1 -i tests/test_patch.diff

# 上游同款 pin:不锁 setuptools 的话新版本会让这个 2021 年的构建挂掉
sed -i 's/requires = \["setuptools",/requires = \["setuptools==68.0.0",/' pyproject.toml

python -m pip install numpy==1.23.4
python -m pip install -e ".[test]"

python -m pytest -rA astropy/modeling/tests/test_separable.py
