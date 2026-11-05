/**
 * 远端定时任务 catalog 的兼容层。
 *
 * dsh 0.2.x 给调度记录加了 `involvedSessionIds` / `target`，旧版 Host 不返回
 * 这两个字段；官方侧栏的 `SessionScheduleMark` 会直接
 * `task.involvedSessionIds.includes(...)`，缺字段会让整条会话行崩掉。
 * 这里只补结构默认值，不伪造参与关系。
 */

/** @param {unknown} record @param {string} hostId */
export function normalizeRemoteScheduleRecord(record, hostId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const involvedSessionIds = Array.isArray(record.involvedSessionIds) ? record.involvedSessionIds : []
  const target =
    record.target && typeof record.target === 'object'
      ? record.target
      : typeof record.sessionId === 'string'
        ? { kind: 'session', sessionId: record.sessionId }
        : { kind: 'new' }
  return { ...record, involvedSessionIds, target, peerbarHostId: hostId }
}
