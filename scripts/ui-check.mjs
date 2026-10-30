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
 *       ui-4-remote-new.png、ui-5-remote-terminal.png、ui-6-remote-terminal.png、
 *       ui-7-plan-preview.png、ui-0-add-workspace.png、ui-0b-add-workspace-remote.png、
 *       ui-8-remote-workspace.png、ui-9-grouping-off.png、ui-10-settings.png、
 *       ui-10b-add-host.png、ui-11-changes-card.png、ui-check.json
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

  // 交付物卡片的两条按会话路由：远端会话必须走 /dsh-peerbar/api/asset 转发，
  // 直接打本机 /api/changes.* 只会 404（卡片就不出现）。§10 用这两份记录断言。
  const assetProxies = []
  const directChanges = []
  const rpcCalls = []
  page.on('response', (response) => {
    const url = response.url()
    if (url.includes('/dsh-peerbar/api/hosts/')) {
      let endpoint = ''
      try {
        endpoint = (response.request().postData() ?? '').match(/"endpoint":"([^"]+)"/)?.[1] ?? ''
      } catch {
        /* 忽略 */
      }
      if (endpoint) rpcCalls.push({ status: response.status(), endpoint })
      return
    }
    if (url.includes('/dsh-peerbar/api/asset')) {
      let target = ''
      try {
        target = new URL(url).searchParams.get('path') ?? ''
      } catch {
        /* 忽略 */
      }
      assetProxies.push({ status: response.status(), target })
      return
    }
    if (url.includes('/api/changes.')) directChanges.push({ status: response.status(), url: url.replace(/^https?:\/\/[^/]+/, '') })
  })

  // 插件自己的路由失败要留证据（5xx 只会在 console 里留一行「Failed to load resource」，
  // 看不出是哪个端点、为什么）。失败时把 body 一并发到 ui-check.json。
  const apiErrors = []
  page.on('response', async (response) => {
    const url = response.url()
    if (!url.includes('/dsh-peerbar/') || response.status() < 400) return
    let body = ''
    try {
      body = (await response.text()).slice(0, 400)
    } catch {
      /* 忽略 */
    }
    apiErrors.push({ status: response.status(), url: url.replace(/^https?:\/\/[^/]+/, ''), body })
  })

  await page.goto(base, { waitUntil: 'networkidle2', timeout: 40000 })
  // 官方树会异步出本机工作区，远端组要等第一轮 /state 回来（5s 内）。
  await until('侧栏出现工作区行', () => page.evaluate(() => document.querySelectorAll('[data-row-key^="workspace:"]').length > 0), 30000)
  // 远端组要等第一轮 /state（5s 内）投影进 store
  await sleep(6000)

  /**
   * 从页面里读 Host 名单。
   *
   * 侧栏不再把「· 主机名」写进工作区标题（主机行已经承担了来源），所以归属
   * 只能从 `data-row-key` 读：合成的行 key 是 `workspace:peerbar:<hostId>:…`，
   * 本机真工作区是 `workspace:<官方 id>`（不带前缀）。
   */
  const hosts = await page.evaluate(async () => {
    try {
      const response = await fetch('/dsh-peerbar/api/state', { credentials: 'same-origin' })
      const payload = await response.json()
      return (payload?.hosts ?? [])
        .filter((host) => typeof host?.hostId === 'string' && typeof host?.name === 'string' && host.name)
        .map((host) => ({ hostId: host.hostId, name: host.name }))
    } catch {
      return []
    }
  })
  const hostNames = hosts.map((host) => host.name)
  if (hostNames.length === 0) problems.push('没有读到任何 Host（/state.hosts 为空）')

  const readTree = () =>
    page.evaluate((hostList) => {
      const byId = new Map(hostList.map((host) => [host.hostId, host.name]))
      const rows = [...document.querySelectorAll('[data-row-key^="workspace:"], [data-row-key^="session:"]')]
      const groups = []
      const sessions = []
      for (const row of rows) {
        const text = (row.innerText ?? '').replace(/\s+/g, ' ').trim()
        const key = row.getAttribute('data-row-key') ?? ''
        const isGroup = key.startsWith('workspace:')
        // 主机根的 key 以 `:hostroot` 结尾（后面没有冒号），工作区/会话是 `:ws:`/`:sess:`
        const match = /^(?:workspace|session):peerbar:([^:]+):(hostroot|ws|sess)(?::|$)/.exec(key)
        const hostId = match ? match[1] : null
        const entry = {
          key,
          text,
          hostId,
          host: hostId && hostId !== 'local' ? byId.get(hostId) ?? hostId : null,
          isHostRow: match ? match[2] === 'hostroot' : false,
          expanded: row.getAttribute('aria-expanded'),
          // 官方"按工作区树"靠这个 CSS 变量做缩进：主机行 0px，子工作区 12px
          indent: getComputedStyle(row).getPropertyValue('--dsh-workspace-indent').trim(),
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
    }, hosts)

  // ---- 1) 树的形态：主机分组（1.2.0 起默认开）----
  // 官方树支持任意层级，主机层是投影出来的：远端路径带 `主机:` 前缀、每台主机一个
  // 合成父工作区（本机用 `/`）。所以加载后应该只有「本机 / 各主机」三行。
  const tree = await readTree()
  const hostRowTexts = ['本机', ...hostNames]
  const isHostRow = (row) => row.isHostRow === true
  const hostRows = tree.groups.filter(isHostRow)
  const workspaceRowsAtLoad = tree.groups.filter((row) => !isHostRow(row))
  const first = {
    hostNames,
    hostRows: hostRows.map((row) => row.text),
    workspaceRowsAtLoad: workspaceRowsAtLoad.map((row) => row.text),
    shadowRows: tree.shadowRows,
  }
  await page.screenshot({ path: path.join(OUT, 'ui-1-sidebar.png') })

  if (tree.shadowRows > 0) problems.push(`仍出现影子树行（.dshp-sessionRow × ${tree.shadowRows}），说明没有走官方侧栏`)
  if (hostRows.length !== hostNames.length + 1) {
    problems.push(`主机行应为「本机 + ${hostNames.length} 台」，实际 ${hostRows.length} 行（${hostRows.map((row) => row.text).join('、')}）`)
  }
  if (hostRows[0]?.text !== '本机') problems.push('主机行第一行不是「本机」')
  if (workspaceRowsAtLoad.length > 0) {
    problems.push(`分组默认收起时不该出现工作区行（出现 ${workspaceRowsAtLoad.length} 行：${workspaceRowsAtLoad.map((row) => row.text).slice(0, 4).join('、')}）`)
  }
  if (tree.sessions.length > 0) problems.push('分组收起时不该出现会话行')

  // 展开所有主机行：工作区行要出现在各自主机下面（缩进 12px）
  const expandHost = async (label) => {
    const ok = await page.evaluate((text) => {
      const row = [...document.querySelectorAll('[data-row-key^="workspace:"]')].find(
        (node) => (node.innerText ?? '').replace(/\s+/g, ' ').trim() === text,
      )
      if (!row) return false
      if (row.getAttribute('aria-expanded') === 'true') return true
      row.click()
      return true
    }, label)
    if (ok) await sleep(700)
    return ok
  }
  for (const label of hostRowTexts) {
    if (!(await expandHost(label))) problems.push(`侧栏没有主机行「${label}」`)
  }
  await sleep(900)

  const expandedTree = await readTree()
  const remoteGroups = expandedTree.groups.filter((group) => !isHostRow(group) && group.hostId && group.hostId !== 'local')
  const localGroups = expandedTree.groups.filter((group) => !isHostRow(group) && !group.hostId)
  first.localGroups = localGroups.map((group) => group.text)
  first.remoteGroups = remoteGroups.map((group) => group.text)
  first.childIndent = {
    host: hostRows[0]?.indent ?? null,
    local: localGroups[0]?.indent ?? null,
    remote: remoteGroups[0]?.indent ?? null,
  }
  await page.screenshot({ path: path.join(OUT, 'ui-1b-hosts-expanded.png') })

  if (localGroups.length === 0) problems.push('展开「本机」后没有本机工作区行')
  if (remoteGroups.length === 0) problems.push('展开远端主机后没有远端工作区行（行 key 应以 workspace:peerbar:<hostId>:ws: 开头）')
  if (first.childIndent.remote !== '12px') problems.push(`子工作区行缩进应为 12px，实际 ${first.childIndent.remote}`)
  if (first.childIndent.host !== '0px') problems.push(`主机行缩进应为 0px，实际 ${first.childIndent.host}`)

  const hostsSeen = new Set(remoteGroups.map((group) => group.hostId))
  if (hostNames.length > 1 && hostsSeen.size < hostNames.length) {
    problems.push(`只有 ${hostsSeen.size}/${hostNames.length} 台 Host 出现在侧栏（${[...hostsSeen].join('、')}）`)
  }

  // 主机行不是真工作区：悬停的「新建会话」必须被拦下（给提示、不建会话）
  const hostCreate = await page.evaluate((label) => {
    const row = [...document.querySelectorAll('[data-row-key^="workspace:"]')].find(
      (node) => (node.innerText ?? '').replace(/\s+/g, ' ').trim() === label,
    )
    if (!row) return null
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    const button = [...row.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') ?? '').includes('新建会话'))
    const sessionsBefore = document.querySelectorAll('[data-row-key^="session:"]').length
    button?.click()
    return { found: Boolean(button), sessionsBefore }
  }, hostNames[0])
  await sleep(1500)
  const hostCreateAfter = await page.evaluate(() => ({
    sessions: document.querySelectorAll('[data-row-key^="session:"]').length,
    notice: document.getElementById('dshp-notice')?.textContent ?? null,
  }))
  first.hostCreateBlocked = { ...hostCreate, ...hostCreateAfter }
  if (!hostCreate?.found) problems.push('主机行上没有「新建会话」按钮（官方行结构变了？）')
  if (hostCreate?.found && hostCreateAfter.sessions !== hostCreate.sessionsBefore) {
    problems.push('点主机行的「新建会话」真的建了会话（应被拦下）')
  }
  if (hostCreate?.found && !/主机分组/.test(hostCreateAfter.notice ?? '')) {
    problems.push(`点主机行建会话没有给出提示（notice=${hostCreateAfter.notice}）`)
  }

  // 回归：按目录合成、又没有正式会话的空组不该出现（用户验收时撞到的「未分组」空组）
  const emptySynthetic = await page.evaluate(async () => {
    try {
      const state = await fetch('/dsh-peerbar/api/state', { credentials: 'same-origin' }).then((response) => response.json())
      const lines = (document.body.innerText ?? '').split('\n').map((line) => line.trim())
      const leaked = []
      for (const host of state?.hosts ?? []) {
        for (const workspace of host.workspaces ?? []) {
          if (typeof workspace.workspaceId === 'string' && workspace.workspaceId) continue
          const formal = (workspace.sessions ?? []).filter((session) => session.archived !== true && session.blank !== true)
          if (formal.length > 0) continue
          const title = workspace.name ?? '未分组'
          // 有 cwd 就按虚拟 id 精确查行；没有（更边缘）再退回整行文本比对。
          const key = typeof workspace.cwd === 'string' && workspace.cwd ? `workspace:peerbar:${host.hostId}:ws:${workspace.cwd}` : null
          const shown = key
            ? Boolean(document.querySelector(`[data-row-key="${CSS.escape(key)}"]`))
            : lines.includes(title)
          if (shown) leaked.push(`${title}（${workspace.cwd ?? '无路径'}）`)
        }
      }
      return leaked
    } catch {
      return []
    }
  })
  first.emptySyntheticLeaked = emptySynthetic
  if (emptySynthetic.length > 0) {
    problems.push(`空的合成工作区出现在了侧栏：${emptySynthetic.join('、')}`)
  }

  // ---- 1b) 远端工作区组默认收起（1.2.0）----
  // 主机展开后，子工作区（会话组）应全部收起；插件只在新组第一次出现时写一次
  // 折叠状态（`uiWorkspace.view.setGroupExpanded`），用户手动展开后重载要保留。
  const readRemoteRows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-row-key^="workspace:"]')]
        .map((row) => ({
          key: row.getAttribute('data-row-key') ?? '',
          text: (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
          expanded: row.getAttribute('aria-expanded'),
        }))
        .filter((row) => {
          const match = /^workspace:peerbar:([^:]+):ws:/.exec(row.key)
          return Boolean(match) && match[1] !== 'local'
        }),
    )

  const collapsed = await until(
    '远端工作区组默认收起',
    () =>
      readRemoteRows().then((remote) => {
        const expandable = remote.filter((row) => row.expanded !== null)
        if (expandable.length === 0) return null
        if (!expandable.every((row) => row.expanded === 'false')) return null
        return { remote: remote.length, expandable: expandable.length }
      }),
    15000,
  ).catch(() => null)
  first.autoCollapse = collapsed
  if (remoteGroups.length > 0 && !collapsed) problems.push('远端工作区组没有默认收起（15s 内仍展开）')

  // ---- 1c) 「添加工作区」对话框：主机选择 + 远端目录浏览（1.2.0）----
  const addButton = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button[aria-label]')].filter(
      (node) => node.offsetParent !== null && (node.getAttribute('aria-label') ?? '').includes('工作区'),
    )
    const button = buttons.find((node) => node.closest('[class*="headerActions"]')) ?? buttons[0]
    if (!button) return false
    button.click()
    return true
  })
  first.addWorkspaceButton = addButton
  if (!addButton) problems.push('侧栏找不到「添加工作区」按钮')
  const addDialog = addButton
    ? await until(
        '添加工作区对话框',
        () =>
          page.evaluate((names) => {
            const input = document.querySelector('.dshp-pathInput')
            if (!input) return null
            const text = document.body.innerText ?? ''
            return {
              local: text.includes('本机'),
              hosts: names.filter((name) => text.includes(name)),
              path: input.value,
            }
          }, hostNames),
        15000,
      ).catch(() => null)
    : null
  first.addWorkspaceDialog = addDialog
  if (addButton && !addDialog) problems.push('「添加工作区」没有弹出接管的目录对话框')
  if (addDialog && !addDialog.local) problems.push('目录对话框缺少「本机」主机标签')
  if (addDialog) {
    const missing = hostNames.filter((name) => !addDialog.hosts.includes(name))
    if (missing.length > 0) problems.push(`目录对话框缺少远程主机标签：${missing.join('、')}`)
    await sleep(600) // 等 Modal 的入场动画结束，否则截图是半透明的
    await page.screenshot({ path: path.join(OUT, 'ui-0-add-workspace.png') })

    // 切到第一台远端主机：只读地列出远端目录，截图后取消（真正的写入在 §8）。
    const switched = await page.evaluate((name) => {
      const chip = [...document.querySelectorAll('button')].find(
        (node) => node.offsetParent !== null && (node.innerText ?? '').trim() === name,
      )
      if (!chip) return false
      chip.click()
      return true
    }, hostNames[0])
    const remoteListing = switched
      ? await until(
          `${hostNames[0]} 目录列表`,
          () =>
            page.evaluate(() => {
              const input = document.querySelector('.dshp-pathInput')
              if (!input?.value) return null
              const text = document.body.innerText ?? ''
              if (text.includes('正在读取…')) return null
              return { path: input.value, home: text.includes('主目录') }
            }),
          20000,
        ).catch(() => null)
      : null
    first.addWorkspaceRemoteListing = remoteListing
    if (switched && !remoteListing) problems.push(`切到 ${hostNames[0]} 后没有列出远端目录`)
    if (remoteListing) {
      await sleep(400)
      await page.screenshot({ path: path.join(OUT, 'ui-0b-add-workspace-remote.png') })
    }
    await page.evaluate(() => {
      const input = document.querySelector('.dshp-pathInput')
      const dialogScope = input?.closest('[role="dialog"]') ?? document.body
      const cancel = [...dialogScope.querySelectorAll('button')].find(
        (node) => node.offsetParent !== null && (node.innerText ?? '').trim() === '取消',
      )
      cancel?.click()
    })
    const closed = await until('目录对话框关闭', () => page.evaluate(() => !document.querySelector('.dshp-pathInput')), 10000).catch(
      () => false,
    )
    if (!closed) problems.push('目录对话框点取消后没有关闭')
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
      if (!created) {
        problems.push(
          `在远端组新建会话后，组里没有出现新会话行（插件路由失败：${JSON.stringify(apiErrors.slice(-2))}）`,
        )
      }
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

      // 清理：关掉这次自检创建的终端。不关的话远端会攒到 per-session 上限
      // （`Session terminal limit reached`），下一轮自检就打不开 xterm 了。
      const closed = await page.evaluate(async (groupKey) => {
        const recorded = (window.__DSH_PB_REQUESTS__ ?? []).filter(
          (entry) => /terminal\/create/.test(entry.body ?? '') && entry.payload?.ok === true,
        )
        const last = recorded.at(-1)
        const id = last?.payload?.value?.id
        const created = /"agentId":"([^"]+)"/.exec(last?.body ?? '')?.[1]
        if (!id || !created) return { ok: false, reason: '没有找到 terminal/create 的记录' }
        const hostId = /^workspace:peerbar:([^:]+):ws:/.exec(groupKey ?? '')?.[1]
        if (!hostId) return { ok: false, reason: '没有解析出 hostId' }
        const response = await fetch(`/dsh-peerbar/api/hosts/${encodeURIComponent(hostId)}/rpc`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-dsh-peerbar-action': '1' },
          body: JSON.stringify({ endpoint: 'terminal/close', args: { agentId: created, id } }),
        })
        const payload = await response.json().catch(() => null)
        return { ok: payload?.ok === true, id }
      }, firstRemoteKey).catch((error) => ({ ok: false, reason: String(error) }))
      first.terminalClosed = closed
    }
  }

  // ---- 7) 计划预览：远端 session/follow 的 opening snapshot + session/page ----
  // 用 nv50 上已归档的「计划桥测试」会话：先解档 → 点开 → 点计划卡片 → 右侧栏应出现全文。
  // 只读远端历史，唯一的写入是解档/回档这条测试会话（与新建会话同级）。
  if (!QUICK) {
    const planTarget = await page.evaluate(async () => {
      const state = await fetch('/dsh-peerbar/api/state', { credentials: 'same-origin' }).then((response) => response.json())
      for (const host of state?.hosts ?? []) {
        for (const workspace of host.workspaces ?? []) {
          for (const session of workspace.sessions ?? []) {
            if (!/计划桥测试/.test(session.title ?? '')) continue
            return {
              hostId: host.hostId,
              hostName: host.name,
              rawId: session.rawId,
              title: session.title,
              hostRowKey: `workspace:peerbar:${host.hostId}:hostroot`,
              workspaceKey: `workspace:${workspace.id ?? ''}`,
              workspaceTitle: workspace.name ?? '未分组',
            }
          }
        }
      }
      return null
    })
    first.planPreview = { target: planTarget }

    const setArchived = (target, archived) =>
      page.evaluate(
        async ([hostId, sessionId, archive]) => {
          const response = await fetch(`/dsh-peerbar/api/hosts/${encodeURIComponent(hostId)}/rpc`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-dsh-peerbar-action': '1' },
            body: JSON.stringify({
              endpoint: archive ? 'workspace/archiveSession' : 'workspace/unarchiveSession',
              args: { request: { sessionId, ...(archive ? { stopActivity: true } : {}) } },
            }),
          })
          const payload = await response.json().catch(() => null)
          return response.ok && payload?.ok !== false
        },
        [target.hostId, target.rawId, archived],
      )

    if (!planTarget) {
      first.planPreview.skipped = '没有「计划桥测试」会话（找不到计划夹具）'
    } else {
      const unarchived = await setArchived(planTarget, false)
      first.planPreview.unarchived = unarchived
      if (!unarchived) problems.push('解档计划夹具会话失败（远端 workspace/unarchiveSession 被拒）')

      // 展开目标组，等 /state 把归档集刷新过来（行才会出现）
      const planRow = await until(
        '计划夹具会话出现在侧栏',
        async () => {
          await page.evaluate(([hostKey, workspaceKey]) => {
            for (const key of [hostKey, workspaceKey]) {
              const row = document.querySelector(`[data-row-key="${CSS.escape(key)}"]`)
              if (row && row.getAttribute('aria-expanded') !== 'true') row.click()
            }
          }, [planTarget.hostRowKey, planTarget.workspaceKey])
          return page.evaluate(
            (key) => {
              const row = document.querySelector(`[data-row-key="${key}"]`)
              if (!row) return null
              row.click()
              return row.innerText.replace(/\s+/g, ' ').trim()
            },
            `session:${planTarget.rawId}`,
          )
        },
        25000,
      ).catch(() => false)
      first.planPreview.rowAppeared = planRow

      if (!planRow) {
        problems.push(`解档后「${planTarget.title}」没有出现在侧栏（25s）`)
      } else {
        // 计划卡片由官方 ui-plan 从 tool/call(exit_plan_mode) 派生
        const card = await until(
          '计划卡片出现',
          () =>
            page.evaluate(() => {
              const node = document.querySelector('[data-plan-card]')
              if (!node) return null
              return { callId: node.getAttribute('data-plan-card'), title: (node.innerText ?? '').replace(/\s+/g, ' ').trim() }
            }),
          25000,
        ).catch(() => false)
        first.planPreview.card = card
        if (!card) {
          problems.push('远端会话里没有渲染出计划卡片（[data-plan-card] 未出现）')
        } else {
          await page.evaluate(() => document.querySelector('[data-plan-card]')?.click())
          // 官方页签先显示「正在读取计划…」，读成功后换成计划正文。
          // 注意 until 只认「真值」：读到正文或明确失败之前一律返回 null，
          // 否则第一轮（还在 loading）就会被当成最终状态。
          const loaded = await until(
            '计划全文',
            () =>
              page.evaluate(() => {
                const text = document.body.innerText ?? ''
                const hasBody = text.includes('恰好一行说明文字')
                const failed = text.includes('无法读取计划')
                if (!hasBody && !failed) return null
                return {
                  loading: text.includes('正在读取计划'),
                  failed,
                  // 夹具计划正文里的一句，卡片标题里没有
                  hasBody,
                  tabs: [...document.querySelectorAll('[data-dockkit-tab]')].map((node) => (node.textContent ?? '').trim()),
                }
              }),
            25000,
          ).catch(() => false)
          first.planPreview.loaded = loaded
          await page.screenshot({ path: path.join(OUT, 'ui-7-plan-preview.png') })
          if (!loaded) {
            problems.push('点击计划卡片后计划预览没有加载出来（25s）')
          } else {
            if (loaded.failed) problems.push('计划预览显示「无法读取计划」')
            if (!loaded.hasBody) problems.push('计划预览没有出现正文（可能仍停在「正在读取计划…」）')
            if (loaded.hasBody && loaded.loading) {
              // 正文已出，但页面上还留着 loading 文案 → 说明换了另一个页签，记录但不判失败
              first.planPreview.loadingLeftover = true
            }
          }
        }
      }

      // 回档，别把夹具会话留在列表里
      first.planPreview.rearchived = await setArchived(planTarget, true)
      if (!first.planPreview.rearchived) problems.push('回档计划夹具会话失败')
    }
  }

  // ---- 8) 在远端目录上添加工作区（1.2.0）----
  // 选一个远端已存在、但还没登记成工作区的目录：在对话框里选主机 → 输入路径 →
  // 打开 → 远端 `workspace/create` → 侧栏出现该工作区行（按投影出来的行 key
  // 精确匹配，不靠标题文本）→ 用 `workspace/delete` 清掉。只注册/注销目录，
  // 不写任何文件。
  if (!QUICK) {
    const candidates = ['/tmp', '/home/nwj/peerbar-ui-check']
    const target = await page.evaluate(async (paths) => {
      const state = await fetch('/dsh-peerbar/api/state', { credentials: 'same-origin' }).then((response) => response.json())
      for (const host of state?.hosts ?? []) {
        if (host.status !== 'online') continue
        const used = new Set((host.workspaces ?? []).map((workspace) => workspace.cwd))
        const path = paths.find((candidate) => !used.has(candidate))
        if (path) return { hostId: host.hostId, hostName: host.name, path }
      }
      return null
    }, candidates)
    first.remoteAddWorkspace = { target }

    const findWorkspace = () =>
      page.evaluate(async ({ hostId, path }) => {
        const state = await fetch('/dsh-peerbar/api/state', { credentials: 'same-origin' }).then((response) => response.json())
        const host = (state?.hosts ?? []).find((entry) => entry.hostId === hostId)
        const workspace = (host?.workspaces ?? []).find((entry) => entry.cwd === path)
        return workspace
          ? {
              workspaceId: workspace.workspaceId,
              cwd: workspace.cwd,
              title: workspace.name,
              rowKey: `workspace:${workspace.id ?? ''}`,
            }
          : null
      }, target)

    const remove = async () => {
      const found = await findWorkspace().catch(() => null)
      if (!found?.workspaceId) return { ok: true, skipped: '没有登记（无需清理）' }
      const removed = await page.evaluate(async ({ hostId, workspaceId }) => {
        const response = await fetch(`/dsh-peerbar/api/hosts/${encodeURIComponent(hostId)}/rpc`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-dsh-peerbar-action': '1' },
          body: JSON.stringify({ endpoint: 'workspace/delete', args: { request: { workspaceId } } }),
        })
        const payload = await response.json().catch(() => null)
        return payload?.ok === true
      }, { hostId: target.hostId, workspaceId: found.workspaceId })
      return { ok: removed === true, workspaceId: found.workspaceId }
    }

    if (!target) {
      first.remoteAddWorkspace.skipped = '没有可用的远端候选目录（都已被登记成工作区）'
    } else {
      try {
        const opened = await page.evaluate(() => {
          const buttons = [...document.querySelectorAll('button[aria-label]')].filter(
            (node) => node.offsetParent !== null && (node.getAttribute('aria-label') ?? '').includes('工作区'),
          )
          const button = buttons.find((node) => node.closest('[class*="headerActions"]')) ?? buttons[0]
          button?.click()
          return Boolean(button)
        })
        if (!opened) throw new Error('找不到「添加工作区」按钮')
        // 桌面端的本机选择器是 native 能力：对话框先渲染「系统对话框」分支，
        // 路径框只在非 native 分支里，所以先切到远端主机再等路径框。
        await until(
          '对话框打开',
          () => page.evaluate(() => (document.body.innerText ?? '').includes('选择工作区目录')),
          15000,
        )
        // Modal 入场动画的第一帧里子树还没布局（offsetParent 为 null），按几何尺寸
        // 判断可见性并轮询点击，避免「标签明明在屏幕上却找不到」。
        const chipClicked = await until(
          `主机标签 ${target.hostName}`,
          () =>
            page.evaluate((name) => {
              const chip = [...document.querySelectorAll('button')].find((node) => {
                if ((node.innerText ?? '').trim() !== name) return false
                const rect = node.getBoundingClientRect()
                return rect.width > 0 && rect.height > 0
              })
              if (!chip) return null
              chip.click()
              return true
            }, target.hostName),
          15000,
        ).catch(() => false)
        if (!chipClicked) throw new Error(`对话框里找不到主机标签 ${target.hostName}`)
        await until(
          '路径框',
          () =>
            page.evaluate(() => {
              const input = document.querySelector('.dshp-pathInput')
              if (!input) return null
              const rect = input.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0 ? true : null
            }),
          15000,
        )
        // 直接在页面里写值 + 发回车：三击选中在无头浏览器里不可靠（会把路径
        // 拼成 /home/nwj/tmp），键盘焦点也可能被 Modal 的 focus trap 拿走。
        await page.evaluate((path) => {
          const input = document.querySelector('.dshp-pathInput')
          if (!input) return
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          setter.call(input, path)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        }, target.path)
        const listed = await until(
          `列出 ${target.path}`,
          () =>
            page.evaluate((path) => {
              const input = document.querySelector('.dshp-pathInput')
              if (!input || input.value !== path) return null
              if ((document.body.innerText ?? '').includes('正在读取…')) return null
              return { path }
            }, target.path),
          20000,
        ).catch(() => null)
        if (!listed) throw new Error(`输入路径后没有列出 ${target.path}`)
        // 只在对话框里找按钮：计划页签自己也有一个「打开」，先到先得会点错。
        const confirmed = await page.evaluate(() => {
          const input = document.querySelector('.dshp-pathInput')
          const scope = input?.closest('[role="dialog"]') ?? input?.parentElement
          if (!scope) return false
          const open = [...scope.querySelectorAll('button')].find(
            (node) => node.offsetParent !== null && (node.innerText ?? '').trim() === '打开',
          )
          open?.click()
          return Boolean(open)
        })
        if (!confirmed) throw new Error('对话框里找不到「打开」按钮')
        const registered = await until('远端登记新工作区', findWorkspace, 30000)
        first.remoteAddWorkspace.registered = registered
        const appeared = await until(
          '侧栏出现新工作区组',
          () =>
            page.evaluate((expected) => {
              return document.querySelector(`[data-row-key="${CSS.escape(expected)}"]`) ? true : null
            }, registered.rowKey),
          25000,
        )
          .then(() => true)
          .catch(() => false)
        first.remoteAddWorkspace.appeared = appeared
        if (!appeared) problems.push(`在 ${target.hostName} 上添加工作区后侧栏没有出现「${registered.title}」`)
        await sleep(400)
        await page.screenshot({ path: path.join(OUT, 'ui-8-remote-workspace.png') })
      } catch (error) {
        first.remoteAddWorkspace.error = String(error?.message ?? error)
        first.remoteAddWorkspace.dialog = await page
          .evaluate(() => {
            const input = document.querySelector('.dshp-pathInput')
            const scope = input?.closest('[role="dialog"]')
            return scope ? (scope.innerText ?? '').slice(0, 400) : null
          })
          .catch(() => null)
        await page.screenshot({ path: path.join(OUT, 'ui-8-debug.png') }).catch(() => {})
        problems.push(`远端添加工作区失败：${first.remoteAddWorkspace.error}`)
      } finally {
        const removed = await remove().catch((error) => ({ ok: false, reason: String(error) }))
        first.remoteAddWorkspace.cleanup = removed
        if (removed.ok !== true) problems.push('清理远端测试工作区失败（远端可能残留一条工作区登记）')
        const unregistered = await until('远端登记已删除', async () => ((await findWorkspace().catch(() => null)) ? null : true), 25000)
          .then(() => true)
          .catch(() => false)
        first.remoteAddWorkspace.removed = unregistered
        if (!unregistered) problems.push('测试工作区没有从 /state 里消失')
        if (first.remoteAddWorkspace.registered) {
          const rowGone = await until(
            '侧栏移除测试工作区',
            () =>
              page.evaluate((expected) => {
                return document.querySelector(`[data-row-key="${CSS.escape(expected)}"]`) ? null : true
              }, first.remoteAddWorkspace.registered.rowKey),
            25000,
          )
            .then(() => true)
            .catch(() => false)
          first.remoteAddWorkspace.rowGone = rowGone
          if (!rowGone) problems.push('测试工作区注销后侧栏行没有消失')
        }
      }
    }
  }

  // ---- 9) 折叠迁移 + 分组方式联动（1.2.0）----
  // 9a 一次性迁移：展开一个远端工作区组 → 官方记住 → 清插件标记重载 → 又被收起。
  // 9b 视图选项切到「按工作区」→ 分组自动退场、行回到平铺（真实路径 + 主机后缀）。
  // 9c 切回「按工作区树」→ 主机行回来。
  // 9d 设置页「远程主机」：没有侧栏块、没有排序按钮；「添加」开一个登记窗口。
  const probe = await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-row-key^="workspace:"]')].find((node) => {
      const match = /^workspace:peerbar:([^:]+):ws:/.exec(node.getAttribute('data-row-key') ?? '')
      return Boolean(match) && match[1] !== 'local' && node.getAttribute('aria-expanded') !== null
    })
    if (!row) return null
    const key = row.getAttribute('data-row-key') ?? ''
    row.click()
    return { key, workspaceId: key.replace(/^workspace:/, '') }
  })
  first.migrationProbe = probe
  if (probe) {
    await sleep(900)
    const persisted = await page.evaluate((workspaceId) => {
      const raw = localStorage.getItem('dsh.workspace.view.v5') ?? ''
      return { hasKey: raw.includes(workspaceId), rawLength: raw.length }
    }, probe.workspaceId)
    first.autoCollapsePersisted = persisted
    if (!persisted.hasKey) problems.push('展开远端组后官方没有把折叠状态写进 localStorage（迁移无法验证）')
    await page.evaluate(() => {
      localStorage.removeItem('dsh-peerbar.collapsedRemote.v1')
      localStorage.removeItem('dsh-peerbar.collapsedRemote.migrated.v1')
    })
    await page.reload({ waitUntil: 'networkidle2', timeout: 40000 })
    await until(
      '重载后出现主机行',
      () => page.evaluate(() => document.querySelectorAll('[data-row-key^="workspace:"]').length > 0),
      30000,
    )
    await sleep(6000)
    for (const name of ['本机', ...hostNames]) {
      if (!(await expandHost(name))) problems.push(`重载后找不到主机行「${name}」`)
    }
    await sleep(1000)
    const reCollapsed = await until(
      '重载后远端组再次收起',
      () =>
        readRemoteRows().then((remote) => {
          const expandable = remote.filter((row) => row.expanded !== null)
          if (expandable.length === 0) return null
          return expandable.every((row) => row.expanded === 'false') ? true : null
        }),
      15000,
    ).catch(() => false)
    first.autoCollapseAfterReload = reCollapsed
    if (!reCollapsed) problems.push('重载后迁移没有把已展开的远端组收起来')
  } else {
    problems.push('找不到任何远端工作区行（迁移无法验证）')
  }

  // 9b 视图选项 → 按工作区：分组自动退场，行为平铺的真实路径
  const openViewOptions = async () => {
    const opened = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button[aria-label]')].find(
        (node) => node.getAttribute('aria-label') === '视图选项',
      )
      if (!button) return false
      button.click()
      return true
    })
    if (!opened) problems.push('找不到「视图选项」按钮')
    await sleep(700)
  }
  const clickViewOption = async (label) => {
    const point = await page.evaluate((text) => {
      const nodes = [...document.querySelectorAll('*')].filter(
        (node) => (node.innerText ?? '').trim() === text && node.children.length === 0 && node.offsetParent !== null,
      )
      const node = nodes[0]
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }, label)
    if (!point) {
      problems.push(`视图选项里找不到「${label}」`)
      return false
    }
    await page.mouse.click(point.x, point.y)
    return true
  }

  await openViewOptions()
  await clickViewOption('按工作区')
  await sleep(2200)
  const flat = await page.evaluate(() => ({
    flag: localStorage.getItem('dsh-peerbar.hostGroups.v2'),
    rows: [...document.querySelectorAll('[data-row-key^="workspace:"]')].map((row) => ({
      key: row.getAttribute('data-row-key') ?? '',
      text: (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
    })),
  }))
  const flatHostRows = flat.rows.filter((row) => row.key.endsWith(':hostroot'))
  first.groupingOff = { flag: flat.flag, rowCount: flat.rows.length, hostRows: flatHostRows.map((row) => row.text) }
  if (flat.flag !== '0') problems.push(`切到「按工作区」后分组标记没有自动写回关（flag=${flat.flag}）`)
  if (flatHostRows.length > 0) problems.push(`平铺后仍出现主机行：${flatHostRows.map((row) => row.text).join('、')}`)
  const expectedFlat = (first.localGroups?.length ?? 0) + (first.remoteGroups?.length ?? 0)
  if (expectedFlat > 0 && flat.rows.length !== expectedFlat) {
    problems.push(`平铺行数应为 ${expectedFlat}，实际 ${flat.rows.length}`)
  }
  // 平铺时远端工作区标题要带「· 主机名」：没有主机行，后缀是唯一来源
  const flatRemote = flat.rows.filter((row) => /^workspace:peerbar:[^:]+:ws:/.test(row.key) && !/:local:/.test(row.key))
  const flatMissingSuffix = flatRemote.filter((row) => !hostNames.some((name) => row.text.endsWith(` · ${name}`)))
  first.flatSuffix = { remote: flatRemote.length, missing: flatMissingSuffix.map((row) => row.text) }
  if (flatRemote.length > 0 && flatMissingSuffix.length > 0) {
    problems.push(`平铺时远端工作区标题缺少「· 主机名」后缀：${flatMissingSuffix.map((row) => row.text).join('、')}`)
  }
  await page.screenshot({ path: path.join(OUT, 'ui-9-grouping-off.png') })

  // 9c 切回「按工作区树」：主机行回来（设置的投影只在这个分组方式下成立）
  await openViewOptions()
  await clickViewOption('按工作区树')
  await sleep(2600)
  const regrouped = await page.evaluate(() => ({
    flag: localStorage.getItem('dsh-peerbar.hostGroups.v2'),
    hostRows: [...document.querySelectorAll('[data-row-key^="workspace:"]')]
      .filter((row) => (row.getAttribute('data-row-key') ?? '').endsWith(':hostroot'))
      .map((row) => (row.innerText ?? '').replace(/\s+/g, ' ').trim()),
  }))
  first.groupingOn = regrouped
  if (regrouped.flag !== '1') problems.push(`切回「按工作区树」后分组标记没有恢复（flag=${regrouped.flag}）`)
  if (regrouped.hostRows.length !== hostNames.length + 1) {
    problems.push(`切回分组后主机行应为 ${hostNames.length + 1} 行，实际 ${regrouped.hostRows.length}`)
  }

  // 9d 设置页「远程主机」：没有侧栏块、没有排序按钮，「添加」开登记窗口
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button[aria-label]')]
      .find((node) => node.getAttribute('aria-label') === '账号菜单')
      ?.click()
  })
  await sleep(700)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('[role="menuitem"], button')]
      .find((node) => (node.innerText ?? '').trim() === '设置' && node.offsetParent !== null)
      ?.click()
  })
  await sleep(1200)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button, [role="menuitem"], div')]
      .find((node) => (node.innerText ?? '').trim() === '远程主机' && node.offsetParent !== null)
      ?.click()
  })
  await sleep(900)
  const settingsPage = await page.evaluate(() => {
    const panel = document.querySelector('.dshp-set')
    if (!panel) return null
    const text = panel.innerText ?? ''
    return {
      title: (panel.querySelector('.dshp-set-title')?.innerText ?? '').trim(),
      text: text.replace(/\s+/g, ' ').trim().slice(0, 600),
      hosts: [...panel.querySelectorAll('.dshp-host')].map((card) => ({
        name: card.querySelector('.dshp-host-name')?.innerText?.trim() ?? null,
        origin: card.querySelector('.dshp-host-origin')?.innerText?.trim() ?? null,
        status: card.querySelector('.dshp-host-badge')?.innerText?.trim() ?? null,
        buttons: [...card.querySelectorAll('.dshp-host-actions button')].map((node) => (node.innerText ?? '').trim()),
      })),
      // 旧版的侧栏块与排序按钮必须绝迹
      hasSidebarHeading: text.includes('侧栏') || text.includes('按主机分组') || text.includes('收起全部远端工作区'),
      hasMoveButtons: [...panel.querySelectorAll('button')].some((node) => /^[↑↓]$/.test((node.innerText ?? '').trim())),
      addButtons: [...panel.querySelectorAll('button')].filter((node) => (node.innerText ?? '').trim() === '添加').length,
      flag: localStorage.getItem('dsh-peerbar.hostGroups.v2'),
    }
  })
  first.settingsPage = settingsPage
  if (!settingsPage) {
    problems.push('设置页找不到「远程主机」内容（.dshp-set 未渲染）')
  } else {
    if (settingsPage.hasSidebarHeading) problems.push('设置页仍出现「侧栏 / 按主机分组 / 收起全部远端工作区」字样（应整体移除）')
    if (settingsPage.hasMoveButtons) problems.push('设置页主机卡片仍有「上移/下移」按钮（应移除）')
    if (settingsPage.addButtons !== 1) problems.push(`设置页「添加」按钮应只有 1 个，实际 ${settingsPage.addButtons}`)
    if (settingsPage.hosts.length !== hostNames.length) {
      problems.push(`设置页应列出 ${hostNames.length} 台主机，实际 ${settingsPage.hosts.length}`)
    }
    for (const card of settingsPage.hosts) {
      for (const label of ['刷新', '令牌', '删除']) {
        if (!card.buttons.includes(label)) problems.push(`主机卡片「${card.name}」缺少按钮「${label}」（${card.buttons.join('/')}）`)
      }
    }
  }
  await page.screenshot({ path: path.join(OUT, 'ui-10-settings.png') })

  // 「添加」→ 登记窗口（只验证表单出现，不真的登记，避免污染注册表）
  const addHostClick = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.dshp-set button')].find((node) => (node.innerText ?? '').trim() === '添加')
    if (!button) return false
    button.click()
    return true
  })
  await sleep(800)
  const addHostForm = await page.evaluate(() => {
    const form = document.querySelector('.dshp-form')
    if (!form) return null
    const scope = form.closest('[role="dialog"]') ?? document
    return {
      fields: [...form.querySelectorAll('.dshp-field > label')].map((node) => (node.innerText ?? '').trim()),
      inputs: form.querySelectorAll('input').length,
      footer: [...scope.querySelectorAll('button')].map((node) => (node.innerText ?? '').trim()).slice(0, 8),
      // 页面主体不应该还留着旧的内联表单
      inlineFormVisible: Boolean(document.querySelector('.dshp-set > form')),
    }
  })
  first.settingsAddDialog = { opened: addHostClick, form: addHostForm }
  if (!addHostClick) problems.push('设置页点「添加」没有反应')
  if (!addHostForm) problems.push('「添加」之后没有弹出登记窗口（.dshp-form 未出现）')
  else {
    if (addHostForm.fields.join('/') !== '名称/地址/访问令牌') {
      problems.push(`登记窗口字段应为 名称/地址/访问令牌，实际 ${addHostForm.fields.join('/')}`)
    }
    if (!addHostForm.footer.includes('添加')) problems.push(`登记窗口底部没有「添加」按钮（${addHostForm.footer.join('/')}）`)
    if (addHostForm.inlineFormVisible) problems.push('设置页仍保留内联的「添加」表单块')
  }
  await page.screenshot({ path: path.join(OUT, 'ui-10b-add-host.png') })
  await page.keyboard.press('Escape')
  await sleep(600)

  // 10 远端会话的「已编辑 N 个文件」卡片（官方 ui-deliverables）
  //    卡片用普通 fetch 读 `/api/changes.summary?sessionId=…&seq=…`，摘要只存在
  //    记录它的那个 Host 进程里。联邦视图里那个会话属于远端，本机路由只能 404，
  //    所以插件把它改写到 `/dsh-peerbar/api/asset` 转发。这里：
  //      1) 找一条**真带 `workspace/changes` 宣告**的远端会话（没有就记 skipped）；
  //      2) 先确认远端摘要还活着（Host 重启就没了，那是既定行为，记 skipped）；
  //      3) 打开它，断言卡片出现、转发 200、没有任何直连 `/api/changes.*`。
  const changesFixture = await page.evaluate(async () => {
    const state = await (await fetch('/dsh-peerbar/api/state', { credentials: 'same-origin' })).json()
    const candidates = []
    for (const host of state.hosts ?? []) {
      if (host.enabled !== true || host.status !== 'online') continue
      for (const workspace of host.workspaces ?? []) {
        for (const session of (workspace.sessions ?? []).slice(0, 3)) {
          if (session.archived === true) continue
          candidates.push({
            hostId: host.hostId,
            hostName: host.name,
            workspaceId: workspace.id ?? '',
            workspaceTitle: workspace.name ?? '',
            sessionId: session.rawId,
          })
        }
      }
    }
    const probe = (candidate) =>
      new Promise((resolve) => {
        let settled = false
        let socket
        const finish = (value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try {
            socket?.close()
          } catch {
            /* 忽略 */
          }
          resolve(value)
        }
        const timer = setTimeout(() => finish(null), 3000)
        try {
          const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
          const query = new URLSearchParams({ hostId: candidate.hostId, sessionId: candidate.sessionId })
          socket = new WebSocket(`${scheme}//${location.host}/dsh-peerbar/api/follow?${query.toString()}`)
        } catch {
          finish(null)
          return
        }
        socket.addEventListener('message', (event) => {
          let message
          try {
            message = JSON.parse(event.data)
          } catch {
            return
          }
          const value = message?.value
          if (message?.type !== 'item' || value?.type !== 'snapshot' || !Array.isArray(value.records)) return
          const record = value.records.find((item) => (item?.event?.type ?? item?.type) === 'workspace/changes')
          if (!record) return finish(null)
          finish({ ...candidate, seq: record.event?.seq ?? record.seq ?? null })
        })
        socket.addEventListener('error', () => finish(null))
      })
    for (const candidate of candidates.slice(0, 6)) {
      const found = await probe(candidate)
      if (found) return found
    }
    return null
  })

  if (!changesFixture) {
    first.changesCard = { skipped: '远端没有带 workspace/changes 宣告的会话' }
  } else {
    const summaryProbe = await page.evaluate(async (fixture) => {
      const path = `/api/changes.summary?sessionId=${encodeURIComponent(fixture.sessionId)}&seq=${fixture.seq}`
      const url = `/dsh-peerbar/api/asset?hostId=${encodeURIComponent(fixture.hostId)}&path=${encodeURIComponent(path)}`
      const response = await fetch(url, { credentials: 'same-origin' })
      return { status: response.status, upstream: response.headers.get('x-peerbar-upstream') }
    }, changesFixture)

    if (summaryProbe.status !== 200) {
      first.changesCard = { skipped: `远端摘要已不可读（HTTP ${summaryProbe.status}）` }
    } else {
      // 展开 owning Host 与工作区（行 key 是投影出来的虚拟 id），再点中那条会话
      const expandRow = async (rowKey) => {
        const clicked = await page.evaluate((key) => {
          const row = document.querySelector(`[data-row-key="${CSS.escape(key)}"]`)
          if (!row) return false
          if (row.getAttribute('aria-expanded') !== 'true') row.click()
          return true
        }, rowKey)
        await sleep(700)
        return clicked
      }
      const hostRowKey = `workspace:peerbar:${changesFixture.hostId}:hostroot`
      if (!(await expandRow(hostRowKey))) problems.push('§10 找不到 owning Host 的主机行（无法展开工作区）')
      if (!(await expandRow(`workspace:${changesFixture.workspaceId}`))) {
        problems.push('§10 找不到该会话所在的工作区行（无法展开会话）')
      }
      await sleep(200)
      const clicked = await page.evaluate(
        (id) => {
          const row = document.querySelector(`[data-row-key="session:${id}"]`)
          row?.click()
          return Boolean(row)
        },
        changesFixture.sessionId,
      )
      if (!clicked) problems.push('侧栏里找不到带改动记录的远端会话行（§10 无法打开）')
      const cardShown = clicked
        ? await until(
            '远端会话里出现改动文件卡片',
            async () => page.evaluate(() => /已编辑\s*\d+\s*个文件/.test(document.body.innerText)),
            25000,
          ).catch(() => false)
        : false
      await page.screenshot({ path: path.join(OUT, 'ui-11-changes-card.png') })
      const forwarded = assetProxies.filter((item) => item.status === 200 && item.target.startsWith('/api/changes.summary'))
      if (!cardShown) problems.push('远端会话没有渲染出「已编辑 N 个文件」卡片（摘要没转发成功？）')
      if (forwarded.length === 0) problems.push('改动摘要没有走 /dsh-peerbar/api/asset 转发（仍是直连 /api/changes.summary）')
      // 只认「这条远端会话」的直连失败：本机会话的摘要随 Host 重启消失，
      // 那是官方的既定行为（卡片不出现），不是本节的回归。
      const directHits = directChanges.filter(
        (item) => item.status >= 400 && item.url.includes(encodeURIComponent(changesFixture.sessionId)),
      )
      if (directHits.length > 0) problems.push(`仍有直连 /api/changes.* 的失败请求：${JSON.stringify(directHits.slice(0, 2))}`)
      // 同一轮顺手核对回复下的 👍/👎：0.2.2 的 messageFeedback 是 Remote 名字空间，
      // 不转发就会在本机读不到远端会话的反馈，条形下方显示「反馈状态加载失败」。
      // 反馈状态是懒加载的（首次 focus/悬停评分按钮才读），所以这里主动 focus 一下。
      const feedbackFocused = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button[aria-label]')].find(
          (node) => node.getAttribute('aria-label') === '好的回答',
        )
        if (!button) return false
        button.focus()
        button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        return true
      })
      await sleep(1500)
      const feedback = await page.evaluate(() => ({
        failed: (document.body.innerText ?? '').includes('反馈状态加载失败'),
        buttons: document.querySelectorAll('[aria-label="好的回答"]').length,
      }))
      const feedbackCalls = rpcCalls.filter((item) => item.endpoint.startsWith('messageFeedback/'))
      if (feedback.failed) problems.push('远端会话里出现「反馈状态加载失败」（messageFeedback 没有转发）')
      if (feedbackCalls.some((item) => item.status >= 400)) {
        problems.push(`messageFeedback 转发失败：${JSON.stringify(feedbackCalls.filter((item) => item.status >= 400).slice(0, 2))}`)
      }
      if (feedbackFocused && !feedbackCalls.some((item) => item.endpoint === 'messageFeedback/list' && item.status === 200)) {
        problems.push('远端会话的反馈状态没有经 messageFeedback/list 读到（RPC 里没有成功的 list）')
      }
      first.changesCard = {
        host: changesFixture.hostName,
        sessionId: changesFixture.sessionId,
        seq: changesFixture.seq,
        shown: Boolean(cardShown),
        forwarded: forwarded.length,
        directHits: directHits.length,
        feedback: {
          focused: feedbackFocused,
          failed: feedback.failed,
          calls: feedbackCalls.length,
          buttons: feedback.buttons,
        },
      }
    }
  }

  // ---- 收尾 ----
  const knownWarnings = consoleErrors.filter((text) => KNOWN_NOISE.some((pattern) => pattern.test(text)))
  const realErrors = consoleErrors.filter((text) => !knownWarnings.includes(text))
  const result = { base, mode: QUICK ? 'quick' : 'full', ...first, apiErrors, consoleErrors: realErrors, knownWarnings }
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
