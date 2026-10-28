#!/usr/bin/env bash
# 宿主版本兼容性检查。
#
#   bash scripts/compat-check.sh            # 用 /opt 下的 DSH Desktop
#   DSH_APP=/path/to/app bash scripts/compat-check.sh
#
# 检查本插件依赖的「宿主契约」是否还在：
#   1. lib/rpc.js 白名单里的每个端点
#   2. session/page 的分页参数（beforeSeq / turnWindow / maxMessages）
#   3. sidebarRight.openResource（文件引用拦截）
#   4. ctx.remote.session 的 modelCatalog / selectModel（模型座路由）
#   5. sidebar.workspaces 的 directoryFlow 子座位（「添加工作区」）
#
# 退出码：0 全通过；1 有缺失（会列出具体项）
# 这是待办 T14「版本兼容护栏」的落地：升级宿主后先跑它，再跑 ui-check。

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${DSH_APP:-/opt/dsh-desktop-linux-bin/resources/app}"
PKGS="$APP/dsh/node_modules/@deepseek-ai"

if [ ! -d "$PKGS" ]; then
  echo "找不到宿主包目录：$PKGS" >&2
  echo "用 DSH_APP 指向 DSH Desktop 的 resources/app 目录" >&2
  exit 1
fi

exec python3 - "$ROOT" "$APP" "$PKGS" <<'PY'
import glob
import json
import os
import re
import sys

root, app, pkgs = sys.argv[1], sys.argv[2], sys.argv[3]
problems = []


def read(path):
    try:
        with open(path, errors="ignore") as fh:
            return fh.read()
    except OSError:
        return ""


# ---- 版本 ----
version = "unknown"
try:
    version = json.load(open(os.path.join(app, "package.json"))).get("version", "unknown")
except OSError:
    pass
print(f"宿主版本：{version}")


def package_client(pkg):
    return read(os.path.join(pkgs, pkg, "lib", "client.js"))


def package_host(pkg):
    return read(os.path.join(pkgs, pkg, "lib", "typert.host.js"))


# ---- 1. 白名单端点 ----
host_endpoints = set()
for path in glob.glob(os.path.join(pkgs, "*", "lib", "typert.host.js")):
    host_endpoints.update(re.findall(r"'([a-zA-Z]+/[a-zA-Z]+)': \{", read(path)))

rpc_src = read(os.path.join(root, "lib", "rpc.js"))
allow = re.findall(r"^  '([a-zA-Z]+/[a-zA-Z]+)',", rpc_src, re.M)
missing_endpoints = [name for name in allow if name not in host_endpoints]
if missing_endpoints:
    problems.append(f"白名单端点已不存在：{', '.join(missing_endpoints)}")
print(f"  · 白名单端点：{len(allow)} 个，缺 {len(missing_endpoints)} 个")

# ---- 2. session/page 分页参数 ----
page_src = package_host("dsh-api-session-controller")
page_block = page_src[page_src.find("'session/page': {") :][:8000]
for key in ("beforeSeq", "turnWindow", "maxMessages", "throughSeq"):
    if key not in page_block:
        problems.append(f"session/page 缺少参数 {key}（远端历史分页会退化）")
print("  · session/page 分页参数：检查完毕")

# ---- 3. sidebarRight.openResource ----
right_src = package_client("dsh-client-ui-sidebar-right")
if "openResource(address" not in right_src:
    problems.append("sidebarRight.openResource 不存在（远端文件引用拦截会失效）")
print("  · sidebarRight.openResource：检查完毕")

# ---- 4. 模型座路由依赖 ----
model_src = package_client("dsh-client-ui-model-selection")
if "modelCatalog" not in model_src or "selectModel" not in model_src:
    problems.append("model-selection 不再走 remote.session.modelCatalog/selectModel（模型座路由会失效）")
print("  · 模型座路由（modelCatalog/selectModel）：检查完毕")

# ---- 5. 侧栏子座位 ----
workspace_src = package_client("dsh-client-ui-workspace")
if "sidebar.workspaces.directoryFlow" not in workspace_src:
    problems.append("sidebar.workspaces.directoryFlow 子座位不存在（「添加工作区」会消失）")
picker_src = package_client("dsh-client-ui-directory-picker-browse")
if "sidebar.workspaces.directoryFlow" not in picker_src:
    problems.append("directory-picker-browse 不再注入 sidebar.workspaces.directoryFlow（注入链路变了）")
print("  · sidebar.workspaces.directoryFlow：检查完毕")

# ---- 6. 远端终端通道 ----
webserver_src = read(os.path.join(pkgs, "dsh-host-webserver", "lib", "index.js"))
if "registerUpgrade(route)" not in webserver_src:
    problems.append("webServer.registerUpgrade 不存在（远端终端 WS 代理无法挂载）")
terminal_src = package_host("dsh-api-terminal-controller")
for endpoint in ("terminal/attach", "terminal/retain"):
    if f"'{endpoint}':" not in terminal_src:
        problems.append(f"{endpoint} 不存在（远端终端无法连接/保留）")
print("  · 远端终端（registerUpgrade + attach/retain）：检查完毕")

# ---- 结论 ----
print()
if problems:
    print("兼容性问题：")
    for item in problems:
        print(f"  ✗ {item}")
    sys.exit(1)
print("兼容性检查通过")
PY
