/**
 * 落盘：Host 注册表与快照缓存。
 *
 * 令牌和 cookie 只出现在注册表里，权限 0600；对外一律走 `publicHost()`，
 * 那里没有这两个字段。
 */

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const REGISTRY_FILE = 'dsh-peerbar.json'
const CACHE_FILE = 'dsh-peerbar-cache.json'
const CACHE_VERSION = 1

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function registryPath() {
  return join(dshHome(), REGISTRY_FILE)
}

export function cachePath() {
  return join(dshHome(), CACHE_FILE)
}

/** 读 JSON；文件不存在返回 null，内容坏返回 null（调用方保留旧值，不覆盖）。 */
export async function readJson(file) {
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 原子写：临时文件 0600 → rename，避免写一半留下坏 JSON。 */
export async function writeJsonAtomic(file, data) {
  await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const text = `${JSON.stringify(data, null, 2)}\n`
  await fs.writeFile(tmp, text, { mode: 0o600 })
  try {
    await fs.rename(tmp, file)
  } catch (error) {
    await fs.rm(tmp, { force: true })
    throw error
  }
  await fs.chmod(file, 0o600).catch(() => {})
}

function pickString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function pickBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

/** 校验并补全一条 Host 记录；origin 不合法时返回 null（坏记录直接丢）。 */
export function normalizeHost(raw, index = 0) {
  if (raw == null || typeof raw !== 'object') return null
  const origin = pickString(raw.origin).trim()
  if (!origin) return null
  const id = /^h_[0-9a-f]{8}$/.test(pickString(raw.id)) ? raw.id : ''
  const cookie = raw.cookie != null && typeof raw.cookie === 'object' ? raw.cookie : null
  return {
    id: id || null, // 由调用方按 origin 补
    name: pickString(raw.name).trim() || origin,
    origin,
    order: Number.isFinite(raw.order) ? Number(raw.order) : index,
    enabled: pickBoolean(raw.enabled, true),
    color: pickString(raw.color) || null,
    tls: {
      allowSelfSigned: pickBoolean(raw.tls?.allowSelfSigned, false),
      caFile: pickString(raw.tls?.caFile) || null,
    },
    token: pickString(raw.token) || '',
    cookie:
      cookie && typeof cookie.header === 'string' && cookie.header
        ? { header: cookie.header, savedAt: Number(cookie.savedAt) || 0 }
        : null,
  }
}

/** 注册表整体归一化；`version` 留着给后续迁移用。 */
export function normalizeRegistry(raw) {
  const hosts = Array.isArray(raw?.hosts) ? raw.hosts.map(normalizeHost).filter(Boolean) : []
  return {
    version: Number(raw?.version) || 1,
    probeIntervalMs: Number(raw?.probeIntervalMs) || 0,
    hosts,
  }
}

/** 对外可见的 Host：只有布尔位，没有令牌与 cookie 明文。 */
export function publicHost(host) {
  return {
    hostId: host.id,
    name: host.name,
    origin: host.origin,
    order: host.order,
    enabled: host.enabled,
    color: host.color,
    allowSelfSigned: host.tls?.allowSelfSigned === true,
    hasToken: Boolean(host.token),
    hasCookie: Boolean(host.cookie?.header),
  }
}

export async function readRegistry() {
  return normalizeRegistry(await readJson(registryPath()))
}

export async function writeRegistry(registry) {
  await writeJsonAtomic(registryPath(), {
    version: registry.version || 1,
    ...(registry.probeIntervalMs ? { probeIntervalMs: registry.probeIntervalMs } : {}),
    hosts: registry.hosts,
  })
}

/** 缓存：只存摘要，不存正文。 */
export function emptyCache() {
  return { version: CACHE_VERSION, savedAt: 0, hosts: {} }
}

export async function readCache() {
  const raw = await readJson(cachePath())
  if (raw == null || typeof raw !== 'object') return emptyCache()
  return {
    version: Number(raw.version) || CACHE_VERSION,
    savedAt: Number(raw.savedAt) || 0,
    hosts: raw.hosts != null && typeof raw.hosts === 'object' ? raw.hosts : {},
  }
}

export async function writeCache(cache) {
  await writeJsonAtomic(cachePath(), {
    version: CACHE_VERSION,
    savedAt: Date.now(),
    hosts: cache.hosts ?? {},
  })
}

/** 缓存条目是否还能用（默认 24h）。 */
export function isCacheFresh(entry, ttlMs = 24 * 60 * 60 * 1000) {
  const fetchedAt = Number(entry?.fetchedAt) || 0
  return fetchedAt > 0 && Date.now() - fetchedAt <= ttlMs
}
