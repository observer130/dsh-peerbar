#!/usr/bin/env bash
# 起一个隔离 profile 的 dsh web 实例，专供 scripts/ui-check.mjs 自检。
#
#   scripts/dev-server.sh > .workbuddy/tmp/pb-web.log 2>&1 &
#
# 首次会自动把 ~/.dsh/profiles/desktop 复制成 ~/.dsh/profiles/pb-test。
# 端口默认 3100，可用 DSH_TEST_PORT 覆盖。

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${DSH_TEST_NODE:-/home/nwj/.workbuddy/binaries/node/versions/22.22.2/bin/node}"
DSH_BIN="/opt/dsh-desktop-linux-bin/resources/app/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"
PROFILE="${DSH_TEST_PROFILE:-pb-test}"
PORT="${DSH_TEST_PORT:-3100}"
HOME_DIR="${DSH_HOME:-$HOME/.dsh}"

if [ ! -x "$NODE" ]; then
  echo "node 不存在：$NODE（用 DSH_TEST_NODE 指定）" >&2
  exit 1
fi
if [ ! -f "$DSH_BIN" ]; then
  echo "dsh CLI 不存在：$DSH_BIN" >&2
  exit 1
fi

if [ ! -d "$HOME_DIR/profiles/$PROFILE" ]; then
  echo "初始化测试 profile：$HOME_DIR/profiles/$PROFILE" >&2
  cp -r "$HOME_DIR/profiles/desktop" "$HOME_DIR/profiles/$PROFILE"
fi

cd "$ROOT"
exec "$NODE" "$DSH_BIN" --profile "$PROFILE" --host 127.0.0.1 --port "$PORT" --no-open
