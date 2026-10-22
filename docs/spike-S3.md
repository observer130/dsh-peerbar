# spike-S3：会话正文可得性

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-22 |
| 被测端 | nv50 `https://192.168.3.50:3080`（dsh 0.2.1-rc.2） |
| 结论 | **可读，且不需要 WebSocket**。`session/projections` 拿 `asOfSeq` → `session/page` 拉一段历史 |
| 影响 | M3 的「只读正文」按原计划做，不需要降级，也不需要实现 `/api/remote.mux` |

## 1. `session/follow` 走不通（这是唯一的坑）

```
POST /api/session/follow
→ ok=false code=incompatible
  "typert gateway: session/follow: stream Remote methods must be opened through the stream carrier"
```

`session/follow` 是流式端点，只能经 WS `/api/remote.mux` 打开。它同时是官方文档里
`throughSeq` 的来源（"obtained from the corresponding follow opening frame"）。

## 2. 绕法：用 `projections.asOfSeq` 当切点

`session/projections` 是 unary，返回 `{kind, asOfSeq, values}`，`asOfSeq` 就是当前
已提交的日志水位。把它当 `throughSeq` 传给 `session/page`，能直接拿到历史：

```
POST /api/session/projections  {"args":{"request":{"sessionId":"session-…"}}}
  → {kind:"sequenced", asOfSeq:466, values:{title, tokenUsage, …}}

POST /api/session/page
  {"args":{"request":{
     "address":{"kind":"session","sessionId":"session-…"},
     "throughSeq":466,
     "maxMessages":30}}}
  → {records:[…], hasMore:true}
```

实测：**30 条消息 / 8.3 KB / 34 ms**，`hasMore=true` 表示还有更早的。

## 3. records 的形状

每个 record 是 `{type:"event", event:{type, seq, time, data, surfaceOp}}`。
一次 `maxMessages:30` 的请求返回了 **169 条 record**，因为里面混着大量过程事件：

| event.type | 条数（一次 30 条的样本） | 处理 |
| --- | --- | --- |
| `assistant/message` | 28 | 取 `data.message.content` 里的 `text`；`tool-call` 只留工具名 |
| `tool/call` | 27 | 丢 |
| `tool/result` | 27 | 丢（正文可能 3 KB+，展示价值低） |
| `step/start` / `step/end` | 55 | 丢 |
| `job/registered` / `job/settled` | 24 | 丢 |
| `user/message` | 2 | 取 `data.content` 里的 `text` |
| 其它（todo/write 等） | 少数 | 丢 |

消息内容字段：

```jsonc
// user/message
{ "data": { "role": "user", "content": [{ "type": "text", "text": "…" }], "source": {…} } }

// assistant/message
{ "data": { "message": { "role": "assistant", "content": [
    { "type": "reasoning", "text": "…" },
    { "type": "tool-call", "name": "bash" },
    { "type": "text", "text": "…" }
] } } }
```

**注意**：`user/message` 的正文在 `data.content`，`assistant/message` 的在
`data.message.content`——两者不同层，写代码时别假设统一。

## 4. 落地的裁剪规则（`lib/transcript.js`）

- 只保留 `user/message`（有 text）与 `assistant/message`（有 text 或有 tool-call）。
- 纯 reasoning 的消息丢弃；只有工具调用的消息保留，`text` 为空、`tools` 带工具名，
  否则连续多轮会看起来像断片。
- 单条文本超过 8000 字截断并标注原长；`maxMessages` 收口到 1–50，默认 20。
- 单条 record 最大见过 32 KB，所以响应体积主要取决于条数，30 条约 8 KB 是可接受量级。

## 5. 未做

- **向前翻页**：已做。`session/page` 接受 `beforeSeq`，实测严格向前、无重叠。
- **工具结果展开**：已做。`tool/call` 与 `tool/result` 靠
  `data.callId` / `data.message.toolCallId` 配对；参数截 400 字、结果截 4000 字，
  前端用 `<details>` 折叠。实测 30 条消息含 27 个工具调用，全部配到结果，载荷约 34 KB。
- **本机路径**：`ctx.sessionController` 上同样有 `projections()` / `page()`，形状一致，
  已按同一套规则接上，并已在真实本机会话上验证。
