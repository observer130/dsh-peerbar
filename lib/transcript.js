/**
 * 会话正文的裁剪：把 `session/page` 的 records 变成前端能直接渲染的消息列表。
 *
 * 远端记录里混着 reasoning、tool/result、step/start 等事件，v0.1 只保留
 * user / assistant 的可读文本，外加 assistant 的工具调用名称（否则很多轮次
 * 只有工具调用、正文为空，读起来像断片）。
 */

export const DEFAULT_MAX_MESSAGES = 20
export const MAX_MESSAGES = 50
export const DEFAULT_TEXT_LIMIT = 8000

function clampText(text, limit) {
  if (typeof text !== 'string') return ''
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…（已截断，共 ${text.length} 字）`
}

function textOf(parts) {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim()
}

function toolNamesOf(parts) {
  if (!Array.isArray(parts)) return []
  return parts
    .filter((part) => part?.type === 'tool-call')
    .map((part) => part.name ?? part.toolName ?? part.tool ?? '')
    .filter((name) => typeof name === 'string' && name !== '')
}

/**
 * @param {Array<{type?:string, event?:object}>} records session/page 的 records
 * @param {{textLimit?:number}} options
 * @returns {Array<{seq:number,time:number,role:'user'|'assistant',text:string,tools:string[]}>}
 */
export function toTranscript(records, { textLimit = DEFAULT_TEXT_LIMIT } = {}) {
  const messages = []
  for (const record of Array.isArray(records) ? records : []) {
    const event = record?.event
    if (event == null || typeof event !== 'object') continue
    const seq = Number(event.seq) || 0
    const time = Number(event.time) || 0

    if (event.type === 'user/message') {
      const text = textOf(event.data?.content)
      if (!text) continue
      messages.push({ seq, time, role: 'user', text: clampText(text, textLimit), tools: [] })
      continue
    }

    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      const text = textOf(content)
      const tools = toolNamesOf(content)
      if (!text && tools.length === 0) continue
      messages.push({ seq, time, role: 'assistant', text: clampText(text, textLimit), tools })
    }
  }
  return messages
}

/** 把 limit 归一化到 [1, MAX_MESSAGES]。 */
export function clampLimit(value, fallback = DEFAULT_MAX_MESSAGES) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(MAX_MESSAGES, n)
}

/** 记录里最小的 seq，作为「再往前翻」的游标；没有记录时返回 null。 */
export function oldestSeq(records) {
  let oldest = null
  for (const record of Array.isArray(records) ? records : []) {
    const seq = Number(record?.event?.seq)
    if (!Number.isFinite(seq)) continue
    if (oldest === null || seq < oldest) oldest = seq
  }
  return oldest
}

/**
 * 本机会话或任意 controller 形状的对象 → 正文。
 * `controller` 需要 `projections({sessionId}, signal)` 与 `page(request, signal)`。
 *
 * 注意：dsh 的两个方法都会 `signal.throwIfAborted()`，signal 不能省——少传会报
 * `Cannot read properties of undefined (reading 'aborted')`。
 */
export async function readTranscriptFrom(controller, sessionId, limit, { textLimit, timeoutMs = 15000, beforeSeq } = {}) {
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : new AbortController().signal
  const projections = await controller.projections({ sessionId }, signal)
  const throughSeq = Number(projections?.asOfSeq)
  if (!Number.isFinite(throughSeq)) throw new Error('拿不到会话的 asOfSeq')
  const page = await controller.page(
    {
      address: { kind: 'session', sessionId },
      throughSeq,
      maxMessages: clampLimit(limit),
      ...(Number.isFinite(Number(beforeSeq)) && beforeSeq != null ? { beforeSeq: Number(beforeSeq) } : {}),
    },
    signal,
  )
  return {
    messages: toTranscript(page?.records, { textLimit }),
    hasMore: page?.hasMore === true,
    nextBeforeSeq: oldestSeq(page?.records),
  }
}
