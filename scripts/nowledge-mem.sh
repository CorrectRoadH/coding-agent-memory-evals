#!/usr/bin/env bash
# 临时 Nowledge Mem 实例管理:宿主机 docker 起服务端 + cloudflared quick tunnel 暴露给 E2B 沙箱。
#
# 每个实例(默认名 default)独立:容器、端口、隧道、数据目录、env 文件。
# 「每次 exp 新激活、跑完反激活」用法见 scripts/exp-nowledge.sh:
#   up <name>   → 全新记忆库(embedding 模型走共享缓存,秒级就绪)
#   down <name> → 拆容器+隧道并【删除该实例数据】;共享模型缓存保留
#
# 用法: scripts/nowledge-mem.sh up|down|status|env [instance-name]
# up 之后连接信息落 .cache/nowledge-mem/<name>/env(NMEM_URL / NMEM_API_KEY)。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_DIR="$REPO_ROOT/.cache/nowledge-mem"
MODEL_CACHE="$BASE_DIR/model-cache" # 跨实例共享:embedding GGUF,可重建

NAME="${2:-default}"
[[ "$NAME" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "[nowledge-mem] 非法实例名: $NAME" >&2; exit 1; }
STATE_DIR="$BASE_DIR/$NAME"
ENV_FILE="$STATE_DIR/env"
TUNNEL_LOG="$STATE_DIR/cloudflared.log"
TUNNEL_PID_FILE="$STATE_DIR/cloudflared.pid"
PORT_FILE="$STATE_DIR/port"

CONTAINER="nowledge-mem-$NAME"
# 与沙箱内 nmem-cli 版本同步升;server/client 版本漂移未验证过,升级时一起动。
IMAGE="nowledgelabs/mem:0.10.29"

log() { printf '[nowledge-mem:%s] %s\n' "$NAME" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

container_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ]
}

instance_port() {
  cat "$PORT_FILE" 2>/dev/null
}

alloc_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}

tunnel_pid() {
  local pid
  pid=$(cat "$TUNNEL_PID_FILE" 2>/dev/null) || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

tunnel_url() {
  # quick tunnel 的 URL 只出现在启动日志里。排除 cloudflared 自己引用的 api.trycloudflare.com
  # (控制面端点,常先于真正的 quick-tunnel URL 打印,head -1 会误取)。
  grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null \
    | grep -vxE 'https://api\.trycloudflare\.com' | head -1
}

wait_for() {
  local label="$1" timeout="$2" cmd
  shift 2
  cmd=("$@")
  local deadline=$((SECONDS + timeout))
  until "${cmd[@]}" >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || die "$label 在 ${timeout}s 内未就绪"
    sleep 2
  done
}

embedding_degraded() {
  curl -fsS "http://localhost:$(instance_port)/health" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["embedding"]["degraded"])'
}

# ---- license ----------------------------------------------------------------
# 每个新实例是全新设备身份:activate 占一个 seat,down 时必须 deactivate 释放,
# 否则 seat 泄漏只能去账号后台清。license id 从 env NMEM_LICENSE_ID 读,
# 缺省时回退解析仓库 .env(gitignored)。所有 license 调用走容器内 loopback
# (loopback 视为本地授权,对齐 nmemctl)。
env_value() { # <VAR>:env 优先,回退解析仓库 .env
  local val
  eval "val=\"\${$1:-}\""
  if [ -z "$val" ]; then
    val=$(grep -E "^$1=" "$REPO_ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  fi
  printf '%s' "$val"
}

license_id() { env_value NMEM_LICENSE_ID; }
license_email() { env_value NMEM_LICENSE_EMAIL; }

license_api() { # <endpoint> [json-body]
  local endpoint="$1" body="${2:-}"
  if [ -n "$body" ]; then
    docker exec "$CONTAINER" curl -fsS -X POST -H 'Content-Type: application/json' \
      -d "$body" "http://127.0.0.1:14242/api/license/$endpoint"
  else
    docker exec "$CONTAINER" curl -fsS -X POST "http://127.0.0.1:14242/api/license/$endpoint"
  fi
}

license_status() {
  docker exec "$CONTAINER" curl -fsS "http://127.0.0.1:14242/api/license/status" 2>/dev/null
}

license_activate() {
  local id email
  id=$(license_id)
  email=$(license_email)
  if [ -z "$id" ] || [ -z "$email" ]; then
    log "WARN: 未设置 NMEM_LICENSE_ID / NMEM_LICENSE_EMAIL(env 或 .env),实例以 free tier 跑(memory 上限 50,benchmark 不可用)"
    return 0
  fi
  case "$id$email" in *\"*|*\\*) die "license id/email 含非法字符" ;; esac
  local status
  status=$(license_status) || status=""
  if printf '%s' "$status" | grep -qE '"is_device_activated"[[:space:]]*:[[:space:]]*true'; then
    log "license 已激活,跳过"
    return 0
  fi
  log "激活 license …"
  # 0.10.29 服务端要 license_code + email(官方 nmemctl 还在发 license_id,已过时)。
  # 注意:activate 对语义错误(seat 用尽、license 无效)也回 HTTP 200 + {"status":"error","message":…},
  # curl -fsS 抓不到——必须解析 body 的 message,否则失败只剩「is_device_activated 仍 false」这种无解报错。
  local activate_resp
  activate_resp=$(license_api activate "{\"license_code\":\"$id\",\"email\":\"$email\"}") || die "license 激活请求失败(HTTP 层)"
  if ! printf '%s' "$(license_status)" | grep -qE '"is_device_activated"[[:space:]]*:[[:space:]]*true'; then
    local msg
    msg=$(printf '%s' "$activate_resp" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("message",""))' 2>/dev/null)
    [ -n "$msg" ] || msg="activate 返回体无 message,is_device_activated 仍 false"
    # 激活失败是否致命,取决于本次跑对 pro 的依赖:
    #  · free tier 已开放全部 feature(remote_ai_models / advanced_search / knowledge_graph / thread_import),
    #    只有 memory 上限 50 —— dev-e2b 冒烟(单 eval 写几条)完全够用,不该被 seat 用尽硬挡。
    #  · compare/ 正式跑要 >50 条 + 一致的 pro 条件,必须硬失败:设 NOWLEDGE_REQUIRE_PRO=1。
    # 「device limit reached」的根因:每个临时实例是全新 device,seat 无自助释放端点(devices/reset/release 全 404),
    #  只能去 nowledge 账号后台(mem.nowledge.co)释放旧设备,或改用持久 device 复用(见 down 注释)。
    if [ "${NOWLEDGE_REQUIRE_PRO:-0}" = "1" ]; then
      die "license 激活失败:$msg(NOWLEDGE_REQUIRE_PRO=1,拒绝降级)"
    fi
    log "WARN: license 激活失败:$msg"
    log "WARN: 降级到 free tier 继续(memory 上限 50,全 feature 可用)。正式对比请清 seat 或设 NOWLEDGE_REQUIRE_PRO=1 硬失败。"
    return 0
  fi
  log "license 已激活($(license_status | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tier"), "memory_limit:", d.get("memory_limit"))' 2>/dev/null))"
}

license_deactivate() {
  container_running || return 0
  local status
  status=$(license_status) || return 0
  # 未激活的实例没有 seat 可释放
  printf '%s' "$status" | grep -qE '"is_device_activated"[[:space:]]*:[[:space:]]*true' || return 0
  if license_api deactivate >/dev/null 2>&1; then
    log "license 已反激活(seat 已释放)"
  else
    log "WARN: license 反激活失败——seat 可能泄漏,需去 nowledge 账号后台手动释放"
  fi
}

# 0.10+ 的 Rust 镜像不带 `nmem` CLI(官方 docker 文档已过时);key 走容器内 loopback REST,
# loopback 视为本地授权。reveal-key 无 key 时 400,用 rotate-key 引导生成(对齐 nmemctl 语义)。
read_key() {
  local out key
  for endpoint in reveal-key rotate-key; do
    out=$(docker exec "$CONTAINER" curl -fsS -X POST "http://127.0.0.1:14242/api/remote-access/$endpoint" 2>/dev/null) || out=""
    key=$(printf '%s' "$out" | grep -oE 'nmem_[A-Za-z0-9_-]+' | head -1)
    [ -n "$key" ] && { printf '%s' "$key"; return 0; }
  done
  return 1
}

up() {
  mkdir -p "$STATE_DIR/data" "$STATE_DIR/config" "$STATE_DIR/cache" "$MODEL_CACHE"

  local port
  if container_running; then
    port=$(instance_port) || die "容器在跑但没有 port 记录($PORT_FILE)"
    log "容器已在运行(端口 $port),跳过启动"
  else
    port=$(instance_port) || true
    [ -n "${port:-}" ] || port=$(alloc_port)
    printf '%s' "$port" >"$PORT_FILE"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    log "启动 $IMAGE(端口 $port)…"
    # 挂载点对齐官方 compose(data:/var/lib/nowledge-mem 等;此前网页文档摘要给的
    # /data、/cache 是错的,镜像不写那里)。模型实测落在 data 树下的
    # .cache/nmem-rs/models,用嵌套挂载把它单独指到跨实例共享缓存——
    # data/config 每实例独立(反激活即清零),379MB 的 GGUF 只下一次。
    docker run -d --name "$CONTAINER" \
      -p "$port:14242" \
      -v "$STATE_DIR/data:/var/lib/nowledge-mem" \
      -v "$STATE_DIR/config:/etc/nowledge-mem" \
      -v "$STATE_DIR/cache:/var/cache/nowledge-mem" \
      -v "$MODEL_CACHE:/var/lib/nowledge-mem/.cache/nmem-rs/models" \
      -e NOWLEDGE_NAS_BOOTSTRAP=0 \
      --memory 4g \
      --restart unless-stopped \
      "$IMAGE" >/dev/null
  fi

  log "等待 /health …"
  wait_for "server /health" 180 curl -fsS "http://localhost:$port/health"

  local api_key
  api_key=$(read_key) || die "拿不到 API key(/api/remote-access/reveal-key)"

  license_activate

  # 无 embedding 模型时服务端降级为 HASH fallback(FTS-only),benchmark 不可用。
  # 模型缓存跨实例共享,通常只有第一次要下;服务端只在启动时探测 GGUF,下载完必须重启。
  if [ "$(embedding_degraded)" = "True" ]; then
    log "embedding 处于降级模式,下载本地模型(进共享缓存,一次性)…"
    NMEM_API_KEY="$api_key" uvx --from nmem-cli nmem models download --api-url "http://localhost:$port" >&2 \
      || die "embedding 模型下载失败"
    log "重启容器以加载模型 …"
    docker restart "$CONTAINER" >/dev/null
    wait_for "重启后 /health" 120 curl -fsS "http://localhost:$port/health"
    [ "$(embedding_degraded)" = "False" ] || die "模型下载后 embedding 仍处于降级模式"
  fi
  log "embedding mode: $(curl -fsS "http://localhost:$port/health" | python3 -c 'import json,sys; print(json.load(sys.stdin)["embedding"]["mode"])')"

  if pid=$(tunnel_pid) && [ -n "$(tunnel_url)" ]; then
    log "隧道已在运行(pid $pid)"
  else
    log "启动 cloudflared quick tunnel …"
    rm -f "$TUNNEL_LOG"
    # --protocol http2:QUIC(UDP 7844)在代理/fake-IP 网络下出不去,强制 TCP
    nohup cloudflared tunnel --protocol http2 --url "http://localhost:$port" >"$TUNNEL_LOG" 2>&1 &
    echo $! >"$TUNNEL_PID_FILE"
    wait_for "cloudflared 隧道 URL" 60 bash -c "grep -qE 'https://[a-z0-9-]+\.trycloudflare\.com' '$TUNNEL_LOG'"
  fi

  local url
  url=$(tunnel_url)
  [ -n "$url" ] || die "日志里找不到隧道 URL($TUNNEL_LOG)"

  # 端到端验证:经隧道 + Bearer 打 /health(quick tunnel 冷启动偶发 502/530,重试而不是判死)
  log "经隧道验证 …"
  wait_for "隧道端到端 /health" 90 curl -fsS -H "Authorization: Bearer $api_key" "$url/health"

  {
    echo "export NMEM_URL=$url"
    echo "export NMEM_API_KEY=$api_key"
  } >"$ENV_FILE"
  log "就绪。连接信息已写入 $ENV_FILE"
  log "  NMEM_URL=$url"
  log "  NMEM_API_KEY=${api_key:0:12}…"
}

# 反激活:先释放 license seat,再拆容器+隧道,删除该实例的记忆数据。共享模型缓存保留。
down() {
  license_deactivate
  if pid=$(tunnel_pid); then
    kill "$pid" 2>/dev/null || true
    log "隧道已停(pid $pid)"
  fi
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER" >/dev/null
    log "容器已删"
  fi
  if [ -d "$STATE_DIR" ]; then
    rm -rf "$STATE_DIR"
    log "实例数据已清除($STATE_DIR)"
  fi
}

# 写路径探针:跑完 exp、拆实例前查服务端到底落了多少 thread / memory。
# 目的:agent 的插件 lifecycle hook(Stop 存线程、m add 存记忆)若静默失败,基础设施会全绿
# 但服务端零记录——只有在拆实例前查服务端才抓得到(拆完数据就没了,这是 DX 痛点的正解)。
# 走两条独立通道:① loopback license status 的 memory_count(免鉴权、字段确定,最可靠);
# ② 经隧道 + API key 跑 nmem threads list(与沙箱 hook 同一条路径,顺带验证隧道仍通)。
probe() {
  local mem_count
  mem_count=$(docker exec "$CONTAINER" curl -fsS "http://127.0.0.1:14242/api/license/status" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("memory_count","?"))' 2>/dev/null || echo "?")
  log "server probe(拆实例前):memory_count=$mem_count"
  [ -f "$ENV_FILE" ] || { log "  (无 env 文件,跳过隧道侧 nmem 查询)"; return 0; }
  local url key
  url=$(grep -E '^export NMEM_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  key=$(grep -E '^export NMEM_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  [ -n "$url" ] && [ -n "$key" ] || { log "  (env 文件缺 URL/KEY,跳过)"; return 0; }
  local threads
  threads=$(NMEM_API_KEY="$key" uvx --from nmem-cli nmem --api-url "$url" --json threads list 2>/dev/null || echo '')
  printf '%s' "$threads" | python3 -c '
import json,sys
raw=sys.stdin.read().strip()
if not raw: print("  threads: <查询失败>"); sys.exit()
try:
    d=json.loads(raw)
    items=d if isinstance(d,list) else d.get("threads",d.get("items",d.get("data",[])))
    print(f"  threads: {len(items)}")
except Exception:
    print("  threads: <解析失败> "+raw[:200])
' >&2
}

status() {
  if container_running; then
    log "容器: 运行中($(docker inspect -f '{{.Config.Image}}' "$CONTAINER"),端口 $(instance_port))"
    curl -fsS "http://localhost:$(instance_port)/health" 2>/dev/null | head -c 300 >&2 && echo >&2 || log "本地 /health 不通"
    log "license: $(license_status | head -c 200 || echo '状态不可读')"
  else
    log "容器: 未运行"
  fi
  if pid=$(tunnel_pid); then
    log "隧道: 运行中(pid $pid)→ $(tunnel_url)"
  else
    log "隧道: 未运行"
  fi
  [ -f "$ENV_FILE" ] && log "env 文件: $ENV_FILE" || log "env 文件: 不存在(先跑 up)"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  probe) probe ;;
  env) cat "$ENV_FILE" 2>/dev/null || die "还没 up" ;;
  *) die "用法: $0 up|down|status|probe|env [instance-name(默认 default)]" ;;
esac
