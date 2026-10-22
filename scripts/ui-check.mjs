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

const problems = []
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

  // 展开第一个远端组，再点其中第一条会话
  const tagHandle = await page.$('.dshp-tag')
  if (tagHandle) {
    await tagHandle.evaluate((node) => node.closest('.koUx-W_projectRow').click())
    await new Promise((resolve) => setTimeout(resolve, 600))
    await page.screenshot({ path: path.join(OUT, 'ui-2-remote-expanded.png') })

    const clicked = await page.evaluate(() => {
      const tag = document.querySelector('.dshp-tag')
      const group = tag?.closest('[role="treeitem"]')
      const row = group?.querySelector('.koUx-W_sessionRow')
      if (!row) return false
      row.click()
      return true
    })
    if (!clicked) {
      problems.push('远端组展开后没有会话行可点')
    } else {
      await page.waitForSelector('.dshp-panel', { timeout: 10000 })
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await page.screenshot({ path: path.join(OUT, 'ui-3-remote-session.png'), fullPage: false })

      const panel = await page.evaluate(() => {
        const tools = document.querySelector('.dshp-tools')
        const first = document.querySelector('.dshp-tool')
        const rect = first?.getBoundingClientRect()
        return {
          messages: document.querySelectorAll('.dshp-msg').length,
          userBubbles: document.querySelectorAll('.vq-vBq_userRow').length,
          toolChips: document.querySelectorAll('.dshp-tool').length,
          toolsDisplay: tools ? getComputedStyle(tools).display : null,
          firstToolWidth: rect ? Math.round(rect.width) : null,
          firstToolDisplay: first ? getComputedStyle(first).display : null,
          panelWidth: document.querySelector('.dshp-panel-body')?.getBoundingClientRect().width ?? 0,
          preview: (document.querySelector('.dshp-panel-body')?.innerText ?? '').slice(0, 160),
        }
      })
      if (panel.messages === 0 && panel.userBubbles === 0) problems.push('正文面板没有任何消息')
      Object.assign(first, { panel })
    }
  }

  const result = { base, ...first, consoleErrors }
  fs.writeFileSync(path.join(OUT, 'ui-check.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (consoleErrors.length) problems.push(`页面报错 ${consoleErrors.length} 条`)

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
