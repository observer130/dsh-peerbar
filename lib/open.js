/**
 * 官方 open-in-app 的远端 VS Code 打开。
 *
 * 官方标题栏「…」→「在应用中打开」→ VS Code（以及会话菜单、文件页签里的同一
 * 入口）最终都走 `POST /open-in-app/open { app, path }`，path 是会话 cwd。
 * 远端 cwd 在本机不存在，官方路由只会 404。客户端半把 `app === 'vscode'` 的
 * 那一条改写到 `/dsh-peerbar/api/open-vscode`，这里把它翻译成
 * `vscode://vscode-remote/ssh-remote+<别名>/<path>`，交给本机 OS 的 URL
 * handler；SSH、认证和远端 server 都由 VS Code 的 Remote-SSH 自己处理。
 *
 * 为什么不 spawn `code --remote`：URI 是跨平台的（Linux `xdg-open`、macOS
 * `open`、Windows `rundll32`），不需要探测应用，也不碰 Windows `.cmd` 的
 * 引号问题。本机 dsh 在用户机器上，Desktop / Web 共用同一条宿主路由。
 */

import { spawn } from 'node:child_process'
import { posix } from 'node:path'

import { CODE } from './codes.js'

/** SSH 目标：别名、IP、域名、user@host；拒绝 `-` 开头、空格、冒号、shell 元字符。 */
const TARGET_RE = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_TARGET = 255
const MAX_PATH = 4096
/** 打开器在这段时间内退出非零，才判定失败；GUI 程序常驻不算失败。 */
const OPEN_WATCH_MS = 800

function isSshTarget(value) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_TARGET
    && TARGET_RE.test(value)
  )
}

/**
 * 从 Host 记录解析 VS Code 要用的 SSH 目标。
 *
 * 优先主机显示名（建议用户把它写成 `~/.ssh/config` 的 Host 别名），不是合法
 * 目标时退回 origin 的主机名。直接 IP 也能连，只是拿不到 config 里的 User /
 * Port / IdentityFile / ProxyJump；非默认参数时用户应把主机名写成别名。
 *
 * @param {{name?: string, origin?: string}} host Host 记录（只读 name / origin）。
 * @returns {string|null} 合法目标，或 null。
 */
export function resolveSshTarget(host) {
  const name = typeof host?.name === 'string' ? host.name.trim() : ''
  if (isSshTarget(name)) return name
  const origin = typeof host?.origin === 'string' ? host.origin : ''
  try {
    const hostname = new URL(origin).hostname
    if (isSshTarget(hostname)) return hostname
  } catch {
    /* origin 不合法：交给调用方报 no-target */
  }
  return null
}

/**
 * 规范化远端绝对 POSIX 路径；非规范写法一律拒绝，避免把 `..` 或 `//` 带进 URI。
 *
 * @param {unknown} value 原始路径。
 * @returns {string|null} 去掉末尾斜杠的规范路径，或 null。
 */
export function normalizeRemotePath(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > MAX_PATH || raw[0] !== '/') return null
  if (raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return null
  const trimmed = raw.length > 1 ? raw.replace(/\/+$/, '') : raw
  if (!trimmed) return null
  const normalized = posix.normalize(trimmed)
  return normalized === trimmed ? normalized : null
}

/**
 * 构造 VS Code Remote-SSH 的 URI。
 *
 * 形状：`vscode://vscode-remote/ssh-remote+<target>/<path>`。path 逐段
 * `encodeURIComponent`，保留 `/`；target 已由 {@link resolveSshTarget} 校验，
 * 只含 URI path 里安全的字符。
 *
 * @param {string} target SSH 目标。
 * @param {string} path 远端绝对 POSIX 路径。
 * @returns {string|null} URI，或 null。
 */
export function buildVscodeUri(target, path) {
  if (!isSshTarget(target)) return null
  const normalized = normalizeRemotePath(path)
  if (normalized === null) return null
  const encoded = normalized.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `vscode://vscode-remote/ssh-remote+${target}${encoded}`
}

/**
 * 路径是否落在任一工作区根下（含根本身）。用来保证路由只能打开该 Host 已知的
 * 工作区，而不是任意远端路径。
 *
 * @param {string} path 远端路径。
 * @param {Array<string>} roots 该 Host 的工作区 cwd 列表。
 * @returns {boolean}
 */
export function isPathInWorkspaces(path, roots) {
  const normalized = normalizeRemotePath(path)
  if (normalized === null) return false
  for (const root of Array.isArray(roots) ? roots : []) {
    const normalizedRoot = normalizeRemotePath(root)
    if (normalizedRoot === null) continue
    if (normalizedRoot === '/' || normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)) {
      return true
    }
  }
  return false
}

/**
 * 给 URL handler 的子进程准备环境：保留 PATH/HOME/DISPLAY/DBUS/SSH_AUTH_SOCK，
 * 去掉 harness 与 Electron 的子进程标记，避免 `code`/`xdg-open` 被当成 node。
 *
 * @param {NodeJS.ProcessEnv} env 父进程环境。
 * @returns {NodeJS.ProcessEnv}
 */
export function scrubOpenEnv(env = process.env) {
  const out = {}
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value !== 'string') continue
    const upper = key.toUpperCase()
    if (upper.startsWith('DSH_')) continue
    if (upper === 'ELECTRON_RUN_AS_NODE' || upper === 'ELECTRON_NO_ATTACH_CONSOLE' || upper === 'NODE_OPTIONS') continue
    out[key] = value
  }
  return out
}

/**
 * 平台对应的 URL 打开命令；只接受 `vscode://`，不接受任意 URL。
 *
 * @param {string} platform `process.platform`。
 * @param {string} uri 已构造的 URI。
 * @returns {{command: string, args: string[]}|null}
 */
export function openCommandFor(platform, uri) {
  if (typeof uri !== 'string' || !uri.startsWith('vscode://')) return null
  if (platform === 'linux') return { command: 'xdg-open', args: [uri] }
  if (platform === 'darwin') return { command: 'open', args: [uri] }
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', uri] }
  return null
}

/**
 * 把 URI 交给 OS 的 handler；不等待窗口就绪，只捕获启动阶段的失败。
 *
 * @param {string} uri `vscode://` URI。
 * @param {object} [options]
 * @param {string} [options.platform] 覆盖 `process.platform`（测试用）。
 * @param {Function} [options.spawnImpl] 覆盖 `child_process.spawn`（测试用）。
 * @param {number} [options.watchMs] 早期失败观察窗。
 * @param {NodeJS.ProcessEnv} [options.env] 覆盖父进程环境（测试用）。
 * @returns {Promise<{ok: true}|{ok: false, code: string, message: string}>}
 */
export function openUri(uri, options = {}) {
  const platform = options.platform ?? process.platform
  const spawnImpl = options.spawnImpl ?? spawn
  const watchMs = Number.isFinite(options.watchMs) ? Math.max(1, options.watchMs) : OPEN_WATCH_MS
  const env = options.env ?? process.env
  const spec = openCommandFor(platform, uri)
  if (spec === null) {
    return Promise.resolve({
      ok: false,
      code: CODE.OPEN_NO_HANDLER,
      message: `当前平台（${platform}）没有可用的 vscode:// 打开器`,
    })
  }
  return new Promise((resolve) => {
    let child
    try {
      child = spawnImpl(spec.command, spec.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: scrubOpenEnv(env),
      })
    } catch (error) {
      resolve({
        ok: false,
        code: CODE.OPEN_NO_HANDLER,
        message: `无法启动 ${spec.command}：${String(error?.message ?? error)}`,
      })
      return
    }

    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.unref?.()
      } catch {
        /* 已退出 */
      }
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: true }), watchMs)
    child.on('error', (error) => {
      const missing = error?.code === 'ENOENT'
      finish({
        ok: false,
        code: CODE.OPEN_NO_HANDLER,
        message: missing
          ? `本机找不到 ${spec.command}`
          : `启动 ${spec.command} 失败：${String(error?.message ?? error)}`,
      })
    })
    child.on('exit', (code, signal) => {
      if (code === 0) {
        finish({ ok: true })
        return
      }
      finish({
        ok: false,
        code: CODE.OPEN_FAILED,
        message: signal
          ? `${spec.command} 被信号 ${String(signal)} 终止`
          : `${spec.command} 退出码 ${String(code)}`,
      })
    })
  })
}

/**
 * 打开远端工作区：解析目标 → 校验路径 → 构造 URI → 交给 OS。
 *
 * @param {object} input
 * @param {{name?: string, origin?: string}} input.host Host 记录。
 * @param {string} input.path 会话 cwd（远端绝对 POSIX 路径）。
 * @param {object} [options] 透传给 {@link openUri}。
 * @returns {Promise<{ok: true, uri: string}|{ok: false, code: string, message: string}>}
 */
export async function openVscode({ host, path, ...options } = {}) {
  const target = resolveSshTarget(host)
  if (target === null) {
    return {
      ok: false,
      code: CODE.OPEN_NO_TARGET,
      message: '这台主机没有可用的 SSH 目标（主机名和 origin 都不是合法目标）',
    }
  }
  const normalized = normalizeRemotePath(path)
  if (normalized === null) {
    return { ok: false, code: CODE.OPEN_BAD_PATH, message: '远端工作区路径不合法' }
  }
  const uri = buildVscodeUri(target, normalized)
  if (uri === null) {
    return { ok: false, code: CODE.OPEN_BAD_PATH, message: '无法构造 vscode:// 地址' }
  }
  const result = await openUri(uri, options)
  return result.ok ? { ok: true, uri } : result
}
