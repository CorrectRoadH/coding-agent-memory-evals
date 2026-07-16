#!/usr/bin/env bash
# Vercel 报告构建:本仓库跳过 install(niceeval 评测依赖很重且与报告无关),
# 在 /tmp 真实安装 niceeval@latest + react,把 node_modules 符号链接回仓库根,
# 再回仓库根执行——reports/*.tsx 里的 `import "niceeval/report"` 从文件位置解析,
# tsx 用仓库 tsconfig(jsx: react-jsx)编译报告文件,这是 niceeval --report 的支持姿势。
set -euo pipefail

REPO="$PWD"
BUILD_DIR=/tmp/niceeval-build

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
npm init -y >/dev/null
npm i --no-audit --no-fund niceeval@latest react react-dom

# Vercel 的 build cache 会把上一次部署的 node_modules 原样恢复到仓库根(里面是旧版
# niceeval),ln -sfn 对已存在的目录会把链接建到目录内部而不是替换它——必须先清掉。
# 本地运行时不动真实 node_modules,直接拒绝。
if [ -e "$REPO/node_modules" ] && [ ! -L "$REPO/node_modules" ]; then
  if [ "${VERCEL:-}" = "1" ]; then
    rm -rf "$REPO/node_modules"
  else
    echo "refusing to replace real $REPO/node_modules; run in a clean clone" >&2
    exit 1
  fi
fi
ln -sfn "$BUILD_DIR/node_modules" "$REPO/node_modules"

cd "$REPO"
echo "niceeval version: $(node_modules/.bin/niceeval --version)"
node_modules/.bin/niceeval view \
  --results .niceeval \
  --report reports/memory.tsx \
  --out site
