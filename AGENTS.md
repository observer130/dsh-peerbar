# AGENTS.md

给 coding agent 的工作说明。人类向的项目介绍在 [README.md](README.md)；dsh 插件 API 的事实基线在 [docs/插件开发规范.md](docs/插件开发规范.md)。

## 项目速览

- **是什么**：一个 DeepSeek Harness（dsh）插件，**聚合多个 dsh 前端**：在官方侧栏那一列里列出本机 + 多台远端（nv50 / m50）的工作区与会话，点远端会话由官方中栏渲染、执行留在远端。需求以 `docs/意图.md` 为准（冻结），实现见 `docs/架构.md`。
- **技术栈**：纯 JavaScript ESM，**无构建步骤**，目标零第三方依赖。宿主半跑在 Node，客户端半是浏览器 `__ModuleLoader__` bundle。
- **两半结构**：`lib/index.js` 宿主半（注册路由、探活、拉取远端快照、缓存）；`lib/client.js` 客户端半（投影进官方 store、合成 SessionBinding、`settings.section`）。两半之间只通过同源 HTTP/WS 通信。

## 架构不变量

这几条是设计前提，不是可调偏好：

- **UI 全是官方的**：不注册 `sidebar.workspaces`、不自绘树、不重写中栏。远端数据投影进官方 store（`workspaces.list` / `sessions.list`），官方组件自己渲染。
- **本机数据不另拉一份**：本机行来自官方 store 本身，远端行只在读路径合并，避免同一会话两行。
- **浏览器不直连远端**。所有跨机请求由宿主半发起（远端 cookie 是 host-only + `SameSite=Strict`，浏览器跨 origin 拿不到）。
- **远端只提供数据，不提供 UI**。不加载远端插件 bundle，不把远端 slot 接进来。
- **虚拟 ID 才是主键**：`peerbar:<hostId>:<kind>:<rawId>`。裸 `workspaceId`/`sessionId` 在不同 Host 间会撞。
- **各 Host 独立并发与退避**。单台失败不得让 `/state` 整体失败，也不得影响其他 Host。

## 环境

| 项 | 值 |
| --- | --- |
| 宿主 | DSH Desktop `@deepseek-ai/dsh-desktop 0.2.2-alpha.2`（2026-10-30 升级；本机唯一安装）；远端 Host 仍是 0.2.1-rc.x |
| 自带运行时 | `/opt/dsh-desktop-linux-bin/resources/runtime` — Node 24.21.0 / pnpm 11.28.5 |
| profile | `~/.dsh/profiles/desktop`，**由 Electron 独占**，CLI 无法管理 |
| 限制 | agent shell 有 `ulimit -v 4GB`，不要从里面直接起 dsh 进程 |

装插件**只能走桌面版 UI**：侧栏「插件」→ 标题旁箭头 → 安装第三方插件 → 填 `/home/nwj/Projects/dsh-peerbar`。任何 `dsh plugin --profile desktop ...` 都会报 `profile "desktop" is managed exclusively by the Electron application`。

## 命令

```sh
# 语法自检（无构建、无 tsc，语法错只会在加载时炸）
for f in lib/*.js; do node --check "$f" || break; done

# 客户端代码变化后重载窗口；宿主代码变化后重启 DSH Desktop

# 只读查看组合层（只能碰非 desktop profile）
RT=/opt/dsh-desktop-linux-bin/resources/runtime
export DSH_DESKTOP_NODE_EXECUTABLE=/opt/dsh-desktop-linux-bin/deepseek-harness
$RT/bin/node /opt/dsh-desktop-linux-bin/resources/app/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile web --dump-config | grep -A4 'dsh-peerbar'

# 打自己的路由（端口随机：ss -ltnp | grep deepseek-harness，或页面 console 里读 location.origin）
curl -i "http://127.0.0.1:<port>/dsh-peerbar/api/state"
curl -i -X POST -H 'Origin: http://evil' "http://127.0.0.1:<port>/dsh-peerbar/api/hosts"   # 期望 403

# 单测（纯函数：守卫 / 身份 / 信封 / 退避，不起 dsh）
node --test test/*.test.js

# 安全验收（打真实实例；不传参数会自动找端口）
scripts/security-check.sh http://127.0.0.1:<port>

# 打包（本机无 pnpm）
npm pack
```

M0 已落地以上命令；`npm pack` 出的 tgz 可直接在桌面版插件页安装。

## 目录

```
lib/index.js     宿主半入口：config 校验、路由装配、生命周期
lib/config.js    注册表与缓存读写（0600、原子替换）
lib/guard.js     回环 + 同源栅栏（P0-5 的地基）
lib/identity.js  origin 归一化、hostId、虚拟 ID、cwd → 工作区
lib/assets.js    远端会话级只读路由白名单（交付物卡片的 changes.summary / changes.diff）
lib/remote.js    令牌换 cookie、RPC 信封、session/list、分页、错误分类
lib/rpc.js       远端 RPC 白名单（/hosts/<id>/rpc 只放行这张表）
lib/stream.js    Remote 流通道：workspace/follow 归档集、workspaceFiles/changes（SSE）、
                 双工 terminal/attach（send/close）、session/control 控制流、session/follow 历史流
lib/control.js   session/control 单向 WS 桥（计划/提问投影）
lib/follow.js    session/follow 单向 WS 桥（计划预览的 opening snapshot）
lib/terminal.js  远端终端 WS 代理：浏览器 ↔ 本机 ↔ 远端 mux，端点白名单 + 帧转发
lib/probe.js     探活状态机与退避
lib/peers.js     每 Host 的快照编排、调度与缓存
lib/codes.js     错误码，前后端共用
lib/client.js    客户端半：官方 store 投影 + 联邦写操作代理 + 远端会话 binding + settings.section
test/            node:test 单测
docs/            意图.md / 架构.md / 现状与计划.md（现行）；插件规范、官方侧栏规格、上游提案、终端设计；archive/ 旧文档
```

新增文件前先想归属；`lib/index.js` 只做装配，不堆业务。

## dsh 插件契约

完整清单见 `docs/插件开发规范.md`，这里只放会直接导致返工的部分：

1. `sidebar.workspaces` 是 **single** slot 且被官方独占，**不能往里追加行**。v8 及以前用
   `priority: -1` 影子替换、自绘整棵树；v9 起改成**不注册该座位**，把远端数据投影进官方 store
   （`workspaces.list.buildSnapshot` 追加组、`sessions.list.getSnapshot` 合并行），官方 UI 原样渲染。
   ⚠️ 不要退回影子替换：自绘树会丢官方菜单/拖拽/未读/派生面板，且每次宿主升级都要返工。
   影子替换下的一堆历史坑（子座位接不回来、`renderSlot` 注入失败）只留在 `docs/archive/`。
2. 插件自己注册的 `ctx.webServer` 路由**没有任何认证**——dsh 的浏览器 cookie 与 Host/Origin 校验只覆盖 `/api`。同源/回环 guard 必须自己写。
3. `/api` 不是 REST：`POST /api/<namespace>/<method>` + `{ args }`，流式走 WS `/api/remote.mux`。
   插件自己的双工通道用 `ctx.webServer.registerUpgrade`（rc.3 已核实，见插件规范 §12）；
   反向方向本插件是 WS 服务端，服务端帧**不得加掩码**。
4. 客户端半必须是 `window.__ModuleLoader__.load({ id, factory(require) })`，**不能出现 `import`/`export`**；`react`、`react-dom`、`@deepseek-ai/dsh-client-ui-primitives` 是 baseline external，禁止打包进自己的 bundle。
5. 宿主半依赖用静态 `export const inject = [...]`，不要手动等 service。

写任何 dsh API 之前，先在本机 `@deepseek-ai/*` 包的 `README.zh.md` 或 `lib/*.js` 里核实，别凭记忆。

## 代码风格

- ESM，`node:` 前缀导入内置模块；两空格缩进；单引号；保留分号。
- 侧栏是官方 UI，样式一律用 `--dsw-*` token；设置页/自绘组件用 `dshp-*` 类名，**禁止复制** `koUx-W_*` / `hP3ldq_*` 这类官方构建期哈希类名。
- 零第三方依赖是目标。要 cookie jar 就写二十行，不拉 `tough-cookie`；新增依赖必须先问。
- 宿主半日志只用 `ctx.logger`，前缀 `[peerbar]`；客户端半没有 `ctx.logger`，用 `console.info/warn/error`。两半都禁止 `console.log`。
- 面向用户的文案走 `ctx.locale.register(ns, { zh, en })`，不把中文硬编码进渲染函数。
- 错误码集中在 `lib/codes.js`，前后端共用；响应统一 `{ ok: false, code, message, hostId? }`。
- 凡不同部署可能取不同值的，都做成 `Config` 字段（Schemastery schema，默认值写在 schema 里）。

示例（宿主半注册一条路由）：

```js
export const inject = ['webServer']

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-peerbar/api/state',
    handler: (req, res) => handleState(ctx, req, res),
  }), 'peerbar: state route')
}
```

## 自检闭环

```sh
# 1) 起一个隔离 profile 的 web 实例（复制 desktop profile，端口 3100）
scripts/dev-server.sh > .workbuddy/tmp/pb-web.log 2>&1 &

# 2) 自动验收：登录 → 截图侧栏 → 展开远端组 → 点开会话 → 再截图 → 断言
node scripts/ui-check.mjs --quick   # 日常：不建会话、不发消息、不调真模型（约 40s）
node scripts/ui-check.mjs           # 发布前全量：远端新建会话 + 真模型回复 + 计划预览（≤180s）
node scripts/panel-check.mjs        # 派生面板：远端文档预览 + 定时任务目录（缺数据记 skipped）
```

- 产物在 `.workbuddy/tmp/`：`ui-1-sidebar.png`、`ui-2-remote-expanded.png`、
  `ui-3-remote-session.png`、`ui-check.json`。
- 断言包含：工作区行 / 会话行数量、会话行缩进、远端标签、正文消息数、console error 必须为 0。
- **改完必须自己看图**（Read 图片），确认视觉与原生一致，再决定下一步。
- 宿主半改动要重启 `dev-server.sh`；客户端改动刷新页面即可（脚本每次新开页面）。
- `dev-server.sh` 每次启动会把测试 profile 的 `node_modules/dsh-peerbar` 软链重指到**当前工作树**；
  没有这一步，复制来的 profile 会去加载 `/home/nwj/Projects/dsh-peerbar`，自检绿了也没验证本次改动。

## 边界

**总是**

- 改完先跑自检闭环（见上）：`node --check`、`node --test`、`node scripts/ui-check.mjs`，并**亲眼看截图**；
  自检不过不向用户汇报「做完了」。
- 用户装的那份 DSH Desktop 只在**功能整体验证通过后**才让他重启；在此之前用 `dev-server.sh` 的隔离实例自测。
- 新核实的 dsh 契约补进 `docs/插件开发规范.md`，标【已核实】并给出证据位置（文件:行号）。

**先问**

- 新增 slot、遮蔽或替换官方 UI（尤其 `sidebar.workspaces`）。
- 引入第三方依赖。
- 改 `docs/意图.md`（冻结的需求基线）的验收项、非目标、里程碑。
- 任何写入 `~/.dsh/` 之外、或改动 dsh 安装目录的操作。

**绝不**

- 提交令牌、cookie、证书私钥（`.gitignore` 已挡住 `dsh-peerbar.json`、`*-cache.json`、`*.pem`、`*.key`，别用 `-f` 绕过）。
- 把令牌写进日志、错误 message 或任何响应体。
- 做白名单外的转发、任意 WS 帧转发。
- 任何跨机写操作——**只有用户显式触发时例外**：
  - 终端：亲手打开右侧栏终端标签，经 `lib/terminal.js` 代理 `terminal/attach|retain`；
  - 定时任务：在任务详情里改期/删除，经 `schedule/update|delete` 代理到该任务所属 Host。
  没有后台写入、没有自动执行，端点白名单之外一律拒绝。
