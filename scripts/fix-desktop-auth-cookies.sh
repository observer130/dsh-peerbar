#!/usr/bin/env bash
# 修 DSH Desktop「Web authentication failed」起不来（启动即崩、点 Restart 无效）
#
# 成因（2026-10-26 实测，rc.3）：
#   dsh 的浏览器会话 cookie 名 = `dsh-auth-` + sha256(host:port)
#   （@deepseek-ai/dsh-client-connection/lib/index.js，`cookieName(authority)`）。
#   桌面端每次启动用随机端口，于是每次都会在 Electron 的 cookie 罐里新增一条
#   `dsh-auth-<新哈希>`；旧的不失效、不清理（Max-Age 30 天，cookie 与端口无关地挂在 127.0.0.1）。
#   攒到约 71 条时 Cookie 头 ≈ 16.1 KB，加上其它请求头超过 Node 默认 16 KiB
#   maxHeaderSize → 宿主直接回 431 → 主进程 `!authenticated.ok` →
#   `desktop welcome: Web authentication failed` → 启动失败。
#   更糟的是每次失败重试还会再加一条，形成自锁：越点 Restart 越起不来。
#
# 证据：Cookie 头 16100 B → 303；16200 B → 431（scripts 之外的 /tmp 复现）。
#
# 用法：
#   scripts/fix-desktop-auth-cookies.sh          # 先退出 DSH Desktop
#   scripts/fix-desktop-auth-cookies.sh --force  # 应用还在跑也照删（下次启动生效）
#
# 退出码：0 已清理；2 应用在运行（未加 --force）；1 其它错误。

set -u

PROFILE_DIR="${DSH_DESKTOP_USER_DATA:-$HOME/.config/@deepseek-ai/dsh-desktop}"
DB="$PROFILE_DIR/Cookies"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

if [ ! -f "$DB" ]; then
  printf '找不到 cookie 库：%s\n' "$DB" >&2
  exit 1
fi

if [ "$FORCE" -ne 1 ] && pgrep -f 'deepseek-harness' >/dev/null 2>&1; then
  printf 'DSH Desktop 还在运行，先退出（或加 --force）。\n' >&2
  exit 2
fi

python3 - "$DB" <<'PY'
import shutil, sqlite3, sys, time

db = sys.argv[1]
backup = f"{db}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
shutil.copy2(db, backup)

con = sqlite3.connect(db)
total = con.execute("select count(*) from cookies").fetchone()[0]
stale = con.execute(
    "select count(*), coalesce(sum(length(name) + length(coalesce(value, '')) + 2), 0)"
    " from cookies where host_key = '127.0.0.1' and name like 'dsh-auth-%'"
).fetchone()
con.execute(
    "delete from cookies where host_key = '127.0.0.1' and name like 'dsh-auth-%'"
)
con.commit()
left = con.execute("select count(*) from cookies").fetchone()[0]
con.close()

print(f"备份      {backup}")
print(f"清理      {stale[0]} 条 dsh-auth-*（原 Cookie 头约 {stale[1]} B）")
print(f"剩余      {left} / {total} 条 cookie")
PY
