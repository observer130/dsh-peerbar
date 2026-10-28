# Changelog

本项目在 0.5.0 之前没有正式发布（只能填仓库绝对路径安装），下面是按能力阶段整理的历史。

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
