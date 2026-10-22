# AGENTS.md

给 coding agent 的工作说明。人类向的项目介绍在 [README.md](README.md)；dsh 插件 API 的事实基线在 [docs/插件开发规范.md](docs/插件开发规范.md)。

## 项目速览

- **是什么**：一个 DeepSeek Harness（dsh）插件。在本机登记多台远端 dsh，管理访问凭据（启动令牌换 cookie）与在线状态。**v0.1 不做聚合视图**（2026-10-22 范围调整），界面只有「设置 → 多机侧栏」。
- **技术栈**：纯 JavaScript ESM，**无构建步骤**，目标零第三方依赖。宿主半跑在 Node，客户端半是浏览器 `__ModuleLoader__` bundle。
- **目标宿主**：dsh `0.2.1-rc.2`，profile `~/.dsh/profiles/desktop`。
- **当前阶段**：M0–M1 已完成并在真实实例上验收；M2/M3 的聚合视图部分按范围调整取消，数据层（探活、快照、正文读取）保留但未暴露 UI。
- **两半结构**：`lib/index.js` 宿主半（注册路由、探活、拉取远端快照、缓存）；`lib/client.js` 客户端半（只注册 `settings.section`）。两半之间只通过同源 HTTP 通信。

## 架构不变量

这几条是设计前提，不是可调偏好：

- **浏览器不直连远端**。所有跨机请求由宿主半发起（远端 cookie 是 host-only + `SameSite=Strict`，浏览器跨 origin 拿不到）。
- **远端只提供数据，不提供 UI**。不加载远端插件 bundle，不把远端 slot 接进来。
- **虚拟 ID 才是主键**：`peerbar:<hostId>:<kind>:<rawId>`。裸 `workspaceId`/`sessionId` 在不同 Host 间会撞。
- **各 Host 独立并发与退避**。单台失败不得让 `/state` 整体失败，也不得影响其他 Host。

## 环境

| 项 | 值 |
| --- | --- |
| 宿主 | DSH Desktop `dsh-desktop-linux-bin 0.2.1rc.2-1`（本机唯一安装） |
| 自带运行时 | `/opt/dsh-desktop-linux-bin/resources/runtime` — Node 24.21.0 / pnpm 11.28.5 |
| profile | `~/.dsh/profiles/desktop`，**由 Electron 独占**，CLI 无法管理 |
| 限制 | agent shell 有 `ulimit -v 4GB`，不要从里面直接起 dsh 进程 |

装插件**只能走桌面版 UI**：侧栏「插件」→ 标题旁箭头 → 安装第三方插件 → 填 `/home/nwj/Projects/dsh-peerbar`。任何 `dsh plugin --profile desktop ...` 都会报 `profile "desktop" is managed exclusively by the Electron application`。

## 命令

```sh
# 语法自检（无构建、无 tsc，语法错只会在加载时炸）
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
```

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
lib/remote.js    令牌换 cookie、RPC 信封、session/list、错误分类
lib/probe.js     探活状态机与退避
lib/peers.js     每 Host 的快照编排、调度与缓存
lib/codes.js     错误码，前后端共用
lib/client.js    客户端半：panellist / main / settings.section
test/            node:test 单测
docs/            需求、插件开发规范、开发计划、spike 结论
```

新增文件前先想归属；`lib/index.js` 只做装配，不堆业务。

## dsh 插件契约（最容易写错的五条）

完整清单见 `docs/插件开发规范.md`，这里只放会直接导致返工的部分：

1. `sidebar.workspaces` 是 **single** slot 且被官方独占，**不能往里追加行**。v0.1 用 `sidebar.panellist`（图标入口）+ `main`（keyed 整页）。
2. 插件自己注册的 `ctx.webServer` 路由**没有任何认证**——dsh 的浏览器 cookie 与 Host/Origin 校验只覆盖 `/api`。同源/回环 guard 必须自己写。
3. `/api` 不是 REST：`POST /api/<namespace>/<method>` + `{ args }`，流式走 WS `/api/remote.mux`。
4. 客户端半必须是 `window.__ModuleLoader__.load({ id, factory(require) })`，**不能出现 `import`/`export`**；`react`、`react-dom`、`@deepseek-ai/dsh-client-ui-primitives` 是 baseline external，禁止打包进自己的 bundle。
5. 宿主半依赖用静态 `export const inject = [...]`，不要手动等 service。

写任何 dsh API 之前，先在本机 `@deepseek-ai/*` 包的 `README.zh.md` 或 `lib/*.js` 里核实，别凭记忆。

## 代码风格

- ESM，`node:` 前缀导入内置模块；两空格缩进；单引号；保留分号。
- 零第三方依赖是目标。要 cookie jar 就写二十行，不拉 `tough-cookie`；新增依赖必须先问。
- 日志只用 `ctx.logger`，前缀 `[peerbar]`。禁止 `console.log`。
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

## Git

- 从 `master` 拉分支：`feat/` `fix/` `spike/` `docs/` `chore/`，一个分支做一件事；合回用 `git merge --no-ff <branch>`，然后删分支。
- 提交信息：Conventional Commits + 中文主题。

  ```
  feat(probe): 按 TLS 错误码区分 tls-error 与 unreachable
  ```

  类型用 `feat|fix|docs|refactor|perf|test|chore|spike`，scope 用 `host|client|sidebar|probe|proxy|config|docs|deps`。正文写清为什么改、怎么验证的；一个提交只做一件事。

## 边界

**总是**

- 改宿主半后重启 DSH Desktop 再验证；改客户端半后重载窗口并看 console。
- 提交前跑 `node --check`。
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
- 抄 GPL 代码（`Codingns4DSH` 只能看设计，不能复制）。

## 文档地图

| 文件 | 作用 | 什么时候读 |
| --- | --- | --- |
| `README.md` | 用户向：功能、安装、版本、注意事项 | 对外表述有疑问时 |
| `docs/需求交接.md` | 需求、验收项、spike 清单 | 动手前；改需求先改这里 |
| `docs/开发计划.md` | 决策台账、路由契约、M0–M3 任务卡与验收命令 | 接任务时；任务编号（T0-1 等）与分支名以它为准 |
| `docs/插件开发规范.md` | dsh 插件 API 事实基线，逐条标【已核实】/【待验证】 | 写任何 dsh API 前 |
| `docs/spike-S*.md` | 每个 spike 的结论与原始输出 | 遇到 S1/S2/S3 相关问题时 |
