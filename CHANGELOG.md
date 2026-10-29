# Changelog

本项目在 0.5.0 之前没有正式发布（只能填仓库绝对路径安装），下面是按能力阶段整理的历史。

## 1.2.0 — 远程工作区管理优化（2026-10-29）

- **远端工作区组默认收起**：官方侧栏的分组默认就是收起的，但用户展开过的组会被官方
  记住（`dsh.workspace.view.v5`）。插件用 `ctx.uiWorkspace.view.setGroupExpanded`
  + 本地账本 `dsh-peerbar.collapsedRemote.v1` 做到：新出现的远端组收一次；升级后
  **第一次**加载把已有远端组也收一次（一次性迁移标记 `.migrated.v1`），之后完全以
  官方记住的展开状态为准。设置页新增「收起全部远端工作区」按钮
- **「添加工作区」支持远端目录**：接管官方 single 座位
  `sidebar.workspaces.directoryFlow` 与 `conversation.hero.workspace.directoryFlow`，
  对话框顶部可选「本机 / nv50 / m50」；远端经只读 `directoryPicker/list` 浏览、
  `workspace/create {path}` 在远端注册，本机分支仍交回官方 `onPicked`（建工作区 +
  开新会话）。路径框可直接编辑回车跳转；桌面端本机是 native picker 时退化为系统对话框
- **上游提案**：`docs/上游提案-侧栏分组座位.md` 说明为什么「本机/nv50/m50」分组行
  需要官方新增座位（list 分组头或 `WorkspaceView.section`），以及两种增量 API 建议
- **自检**：`ui-check` 新增 §1b（加载后远端组必须全收起）、§9（展开→清标记→重载→
  又被收起的迁移验证）、§1c（对话框有主机标签且能列远端目录）、§8（在 nv50 的 `/tmp`
  注册工作区 → 侧栏出现 `tmp · nv50` → `workspace/delete` 清掉）
- **验证**：`node --check` 通过；`node --test` 78 pass；`node scripts/ui-check.mjs` 全绿
  （截图 `ui-0-add-workspace.png`、`ui-0b-add-workspace-remote.png`、`ui-8-remote-workspace.png`）；
  `node scripts/panel-check.mjs` 通过（远端文档预览按数据记 skipped）

## 1.1.0 — 计划预览全文 + 定时任务实时刷新（2026-10-29）

接上联邦路线剩下的两条真实缺口。

- **计划预览全文**：右侧栏「计划」页签不再停在「正在读取计划…」。
  宿主半新增 `lib/follow.js`（`WS /api/follow`）单向转发 `session/follow`；
  浏览器在 `invokeRemote` 的流分支把 `session/follow` 换成同形状句柄
  （`createRemoteFollowStream`）；`session/page` 进 RPC 白名单并补线格式，
  供页签按 follow 的 cursor 往前翻页。地址只接受官方 `parsePlanAddress` 的两种形状
  （顶层会话 / 子代理），`buildFollowArgs` 有单测
- **定时任务实时刷新**：`$events` 的 `emit` 帧转发到 `ctx.remote.events.deliver`，
  白名单只放行 `schedule/changed`。远端改期/删除/投递后，本机「自动化任务」页与
  侧栏任务标记自动重取 catalog，不用刷新页面
- **文档**：`docs/架构.md` 补 §5.3/§5.4 与路由表；`docs/现状与计划.md` 重写能力矩阵、
  P1、沙箱演练步骤；`docs/插件开发规范.md` 补 §13.7/§13.8（follow 是流、emit 要投到
  同一实例、`schedule/create` 没有远程端点）；AGENTS/README 同步
- **验证**：`node --test` 78 pass；`node scripts/ui-check.mjs` 全绿，新增第 7 段
  （解档计划夹具 → 点卡片 → 右侧栏出现正文，截图 `ui-7-plan-preview.png`）；
  `schedule/changed` 用独立沙箱实例演练（远端 agent 建任务 → 本机面板不刷新即出现；
  远端删除 → 立即消失）

## 1.0.0 — 原生会话联邦（2026-10-29）

路线纠正：**聚合多个前端，而不是重画一个前端**。不再遮蔽 `sidebar.workspaces`，
远端数据投影进官方 store，侧栏、中栏、右侧栏全部由官方组件渲染。

- **侧栏**：`ClientWorkspaceModel.buildSnapshot` 追加远端组（本机在前、按登记顺序）；
  `sessions.list.getSnapshot` 合并远端行（含未打开会话、子代理、归档/置顶集合）。
  官方菜单、拖拽、运行点、未读、搜索原样可用；按 cwd 合成且没有正式会话的空组不投影
- **中栏**：`retain` 对联邦 id 就地造 binding（空窗口占位 + 异步 hydrate），
  官方 `openSession` 的同步语义不被破坏；正文、工具调用、交付物、模型选择全部官方
- **交互面**：`$events` waterfall 经官方 `dispatchWaterfall` 派发（计划审阅、用户提问、
  工具审批的卡片与徽标都是官方的）；结果用收到请求那条 Connection 的 answer cookie
  回 `$events/result`。`session/control` 单向桥补投影（`userQuestions`/`inbox`/
  `subagentCatalog`）
- **写操作**：新建会话、改名、归档/取消归档、置顶/取消置顶、分叉全部改投所属 Host；
  跨主机拖拽与合成工作区改名/删除明确拒绝并说明原因
- **离线**：组与缓存标题保留，打开会话提示「{host} 连不上」，不刷 401；恢复自动回来
- **验证**：`ui-check` 改为联邦断言（官方行 key、正文 hydrate、远端新建 + prompt 实投、
  终端回显、空合成组回归）；真实 nv50 上跑通两轮计划审批（卡片 → 同意 → 远端继续）；
  单测 74 pass

## 0.9.0 — 远端文本预览与定时任务（2026-10-28）

- **文档预览**：远端会话里的文件链接不再被拦成提示，直接打开右侧栏预览；
  Markdown/代码/文本走 `workspaceFiles/read`，图片/PDF 走 `readBytes`
  （宿主半解析 multipart → base64 → 浏览器还原 Uint8Array）。Office 转换
  显式提示暂不支持，不静默读本机同名文件
- **定时任务**：宿主半新增 `GET /dsh-peerbar/api/schedule`，把各在线 Host 的
  `schedule/catalog` 合成一份并标注归属；客户端 `schedule/catalog` 走合成结果，
  `list/history/update/delete` 在会话未打开时按 sessionId 定位 Host
- **验证**：nv50 上让远端模型创建提醒「喝水」→「自动化任务」页列出任务，
  会话页头「1 个提醒」打开的详情显示规则（时间/时区/单次），不再显示「已删除」；
  远端 Markdown 实测渲染完整内容；远端 1×1 PNG 在预览面板渲染为 blob 图片
- **调研**：新增 `docs/远端派生面板.md`，记录五个面板的数据来源与剩余工作
  （交付物已可用；计划缺 `session/follow`/`session/page`；子代理依赖本地投影；
  二进制预览缺 multipart 通道）

## 0.8.0 — 远端终端（2026-10-28）

- **官方右侧栏终端直连远端 PTY**：浏览器 ↔ 本机插件 ↔ 远端 `/api/remote.mux`
  的双工 WS 代理；xterm、输入窗口、ack、刷新恢复全部复用官方实现，不自绘终端
- **宿主半**：`ctx.webServer.registerUpgrade` 认领 `/dsh-peerbar/api/terminal`，
  端点白名单只有 `terminal/attach|retain`；按 `hostId` 路由、裸会话 ID 换远端
  agentId/sessionId；每条流单独换 cookie
- **客户端半**：`terminal` namespace 的 unary 改走 `/hosts/<id>/rpc` 白名单
  （environment/shells/list/create/rename/close），`attach|retain` 换成同形状
  双工句柄（`send()` + `for await`），官方终端模型无需改动
- **流层**：`openRemoteStream` 增加 `send()`/`end()`；新增 `encodeServerFrame`
  （服务端帧不加掩码，否则浏览器断连）
- **验收**：`ui-check`（含 `--quick`）新增远端终端阶段——打开右侧栏、新建终端、
  输入 `echo PBCHK-$((6*7))`、断言回显 `PBCHK-42`、关闭标签页回收；另验证刷新后
  `retain` 恢复提示符
- 单测新增 `test/terminal.test.js`（白名单、ID 映射、服务端帧、upgrade guard）

## 0.7.4 — compat 边界与收尾（2026-10-28）

- **私有 patch 集中到 `installClientCompat()`**：文件引用、浏览器面板、附件上传、
  namespace 拦截不再散落在 `apply` 主流程；卸载路径保持不变
- **减少动效**：侧栏 CSS 增加 `prefers-reduced-motion`，搜索头/箭头过渡可关闭
- **单列表回归**：`ui-check` 增加「按工作区 → 单列表 → 按工作区」断言，防止
  本机平铺时丢掉远端组
- **契约回写**：`AGENTS.md` 与插件规范记录 rc.3 子座位所有权限制；新增上游
  additive slot 提案草案（`docs/upstream-slot-proposal.md`）

## 0.7.3 — 工作区组模型收敛（2026-10-28）

- **TreeGroup**：本机工作区、未分组桶、远端工作区归一成同一套组字段
  （key/source/host/workspace/rows/label/defaultOpen/manageable/containsCurrent）
- **单一组渲染器**：删除 `renderLocalGroup` / `renderRemoteGroup`，合并为
  `renderTreeGroup`；本机/远端差异只剩「新建会话入口、Host 标签、离线状态」
- 远端新建会话抽成 `createRemoteSession`，不再在渲染期创建闭包
- 单列表视图语义不变：本机会话平铺，远端组仍按组显示

## 0.7.2 — 侧栏样式去哈希（2026-10-28）

- **侧栏样式不再依赖官方构建期类名**：`koUx-W_*` / `hP3ldq_*` 全部换成
  插件自有的 `dshp-*`，布局数值对齐官方当前实现，颜色/圆角/边框仍走
  `--dsw-*` token；官方前端重新构建不会再把侧栏样式打碎
- **按钮尺寸拆开**：头部 28×28 用 `dshp-headerButton`，行内 16×16 用
  `dshp-iconButton`，不再共用官方的两套哈希类
- **回归断言**：`ui-check` 新增 `.dshp-root` 内禁止出现官方哈希类名的检查
- 无交互变更；菜单、拖拽、归档/置顶、搜索、空态行为保持不变

## 0.7.1 — 客户端生命周期与树模型收敛（2026-10-28）

- **可卸载的补丁**：样式、服务就绪轮询、`sidebarRight.openResource/openTab`、
  `fileUpload.upload`、namespace `invokeRemote`、`ISessions` 原型与
  `list.set/getSnapshot` 都保存原方法并登记 disposer；卸载时还原并清掉
  `__peerbar*` 标记，重载不再留下半残拦截
- **本机写操作改官方入口**：rename 走 `sessions.using(...).binding.session.rename`，
  fork 走 `sessions.fork`，去掉 `callOn('sessions','rename')` 这类非公开路径
- **本地/远端行与菜单收敛**：ProjectRow、Session 菜单、Workspace 菜单各合并为一份；
  新增 `toTreeSession`，渲染层只消费归一后的字段，不再在 JSX 里散落 `host ? ... : ...`
- **重命名体验**：对话框聚焦时全选当前名称；会话行补 `aria-selected`
- **rc.3 子座位结论**：影子替换带 children 的 single slot 后无法接回
  `props.renderSlot`，补声明会撞 `already declared`；恢复组合需要上游 additive slot
  （详见 `docs/插件设计优化分析.md` 第 8 节）

## 0.7.0 — v7 收尾（2026-10-28）

- **主视图面包屑随远端改名同步**：修掉 v6 的 T10 尾巴。根因是远端 binding 被官方
  store 冻结后 `summary` 赋值静默失败，且合成行快照有版本缓存；改为闭包 accessor +
  版本失效后，改名 ≤10s 内侧栏、窗口标题、面包屑三者一致
- **远端「浏览器」面板整体降级**：远端会话里不带 URL 的浏览器入口（引导页/快捷键）
  不再打开空白本机页，改为提示；带 loopback URL 的仍复制 + 提示；非 loopback 照常打开
- **文案统一**：设置分区与空态从「多机侧栏」改为「远程工作区」
- **远端终端评估结论**：`terminal/attach` 是带背压/ack/重连的双工 PTY 流，
  现有只读 mux 接不了，收益与 SSH 重叠，决定不做（`docs/spike-S4.md`）
- `ui-check` 增加面包屑断言：必须与侧栏选中行同名

## 0.6.0 — v6 批次 1–2（2026-10-28）

- **侧栏拖拽排序**：组内拖动会话、同 Host 内拖动工作区；本机走 `workspaces.insertBefore` /
  `insertSessionBefore`，远端走 `workspace/insertBefore` / `insertSessionBefore`，刷新后保持
- **视图偏好持久化**：分组方式、排序方式、归档过滤存 `localStorage`；拖拽开始时自动切「手动排序」
- **测试分层**：新增假远端契约测试（`test/support/mock-host.js` + 8 条用例），单测 59 → 67、
  1.3s 跑完；`ui-check` 增加 `--quick`（约 40s，不建会话、不调真模型）
- **打包验收**：`npm pack` 产物在隔离 profile 安装通过（`/health` 200、security 10/10、
  `ui-check --quick` 全绿）；README 补 tgz 安装方式
- **远端 localhost 链接保护**：远端会话里从聊天区打开 loopback 链接时改为复制地址 + 提示，
  不再在本机打开远端端口；右侧「浏览器」面板本身仍是本机组件（已知限制）
- **远端未读提示**：按官方 `completionUnread` 语义观察 running 的 true→false，
  后台会话跑完显示完成圆点，打开即清（内存态，与官方一致）
- **远端文件面板自动刷新**：新增 SSE 路由 `/api/watch`，把浏览器订阅转发到远端
  `workspaceFiles/changes` 流；面板不再依赖手动刷新

## 0.5.0 — v5 一期

- **远端历史分页与上翻**：首屏 200 条消息（原被压到 50）；向上滚动按 Turn 对齐加载更早的页，
  `hasMore` 不再恒为 false；可一路翻到 `seq=0`
- **远端会话标题实时同步**：远端改名后主视图标题 / 浏览器标签立即更新，不用重开会话
- **cookie 过期自愈**：写操作遇到 `auth-required` 时自动重探换 cookie 并重试一次，不再瞬间报错
- **工作区信息退化可见**：baseline 读取失败时，侧栏在组行给出 ⓘ（含原因），不再「菜单凭空消失」
- **远端文件引用拦截**：远端会话里点文件只提示「在远端某主机上」，不会在本机打开同名文件
- 文档与元数据对齐实现：README 去掉「只读」描述，补能力清单与已知限制
- **兼容 `0.2.1-rc.3`**：升级后复验通过——18 个白名单端点（当时的全部）、`session/page` 的
  `beforeSeq`/`turnWindow`、`sidebarRight.openResource`、`ctx.remote.session.modelCatalog`、
  `sidebar.workspaces` 的 `directoryFlow` 子座位全部仍在；58 单测 + ui-check 全绿

### v5 二期（同版本内）

- **远端图片渲染**：消息里的图片经 `session/attachment` 取回 base64，转成官方
  `readAttachment` 契约的 `number[]`，历史图片正常显示
- **远端发图/附件**：图片仍走官方内联发送；非图片文件接管 `fileUpload.upload`，
  改投远端 `fileUploads/upload`
- **运行时兼容告警**：`/state` 增加 `compatError`；深端点探测失败时侧栏显示 ⚠
- **`dsh web` 形态验证**：侧栏接管 / RPC 代理 / WS baseline / 续聊 e2e 在 web profile 下跑通

### v5 三期（同版本内）

- **远端斜杠命令**：拦截 `RemoteNamespaceService.invokeRemote`，`commands/*`
  按会话归属转发到远端
- **远端文件面板（只读）**：同一拦截点代理 `workspaceFiles/list|read|stat`；
  watch 流先给 readiness，不再卡「正在读取…」
- **「@」补全**：补上 `fileReferences` / `sessionReferenceResolver` / `skills` 三个 namespace
- **模型切换 / 压缩**：`session/modelCatalog|selectModel` 按 host 路由；
  `commands/execute` 超时预算 60 秒
- **子座位**：影子替换后不再重复声明 `sidebar.workspaces` 的 children
  （rc.3 会抛 `slot ... is already declared`）

## 0.4.0 — v4 远端交互（未单独发版）

- 侧栏接管：本机 + 远端工作区/会话混排，Host 标签区分来源
- 远端会话管理：置顶、改名、分叉、归档/取消归档、复制 ID
- 远端工作区管理：改名、删除、新建会话；侧栏「＋」添加远端工作区
- 远端续聊：原生 composer 发消息 / 停止 / 队列；回复轮询增量追加
- 模型切换：模型座读写远端 `modelSelection` 投影
- 远端分组改为注册表驱动：空工作区也显示，未归属会话进「未分组」

## 0.1.0 — 初始骨架

- Host 登记、令牌换 cookie、探活与在线状态
- 只读：只做状态探测与凭据交换，不新建会话、不发消息
