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
const KNOWN_NOISE = [/single slot "sidebar\.workspaces" already has a registration at priority/]

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

  // 展开第一个远端组，最多试 4 条会话，取"有真人发言/富文本"的那条截图
  const tagHandle = await page.$('.dshp-tag')
  if (tagHandle) {
    await tagHandle.evaluate((node) => node.closest('.koUx-W_projectRow').click())
    await new Promise((resolve) => setTimeout(resolve, 600))
    await page.screenshot({ path: path.join(OUT, 'ui-2-remote-expanded.png') })

    const rows = await page.evaluate(() => {
      const group = document.querySelector('.dshp-tag')?.closest('[role="treeitem"]')
      return group ? group.querySelectorAll('.koUx-W_sessionRow').length : 0
    })
    if (rows === 0) problems.push('远端组展开后没有会话行可点')

    let panel = { messages: 0, userBubbles: 0, toolChips: 0, richContent: 0, firstToolWidth: null, preview: '' }
    const groupCount = await page.evaluate(() => document.querySelectorAll('.dshp-tag').length)
    let foundBubble = false
    for (let group = 0; group < Math.min(groupCount, 3) && !foundBubble; group += 1) {
      await page.evaluate((index) => {
        const tags = document.querySelectorAll('.dshp-tag')
        tags[index]?.closest('.koUx-W_projectRow')?.click()
      }, group)
      await new Promise((resolve) => setTimeout(resolve, 400))
      const rows = await page.evaluate((index) => {
        const tags = document.querySelectorAll('.dshp-tag')
        const holder = tags[index]?.closest('[role="treeitem"]')
        return holder ? holder.querySelectorAll('.koUx-W_sessionRow').length : 0
      }, group)
      for (let index = 0; index < Math.min(rows, 3); index += 1) {
        await page.evaluate(
          ([groupIndex, rowIndex]) => {
            const tags = document.querySelectorAll('.dshp-tag')
            const holder = tags[groupIndex]?.closest('[role="treeitem"]')
            holder?.querySelectorAll('.koUx-W_sessionRow')[rowIndex]?.click()
          },
          [group, index],
        )
        await page.waitForSelector('.dshp-panel', { timeout: 8000 })
        await new Promise((resolve) => setTimeout(resolve, 1200))
        const stats = await page.evaluate(() => {
          const first = document.querySelector('.dshp-tool')
          const rect = first?.getBoundingClientRect()
          const body = document.querySelector('.dshp-panel-body')
          return {
            messages: document.querySelectorAll('.dshp-msg').length,
            userBubbles: document.querySelectorAll('.vq-vBq_userRow').length,
            toolChips: document.querySelectorAll('.dshp-tool').length,
            richContent: body ? body.querySelectorAll('table, pre, h1, h2, h3, ul, ol, blockquote').length : 0,
            firstToolWidth: rect ? Math.round(rect.width) : null,
            preview: (body?.innerText ?? '').slice(0, 120),
          }
        })
        if (stats.userBubbles > panel.userBubbles || stats.richContent > panel.richContent || stats.messages > panel.messages) {
          panel = stats
        }
        if (stats.userBubbles > 0) {
          foundBubble = true
          break
        }
      }
    }
    await page.screenshot({ path: path.join(OUT, 'ui-3-remote-session.png'), fullPage: false })
    first.panel = panel

    if (panel.messages === 0 && panel.userBubbles === 0) problems.push('正文面板没有任何消息')
    if (panel.firstToolWidth && panel.firstToolWidth > 200) {
      problems.push(`工具调用没有收成胶囊（首个体宽 ${panel.firstToolWidth}px）`)
    }
    if (!foundBubble) warnings.push('抽样到的会话里没有真人发言，用户气泡样式未被覆盖')
    if (panel.richContent === 0 && panel.messages > 0) {
      warnings.push('抽样会话没有表格/代码块/列表，富文本渲染未被覆盖')
    }
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
