/**
 * 探活状态机：页面探测 → 确保 cookie → 拉一次 session/list → 顺带取归档集。
 *
 * 任何一步失败都落到统一的 `{ ok:false, status, code }`，由 peers.js 决定退避。
 * 归档集是「补充信息」：`workspace/follow` 那条流失败**不影响探活结论**，
 * 只把 `archivedSessionIds` 置 null，让上一轮的已知结果继续生效。
 */

import { CODE, STATUS, statusForCode } from './codes.js'
import { callRpc, exchangeCookie, listSessions, probePage } from './remote.js'
import { readWorkspaceBaseline } from './stream.js'

/**
 * 连续失败 n 次后的等待时间：5→10→20→40→60s，上限 60s，带 ±20% 抖动。
 * `jitter` 传 0 便于单测。
 */
export function nextDelayMs(failures, { baseMs = 5000, maxMs = 60000, jitter = 0.2, random = Math.random } = {}) {
  const n = Math.max(1, Math.floor(Number(failures) || 1))
  const raw = Math.min(maxMs, baseMs * 2 ** (n - 1))
  if (!jitter) return raw
  const factor = 1 + (random() * 2 - 1) * jitter
  return Math.max(1000, Math.round(raw * factor))
}

function failure(code, message, startedAt, extra = {}) {
  const status = statusForCode(code)
  return {
    ok: false,
    status,
    code,
    message,
    latencyMs: Date.now() - startedAt,
    ...extra,
  }
}

/**
 * 探一次 host。不修改入参；换到的新 cookie 通过返回值交给调用方落盘。
 */
export async function probeHost(host, { timeoutMs = 8000, checkCompat = false } = {}) {
  const startedAt = Date.now()

  try {
    const page = await probePage(host, { timeoutMs })
    if (!page.ok) return failure(page.code, page.message, startedAt)
  } catch (error) {
    return failure(error?.code ?? CODE.UNREACHABLE, error?.message ?? String(error), startedAt)
  }

  let cookie = host.cookie?.header ? host.cookie : null
  let cookieRefreshed = false
  let working = host

  if (!cookie) {
    const exchanged = await exchangeCookie(host, { timeoutMs })
    if (!exchanged.ok) return failure(exchanged.code, exchanged.message, startedAt)
    cookie = exchanged.cookie
    cookieRefreshed = true
    working = { ...host, cookie }
  }

  let result = await listSessions(working, { timeoutMs })

  if (!result.ok && result.code === CODE.AUTH_REQUIRED && host.token) {
    const exchanged = await exchangeCookie(host, { timeoutMs })
    if (!exchanged.ok) return failure(exchanged.code, exchanged.message, startedAt)
    cookie = exchanged.cookie
    cookieRefreshed = true
    working = { ...host, cookie }
    result = await listSessions(working, { timeoutMs })
  }

  if (!result.ok) return failure(result.code, result.message, startedAt)

  const items = result.value?.items
  if (!Array.isArray(items)) {
    return failure(CODE.INCOMPATIBLE, 'session/list 返回结构不符（缺少 items）', startedAt)
  }

  // workspace baseline（workspaceId/archived/pinned 的唯一全量源）尽力而为：
  // 失败不拖垮探活，只把 registry 置 null，让上一轮的已知结果继续生效。
  const baseline = await readWorkspaceBaseline(working, { timeoutMs: Math.min(timeoutMs, 2500) })

  const baselineError = baseline.ok ? null : `${baseline.code}: ${baseline.message}`

  // 版本兼容探测（T14）：`session/modelCatalog` 无副作用，但走的是「读端点 + 严格
  // 参数」的路径；它都调不通，说明远端 dsh 与插件预期的契约不一致（升级后静默少
  // 功能的典型症状）。只做一次（由 peers 控制），不拖慢每轮探活。
  let compatError = null
  if (checkCompat) {
    const catalog = await callRpc(working, 'session/modelCatalog', {}, { timeoutMs: Math.min(timeoutMs, 4000) })
    if (!catalog.ok) compatError = `${catalog.code}: ${catalog.message}`
  }

  return {
    ok: true,
    status: STATUS.ONLINE,
    code: null,
    message: '',
    latencyMs: Date.now() - startedAt,
    items,
    registry: baseline.ok ? { items: baseline.items, archivedSessionIds: baseline.archivedSessionIds, pinnedSessionIds: baseline.pinnedSessionIds } : null,
    cookie,
    cookieRefreshed,
    archivedSessionIds: baseline.ok ? baseline.archivedSessionIds : null,
    // 同一个失败的两个视角：archiveError 供 peers 抑制重复日志，
    // registryError 透到 /state 让客户端解释「为什么工作区菜单没了」（T9）。
    archiveError: baselineError,
    registryError: baselineError,
    compatError,
  }
}
