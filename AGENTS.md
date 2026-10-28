# AGENTS.md

给 coding agent 的工作说明。人类向的项目介绍在 [README.md](README.md)；dsh 插件 API 的事实基线在 [docs/插件开发规范.md](docs/插件开发规范.md)。

## 项目速览

- **是什么**：一个 DeepSeek Harness（dsh）插件。**在原生侧栏那一列里**把本机工作区/会话与多台远端（nv50 / m50）混排成一棵树；点远端会话在原生中栏续聊。形态见 `docs/实现方案-A.md`（ADR-001），需求以 `docs/功能复述.md` 为准。
- **技术栈**：纯 JavaScript ESM，**无构建步骤**，目标零第三方依赖。宿主半跑在 Node，客户端半是浏览器 `__ModuleLoader__` bundle。
- **目标宿主**：dsh `0.2.1-rc.2` / `rc.3`（两者都实测通过），profile `~/.dsh/profiles/desktop`。
- **当前阶段**：v5 一期（分页/标题同步/401 自愈/退化提示/文件引用拦截）、二期（远端图片/附件/兼容告警/web 形态）、三期（斜杠命令/远端文件面板/`@` 候选/模型切换）已全部合入 `master`；单测、security-check、ui-check 均通过。v6 批次 1–2 进行中（分支 `feat/v6-drag`）：测试分层（66 单测 + `ui-check --quick`）、视图偏好持久化、拖拽排序已完成；剩余打包、未读、远端终端/浏览器，见 `docs/一期计划-v6.md`。
- **两半结构**：`lib/index.js` 宿主半（注册路由、探活、拉取远端快照、缓存）；`lib/client.js` 客户端半（影子注册 `sidebar.workspaces`、`settings.section`；远端会话合成 SessionBinding 后交原生 `openSession`）。两半之间只通过同源 HTTP 通信。

## 架构不变量

这几条是设计前提，不是可调偏好：

- **形态是硬约束**：远端工作区/会话必须出现在原生侧栏那棵树里（`sidebar.workspaces` 座位）。
  **禁止**用「侧栏图标 + 中栏整页」、右侧 dock、全屏浮层来替代——上一版就是这么翻车的。
- **本机数据不另拉一份**：用 slot 的 `useWorkspaces` / `useSessions` hooks，和官方树同源，避免同一会话两行。

- **浏览器不直连远端**。所有跨机请求由宿主半发起（远端 cookie 是 host-only + `SameSite=Strict`，浏览器跨 origin 拿不到）。
- **远端只提供数据，不提供 UI**。不加载远端插件 bundle，不把远端 slot 接进来。
- **虚拟 ID 才是主键**：`peerbar:<hostId>:<kind>:<rawId>`。裸 `workspaceId`/`sessionId` 在不同 Host 间会撞。
- **各 Host 独立并发与退避**。单台失败不得让 `/state` 整体失败，也不得影响其他 Host。

## 环境

| 项 | 值 |
| --- | --- |
| 宿主 | DSH Desktop `dsh-desktop-linux-bin 0.2.1rc.3-1`（本机唯一安装） |
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
lib/remote.js    令牌换 cookie、RPC 信封、session/list、分页、错误分类
lib/rpc.js       远端 RPC 白名单（/hosts/<id>/rpc 只放行这张表）
lib/stream.js    只读流通道：WS /api/remote.mux 取 workspace/follow 的归档集
lib/probe.js     探活状态机与退避
lib/peers.js     每 Host 的快照编排、调度与缓存
lib/codes.js     错误码，前后端共用
lib/client.js    客户端半：sidebar.workspaces / settings.section + 远端会话绑定
test/            node:test 单测
docs/            需求、插件开发规范、开发计划、spike 结论
```

新增文件前先想归属；`lib/index.js` 只做装配，不堆业务。

## dsh 插件契约（最容易写错的五条）

完整清单见 `docs/插件开发规范.md`，这里只放会直接导致返工的部分：

1. `sidebar.workspaces` 是 **single** slot 且被官方独占，**不能往里追加行**；本插件用 `priority: -1` 影子替换它、自己画整棵树。影子替换只替换渲染：官方 entry 的 `children` 声明仍然生效，**不要重复声明子座位**（会抛 `slot ... is already declared`）；rc.2 曾需要声明，升级后先跑 `scripts/compat-check.sh` 确认。
2. 插件自己注册的 `ctx.webServer` 路由**没有任何认证**——dsh 的浏览器 cookie 与 Host/Origin 校验只覆盖 `/api`。同源/回环 guard 必须自己写。
3. `/api` 不是 REST：`POST /api/<namespace>/<method>` + `{ args }`，流式走 WS `/api/remote.mux`。
4. 客户端半必须是 `window.__ModuleLoader__.load({ id, factory(require) })`，**不能出现 `import`/`export`**；`react`、`react-dom`、`@deepseek-ai/dsh-client-ui-primitives` 是 baseline external，禁止打包进自己的 bundle。
5. 宿主半依赖用静态 `export const inject = [...]`，不要手动等 service。

写任何 dsh API 之前，先在本机 `@deepseek-ai/*` 包的 `README.zh.md` 或 `lib/*.js` 里核实，别凭记忆。

## 代码风格

- ESM，`node:` 前缀导入内置模块；两空格缩进；单引号；保留分号。
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

## Git 与合并闸门（2026-10-22 重写）

**教训**：上一轮每改一两个 commit 就 `--no-ff` 合进 `master`，功能还是错的，导致 master 不可用、
用户被迫反复验收。以下规则不可协商：

1. **`master` 只接受「已验证可用」的状态**。合并 = 一次发布，不是一次提交同步。
2. 开工先拉**长生命周期功能分支**（`feat/<feature>`），在整个功能完成前**不合回 master**，
   中途随便 commit（`wip:` 前缀也可以）。
3. 合回 master 前必须同时满足：
   - `node --test test/*.test.js` 全绿；
   - `node --check lib/*.js` 通过；
   - **`scripts/ui-check.mjs` 全绿**（会自动登录本地实例、点开远端会话、截图、收集 console error）；
   - 我**亲自看过截图**，并逐条对照 `docs/功能复述.md` 的交互表；
   - 宿主半改动已重启实例验证，客户端改动已刷新验证。
4. 只要功能还有一项不对，就**不合**；需要保留进度就继续在该分支上 commit。
5. 已经合错的，**回滚那次 merge**，不要「在新 commit 里顺手修」把 master 当成工作区。
6. 提交信息：Conventional Commits + 中文主题，正文必须写「怎么验证的」；验证方式写不出来的提交，
   说明还没做完，留在功能分支上。

## 自检闭环（不许再让用户当第一验收人）

```sh
# 1) 起一个隔离 profile 的 web 实例（复制 desktop profile，端口 3100）
scripts/dev-server.sh > .workbuddy/tmp/pb-web.log 2>&1 &

# 2) 自动验收：登录 → 截图侧栏 → 展开远端组 → 点开会话 → 再截图 → 断言
node scripts/ui-check.mjs --quick   # 日常：不建会话、不发消息、不调真模型（约 40s）
node scripts/ui-check.mjs           # 发布前全量：含远端新建会话 + 真模型回复（≤180s）
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
- 改 `docs/需求交接.md` 的验收项、非目标、里程碑。
- 任何写入 `~/.dsh/` 之外、或改动 dsh 安装目录的操作。

**绝不**

- 提交令牌、cookie、证书私钥（`.gitignore` 已挡住 `dsh-peerbar.json`、`*-cache.json`、`*.pem`、`*.key`，别用 `-f` 绕过）。
- 把令牌写进日志、错误 message 或任何响应体。
- 做白名单外的转发、任意 WS 帧转发、任何跨机写操作。
