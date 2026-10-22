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
export const DEFAULT_ARGS_LIMIT = 400
export const DEFAULT_RESULT_LIMIT = 4000

function clampText(text, limit) {
  if (typeof text !== 'string') return ''
  if (limit <= 0 || text.length <= limit) return text
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

/**
 * records → 消息列表。
 *
 * 工具调用是独立事件（`tool/call`），结果又是另一个事件（`tool/result`），
 * 靠 `callId` / `toolCallId` 配对。调用挂到它前面最近的那条 assistant 消息上；
 * 结果回来时回填，前端用 `<details>` 折叠展示。
 *
 * @param {Array<{type?:string, event?:object}>} records
 * @returns {Array<{seq:number,time:number,role:'user'|'assistant',text:string,tools:Array}>}
 */
export function toTranscript(
  records,
  { textLimit = DEFAULT_TEXT_LIMIT, argsLimit = DEFAULT_ARGS_LIMIT, resultLimit = DEFAULT_RESULT_LIMIT } = {},
) {
  const messages = []
  const byCallId = new Map()
  let lastAssistant = null

  for (const record of Array.isArray(records) ? records : []) {
    const event = record?.event
    if (event == null || typeof event !== 'object') continue
    const seq = Number(event.seq) || 0
    const time = Number(event.time) || 0

    if (event.type === 'user/message') {
      // 只有 source.kind === 'user' 才是真人发言；time-context /
      // agent-instructions / runtime-context / tool-jobs 是系统注入，
      // 一显示就会让正文看起来像用户在自言自语。
      const kind = event.data?.source?.kind
      if (typeof kind === 'string' && kind !== 'user') continue
      const text = textOf(event.data?.content)
      if (!text) continue
      messages.push({ seq, time, role: 'user', text: clampText(text, textLimit), tools: [] })
      lastAssistant = null
      continue
    }

    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      const message = { seq, time, role: 'assistant', text: clampText(textOf(content), textLimit), tools: [] }
      messages.push(message)
      lastAssistant = message
      continue
    }

    if (event.type === 'tool/call') {
      const data = event.data ?? {}
      const tool = {
        callId: typeof data.callId === 'string' ? data.callId : '',
        name: typeof data.name === 'string' ? data.name : 'tool',
        args: clampText(typeof data.arguments === 'string' ? data.arguments : '', argsLimit),
        result: null,
        isError: false,
      }
      if (!lastAssistant) {
        lastAssistant = { seq, time, role: 'assistant', text: '', tools: [] }
        messages.push(lastAssistant)
      }
      lastAssistant.tools.push(tool)
      if (tool.callId) byCallId.set(tool.callId, tool)
      continue
    }

    if (event.type === 'tool/result') {
      const message = event.data?.message
      const callId = message?.toolCallId ?? message?.source?.callId ?? ''
      const tool = callId ? byCallId.get(callId) : null
      if (!tool) continue
      tool.result = clampText(textOf(message?.content), resultLimit)
      tool.isError = message?.isError === true
    }
  }

  return messages.filter((message) => message.text !== '' || message.tools.length > 0)
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
