/**
 * 错误码与 Host 状态。宿主半与客户端半共用同一套字符串，
 * 前端按 code 决定文案与重试策略，不做字符串猜测。
 */

export const CODE = Object.freeze({
  /** 连接被拒、DNS 失败、路由不可达 */
  UNREACHABLE: 'unreachable',
  /** TLS 校验失败（自签、过期、域名不匹配） */
  TLS_ERROR: 'tls-error',
  /** 是 dsh，但 cookie 缺失或已失效，需要重贴令牌 */
  AUTH_REQUIRED: 'auth-required',
  /** 有响应，但不是 dsh */
  NOT_DSH: 'not-dsh',
  /** 是 dsh，但 Remote 协议对不上（gateway/* 错误或字段缺失） */
  INCOMPATIBLE: 'incompatible',
  /** 超时 */
  TIMEOUT: 'timeout',
  /** 本机接口收到非法参数 */
  BAD_REQUEST: 'bad-request',
  /** 本机接口来源/方法不被允许 */
  DENIED: 'denied',
})

export const STATUS = Object.freeze({
  ONLINE: 'online',
  AUTH_REQUIRED: 'auth-required',
  UNREACHABLE: 'unreachable',
  TLS_ERROR: 'tls-error',
  NOT_DSH: 'not-dsh',
  INCOMPATIBLE: 'incompatible',
  TIMEOUT: 'timeout',
  /** 用户停用，不探活 */
  DISABLED: 'disabled',
})

const STATUS_BY_CODE = Object.freeze({
  [CODE.UNREACHABLE]: STATUS.UNREACHABLE,
  [CODE.TLS_ERROR]: STATUS.TLS_ERROR,
  [CODE.AUTH_REQUIRED]: STATUS.AUTH_REQUIRED,
  [CODE.NOT_DSH]: STATUS.NOT_DSH,
  [CODE.INCOMPATIBLE]: STATUS.INCOMPATIBLE,
  [CODE.TIMEOUT]: STATUS.TIMEOUT,
})

/** 失败响应体，前后端共用。 */
export function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

/** 错误码 → Host 状态。`bad-request` / `denied` 不是 Host 状态。 */
export function statusForCode(code) {
  return STATUS_BY_CODE[code] ?? STATUS.UNREACHABLE
}
