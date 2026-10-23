#!/usr/bin/env node
/**
 * UI 自检：起 headless Chrome，登录本地 dsh web 实例，点开远端会话，截图并给出断言。
 *
 * 用法：
 *   node scripts/ui-check.mjs                     # 从 .workbuddy/tmp/pb-web.log 读端口与 token
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
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
})

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
  await new Promise((resolve) => setTimeout(resolve, 800))

  const first = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.koUx-W_projectRow')]
    const session = document.querySelector('.koUx-W_sessionRow')
    const tree = document.querySelector('.dshp-root')
    return {
      projectRows: rows.length,
      sessionRows: document.querySelectorAll('.koUx-W_sessionRow').length,
      remoteTags: [...document.querySelectorAll('.dshp-tag')].map((node) => node.textContent),
      firstGroups: rows.slice(0, 5).map((node) => node.innerText.replace(/\s+/g, ' ').trim()),
      blankRows: [...document.querySelectorAll('.koUx-W_sessionRow .koUx-W_title')].filter(
        (node) => node.textContent.trim() === '未命名会话',
      ).length,
      menuButtons: document.querySelectorAll('.koUx-W_rowActions button').length,
      // 原生 idle 行走 sidebar.session.row.leading 空槽，不画状态点
      idleDots: document.querySelectorAll('.koUx-W_sessionRow .koUx-W_slot [data-state="idle"]').length,
      idleSlotWidth: (() => {
        const slot = document.querySelector('.koUx-W_sessionRow .koUx-W_slot')
        return slot ? Math.round(slot.getBoundingClientRect().width) : null
      })(),
      sessionPaddingLeft: session ? getComputedStyle(session).paddingLeft : null,
      treeHeight: tree ? tree.getBoundingClientRect().height : 0,
    }
  })

  await page.screenshot({ path: path.join(OUT, 'ui-1-sidebar.png') })

  if (first.projectRows === 0) problems.push('侧栏没有任何工作区行（.koUx-W_projectRow 为 0）')
  if (first.sessionRows === 0) problems.push('侧栏没有任何会话行（.koUx-W_sessionRow 为 0）')
  if (first.remoteTags.length === 0) problems.push('侧栏没有远端 Host 标签（.dshp-tag）')
  if (first.sessionPaddingLeft && Number.parseFloat(first.sessionPaddingLeft) < 20) {
    problems.push(`会话行没有缩进（padding-left=${first.sessionPaddingLeft}）`)
  }
  if (first.menuButtons === 0) problems.push('行内没有任何菜单按钮（.koUx-W_rowActions button 为 0）')
  if (first.idleDots > 0) problems.push(`idle 行不该画状态点（实际 ${first.idleDots} 个），原生只有在途/完成态才画`)
  if (first.idleSlotWidth !== null && first.idleSlotWidth !== 16) {
    problems.push(`不画点后 slot 仍应占 16px（实际 ${first.idleSlotWidth}px）`)
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
    for (const label of ['重命名工作区', '删除工作区']) {
      if (!items.some((item) => item.startsWith(label))) problems.push(`工作区菜单缺少「${label}」`)
    }
    await page.keyboard.press('Escape')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  // 远端行管理（P2/P3）：远端会话行菜单五项 + hover 三按钮 + 远端工作区菜单
  // 远端数据会变：首个远端组可能只剩「已归档」会话（默认隐藏而变空组），
  // 所以先展开所有远端组，再取第一个**真有可见会话行**的组作为被测目标。
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
    const group = groups.find((node) => node.querySelector('.koUx-W_sessionRow'))
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
      const group = groups.find((node) => node.querySelector('.koUx-W_sessionRow'))
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
      const group = groups.find((node) => node.querySelector('.koUx-W_sessionRow'))
      group?.querySelector('.koUx-W_projectRow .koUx-W_rowActions button:first-child')?.click()
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const remoteWsItems = await menuItemsOf()
    await page.screenshot({ path: path.join(OUT, 'ui-8-remote-workspace-menu.png') })
    first.remoteWorkspaceMenuItems = remoteWsItems
    for (const label of ['重命名工作区', '删除工作区']) {
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

  const knownWarnings = consoleErrors.filter((text) => KNOWN_NOISE.some((pattern) => pattern.test(text)))
  const realErrors = consoleErrors.filter((text) => !knownWarnings.includes(text))
  const result = { base, ...first, consoleErrors: realErrors, knownWarnings }
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
  await browser.close()
}
