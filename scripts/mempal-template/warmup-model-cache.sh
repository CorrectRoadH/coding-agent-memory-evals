#!/usr/bin/env bash
# 构建期(user)预热 embedding 模型 cache:跑一次真实 ingest,触发 mempal 从 HuggingFace
# 官方源拉 model2vec 模型(minishlab/potion-multilingual-128M ≈507 MB)灌进
# ~/.cache/huggingface 烘进镜像;运行时命中 cache、零下载。运行时 HOME 也是 /home/user。
# warmup 库本身删掉:每个 attempt 从空库起步,记忆只来自 mempalSetup 恢复的状态。
set -euo pipefail

warm_dir=/tmp/mempal-template-warm
rm -rf "$warm_dir" "$HOME/.mempal"
mkdir -p "$warm_dir"
printf '%s\n' 'niceeval template warmup' >"$warm_dir/warmup.md"

mempal init "$warm_dir"
mempal ingest "$warm_dir" --wing niceeval-template

# 不用 `... | grep -q`:grep 提前关管道会令 Rust stdout 吃 SIGPIPE。
out=$(mempal search 'niceeval template warmup' --json)
case "$out" in
  *'niceeval template warmup'*) ;;
  *)
    echo "$out" >&2
    exit 1
    ;;
esac

# 自检:cache 已落盘就该有模型文件;没有就是没烘上,构建当场失败。
test -n "$(find "$HOME/.cache/huggingface" -name '*.safetensors' 2>/dev/null | head -1)"

rm -rf "$warm_dir" "$HOME/.mempal"
