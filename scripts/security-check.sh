#!/usr/bin/env bash
# dsh-peerbar 安全验收（P0-5 / T1-4）
#
# 只做负向断言，不写任何数据。用法：
#   scripts/security-check.sh                      # 自动找本机端口
#   scripts/security-check.sh http://127.0.0.1:43619
#
# 退出码：0 全过；1 有失败项。

set -u

BASE="${1:-}"
fail=0
pass=0

say() { printf '%s\n' "$*"; }
ok() { pass=$((pass + 1)); say "PASS  $*"; }
bad() { fail=$((fail + 1)); say "FAIL  $*"; }

if [ -z "$BASE" ]; then
  for port in $(ss -ltn 2>/dev/null | awk '/127\.0\.0\.1:/{split($4,a,":"); print a[2]}' | sort -un); do
    code=$(curl -s -m 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/dsh-peerbar/api/health" 2>/dev/null || true)
    if [ "$code" = "200" ]; then
      # 多个实例时取 host 数最多的那个不现实，这里取最后一个命中的并在输出里标明
      BASE="http://127.0.0.1:$port"
    fi
  done
fi

if [ -z "$BASE" ]; then
  say "找不到运行中的 dsh-peerbar（先启动 DSH Desktop，或显式传 base URL）"
  exit 1
fi

say "目标：$BASE"
say ''

health=$(curl -s -m 5 "$BASE/dsh-peerbar/api/health" || true)
case "$health" in
  *'"product":"dsh-peerbar"'*) ok "health 返回 product" ;;
  *) bad "health 异常：${health:0:120}" ;;
esac

state=$(curl -s -m 10 "$BASE/dsh-peerbar/api/state" || true)
case "$state" in
  *'"ok":true'*) ok "state 可读" ;;
  *) bad "state 异常：${state:0:120}" ;;
esac

leak=0
case "$state" in *dsh-auth-*) leak=1 ;; esac
case "$state" in *'"token"'*) leak=1 ;; esac
case "$state" in *'"cookie"'*) leak=1 ;; esac
if [ "$leak" = "0" ]; then
  ok "state 不含 token / cookie / dsh-auth-"
else
  bad "state 里出现了凭据字段"
fi

code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' \
  -X POST -H 'Origin: http://evil' -H 'content-type: application/json' \
  -H 'x-dsh-peerbar-action: 1' -d '{}' "$BASE/dsh-peerbar/api/hosts" || true)
[ "$code" = "403" ] && ok "跨源 Origin POST → 403" || bad "跨源 Origin POST → $code（期望 403）"

code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' \
  -X POST -H 'sec-fetch-site: cross-site' -H 'content-type: application/json' \
  -H 'x-dsh-peerbar-action: 1' -d '{}' "$BASE/dsh-peerbar/api/hosts" || true)
[ "$code" = "403" ] && ok "sec-fetch-site: cross-site → 403" || bad "sec-fetch-site: cross-site → $code（期望 403）"

code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' \
  -H 'Host: evil.test' "$BASE/dsh-peerbar/api/state" || true)
[ "$code" = "403" ] && ok "伪造 Host 头 → 403" || bad "伪造 Host 头 → $code（期望 403）"

code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' \
  -X POST -H 'content-type: application/json' -d '{}' "$BASE/dsh-peerbar/api/hosts" || true)
[ "$code" = "403" ] && ok "缺自定义头 → 403" || bad "缺自定义头 → $code（期望 403）"

code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' \
  -X POST -H 'content-type: text/plain' -H 'x-dsh-peerbar-action: 1' -d '{}' "$BASE/dsh-peerbar/api/hosts" || true)
[ "$code" = "415" ] && ok "非 JSON 变更请求 → 415" || bad "非 JSON 变更请求 → $code（期望 415）"

REG="$HOME/.dsh/dsh-peerbar.json"
if [ -f "$REG" ]; then
  mode=$(stat -c '%a' "$REG" 2>/dev/null || echo '?')
  [ "$mode" = "600" ] && ok "注册表权限 600" || bad "注册表权限 $mode（期望 600）"
else
  say "SKIP  注册表尚未创建（还没添加 Host）"
fi

CACHE="$HOME/.dsh/dsh-peerbar-cache.json"
if [ -f "$CACHE" ]; then
  mode=$(stat -c '%a' "$CACHE" 2>/dev/null || echo '?')
  [ "$mode" = "600" ] && ok "缓存权限 600" || bad "缓存权限 $mode（期望 600）"
fi

say ''
say "结果：$pass 通过，$fail 失败"
[ "$fail" -eq 0 ]
