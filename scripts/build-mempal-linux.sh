#!/usr/bin/env bash
# host 侧一次性构建 mempal 的 linux/amd64 二进制,供 experiments/shared/mempal.ts
# 的 setup 在沙箱内上传安装(见 docs/mempal-condition-design.md)。
#
# 为什么不在沙箱里现场 cargo install:mempal 没有预编译 release(GitHub releases
# assets 为空),只能 `cargo install mempal`(crates.io),沙箱内现场 rustup + 编译
# 要 3-6 分钟/沙箱,不可接受 —— 所以 host 侧一次性构建、结果缓存复用。
#
# 为什么用 node:24-slim 做构建基底:要和 E2B coding-agent 模板的 glibc
# ABI 一致,否则 host 编译的二进制在沙箱里跑不起来(GLIBC_2.xx not found)。
#
# 为什么显式 --platform linux/amd64:沙箱后端(e2b/docker/vercel)统一是
# x86-64,而本机常是 Apple Silicon(arm64)—— 必须交叉构建,docker 在 arm64 宿主上
# 会走 Rosetta/QEMU 模拟,慢(10-20 分钟属正常),但只需构建一次(产物缓存)。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CACHE_DIR=".cache/mempal"
BIN_PATH="$CACHE_DIR/mempal"
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
  esac
done

if [ -f "$BIN_PATH" ] && [ "$FORCE" != "true" ]; then
  echo "[build-mempal-linux] $BIN_PATH 已存在,跳过构建(加 --force 强制重建)"
  exit 0
fi

mkdir -p "$CACHE_DIR"
CACHE_ABS="$(cd "$CACHE_DIR" && pwd)"

echo "[build-mempal-linux] 用 node:24-slim(linux/amd64)交叉构建 mempal,预计 10-20 分钟(Apple Silicon 走 Rosetta 模拟)..."

docker run --rm --platform linux/amd64 -v "$CACHE_ABS:/out" node:24-slim bash -c '
  set -euo pipefail
  apt-get update -qq && apt-get install -y -qq curl build-essential pkg-config libssl-dev >/dev/null
  curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
  source "$HOME/.cargo/env"
  cargo install mempal --locked
  cp "$HOME/.cargo/bin/mempal" /out/mempal
'

echo "[build-mempal-linux] 构建完成,校验产物架构..."
FILE_OUT="$(file "$BIN_PATH")"
echo "[build-mempal-linux] file: $FILE_OUT"

if ! printf '%s' "$FILE_OUT" | grep -q "ELF 64-bit" || ! printf '%s' "$FILE_OUT" | grep -q "x86-64"; then
  echo "[build-mempal-linux] 错误:产物架构不是 x86-64 ELF 64-bit,构建失败或平台参数被忽略" >&2
  exit 1
fi

echo "[build-mempal-linux] OK: $BIN_PATH ($(du -h "$BIN_PATH" | cut -f1))"
