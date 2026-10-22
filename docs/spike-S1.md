# spike-S1：远端鉴权与读取通道

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-22 |
| 被测端 | nv50 `https://192.168.3.50:3080`（dsh 0.2.1-rc.2，自签证书） |
| 结论 | **可行**。手动粘贴启动令牌 → 换 API cookie → HTTP 调 `session/list`，全程无需在远端装插件 |
| 影响 | 推翻《开发计划》v1 的 provider 方案，D1 改判 |

## 1. 三步链路（已跑通）

```sh
# ① 令牌换 cookie（302 到 ./api/remote.mux，Set-Cookie 为 dsh-auth-<audience>）
curl -k -c jar "https://192.168.3.50:3080/connect?token=<启动令牌>&interactions=none"

# ② 调 Remote 端点（body 是 Connection 的 RPC 信封，不是裸 {args}）
curl -k -b jar -X POST -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"r1","method":"session/list","payload":{"args":{"_request":{}}}}' \
  "https://192.168.3.50:3080/api/session/list"

# ③ 结果在 result.value.items
```

## 2. 实测输出（脱敏）

### 2.1 `/connect`

```
HTTP/1.1 302 Found
location: ./api/remote.mux
set-cookie: dsh-auth-V3yOrztVGtMwtXSA6fuyNNsEJjnoysTX7mO0fiLCz5Q=<redacted>;
            Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict; Secure
```

- cookie 名里带 audience hash（含 scheme），所以 **http 的 cookie 不能拿去打 https**，jar 必须按 origin 存。
- `Max-Age=2592000` = 30 天。签名密钥在远端 `$DSH_HOME/.credentials.yaml` 里持久化 → **理论上跨远端重启仍有效**（文档结论，未实测）。
- 令牌只在「换 cookie」这一步用得上；换到之后日常请求不再需要它。

### 2.2 信封格式（第一次踩坑的地方）

裸 `{"args":{}}` 会被拒：

```json
{"type":"server-response","rpcId":"invalid-request","result":{"ok":false,
 "error":{"code":"gateway/bad-request","message":"invalid client-request message",
 "details":{"issues":[{"code":"invalid_value","values":["client-request"],"path":["type"]},
 {"code":"invalid_type","path":["rpcId"]},{"code":"invalid_type","path":["method"]},
 {"code":"invalid_type","path":["payload"]}]}}}}
```

正确信封四件套（缺一不可）：

| 字段 | 值 |
| --- | --- |
| `type` | 固定 `"client-request"` |
| `rpcId` | 任意字符串，响应原样回带 |
| `method` | 必须**等于路径尾部**（`/api/session/list` → `session/list`），不匹配报 `method ... does not match endpoint` |
| `payload` | `{ args: {…} }`，键名是参数的 **wire 名** |

参数名坑：`session/list` 的唯一参数在 descriptor 里叫 `_request`，所以 `args` 必须是 `{"_request":{}}`。
`{}` → `missing "_request"`；`{"request":{}}` → `missing "_request"; unexpected "request"`。

### 2.3 `session/list` 返回

`result.value.items`，单条字段：

```
agentAvailable, blank, cwd, formatStatus, projections, running, sessionId, updatedAt
```

`projections.values` 里可用的键（20 个）：
`title`、`sessionListMetadata`、`workingDirectory`、`modelSelection`、`permissions`、`tokenUsage`、`contextPressure`、`contextBreakdown`、`todos`、`goal`、`plan`、`subagent*`、`userQuestions`、`inbox`、`imageLimits`、`sessionStats`、`turnOutline`。

实测样本：**26 条会话 / 6 个不同 cwd / 12 条有 title**，其余是 blank 会话（`blank: true`，无标题）。

### 2.4 没有工作区读端点

`dsh-api-workspace-controller` 的 Remote 端点全是写操作：

```
workspace/create, delete, rename, archiveSession, unarchiveSession,
pinSession, unpinSession, insertBefore, insertSessionBefore,
initializeDefault, follow
```

**没有 `workspace/list`。**`session/list` 的返回里也没有 `workspaceId`，只有 `cwd`。

→ v0.1 的「工作区」只能按 `cwd` 分组合成（组名取目录 basename），并在 UI 上标注这是路径分组而非远端工作区记录。

### 2.5 cookie 跨远端重启（2026-10-22 补测）

nv50 的 dsh 重启后，启动令牌失效（`/connect` 返回 `auth-required`），但本机已保存的
cookie 仍能正常 `session/list` 与 `session/page`：

```
exchange: false auth-required 令牌无效或已过期
用缓存 cookie 拉列表: ok 26 条
正文: ok 3 条
```

→ **cookie 跨进程重启有效**，与「签名密钥持久化」的文档结论一致。日常不需要在远端
每次重启后重贴令牌；只有 cookie 过期（30 天）或远端凭据被清时才需要。

## 3. 推论

1. **不需要 provider 模式**：远端不用装任何东西，本机持有 cookie 即可读。
2. **不需要 WS**：`session/list` 是 unary HTTP，v0.1 用轮询足够。
3. **`/api` 的 Host/Origin 信任要先过**：curl 直连 `192.168.3.50:3080` 落在 `--trusted-host` 范围内；若将来远端用域名，`Host` 头必须匹配。
4. **cookie 是凭据**：落盘必须 0600，且不能回传前端。令牌只用于首次/失效后换取。

## 4. 未验证

- `cursor` 分页语义（26 条一次返回，v0.1 可忽略；`session/page` 的 `beforeSeq` 已验证）。
- 远端 dsh 若绑在 `127.0.0.1` 或走域名 + 反代，cookie 的 audience 是否仍匹配。
