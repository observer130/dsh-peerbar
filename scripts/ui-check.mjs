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
 *       ui-8-remote-workspace.png、ui-check.json
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
    }, hostNames)

  // ---- 1) 树的形态：主机分组（1.2.0 起默认开）----
  // 官方树支持任意层级，主机层是投影出来的：远端路径带 `主机:` 前缀、每台主机一个
  // 合成父工作区（本机用 `/`）。所以加载后应该只有「本机 / 各主机」三行。
  const tree = await readTree()
  const hostRowTexts = ['本机', ...hostNames]
  const isHostRow = (row) => hostRowTexts.includes(row.text)
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
  const remoteGroups = expandedTree.groups.filter((group) => group.host)
  const localGroups = expandedTree.groups.filter((group) => !group.host && !isHostRow(group))
  first.localGroups = localGroups.map((group) => group.text)
  first.remoteGroups = remoteGroups.map((group) => group.text)
  first.childIndent = {
    host: hostRows[0]?.indent ?? null,
    local: localGroups[0]?.indent ?? null,
    remote: remoteGroups[0]?.indent ?? null,
  }
  await page.screenshot({ path: path.join(OUT, 'ui-1b-hosts-expanded.png') })

  if (localGroups.length === 0) problems.push('展开「本机」后没有本机工作区行')
  if (remoteGroups.length === 0) problems.push('展开远端主机后没有远端工作区行（组名应以「 · 主机名」结尾）')
  if (first.childIndent.remote !== '12px') problems.push(`子工作区行缩进应为 12px，实际 ${first.childIndent.remote}`)
  if (first.childIndent.host !== '0px') problems.push(`主机行缩进应为 0px，实际 ${first.childIndent.host}`)

  const hostsSeen = new Set(remoteGroups.map((group) => group.host))
  if (hostNames.length > 1 && hostsSeen.size < hostNames.length) {
    problems.push(`只有 ${hostsSeen.size}/${hostNames.length} 台 Host 出现在侧栏`)
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

  // 回归：按目录合成、又没有正式会话的空组不该出现（用户验收时撞到的「未分组 · nv50」）
  const emptySynthetic = await page.evaluate(async () => {
    try {
      const state = await fetch('/dsh-peerbar/api/state', { credentials: 'same-origin' }).then((response) => response.json())
      const text = document.body.innerText ?? ''
      const leaked = []
      for (const host of state?.hosts ?? []) {
        for (const workspace of host.workspaces ?? []) {
          if (typeof workspace.workspaceId === 'string' && workspace.workspaceId) continue
          const formal = (workspace.sessions ?? []).filter((session) => session.archived !== true && session.blank !== true)
          if (formal.length > 0) continue
          const title = `${workspace.name ?? '未分组'} · ${host.name}`
          if (text.includes(title)) leaked.push(title)
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
  const collapsed = await until(
    '远端工作区组默认收起',
    () =>
      page.evaluate((names) => {
        const rows = [...document.querySelectorAll('[data-row-key^="workspace:"]')]
        const remote = rows
          .map((row) => ({
            text: (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
            expanded: row.getAttribute('aria-expanded'),
          }))
          .filter((row) => names.some((name) => row.text.endsWith(` · ${name}`)))
        const expandable = remote.filter((row) => row.expanded !== null)
        if (expandable.length === 0) return null
        if (!expandable.every((row) => row.expanded === 'false')) return null
        return { remote: remote.length, expandable: expandable.length }
      }, hostNames),
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
              workspaceTitle: `${workspace.name ?? '未分组'} · ${host.name}`,
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
          await page.evaluate((title) => {
            const group = [...document.querySelectorAll('[data-row-key^="workspace:"]')].find((row) =>
              (row.innerText ?? '').includes(title),
            )
            if (group && group.getAttribute('aria-expanded') !== 'true') group.click()
          }, planTarget.workspaceTitle)
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
  // 打开 → 远端 `workspace/create` → 侧栏出现「目录名 · 主机」→ 用
  // `workspace/delete` 清掉。只注册/注销目录，不写任何文件。
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
        return workspace ? { workspaceId: workspace.workspaceId, cwd: workspace.cwd, title: `${workspace.name} · ${host.name}` } : null
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
              const rows = [...document.querySelectorAll('[data-row-key^="workspace:"]')]
              return rows.some((row) => (row.innerText ?? '').includes(expected)) ? true : null
            }, registered.title),
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
                const rows = [...document.querySelectorAll('[data-row-key^="workspace:"]')]
                return rows.some((row) => (row.innerText ?? '').includes(expected)) ? null : true
              }, first.remoteAddWorkspace.registered.title),
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

  // ---- 9) 折叠迁移 + 分组开关（1.2.0）----
  // 9a 一次性迁移：展开一个远端工作区组 → 官方记住 → 清插件标记重载 → 又被收起。
  // 9b 视图选项切到「按工作区」→ 开关自动关、行回到平铺（真实路径、无主机行）。
  // 9c 设置页把「按主机分组」打开 → 回到主机分组。
  const probe = await page.evaluate((names) => {
    const row = [...document.querySelectorAll('[data-row-key^="workspace:"]')].find((node) =>
      names.some((name) => (node.innerText ?? '').trim().endsWith(` · ${name}`)),
    )
    if (!row) return null
    const key = row.getAttribute('data-row-key') ?? ''
    row.click()
    return { key, workspaceId: key.replace(/^workspace:/, '') }
  }, hostNames)
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
        page.evaluate((names) => {
          const rows = [...document.querySelectorAll('[data-row-key^="workspace:"]')]
          const remote = rows
            .map((row) => ({
              text: (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
              expanded: row.getAttribute('aria-expanded'),
            }))
            .filter((row) => names.some((name) => row.text.endsWith(` · ${name}`)))
          const expandable = remote.filter((row) => row.expanded !== null)
          if (expandable.length === 0) return null
          return expandable.every((row) => row.expanded === 'false') ? true : null
        }, hostNames),
      15000,
    ).catch(() => false)
    first.autoCollapseAfterReload = reCollapsed
    if (!reCollapsed) problems.push('重载后迁移没有把已展开的远端组收起来')
  } else {
    problems.push('找不到任何远端工作区行（迁移无法验证）')
  }

  // 9b 视图选项 → 按工作区：分组自动关
  const menuOpened = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button[aria-label]')].find(
      (node) => node.getAttribute('aria-label') === '视图选项',
    )
    if (!button) return false
    button.click()
    return true
  })
  if (!menuOpened) problems.push('找不到「视图选项」按钮')
  await sleep(700)
  const groupItem = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (node) => (node.innerText ?? '').trim() === '按工作区' && node.children.length === 0 && node.offsetParent !== null,
    )
    const node = nodes[0]
    if (!node) return null
    const rect = node.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  if (!groupItem) problems.push('视图选项里找不到「按工作区」')
  else await page.mouse.click(groupItem.x, groupItem.y)
  await sleep(2200)
  const flat = await page.evaluate(() => ({
    flag: localStorage.getItem('dsh-peerbar.hostGroups'),
    rows: [...document.querySelectorAll('[data-row-key^="workspace:"]')].map((row) => (row.innerText ?? '').replace(/\s+/g, ' ').trim()),
  }))
  const flatHostRows = flat.rows.filter((text) => ['本机', ...hostNames].includes(text))
  first.groupingOff = { flag: flat.flag, rowCount: flat.rows.length, hostRows: flatHostRows }
  if (flat.flag !== '0') problems.push(`切到「按工作区」后分组开关没有自动关（flag=${flat.flag}）`)
  if (flatHostRows.length > 0) problems.push(`关掉分组后仍出现主机行：${flatHostRows.join('、')}`)
  const expectedFlat = (first.localGroups?.length ?? 0) + (first.remoteGroups?.length ?? 0)
  if (expectedFlat > 0 && flat.rows.length !== expectedFlat) {
    problems.push(`平铺行数应为 ${expectedFlat}，实际 ${flat.rows.length}`)
  }
  await page.screenshot({ path: path.join(OUT, 'ui-9-grouping-off.png') })

  // 9c 设置页 → 远程工作区 → 打开「按主机分组」
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
      .find((node) => (node.innerText ?? '').trim() === '远程工作区' && node.offsetParent !== null)
      ?.click()
  })
  await sleep(900)
  const toggled = await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((node) => (node.innerText ?? '').includes('按主机分组'))
    const box = label?.querySelector('input[type="checkbox"]')
    if (!box) return false
    if (!box.checked) box.click()
    return true
  })
  if (!toggled) problems.push('设置页找不到「按主机分组」开关')
  await sleep(2200)
  await page.screenshot({ path: path.join(OUT, 'ui-10-grouping-on.png') })
  const regrouped = await page.evaluate((names) => {
    const rows = [...document.querySelectorAll('[data-row-key^="workspace:"]')].map((row) =>
      (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
    )
    return {
      flag: localStorage.getItem('dsh-peerbar.hostGroups'),
      hostRows: rows.filter((text) => ['本机', ...names].includes(text)),
    }
  }, hostNames)
  first.groupingOn = regrouped
  if (regrouped.flag !== '1') problems.push(`设置页打开分组后开关没生效（flag=${regrouped.flag}）`)
  if (regrouped.hostRows.length !== hostNames.length + 1) {
    problems.push(`设置页打开分组后主机行应为 ${hostNames.length + 1} 行，实际 ${regrouped.hostRows.length}`)
  }
  await page.keyboard.press('Escape')
  await sleep(600)

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
