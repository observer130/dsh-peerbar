# ADR-001：顶替 `sidebar.workspaces` 座位，会话打开交回原生

| 项 | 值 |
| --- | --- |
| 状态 | **已定**（2026-10-22），执行前需先完成 E1 / E2 两个实验 |
| 取代 | `docs/需求交接.md` §8.2「注入原生侧栏工作区树」——该路线不可行，见下 |
| 目标 | 远端工作区/会话出现在**原生侧栏那一列**里，点开在**原生中栏**读 |

---

## 1. 结论

1. 客户端半边**接管** `sidebar.workspaces` 这个 single 座位，自己渲染一整棵树：本机工作区 + 各远端工作区。
2. 点**本机**会话 → 调 `ctx.uiWorkspace.openSession(id)`，交给原生把中栏切到对话。我们一行对话 UI 都不写。
3. 点**远端**会话 → 调 `ctx.layout.selectPanel('peerbar-session')`，切到我们注册的只读正文面板（`main` 槽的一个 key）。**不需要侧栏图标**，所以不会变成「又一个入口」。
4. 不碰 preboot、不改原生 store、不做 iframe、不镜像远端目录。

---

## 2. 为什么不选 B（preboot 包装原生 list store）

B 能做到「官方 UI 原样渲染远端条目」，但代价是：

- 要在客户端 bootstrap 之前替换原生 list store，属于逆向内部结构，0.2.x 每次小版本都可能碎；
- Codingns4DSH 走的就是这条，至今在 spec 里仍标着「原生 Session binding / Conversation Remote 协议缺口」，并保留 DOM 注入降级路径——说明**点击远端会话能不能打开**这块骨头它也没完全啃下来；
- 对本项目目标是个人自用、单人维护，版本跟进成本不划算。

A 的代价是「官方那棵树换成我们的」，但换来的是：不逆向内部、不依赖未公开协议、远端正文完全由我们控制（只读，天然安全）。

---

## 3. 已核实的事实（0.2.1-rc.2，前缀 `/opt/dsh-desktop-linux-bin/resources/app/dsh/node_modules/@deepseek-ai/`）

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 | `sidebar.workspaces` 是 **single**，被 ui-workspace 独占；往里注册会**顶替**官方树，而不是追加 | `dsh-cordis-client-runner/lib/client.js` 的 slot 目录 |
| F2 | `sidebar` 本身是 single，由 SidebarRoot 占据，它声明了「工作区座位」和「设置座位」；我们只顶替前者，设置入口不受影响 | 同上（`key:"sidebar"` 的 doc） |
| F3 | 客户端有 `uiWorkspace` 服务：`openSession(target)`（内部 `replaceMain(target, …, 'reveal')`）、`openWorkspace(workspaceId, …)`、`forkSession` | `dsh-client-ui-workspace/lib/client.js`；服务名 `super(ctx, "uiWorkspace")` |
| F4 | 有 `ctx.layout.selectPanel(panelId)` / `beginNavigation()` / `panelInfo`，用于选中某个 main 面板或「回到对话」；`selectPanel` 会校验该面板是否已注册，未注册直接抛错 | `dsh-client-ui-layout/lib/client.js`，且 ui-workspace 自己就在调 |
| F5 | `main` 是 **keyed**：「Central panel selected by sidebar entry id；保留 key `conversation` 承载对话，其它 key 不绑定 Session」 | slot 目录 |
| F6 | 可追加的行级座位（`sidebar.session.row.action` / `.leading` / `.hover`、`sidebar.workspaces.session.row.action`）**只能装饰已存在的行**，不能新增行 | slot 目录 |
| F7 | 远端读取链路已验证：令牌 → `/connect?token=…` 换 `Set-Cookie: dsh-auth-*`（30 天）→ `POST /api/session/list` RPC 信封；nv50 实测 26 条会话 | `docs/spike-S1.md`、`docs/开发计划.md` §1.4 |

> F3 是这次翻案的关键：上一版没有找到 `openSession`，所以只能自己画对话区，最后退化成「整页聚合页」。现在点本机会话可以完全交给原生。

---

## 4. 界面结构

```
sidebar（single，SidebarRoot，官方）
├── sidebar.workspaces   ← 我们顶替：一棵树（本机 + 远端）
│     ├─ 本机工作区…（数据来自 ctx.workspaces / ctx.sessions）
│     └─ nv50 [nv50] → 远端会话…（数据来自 /dsh-peerbar/api/state）
└── sidebar.settings     ← 官方，原样保留（设置入口不能丢）

main（keyed）
├── conversation         ← 官方对话区
└── peerbar-session      ← 我们注册：远端会话只读正文
```

交互映射：

| 用户动作 | 调用 | 结果 |
| --- | --- | --- |
| 点本机会话行 | `ctx.uiWorkspace.openSession(sessionId)` | 原生切到对话，和官方树行为一致 |
| 点远端会话行 | `setTarget({hostId, sessionId})` → `ctx.layout.selectPanel('peerbar-session')` | 中栏换成只读正文 |
| 点本机工作区「+」 | `ctx.uiWorkspace.openWorkspace(workspaceId)` | 原生在该工作区新建/打开会话 |
| 点远端工作区「+」 | 不给这个按钮 | 只读，远端不建会话 |
| 折叠/展开、搜索 | 本地组件状态 | 不走原生 |
| 断线 | 组置灰 + `stale` 标记 | 仍可展开缓存标题，点行提示 |

---

## 5. 要接受的损失（v0.1 明确放弃的原生侧栏能力）

顶替座位就意味着这些原来由官方树提供的能力没了，**必须写进 README 的「已知限制」**，不要装作还在：

- 工作区右键菜单（重命名、移除、复制路径等）；
- 会话行菜单（归档、删除、置顶、复制会话 ID）；
- 拖拽调整工作区/会话顺序；
- 侧栏内的「添加工作区」入口（目录选择器仍在「新建会话」的 hero 里，`conversation.hero.workspace.directoryFlow`，**新会话的主路径没断**）；
- 会话置顶（pinned）的视觉分组。

若这些日后要补：一律走宿主/客户端已有 API 逐个接回，不要为了它们去改原生 store。

---

## 6. 必须先做的两个实验

### E1：main 面板能不能「不进图标也选中」（决定 §4 的远端正文方案）

1. 注册 `main` 的 key `peerbar-session`，**不注册** `sidebar.panellist`；
2. 控制台/临时按钮里调 `ctx.layout.selectPanel('peerbar-session')`；
3. 观察：
   - 中栏是否切过去？
   - 是否被 `retainMainPanels` 立刻弹回 `conversation`？（layout 的 actions 里有 `retainMainPanels(panelIds)`，如果它只保留「有侧栏入口的面板」，我们的面板会被踢掉）
   - 切到一个本机会话后，是否正常回到对话？
4. **判定**：稳定停留 ≥10s 且不影响本机会话 → 通过。
5. **失败退路**：
   - R1：同时注册一个 `sidebar.panellist` 条目（`order` 放最后），图标会出现在侧栏图标栏底部——能接受，因为主路径仍是树里点行；
   - R2：把远端正文改为 `conversation.view` 的一个视图（list 槽，会话级，渲染一次一个），但需要「当前会话 = 远端会话」的绑定，大概率走不通；
   - R3 兜底：远端行点击不切主面板，弹出只读浮层（`shell.overlay`）——体验降级，但功能不丢。

### E2：本地数据形状（决定树里本机部分怎么取数）

1. 打印 `ctx.workspaces`（快照里应有 `items[{workspaceId, cwd, name, pinned…}]`）与 `ctx.sessions`（`byId` / `list`）的实际字段；
2. 确认能否拿到：工作区名、cwd、会话标题、最后活动时间、running 状态、归档/置顶标记；
3. **判定**：够渲染树 → 用 ctx（不重复拉接口）；不够 → 退回用 `/state` 的 `local` 段（宿主侧已实现）。

> 两个实验都只改客户端半边，改完刷新页面即可，不用重启 dsh。

---

## 7. 任务卡

| ID | 内容 | 产出 | 验收 | 依赖 |
| --- | --- | --- | --- | --- |
| T1 | 座位接管脚手架 | `client.js` 注册 `sidebar.workspaces` 单一入口，渲染「本机工作区树」最小版（组 + 行，无远端） | 侧栏能选本机会话进原生对话；**设置入口仍在**；关闭插件后侧栏完全还原 | E2 |
| T2 | 远端并入 | 消费 `/dsh-peerbar/api/state`，远端组接在本机之后，来源标签 + 颜色 | nv50 的 6 个工作区出现在树里，点开能看到 26 条会话的标题 | T1、F7 |
| T3 | 远端正文 | `main` key `peerbar-session` + `layout.selectPanel`，只读消息流 + 复制 | 点远端会话在中栏可读；点本机会话能正常回到对话 | E1、T2 |
| T4 | 状态与容错 | 断线置灰、缓存展开、5s 复检、恢复回色 | 断网 30s 不白屏；恢复 ≤10s | T2 |
| T5 | 最小交互补齐 | 折叠状态记忆、搜索框、`+` 新建会话、行内「复制路径」 | 日常够用；不引入拖拽/菜单 | T3 |

**复用上一轮已验证的成果**（不要重写）：`lib/{peers,probe,remote,config,guard,identity,transcript,codes}.js`、`scripts/security-check.sh`、`test/*`。缺的只有 `lib/client.js` 的树与正文两个组件。

---

## 8. 禁止事项（上一轮翻车的直接原因）

1. ❌ 不要用「侧栏图标 + 中栏整页」作为功能入口——那是上一版，被否；
2. ❌ 不要改 preboot、不要 patch 原生 store（B 路线，本版本不采用）；
3. ❌ 不要注册到 `sidebar`（整个左栏）——会把设置入口一起顶掉；
4. ❌ 不要试图往 `sidebar.session.row.*` 塞新行——那只是装饰位；
5. ❌ 不要 iframe 远端页面（远端没有会话级 URL，只能开首页）；
6. ❌ 不要让本机数据另拉一份接口——会和原生状态不一致，出现同一会话两行。

---

## 9. 风险

| 风险 | 信号 | 应对 |
| --- | --- | --- |
| 官方升级改了 `sidebar.workspaces` 的 ownerProps | 组件收不到折叠/宽度状态 | 只依赖必要 props，缺省值兜底；版本锁 0.2.1-rc.x |
| `retainMainPanels` 踢掉我们的 main 面板 | E1 复现 | 走 R1（补 panellist 图标） |
| 树渲染性能（本机 187 + 远端 26 会话） | 首屏卡顿 | 默认折叠远端组；行组件 memo；搜索本地过滤 |
| 用户依赖被放弃的原生菜单 | 使用反馈 | README 明示；后续按需接回 |
