#!/usr/bin/env node
/**
 * UI 自检（联邦版）：官方侧栏里是否出现远端组、点开远端会话后官方中栏是否渲染远端正文。
 *
 * 用法：
 *   node scripts/ui-check.mjs            # 发布前全量：含远端新建会话 + 发消息（≤180s）
 *   node scripts/ui-check.mjs --quick    # 日常：只验树与打开会话（约 40s）
 *   node scripts/ui-check.mjs --base <url>
 *
 * 产物：.workbuddy/tmp/ui-1-sidebar.png、ui-2-remote-expanded.png、ui-3-remote-session.png、
 *       ui-4-remote-new.png、ui-5-remote-terminal.png、ui-check.json
 * 退出码：0 通过；1 有断言失败或页面报错
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('/home/nwj/.workbuddy/binaries/node/workspace/')
const puppeteer = require('puppeteer-core')

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, '.workbuddy/tmp')
fs.mkdirSync(OUT, { recursive: true })

// 联邦模式下不再影子替换，官方那条冲突噪声不会出现；Immer nr:2 是既有噪声（合成
// retention 的订阅），404 是 favicon 之类，均不影响功能。
const KNOWN_NOISE = [
  /\[Immer\]/,
  /\[client-store\] subscriber failed/,
  /Failed to load resource: the server responded with a status of 404/,
  /single slot "sidebar\.workspaces" already has a registration/,
]

function readBase() {
  const index = process.argv.indexOf('--base')
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1]
  const log = path.join(OUT, 'pb-web.log')
  if (!fs.existsSync(log)) throw new Error('没有 --base，也找不到 .workbuddy/tmp/pb-web.log')
  const match = fs.readFileSync(log, 'utf8').match(/http:\/\/[\d.]+:\d+\/\?token=\S+/)
  if (!match) throw new Error('日志里没有带 token 的 URL')
  return match[0]
}

const problems = []
const base = readBase()
const QUICK = process.argv.includes('--quick')
const cdpIndex = process.argv.indexOf('--cdp')
const cdpUrl = cdpIndex !== -1 ? process.argv[cdpIndex + 1] : null
const browser = cdpUrl
  ? await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null })
  : await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
    })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询直到 predicate 返回真值或超时。 */
async function until(label, predicate, timeoutMs = 20000, intervalMs = 250) {
  const started = Date.now()
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`等待超时：${label}`)
    await sleep(intervalMs)
  }
}

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })

  // 记录插件 RPC 的实际结果：发送/新建这类断言不能依赖 innerText
  // （官方滚动容器里的正文不一定出现在 body.innerText 里）。
  await page.evaluateOnNewDocument(() => {
    const original = window.fetch
    window.__DSH_PB_REQUESTS__ = []
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? ''
      const response = await original(input, init)
      if (init && init.method === 'POST' && url.includes('/dsh-peerbar/api/')) {
        response
          .clone()
          .json()
          .then((payload) => window.__DSH_PB_REQUESTS__.push({ url, body: String(init.body ?? ''), payload }))
          .catch(() => {})
      }
      return response
    }
  })

  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await page.goto(base, { waitUntil: 'networkidle2', timeout: 40000 })
  // 官方树会异步出本机工作区，远端组要等第一轮 /state 回来（5s 内）。
  await until('侧栏出现工作区行', () => page.evaluate(() => document.querySelectorAll('[data-row-key^="workspace:"]').length > 0), 30000)
  // 远端组要等第一轮 /state（5s 内）投影进 store
  await sleep(6000)

  /** 从页面里读 Host 名单（组名后缀是 `名字 · 主机名`）。 */
  const hostNames = await page.evaluate(async () => {
    try {
      const response = await fetch('/dsh-peerbar/api/state', { credentials: 'same-origin' })
      const payload = await response.json()
      return (payload?.hosts ?? []).map((host) => host.name).filter((name) => typeof name === 'string' && name)
    } catch {
      return []
    }
  })
  if (hostNames.length === 0) problems.push('没有读到任何 Host（/state.hosts 为空）')

  const readTree = () =>
    page.evaluate((names) => {
      const rows = [...document.querySelectorAll('[data-row-key^="workspace:"], [data-row-key^="session:"]')]
      const groups = []
      const sessions = []
      for (const row of rows) {
        const text = (row.innerText ?? '').replace(/\s+/g, ' ').trim()
        const key = row.getAttribute('data-row-key') ?? ''
        const isGroup = key.startsWith('workspace:')
        const host = names.find((name) => text.endsWith(` · ${name}`))
        const entry = {
          key,
          text,
          host: host ?? null,
          expanded: row.getAttribute('aria-expanded'),
          selected: /selected|selectedRow/i.test(row.className) || row.getAttribute('aria-selected') === 'true',
        }
        if (isGroup) groups.push(entry)
        else sessions.push(entry)
      }
      return {
        groups,
        sessions,
        // 影子树的类名不该再出现（出现说明回退到了自绘）
        shadowRows: document.querySelectorAll('.dshp-sessionRow').length,
        composer: Boolean(document.querySelector('textarea, [contenteditable="true"]')),
        body: (document.body.innerText ?? '').slice(0, 4000),
      }
    }, hostNames)

  // ---- 1) 树的形态 ----
  const tree = await readTree()
  const remoteGroups = tree.groups.filter((group) => group.host)
  const localGroups = tree.groups.filter((group) => !group.host)
  const first = {
    hostNames,
    localGroups: localGroups.map((group) => group.text),
    remoteGroups: remoteGroups.map((group) => group.text),
    shadowRows: tree.shadowRows,
  }
  await page.screenshot({ path: path.join(OUT, 'ui-1-sidebar.png') })

  if (tree.shadowRows > 0) problems.push(`仍出现影子树行（.dshp-sessionRow × ${tree.shadowRows}），说明没有走官方侧栏`)
  if (localGroups.length === 0) problems.push('侧栏没有本机工作区行')
  if (remoteGroups.length === 0) problems.push('侧栏没有远端组（组名应以「 · 主机名」结尾）')
  if (remoteGroups.length > 0 && localGroups.length > 0) {
    const lastLocal = tree.groups.map((group) => group.host).lastIndexOf(null)
    const firstRemote = tree.groups.findIndex((group) => group.host)
    if (firstRemote < lastLocal) problems.push('远端组排在本机组前面了（要求本机在前、远端接后）')
  }
  const hostsSeen = new Set(remoteGroups.map((group) => group.host))
  if (hostNames.length > 1 && hostsSeen.size < hostNames.length) {
    problems.push(`只有 ${hostsSeen.size}/${hostNames.length} 台 Host 出现在侧栏`)
  }

  // ---- 2) 展开第一个远端组 ----
  const firstRemoteKey = remoteGroups[0]?.key
  if (firstRemoteKey) {
    await page.evaluate((key) => {
      const row = document.querySelector(`[data-row-key="${key}"]`)
      row?.click()
    }, firstRemoteKey)
    await sleep(900)
  }
  const expanded = await readTree()
  const remoteSessions = expanded.sessions
  first.remoteSessionRows = remoteSessions.length
  await page.screenshot({ path: path.join(OUT, 'ui-2-remote-expanded.png') })
  if (remoteGroups.length > 0 && remoteSessions.length === 0) {
    problems.push('第一个远端组展开后没有任何会话行')
  }

  // ---- 3) 点开远端会话，官方中栏 ----
  const targetSession = remoteSessions[0]
  if (targetSession) {
    first.openedSession = targetSession.text
    const hit = await page.evaluate((key) => {
      const row = document.querySelector(`[data-row-key="${key}"]`)
      if (!row) return 'missing'
      row.click()
      return 'clicked'
    }, targetSession.key)
    first.openClick = hit
    // 会话视图的标志是「对话 / 轨迹」页签；正文再过一小会儿 hydrate 进来。
    const sessionOpened = await until(
      '中栏切到会话视图',
      () =>
        page.evaluate(() => ({
          ok: Boolean(document.querySelector('textarea, [contenteditable="true"]')) && /轨迹/.test(document.body.innerText ?? ''),
        })).then((state) => state.ok),
      20000,
    ).catch(() => false)
    first.sessionViewOpened = sessionOpened
    if (!sessionOpened) problems.push('点开远端会话后中栏没有切到会话视图（20s）')
    const hydrated = await until(
      '远端会话正文',
      // CSS Module 类名带语义前缀（`_markdown_1ypvv_5`），比构建期哈希稳定
      () => page.evaluate(() => document.querySelectorAll('[class*="markdown" i]').length > 0),
      20000,
    ).catch(() => false)
    first.sessionHydrated = hydrated
    if (sessionOpened && !hydrated) problems.push('远端会话正文没有 hydrate 出来（20s）')
    const opened = await page.evaluate(() => ({
      composer: Boolean(document.querySelector('textarea, [contenteditable="true"]')),
      markdown: document.querySelectorAll('[class*="markdown" i]').length,
      bodyLength: (document.body.innerText ?? '').length,
      body: (document.body.innerText ?? '').slice(-1500),
    }))
    first.openedBodyLength = opened.bodyLength
    first.openedBodyTail = opened.body.slice(-400)
    if (!opened.composer) problems.push('远端会话打开后没有 composer')
    await page.screenshot({ path: path.join(OUT, 'ui-3-remote-session.png') })
  }

  // ---- 4) 本机会话没有回归：展开本机组，点它新出现的会话行 ----
  const localGroupKey = localGroups[0]?.key
  let localSessionOpened = null
  if (localGroupKey) {
    const before = await page.evaluate(() => [...document.querySelectorAll('[data-row-key^="session:"]')].map((row) => row.getAttribute('data-row-key')))
    await page.evaluate((key) => document.querySelector(`[data-row-key="${key}"]`)?.click(), localGroupKey)
    await sleep(1500)
    localSessionOpened = await page.evaluate((seen) => {
      const row = [...document.querySelectorAll('[data-row-key^="session:"]')].find(
        (node) => !seen.includes(node.getAttribute('data-row-key')),
      )
      if (!row) return null
      row.click()
      return row.innerText.trim()
    }, before)
    await sleep(2500)
    const localBody = await page.evaluate(() => (document.body.innerText ?? '').slice(0, 2000))
    first.localSessionOpened = localSessionOpened
    first.localBodyLength = localBody.length
    if (localSessionOpened && localBody.length < 200) problems.push('打开本机会话后页面内容异常')
  } else {
    problems.push('找不到本机工作区行')
  }

  // ---- 5) 全量：远端新建会话 + 发消息（证明写操作在远端） ----
  if (!QUICK && firstRemoteKey) {
    const beforeKeys = await page.evaluate(() => [...document.querySelectorAll('[data-row-key^="session:"]')].map((row) => row.getAttribute('data-row-key')))
    const made = await page.evaluate((key) => {
      const row = document.querySelector(`[data-row-key="${key}"]`)
      row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      const button = row?.querySelector('button[aria-label*="新建会话"]')
      if (!button) return false
      button.click()
      return true
    }, firstRemoteKey)
    first.remoteCreateClicked = made
    if (!made) problems.push('远端组上没有「新建会话」按钮')
    if (made) {
      // 新会话必须出现在**这个远端组**下（出现在本机组说明拿远端 cwd 建了本地会话）
      const created = await until(
        '远端新会话出现在该组下',
        () =>
          page.evaluate(
            ([key, seen]) => {
              const row = [...document.querySelectorAll('[data-row-key^="session:"]')].find(
                (node) => !seen.includes(node.getAttribute('data-row-key')),
              )
              if (!row) return null
              const group = row.closest('[data-row-key^="workspace:"]')
              return {
                key: row.getAttribute('data-row-key'),
                text: row.innerText.replace(/\s+/g, ' ').trim(),
                groupKey: group?.getAttribute('data-row-key') ?? null,
              }
            },
            [firstRemoteKey, beforeKeys],
          ).catch(() => null),
        20000,
      ).catch(() => false)
      first.remoteCreated = created
      if (!created) problems.push('在远端组新建会话后，组里没有出现新会话行')
      await page.screenshot({ path: path.join(OUT, 'ui-4-remote-new.png') })

      // 会话视图起来 + composer 可写
      const viewReady = await until(
        '新会话视图',
        () => page.evaluate(() => /轨迹/.test(document.body.innerText ?? '')),
        15000,
      ).catch(() => false)
      if (!viewReady) problems.push('远端新会话没有在中栏打开')

      const box = await page.$('textarea, [contenteditable="true"]')
      if (!box) {
        problems.push('远端新会话没有 composer')
      } else {
        await box.click()
        await page.keyboard.type('只回复两个字：收到')
        await page.keyboard.press('Enter')
        const sent = await until(
          '远端接受 session/prompt',
          () =>
            page.evaluate(() =>
              (window.__DSH_PB_REQUESTS__ ?? []).some(
                (entry) => /session\/prompt/.test(entry.body ?? '') && entry.payload?.ok === true,
              ),
            ),
          20000,
        ).catch(() => false)
        first.promptSent = Boolean(sent)
        if (!sent) problems.push('发送后中栏没有出现用户消息')
        await sleep(4000)
        await page.screenshot({ path: path.join(OUT, 'ui-5-remote-prompt.png') })

        // 清理：归档这次测试会话（远端），别在列表里堆空白会话
        if (created) {
          const cleanup = await page.evaluate(
            async ([sessionKey, groupKey]) => {
              const sessionId = sessionKey.replace(/^session:/, '')
              const match = /^workspace:peerbar:([^:]+):ws:/.exec(groupKey ?? '')
              const hostId = match?.[1]
              if (!hostId) return { hostId: null, ok: false }
              const response = await fetch(`/dsh-peerbar/api/hosts/${encodeURIComponent(hostId)}/rpc`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json', 'x-dsh-peerbar-action': '1' },
                body: JSON.stringify({
                  endpoint: 'workspace/archiveSession',
                  args: { request: { sessionId, stopActivity: true } },
                }),
              })
              const payload = await response.json().catch(() => null)
              return { hostId, ok: response.ok && payload?.ok !== false }
            },
            [created.key, firstRemoteKey],
          ).catch((error) => ({ ok: false, error: String(error) }))
          first.testSessionCleanup = cleanup
        }
      }
    }
  }

  // ---- 6) 远端终端（官方右侧栏 + 插件 WS 代理） ----
  if (targetSession) {
    // 回到那条远端会话（可能已被上一阶段切走或折叠）
    await page.evaluate((key) => {
      const group = document.querySelector(`[data-row-key="${key}"]`)
      if (group && group.getAttribute('aria-expanded') !== 'true') group.click()
    }, firstRemoteKey)
    await sleep(800)
    await page.evaluate((key) => document.querySelector(`[data-row-key="${key}"]`)?.click(), targetSession.key)
    await sleep(2000)
    await page.evaluate(() => {
      const open = [...document.querySelectorAll('button[aria-label]')].find((button) =>
        /打开右侧边栏|展开右侧边栏/.test(button.getAttribute('aria-label') || ''),
      )
      open?.click()
    })
    await sleep(1200)
    await page.evaluate(() => {
      document.querySelector('[data-sidebar-right-guide-entry="terminal"]')?.click()
    })
    await sleep(1500)
    await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="选择 Shell"], button[aria-label="Select shell"]')
      button?.click()
    })
    await sleep(900)
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"], [role="option"]')].find((node) => /bash/i.test(node.textContent || ''))
      item?.click()
    })
    const terminalReady = await until(
      '右侧栏终端出现 xterm',
      () => page.evaluate(() => Boolean(document.querySelector('.xterm-screen, .xterm'))),
      20000,
    ).catch(() => false)
    first.terminalPanel = Boolean(terminalReady)
    if (!terminalReady) {
      problems.push('远端会话的右侧栏终端没有出现 xterm')
    } else {
      const center = await page.evaluate(() => {
        const node = document.querySelector('.xterm-screen, .xterm')
        const rect = node.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })
      await page.mouse.click(center.x, center.y)
      await sleep(300)
      await page.keyboard.type('echo PBCHK-$((6*7))')
      await page.keyboard.press('Enter')
      await sleep(2500)
      const screen = await page.evaluate(() => document.querySelector('.xterm-screen, .xterm')?.innerText ?? '')
      first.terminalScreen = screen.slice(-160)
      await page.screenshot({ path: path.join(OUT, 'ui-6-remote-terminal.png') })
      if (!screen.includes('PBCHK-42')) problems.push(`远端终端没有回显 PBCHK-42：${screen.slice(-120)}`)
    }
  }

  // ---- 收尾 ----
  const knownWarnings = consoleErrors.filter((text) => KNOWN_NOISE.some((pattern) => pattern.test(text)))
  const realErrors = consoleErrors.filter((text) => !knownWarnings.includes(text))
  const result = { base, mode: QUICK ? 'quick' : 'full', ...first, consoleErrors: realErrors, knownWarnings }
  fs.writeFileSync(path.join(OUT, 'ui-check.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (realErrors.length) problems.push(`页面报错 ${realErrors.length} 条`)

  if (problems.length) {
    console.error('\n断言失败：')
    for (const problem of problems) console.error(' -', problem)
    process.exitCode = 1
  } else {
    console.log('\n全部断言通过')
  }
} finally {
  await browser.close()
}
