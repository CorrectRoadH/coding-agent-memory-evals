#!/usr/bin/env bash
# host 侧一次性产出 mempal E2B 模板的两份输入(见 docs/mempal-condition-design.md):
#   .cache/mempal/mempal            linux/amd64 二进制
#   .cache/mempal/hf-cache-parts/   预取好的 embedding 模型 cache,切成 64 MB 分片(~462 MB)
# 两者都由 scripts/build-mempal-e2b-template.ts 直接 COPY 进模板,构建期不碰网络。
#
# 为什么模型必须 host 预取:mempal 首次 ingest 会从 HuggingFace 拉 model2vec 模型
# (minishlab/potion-multilingual-128M),而 HF 的 xet CDN 对 E2B 恒定返回 403 —— 实测
# 模板构建环境和运行中的沙箱都一样,HF_HUB_DISABLE_XET / HF_ENDPOINT 都改不掉(URL 由
# xet bridge 下发)。也就是说 E2B 里根本下不到这个模型,只能 host 下好带进去。
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
HF_PATH="$CACHE_DIR/hf-cache.tgz"
PARTS_DIR="$CACHE_DIR/hf-cache-parts"
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
  esac
done

mkdir -p "$CACHE_DIR"
CACHE_ABS="$(cd "$CACHE_DIR" && pwd)"

if [ -f "$BIN_PATH" ] && [ "$FORCE" != "true" ]; then
  echo "[build-mempal-linux] $BIN_PATH 已存在,跳过二进制构建(加 --force 强制重建)"
else
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
fi

if [ -d "$PARTS_DIR" ] && [ -n "$(ls -A "$PARTS_DIR" 2>/dev/null)" ] && [ "$FORCE" != "true" ]; then
  echo "[build-mempal-linux] $PARTS_DIR 已有分片,跳过模型预取(加 --force 强制重取)"
  exit 0
fi

echo "[build-mempal-linux] 用刚构建的二进制在 linux 容器里跑一次 ingest,把 embedding 模型拉进 HF cache 并打包..."

docker run --rm --platform linux/amd64 -v "$CACHE_ABS:/out" node:24-slim bash -c '
  set -euo pipefail
  export HOME=/root
  mkdir -p /tmp/warm && printf "%s\n" "mempal template warmup" > /tmp/warm/warmup.md
  /out/mempal init /tmp/warm >/dev/null
  /out/mempal ingest /tmp/warm --wing warmup >/dev/null
  # 只打包模型 cache;/root/.mempal(warmup 库本身)不进模板,attempt 从空库起步。
  tar -C "$HOME/.cache" -I "gzip -1" -cf /out/hf-cache.tgz huggingface
'

# 切片:E2B SDK 把每个 copy 的文件整个读进 Buffer 再 PUT,单个 484 MB 必 `fetch failed`;
# 64 MB 分片逐个上传稳定,模板里 cat 回来即可(见 build-mempal-e2b-template.ts)。
rm -rf "$PARTS_DIR"
mkdir -p "$PARTS_DIR"
split -b 64m "$HF_PATH" "$PARTS_DIR/hf-cache.part-"
rm -f "$HF_PATH"

echo "[build-mempal-linux] OK: $PARTS_DIR ($(ls "$PARTS_DIR" | wc -l | tr -d ' ') 个分片, $(du -sh "$PARTS_DIR" | cut -f1))"
