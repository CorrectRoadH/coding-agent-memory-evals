#!/usr/bin/env bash
# 跑一次 Nowledge Mem 记忆条件实验:每次都是全新激活,跑完(含失败/中断)必反激活。
#
#   scripts/exp-nowledge.sh dev-e2b/codex-gpt-5.4-mini-nowledge [eval-filter…]
#
# 激活 = 全新记忆库的 mem 实例(容器+隧道,embedding 模型走共享缓存);
# 反激活 = 拆容器+隧道并删除实例数据。实验进程经 NMEM_URL/NMEM_API_KEY 环境变量
# 拿到本次实例的连接信息(experiments/shared/nowledge.ts 优先读环境变量)。
set -euo pipefail

[ $# -ge 1 ] || { echo "用法: $0 <experiment>(niceeval exp 的参数原样透传)" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CTL="$SCRIPT_DIR/nowledge-mem.sh"

# 实例名带时间戳:并发跑多个实验互不干扰,残留也可辨认
INSTANCE="exp-$(date +%Y%m%d-%H%M%S)-$$"

cleanup() { "$CTL" down "$INSTANCE" || true; }
trap cleanup EXIT

"$CTL" up "$INSTANCE"
# shellcheck source=/dev/null
source "$(dirname "$CTL")/../.cache/nowledge-mem/$INSTANCE/env"
export NMEM_URL NMEM_API_KEY

# niceeval verdict=failed 会以非零退出;别让它跳过写路径探针,也别吞掉真正的退出码
set +e
pnpm exec niceeval exp "$@"
rc=$?
set -e

# 拆实例前查服务端:验证 agent 的记忆 hook 写路径真的落了 thread/memory(见 nowledge-mem.sh probe)
"$CTL" probe "$INSTANCE" || true

exit $rc
