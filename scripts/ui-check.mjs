#!/usr/bin/env node
/**
 * UI 自检：起 headless Chrome，登录本地 dsh web 实例，点开远端会话，截图并给出断言。
 *
 * 用法：
 *   node scripts/ui-check.mjs                     # 全量：含远端新建会话 + 真模型回复（≤180s）
 *   node scripts/ui-check.mjs --quick             # 快速：侧栏/远端行/菜单/正文渲染，不发消息
 *   node scripts/ui-check.mjs --base <url>        # 显式给带 token 的 URL
 *
 * 产物：.workbuddy/tmp/ui-*.png
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

function readBase() {
  const index = process.argv.indexOf('--base')
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1]
  const log = path.join(OUT, 'pb-web.log')
  if (!fs.existsSync(log)) throw new Error('没有 --base，也找不到 .workbuddy/tmp/pb-web.log')
  const match = fs.readFileSync(log, 'utf8').match(/http:\/\/[\d.]+:\d+\/\?token=\S+/)
  if (!match) throw new Error('日志里没有带 token 的 URL')
  return match[0]
}

// 已知噪声：顶替 single slot 时，官方那条注册会报同优先级冲突；我们这条后注册、渲染生效。
// 这是「遮蔽成功」的副作用，不影响功能，但记录在 ui-check.json 里备查。
const KNOWN_NOISE = [
  /single slot "sidebar\.workspaces" already has a registration at priority/,
  /Failed to load resource: the server responded with a status of 404/,
  /\[client-store\] subscriber failed/,
  /\[Immer\]/,
]

const problems = []
const warnings = []
const base = readBase()
// 快速档：只验浏览器侧渲染与交互，不建会话、不发消息、不调真实模型。
const QUICK = process.argv.includes('--quick')
// `--cdp http://127.0.0.1:9224` 连一个已在跑的 Chrome：
// 代理沙箱把 RLIMIT_AS 卡在 4GB，直接 launch 会 core dump；
// 用 `systemd-run --user ... google-chrome-stable --headless=new
// --remote-debugging-port=9224` 起浏览器再连即可（脚本结尾不能 close）。
const cdpIndex = process.argv.indexOf('--cdp')
const cdpUrl = cdpIndex !== -1 ? process.argv[cdpIndex + 1] : null
const browser = cdpUrl
  ? await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null })
  : await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
    })
const usingCdp = Boolean(cdpUrl)

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })

  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await page.goto(base, { waitUntil: 'networkidle2', timeout: 40000 })
  await page.waitForSelector('.dshp-root', { timeout: 20000 })
  // 会话行异步进树（本机会话列表加载 + 远端探活），等行出现再取快照，最多 5s
  for (let i = 0; i < 10; i += 1) {
    const rows = await page.evaluate(() => document.querySelectorAll('.koUx-W_sessionRow').length)
    if (rows > 0) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await new Promise((resolve) => setTimeout(resolve, 300))

  const first = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.koUx-W_projectRow')]
    const session = document.querySelector('.koUx-W_sessionRow')
    const tree = document.querySelector('.dshp-root')
    return {
      projectRows: rows.length,
      sessionRows: document.querySelectorAll('.koUx-W_sessionRow').length,
      remoteTags: [...document.querySelectorAll('.dshp-tag')].map((node) => node.textContent),
      firstGroups: rows.slice(0, 5).map((node) => node.innerText.replace(/\s+/g, ' ').trim()),
      // 原生：blank 行标题是「新会话」，未命名回退是「未命名」
      blankRows: [...document.querySelectorAll('.koUx-W_sessionRow .koUx-W_title')].filter(
        (node) => node.textContent.trim() === '新会话',
      ).length,
      untitledRows: [...document.querySelectorAll('.koUx-W_sessionRow .koUx-W_title')].filter(
        (node) => node.textContent.trim() === '未命名',
      ).length,
      menuButtons: document.querySelectorAll('.koUx-W_rowActions button').length,
      // 原生行内 ⋯ 只给 aria，不给 title tooltip
      sessionMenuAria: document.querySelector('.koUx-W_sessionRow .koUx-W_rowActions button')?.getAttribute('aria-label') ?? null,
      projectMenuAria: document.querySelector('.koUx-W_projectRow .koUx-W_rowActions button')?.getAttribute('aria-label') ?? null,
      sessionMenuTitle: document.querySelector('.koUx-W_sessionRow .koUx-W_rowActions button')?.getAttribute('title') ?? null,
      // 原生分组标题栏：36px 高、标题 14px、搜索按钮 28×28
      headerHeight: (() => {
        const el = document.querySelector('.hP3ldq_sectionHeader')
        return el ? Math.round(el.getBoundingClientRect().height) : null
      })(),
      sectionLabelSize: (() => {
        const el = document.querySelector('.hP3ldq_sectionLabel')
        return el ? getComputedStyle(el).fontSize : null
      })(),
      searchButton: (() => {
        const el = document.querySelector('.hP3ldq_searchButton')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return `${Math.round(r.width)}x${Math.round(r.height)}`
      })(),
      folderActive: document.querySelectorAll('.koUx-W_projectRow .koUx-W_folderActive').length,
      selectedRowActiveFolder: (() => {
        const selected = document.querySelector('.koUx-W_sessionRow.koUx-W_selected')
        if (!selected) return null
        const group = selected.parentElement?.parentElement
        return Boolean(group?.querySelector('.koUx-W_projectRow .koUx-W_folderActive'))
      })(),
      overflowLabel: document.querySelector('.hP3ldq_sessionOverflowButton')?.textContent?.trim() ?? null,
      // 原生 idle 行走 sidebar.session.row.leading 空槽，不画状态点
      idleDots: document.querySelectorAll('.koUx-W_sessionRow .koUx-W_slot [data-state="idle"]').length,
      idleSlotWidth: (() => {
        const slot = document.querySelector('.koUx-W_sessionRow .koUx-W_slot')
        return slot ? Math.round(slot.getBoundingClientRect().width) : null
      })(),
      // 原生行几何：padding-left 8px（顶层工作区 depth=0），标题距行左 8+16+4=28
      sessionTitleOffset: (() => {
        if (!session) return null
        const title = session.querySelector('.koUx-W_title')
        return title ? Math.round(title.getBoundingClientRect().left - session.getBoundingClientRect().left) : null
      })(),
      sessionPaddingLeft: session ? getComputedStyle(session).paddingLeft : null,
      treeHeight: tree ? tree.getBoundingClientRect().height : 0,
    }
  })

  await page.screenshot({ path: path.join(OUT, 'ui-1-sidebar.png') })

  if (first.projectRows === 0) problems.push('侧栏没有任何工作区行（.koUx-W_projectRow 为 0）')
  if (first.sessionRows === 0) problems.push('侧栏没有任何会话行（.koUx-W_sessionRow 为 0）')
  if (first.remoteTags.length === 0) problems.push('侧栏没有远端 Host 标签（.dshp-tag）')
  // 原生 `--dsh-workspace-indent` 是 depth*12，顶层工作区下的会话是 0 → padding-left 8px，
  // 标题距行左 8 + slot 16 + margin 4 = 28。
  if (first.sessionPaddingLeft && first.sessionPaddingLeft !== '8px') {
    problems.push(`会话行 padding-left 应为 8px（原生顶层 depth=0），实际 ${first.sessionPaddingLeft}`)
  }
  if (first.sessionTitleOffset !== null && first.sessionTitleOffset !== 28) {
    problems.push(`会话标题距行左应为 28px（原生 8+16+4），实际 ${first.sessionTitleOffset}px`)
  }
  if (first.menuButtons === 0) problems.push('行内没有任何菜单按钮（.koUx-W_rowActions button 为 0）')
  // 原生 blank 行只显示“当前选中”的那一条
  if (first.blankRows > 1) problems.push(`blank 行最多 1 条（原生只显示当前选中的），实际 ${first.blankRows}`)
  // aria 文案与原生一致：会话“名”的操作 / 工作区“名”的操作；且不挂 title
  if (first.sessionMenuAria && !/^会话“.+”的操作$/.test(first.sessionMenuAria)) {
    problems.push(`会话行 ⋯ 的 aria 应为「会话“名”的操作」，实际「${first.sessionMenuAria}」`)
  }
  if (first.projectMenuAria && !/^工作区“.+”的操作$/.test(first.projectMenuAria)) {
    problems.push(`工作区行 ⋯ 的 aria 应为「工作区“名”的操作」，实际「${first.projectMenuAria}」`)
  }
  if (first.sessionMenuTitle !== null) problems.push('会话行 ⋯ 不应挂 title tooltip（原生只有 aria）')
  // 同一时刻只应有一个“当前工作区”，且它必须包含选中的会话
  if (first.folderActive > 1) problems.push(`当前工作区高亮最多 1 个，实际 ${first.folderActive}`)
  if (first.selectedRowActiveFolder === false) {
    problems.push('选中的会话所在工作区的文件夹没有高亮（koUx-W_folderActive）')
  }
  // 标题栏几何对齐原生（36px / 14px / 28×28）
  if (first.headerHeight !== null && first.headerHeight !== 36) {
    problems.push(`分组标题栏高度应为 36px（实际 ${first.headerHeight}）`)
  }
  if (first.sectionLabelSize && first.sectionLabelSize !== '14px') {
    problems.push(`「工作区」标题字号应为 14px（实际 ${first.sectionLabelSize}）`)
  }
  if (first.searchButton && first.searchButton !== '28x28') {
    problems.push(`搜索按钮应为 28×28（实际 ${first.searchButton}）`)
  }
  if (first.idleDots > 0) problems.push(`idle 行不该画状态点（实际 ${first.idleDots} 个），原生只有在途/完成态才画`)
  if (first.idleSlotWidth !== null && first.idleSlotWidth !== 16) {
    problems.push(`不画点后 slot 仍应占 16px（实际 ${first.idleSlotWidth}px）`)
  }
  if (first.overflowLabel && !/^展开其余 \d+ 个会话$/.test(first.overflowLabel)) {
    problems.push(`溢出按钮文案应为「展开其余 N 个会话」（实际「${first.overflowLabel}」）`)
  }

  // 行菜单：先 hover 出 ⋯，再点开，确认菜单项与定位
  const menuItemsOf = async () => {
    return page.evaluate(() => {
      const candidates = [...document.querySelectorAll('[role="menuitem"], [role="menu"] button')]
      return candidates.map((node) => node.textContent.trim()).filter(Boolean)
    })
  }
  if (await page.$('.koUx-W_sessionRow')) {
    await page.hover('.koUx-W_sessionRow')
    const hoverButtons = await page.evaluate(
      () => document.querySelectorAll('.koUx-W_sessionRow .koUx-W_rowActions button').length,
    )
    first.hoverButtons = hoverButtons
    if (hoverButtons < 3) problems.push(`会话行 hover 按钮不足 3 个（实际 ${hoverButtons}）`)
    // 图标度量：原生会话行是 16×16 按钮 + 14px 图标 + 15px 间距
    // （ui-workspace `ArchiveSessionRowButton` / `PinSessionRowButton` 与 Rows.module.css）。
    // 归档图标的 artwork 默认 size=20，不显式传 14 会被 16px 按钮压成 16×20、纵向拉长。
    const iconMetrics = await page.evaluate(() => {
      const row = document.querySelector('.koUx-W_sessionRow')
      const actions = row?.querySelector('.koUx-W_rowActions')
      if (!actions) return null
      return {
        gap: getComputedStyle(actions).gap,
        items: [...actions.querySelectorAll('button')].map((button) => {
          const box = button.getBoundingClientRect()
          const svg = button.querySelector('svg')?.getBoundingClientRect()
          return {
            label: button.getAttribute('aria-label') || button.title || '',
            button: [Math.round(box.width), Math.round(box.height)],
            svg: svg ? [Math.round(svg.width), Math.round(svg.height)] : null,
          }
        }),
      }
    })
    first.iconMetrics = iconMetrics
    if (!iconMetrics) {
      problems.push('会话行没有行操作区（.koUx-W_rowActions）')
    } else {
      if (iconMetrics.gap !== '15px') problems.push(`行操作区间距应为 15px（实际 ${iconMetrics.gap}）`)
      for (const item of iconMetrics.items) {
        if (item.button[0] !== 16 || item.button[1] !== 16) {
          problems.push(`「${item.label}」按钮应为 16×16（实际 ${item.button.join('×')}）`)
        }
        if (!item.svg) continue
        if (item.svg[0] !== item.svg[1]) {
          problems.push(`「${item.label}」图标比例失真（${item.svg.join('×')}）`)
        }
        if (![14, 16].includes(item.svg[0])) {
          problems.push(`「${item.label}」图标尺寸应为 14 或 16（实际 ${item.svg[0]}）`)
        }
        if (/归档|置顶/.test(item.label) && item.svg[0] !== 14) {
          problems.push(`「${item.label}」图标应与原生一致为 14px（实际 ${item.svg[0]}）`)
        }
      }
    }
    await page.click('.koUx-W_sessionRow .koUx-W_rowActions button:last-child')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const menuItems = await menuItemsOf()
    await page.screenshot({ path: path.join(OUT, 'ui-4-session-menu.png') })
    first.menuItems = menuItems
    for (const label of ['置顶会话', '重命名', '分叉会话', '归档会话', '复制 Session ID']) {
      if (!menuItems.some((item) => item.startsWith(label))) problems.push(`会话菜单缺少「${label}」`)
    }
    for (const hint of ['CtrlAltG', 'CtrlAltF', 'CtrlShiftA']) {
      if (!menuItems.some((item) => item.includes(hint))) problems.push(`会话菜单缺少快捷键「${hint}」`)
    }
    // 指针移进菜单后不应关闭（回归：closeOnPointerLeave 曾导致一移就消失）
    if (menuItems.length > 0) {
      await page.hover('[role="menuitem"]')
      await new Promise((resolve) => setTimeout(resolve, 300))
      const still = await menuItemsOf()
      if (still.length < menuItems.length) problems.push('指针移到菜单上后菜单消失了')
    }
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  // 视图选项菜单（S5）
  const hasViewButton = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.hP3ldq_iconButton')]
    const button = buttons.find((node) => (node.title || '').includes('视图'))
    if (!button) return false
    button.click()
    return true
  })
  if (hasViewButton) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const items = await menuItemsOf()
    await page.screenshot({ path: path.join(OUT, 'ui-6-view-options.png') })
    first.viewOptionItems = items
    for (const label of ['按工作区', '单列表', '手动排序', '最近更新', '隐藏已归档', '全部对话', '仅显示已归档']) {
      if (!items.some((item) => item.startsWith(label))) problems.push(`视图选项缺少「${label}」`)
    }
    // 分组/排序/筛选是菜单里的 label 行（不是 menuitem），用整段文本核对
    const menuLabels = await page.evaluate(() => document.querySelector('[role="menu"]')?.innerText ?? '')
    first.viewOptionLabels = menuLabels.replace(/\s+/g, ' ').slice(0, 160)
    for (const label of ['分组方式', '排序方式', '筛选会话']) {
      if (!menuLabels.includes(label)) problems.push(`视图选项缺少分组标题「${label}」`)
    }
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 200))
  } else {
    problems.push('头部没有视图选项按钮')
  }

  if (await page.$('.koUx-W_projectRow')) {
    await page.hover('.koUx-W_projectRow')
    await page.click('.koUx-W_projectRow .koUx-W_rowActions button:last-child')
    await new Promise((resolve) => setTimeout(resolve, 500))
    const items = await menuItemsOf()
    await page.screenshot({ path: path.join(OUT, 'ui-5-workspace-menu.png') })
    first.workspaceMenuItems = items
    for (const label of ['重命名', '删除工作区']) {
      if (!items.some((item) => item.startsWith(label))) problems.push(`工作区菜单缺少「${label}」`)
    }
    // 原生菜单项是「重命名」；「重命名工作区」只出现在对话框标题里
    if (items.some((item) => item.trim() === '重命名工作区')) {
      problems.push('工作区菜单的改名项应为「重命名」，不该带「工作区」')
    }
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  // 远端行管理（P2/P3）：远端会话行菜单五项 + hover 三按钮 + 远端工作区菜单
  // 远端数据会变：首个远端组可能只剩「已归档」会话（默认隐藏而变空组），
  // 所以先展开所有远端组，再取第一个**真有可见会话行**的组作为被测目标。
  // 目标组优先按 /state 挑「有 workspaceId 且有可见行」的组（P3 工作区菜单
  // 需要 workspaceId；无 baseline 的退化组点开只有只读提示）。
  const targetWs = await page.evaluate(async () => {
    const res = await fetch('/dsh-peerbar/api/state')
    const state = await res.json()
    for (const host of state.hosts ?? []) {
      if (host.status !== 'online') continue
      for (const ws of host.workspaces ?? []) {
        const visible = (ws.sessions ?? []).filter((s) => !s.blank && s.archived !== true)
        if (ws.workspaceId && visible.length > 0) {
          return { name: ws.name, hostId: host.hostId, visible: visible.length }
        }
      }
    }
    return null
  })
  first.targetWorkspace = targetWs?.name ?? null
  await page.evaluate((name) => {
    if (!name) return
    for (const row of document.querySelectorAll('.koUx-W_projectRow')) {
      const tag = row.querySelector('.dshp-tag')
      const title = row.querySelector('.koUx-W_title')
      if (tag && title && title.textContent.trim() === name) {
        row.setAttribute('data-pb-target', '1')
        return
      }
    }
  }, targetWs?.name)
  await page.evaluate(() => {
    for (const tag of document.querySelectorAll('.dshp-tag')) {
      const row = tag.closest('.koUx-W_projectRow')
      if (row && row.getAttribute('aria-expanded') !== 'true') row.click()
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 800))
  const remoteMenu = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.dshp-tag')]
      .map((tag) => tag.closest('.koUx-W_projectRow')?.parentElement)
      .filter(Boolean)
    const group = document.querySelector('[data-pb-target="1"]')?.parentElement
      ?? groups.find((node) => node.querySelector('.koUx-W_sessionRow'))
    const row = group?.querySelector('.koUx-W_sessionRow')
    const projectRow = group?.querySelector('.koUx-W_projectRow')
    return {
      remoteGroups: groups.length,
      hasRemoteRow: Boolean(row),
      hasRemoteProject: Boolean(projectRow),
      remoteRowButtons: row ? row.querySelectorAll('.koUx-W_rowActions button').length : 0,
      remoteProjectButtons: projectRow ? projectRow.querySelectorAll('.koUx-W_rowActions button').length : 0,
    }
  })
  first.remoteGroups = remoteMenu.remoteGroups
  first.remoteRowButtons = remoteMenu.remoteRowButtons
  if (!remoteMenu.hasRemoteRow) {
    problems.push('远端组展开后没有会话行')
  } else {
    if (remoteMenu.remoteRowButtons < 3) {
      problems.push(`远端会话行 hover 按钮不足 3 个（实际 ${remoteMenu.remoteRowButtons}）`)
    }
    // 打开远端会话行菜单
    await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.dshp-tag')]
        .map((tag) => tag.closest('.koUx-W_projectRow')?.parentElement)
        .filter(Boolean)
      const group = document.querySelector('[data-pb-target="1"]')?.parentElement
        ?? groups.find((node) => node.querySelector('.koUx-W_sessionRow'))
      group?.querySelector('.koUx-W_sessionRow .koUx-W_rowActions button:last-child')?.click()
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const remoteItems = await menuItemsOf()
    await page.screenshot({ path: path.join(OUT, 'ui-7-remote-session-menu.png') })
    first.remoteSessionMenuItems = remoteItems
    for (const label of ['重命名', '分叉会话', '复制 Session ID']) {
      if (!remoteItems.some((item) => item.startsWith(label))) {
        problems.push(`远端会话菜单缺少「${label}」（P2 对齐本地）`)
      }
    }
    const hasPin = remoteItems.some((item) => item.startsWith('置顶会话') || item.startsWith('取消置顶'))
    const hasArchive = remoteItems.some((item) => item.startsWith('归档会话') || item.startsWith('取消归档'))
    if (!hasPin) problems.push('远端会话菜单缺少置顶/取消置顶')
    if (!hasArchive) problems.push('远端会话菜单缺少归档/取消归档')
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (remoteMenu.hasRemoteProject) {
    await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.dshp-tag')]
        .map((tag) => tag.closest('.koUx-W_projectRow')?.parentElement)
        .filter(Boolean)
      const group = document.querySelector('[data-pb-target="1"]')?.parentElement
        ?? groups.find((node) => node.querySelector('.koUx-W_sessionRow'))
      group?.querySelector('.koUx-W_projectRow .koUx-W_rowActions button:first-child')?.click()
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const remoteWsItems = await menuItemsOf()
    await page.screenshot({ path: path.join(OUT, 'ui-8-remote-workspace-menu.png') })
    first.remoteWorkspaceMenuItems = remoteWsItems
    for (const label of ['重命名', '删除工作区']) {
      if (!remoteWsItems.some((item) => item.startsWith(label))) {
        problems.push(`远端工作区菜单缺少「${label}」（P3）`)
      }
    }
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  // 远端组此时已全部展开；滚到第一个有可见会话行的远端组，最多试 4 条会话，
  // 取"有真人发言/富文本"的那条截图
  const remoteRowCount = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.dshp-tag')]
      .map((tag) => tag.closest('.koUx-W_projectRow')?.parentElement)
      .filter(Boolean)
    const group = groups.find((node) => node.querySelector('.koUx-W_sessionRow'))
    group?.scrollIntoView({ block: 'center' })
    return groups.reduce((sum, node) => sum + node.querySelectorAll('.koUx-W_sessionRow').length, 0)
  })
  if (remoteRowCount === 0) problems.push('远端组展开后没有会话行可点')
  await page.screenshot({ path: path.join(OUT, 'ui-2-remote-expanded.png') })

  if (remoteRowCount > 0) {
    let panel = { chatNodes: 0, nativeTool: 0, foldRows: 0, actionBars: 0, customPanel: 0, preview: '' }
    const groupCount = await page.evaluate(() => document.querySelectorAll('.dshp-tag').length)
    let foundBubble = false
    for (let group = 0; group < Math.min(groupCount, 3) && !foundBubble; group += 1) {
      await page.evaluate((index) => {
        const tags = document.querySelectorAll('.dshp-tag')
        const row = tags[index]?.closest('.koUx-W_projectRow')
        if (row && row.getAttribute('aria-expanded') !== 'true') row.click()
      }, group)
      await new Promise((resolve) => setTimeout(resolve, 400))
      const rows = await page.evaluate((index) => {
        const tags = document.querySelectorAll('.dshp-tag')
        const holder = tags[index]?.closest('.koUx-W_projectRow')?.parentElement
        return holder ? holder.querySelectorAll('.koUx-W_sessionRow').length : 0
      }, group)
      for (let index = 0; index < Math.min(rows, 3); index += 1) {
        await page.evaluate(
          ([groupIndex, rowIndex]) => {
            const tags = document.querySelectorAll('.dshp-tag')
            const holder = tags[groupIndex]?.closest('.koUx-W_projectRow')?.parentElement
            holder?.querySelectorAll('.koUx-W_sessionRow')[rowIndex]?.click()
          },
          [group, index],
        )
        await page.waitForSelector('[data-chat-node-key], .dshp-panel', { timeout: 8000 })
        await new Promise((resolve) => setTimeout(resolve, 1200))
        const stats = await page.evaluate(() => ({
          chatNodes: document.querySelectorAll('[data-chat-node-key]').length,
          nativeTool: document.querySelectorAll('[data-chat-call-id]').length,
          foldRows: document.querySelectorAll('[data-process-activity]').length,
          actionBars: document.querySelectorAll('[class$="_actions"]').length,
          customPanel: document.querySelectorAll('.dshp-panel').length,
          preview: (document.querySelector('body')?.innerText ?? '').slice(0, 140),
        }))
        if (stats.chatNodes > panel.chatNodes) panel = stats
        if (stats.nativeTool > 0 && stats.chatNodes > 0) break
      }
    }
    await page.screenshot({ path: path.join(OUT, 'ui-3-remote-session.png'), fullPage: false })
    first.panel = panel

    if (panel.chatNodes === 0) problems.push('原生会话没有渲染任何聊天节点')
    if (panel.nativeTool === 0) problems.push('原生会话没有工具调用节点')
    if (panel.foldRows === 0) problems.push('原生会话没有折叠行（过程组）')
    if (panel.customPanel > 0) problems.push('回退到了自绘面板，原生渲染未生效')
    if (panel.actionBars === 0) problems.push('原生消息没有动作条')
  }

  if (QUICK) {
    // 快速档：只验「远端会话能打开 + 原生 composer 在」，不建会话、不发消息。
    // 下面的全量块会往远端写数据，所以整块跳过（保持缩进不动，减少 diff）。
    const composer = await page.$('div.B2HNUa_input[role="textbox"]')
    if (!composer) problems.push('远端会话没有原生 composer（--quick）')
    first.composerPresent = Boolean(composer)
  } else {
  // P4/P6 浏览器级：远端新建会话 → composer 发消息 → 远端真跑 → 模型座可切
  // （用「+」新建的测试会话，不污染真实会话；结束后归档清理）
  // 门禁：必须确认 session/create 真的发生了（捕获到返回的 sessionId）才允许打字，
  // 否则会把消息打进已打开的真实会话（事故教训）。
  let testSessionId = null
  let testHostId = null
  page.on('response', async (response) => {
    try {
      const url = response.url()
      if (!url.includes('/rpc')) return
      const hostMatch = url.match(/\/hosts\/([^/]+)\/rpc/)
      const payload = await response.json()
      if (payload?.value?.sessionId && hostMatch) {
        testSessionId = payload.value.sessionId
        testHostId = decodeURIComponent(hostMatch[1])
      }
    } catch {
      /* 忽略 */
    }
  })
  // 影子副本回归断言：点开远端会话前后，本机「未分组」行数不得增加
  // （打开远端会话会往 useSessions 注入 __peerbar 行，绝不能渲染进本机侧栏；
  // 排除标题「新会话」的当前 blank 行——它的显隐受 currentBlankId 影响会抖）
  const countUngrouped = () =>
    page.evaluate(() => {
      for (const row of document.querySelectorAll('.koUx-W_projectRow')) {
        const title = row.querySelector('.koUx-W_title')?.textContent.trim()
        if (title === '未分组' || title === 'Ungrouped') {
          return [...row.parentElement.querySelectorAll('.koUx-W_sessionRow')].filter((n) => {
            const t = n.querySelector('.koUx-W_title')?.textContent.trim() ?? ''
            return t !== '新会话' && t !== 'New session'
          }).length
        }
      }
      return 0
    })
  const ungroupedBefore = await countUngrouped()
  const plusClicked = await page.evaluate(() => {
    const projectRow = document.querySelector('[data-pb-target="1"]') ?? document.querySelector('.dshp-tag')?.closest('.koUx-W_projectRow')
    const button = projectRow?.querySelector('button[title="新会话"], button[title="新建会话"]')
    if (!button) return false
    button.click()
    return true
  })
  if (!plusClicked) {
    problems.push('远端工作区行没有「新建会话」按钮（P3）')
  } else {
    // 等 session/create 的响应（≤5s）
    for (let i = 0; i < 10 && !testSessionId; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (!testSessionId) {
      problems.push('「新建会话」没有真正创建远端会话（P3 session/create）')
    } else {
      await page.waitForSelector('div.B2HNUa_input[role="textbox"]', { timeout: 10000 })
      await new Promise((resolve) => setTimeout(resolve, 800))
      // 发一条带唯一标记的 prompt（回复应为纯标记文本）
      await page.click('div.B2HNUa_input[role="textbox"]')
      await page.keyboard.type('请只回复四个字母：ZQVX，不要任何其他内容')
      await page.keyboard.press('Enter')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const echoed = await page.evaluate(() => (document.body.innerText ?? '').includes('ZQVX'))
      if (!echoed) problems.push('composer 发送后没有出现消息气泡（P4 echo/append）')
      await page.screenshot({ path: path.join(OUT, 'ui-9-remote-chat.png') })
      // 影子副本断言：打开远端会话后本机未分组不得多出行
      const ungroupedAfter = await countUngrouped()
      first.ungroupedShadow = { before: ungroupedBefore, after: ungroupedAfter }
      if (ungroupedAfter > ungroupedBefore) {
        problems.push(`本机「未分组」出现远端会话影子副本（${ungroupedBefore} → ${ungroupedAfter} 行）`)
      }
      // 等远端真跑出回复（≤180s，High 推理档思考可超 2 分钟）：
      // 出现一个纯 ZQVX 的叶子文本节点即为回复
      let replied = false
      for (let i = 0; i < 90; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        replied = await page.evaluate(() =>
          [...document.querySelectorAll('p, span, div')].some(
            (n) => n.children.length === 0 && n.textContent.trim() === 'ZQVX',
          ),
        )
        if (replied) break
      }
      first.remoteReply = replied
      if (!replied) problems.push('远端回复未在 180s 内出现（P4 续聊链路）')
      await page.screenshot({ path: path.join(OUT, 'ui-9b-remote-reply.png') })

      // P6：模型座可打开并列出模型
      const seatClicked = await page.evaluate(() => {
        const seat = document.querySelector('button.YtWLma_trigger')
        if (!seat) return false
        seat.click()
        return true
      })
      if (!seatClicked) problems.push('模型座按钮不存在（P6）')
      else {
        await new Promise((resolve) => setTimeout(resolve, 800))
        const modelMenu = await page.evaluate(() => {
          const items = [
            ...document.querySelectorAll('[role="menuitem"], [role="option"]'),
          ].map((n) => n.textContent.trim()).filter((t) => t && t.length < 60)
          const layers = [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')]
            .map((n) => n.innerText.trim()).filter(Boolean)
          return { items: items.slice(0, 10), layerText: layers.join(' | ').slice(0, 200) }
        })
        first.modelMenuItems = modelMenu.items
        first.modelMenuLayer = modelMenu.layerText
        await page.screenshot({ path: path.join(OUT, 'ui-10-model-seat.png') })
        if (modelMenu.items.length === 0 && !modelMenu.layerText) {
          problems.push('模型座点开后没有模型条目（P6 modelCatalog 路由）')
        }
        await page.keyboard.press('Escape')
      }
    }

    // 清理：归档测试会话（P2 能力顺带回归）
    if (testSessionId && testHostId) {
      await page.evaluate(
        async ([hostId, sessionId]) => {
          await fetch(`/dsh-peerbar/api/hosts/${encodeURIComponent(hostId)}/rpc`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-dsh-peerbar-action': '1' },
            body: JSON.stringify({ endpoint: 'workspace/archiveSession', args: { request: { sessionId, stopActivity: true } } }),
          })
        },
        [testHostId, testSessionId],
      )
      first.testSessionCleanup = true
    } else {
      first.testSessionCleanup = false
    }
  }
  }

  const knownWarnings = consoleErrors.filter((text) => KNOWN_NOISE.some((pattern) => pattern.test(text)))
  const realErrors = consoleErrors.filter((text) => !knownWarnings.includes(text))
  const result = { base, mode: QUICK ? 'quick' : 'full', ...first, consoleErrors: realErrors, knownWarnings }
  fs.writeFileSync(path.join(OUT, 'ui-check.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (realErrors.length) problems.push(`页面报错 ${realErrors.length} 条`)

  if (warnings.length) {
    console.log('\n提醒：')
    for (const warning of warnings) console.log(' -', warning)
  }
  if (problems.length) {
    console.error('\n断言失败：')
    for (const problem of problems) console.error(' -', problem)
    process.exitCode = 1
  } else {
    console.log('\n全部断言通过')
  }
} finally {
  // CDP 模式下不能 close：会把外部那条浏览器关掉，下次连不上
  if (usingCdp) await browser.disconnect()
  else await browser.close()
}
