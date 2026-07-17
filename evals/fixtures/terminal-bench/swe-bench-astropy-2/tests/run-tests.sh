#!/usr/bin/env bash
# 改编自 terminal-bench original-tasks/swe-bench-astropy-2 的 run-tests.sh:
# 上游镜像自带 python3.9;E2B 模板没有,改用 uv 管理的 CPython 3.9(与上游同 minor 版本,
# eval setup 已预装 uv 并 `uv python install 3.9`)。测试在干净 venv 里从 agent 改过的
# 源码重新构建 astropy,与上游语义一致;test_patch(隐藏测试)在 agent 结束后才落盘应用。
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

rm -rf tests-venv
uv venv --python 3.9 --seed tests-venv
source tests-venv/bin/activate

patch --fuzz=5 -p1 -i tests/test_patch.diff

# 上游同款 pin:不锁 setuptools 的话新版本会让这个老构建挂掉
sed -i 's/requires = \["setuptools",/requires = \["setuptools==68.0.0",/' pyproject.toml

# GCC 14(E2B 模板基镜像 = Ubuntu 24.04,gcc 14.2)把 -Wincompatible-pointer-types
# 从 warning 提升为 hard error,astropy 5.x 的 wcslib_celprm_wrap.c 等老 C 代码撞死
# (`error: initialization of 'PyCelprm *' from incompatible pointer type`)。上游 SWE-bench
# 镜像是 gcc ~10 当 warning 放行。降回 warning 让 C 扩展照旧编译,与 .py 修复的判分无关。
export CFLAGS="${CFLAGS:-} -Wno-incompatible-pointer-types -Wno-error=incompatible-pointer-types"

python -m pip install numpy==1.23.4
python -m pip install -e ".[test]"

python -m pytest -rA astropy/io/ascii/tests/test_qdp.py
