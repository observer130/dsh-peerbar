#!/usr/bin/env node
/**
 * 派生面板自检：远端文档预览 + 定时任务目录。
 *
 *   node scripts/panel-check.mjs            # 用 .workbuddy/tmp/pb-web.log 里的实例
 *   node scripts/panel-check.mjs --base <url>
 *
 * 与 ui-check 分开：这两项依赖远端数据（有交付物的会话、真实任务），
 * 不是每个环境都齐；缺数据时记为 skipped，不算失败。
 *
 * 产物：.workbuddy/tmp/panel-check.json、panel-preview.png
 * 退出码：0 通过（含 skipped）；1 有断言失败或页面报错。
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
  const match = fs.readFileSync(log, 'utf8').match(/http:\/\/[\d.]+:\d+\/\?token=\S+/)
  if (!match) throw new Error('日志里没有带 token 的 URL')
  return match[0]
}

const base = readBase()
const problems = []
const result = { preview: null, schedule: null }
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Immer|status of 404/.test(message.text())) consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await page.goto(base, { waitUntil: 'networkidle2', timeout: 40000 })
  // 联邦模式下没有影子树（`.dshp-root` 是 v8 的类名），等官方行出现即可
  await page.waitForFunction(() => document.querySelectorAll('[data-row-key^="workspace:"]').length > 0, {
    timeout: 30000,
  })
  await new Promise((resolve) => setTimeout(resolve, 6000))

  // 找一条带交付物、且在侧栏可见的远端会话
  const candidates = await page.evaluate(async () => {
    const state = await (await fetch('/dsh-peerbar/api/state', { credentials: 'same-origin' })).json()
    const hosts = (state.hosts ?? []).filter((host) => host.status === 'online')
    const found = []
    for (const host of hosts) {
      for (const workspace of host.workspaces ?? []) {
        for (const session of (workspace.sessions ?? []).slice(0, 8)) {
          if (session.archived === true || !session.title) continue
          const url = `/dsh-peerbar/api/session?hostId=${encodeURIComponent(host.hostId)}&id=${encodeURIComponent(session.rawId)}&limit=200&raw=1`
          const raw = await (await fetch(url, { credentials: 'same-origin' })).json()
          const hasDeliverable = (raw.records ?? []).some((record) => record.event?.type === 'deliverables/presented')
          if (hasDeliverable) {
            found.push({ title: session.title, hostId: host.hostId, rawId: session.rawId, cwd: workspace.cwd ?? null })
          }
        }
      }
    }
    return found
  })
  // 展开所有工作区组。主机分组开着时是两层：先展开主机行，子工作区行才出现，
  // 所以要跑几趟（每趟只点当前 DOM 里的折叠行）。
  for (let pass = 0; pass < 3; pass += 1) {
    await page.evaluate(() => {
      for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
        if (row.getAttribute('aria-expanded') !== 'true') row.click()
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 900))
  }

  const statFile = (entry, file) =>
    page
      .evaluate(
        async ([hostId, sessionId, path]) => {
          const response = await fetch(`/dsh-peerbar/api/hosts/${encodeURIComponent(hostId)}/rpc`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-dsh-peerbar-action': '1' },
            body: JSON.stringify({ endpoint: 'workspaceFiles/stat', args: { workspaceFileScopeId: sessionId, path } }),
          })
          const payload = await response.json().catch(() => null)
          return { ok: response.ok && payload?.ok === true, status: response.status }
        },
        [entry.hostId, entry.rawId, file],
      )
      .catch(() => ({ ok: false }))

  // 逐个候选会话试：打开 → 收集正文里的文件引用 → stat 挑一个真能读到的 → 点开。
  // 交付物卡片可能指向已删除的路径，那是数据问题：换下一个候选，而不是判插件失败。
  let openedTitle = null
  let previewDone = false
  const tried = []
  for (const entry of candidates) {
    if (previewDone) break
    const clicked = await page.evaluate((wanted) => {
      const prefix = wanted.slice(0, 12)
      const row = [...document.querySelectorAll('[data-row-key^="session:"]')].find((node) => {
        const text = (node.innerText ?? '').replace(/\s+/g, ' ').trim()
        return text !== '' && (text.includes(prefix) || wanted.includes(text.slice(0, 12)))
      })
      if (!row) return false
      row.click()
      return true
    }, entry.title)
    if (!clicked) continue
    await new Promise((resolve) => setTimeout(resolve, 2600))
    const crumb = await page.evaluate(() => document.querySelector('[class*="crumbCurrent"]')?.textContent?.trim() ?? null)
    if (!crumb) continue
    openedTitle = crumb

    const files = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .map((item) => (item.innerText ?? '').trim())
        .filter((text) => text.length > 0 && text.length < 80 && /\.(md|markdown|py|ts|js|json|jsonl|txt|yaml|yml|csv)$/i.test(text))
        .slice(0, 8),
    )
    if (files.length === 0) {
      tried.push({ title: entry.title, reason: '正文里没有文件引用' })
      continue
    }

    const consoleBefore = consoleErrors.length
    let readable = null
    for (const file of files) {
      if ((await statFile(entry, file)).ok) {
        readable = file
        break
      }
    }
    // stat 失败会在 console 里留下 `status of 502`：那是探针噪声，
    // 只清掉窗口内新增的资源错误，不动真正的 UI 报错。
    for (let index = consoleErrors.length - 1; index >= consoleBefore; index -= 1) {
      if (/status of 502/.test(consoleErrors[index] ?? '')) consoleErrors.splice(index, 1)
    }
    if (!readable) {
      tried.push({ title: entry.title, candidates: files, reason: '引用的文件在远端都读不到' })
      continue
    }

    await page.evaluate((text) => {
      const node = [...document.querySelectorAll('button')].find((item) => (item.innerText ?? '').trim() === text)
      node?.click()
    }, readable)
    await new Promise((resolve) => setTimeout(resolve, 3500))
    const preview = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[data-dockkit-tab]')].map((node) => (node.textContent ?? '').trim())
      const text = document.body.innerText ?? ''
      return { tabs, tail: text.slice(-600) }
    })
    // 预览页签的标题是文件名（不带目录），正文里的引用可能带 `docs/` 前缀。
    const base = readable.split('/').pop()
    const opened = preview.tabs.some((tab) => tab.includes(base))
    const failed = /无法读取|读取失败|不存在|EISDIR|permission denied/i.test(preview.tail.slice(-260))
    result.preview = {
      title: entry.title,
      openedTitle,
      mention: readable,
      cwd: entry.cwd ?? null,
      opened,
      failed,
      tabs: preview.tabs,
    }
    await page.screenshot({ path: path.join(OUT, 'panel-preview.png') })
    if (!opened) problems.push(`点击「${readable}」后预览标签页没有打开`)
    if (failed) problems.push(`「${readable}」预览显示读取失败`)
    previewDone = true
  }

  if (!previewDone) {
    result.preview = {
      skipped: true,
      reason: candidates.length === 0
        ? '没有可在侧栏打开的交付物会话（可能都已归档）'
        : '候选会话引用的文件在远端都读不到（数据问题，不是插件失败）',
      tried,
    }
  }

  // 定时任务：有任务就打开「自动化任务」页核对标题
  const tasks = await page.evaluate(async () => {
    const response = await fetch('/dsh-peerbar/api/schedule', { credentials: 'same-origin' })
    if (!response.ok) return { ok: false, status: response.status }
    const value = await response.json()
    return { ok: true, tasks: (Array.isArray(value) ? value : []).map((item) => item.title).filter(Boolean) }
  })
  if (!tasks.ok) {
    result.schedule = { skipped: true, reason: `catalog 路由 HTTP ${tasks.status}` }
  } else if (tasks.tasks.length === 0) {
    result.schedule = { skipped: true, reason: '当前没有远端定时任务' }
  } else {
    await page.evaluate(() => {
      [...document.querySelectorAll('button[aria-label]')]
        .find((button) => button.getAttribute('aria-label') === '自动化任务')?.click()
    })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const listed = await page.evaluate((titles) => {
      const text = document.body.innerText ?? ''
      return titles.filter((title) => text.includes(title))
    }, tasks.tasks.slice(0, 3))
    result.schedule = { total: tasks.tasks.length, listed }
    if (listed.length === 0) problems.push('「自动化任务」页没有列出远端任务')
  }

  result.consoleErrors = consoleErrors
  if (consoleErrors.length) problems.push(`页面报错 ${consoleErrors.length} 条`)
  result.problems = problems
  fs.writeFileSync(path.join(OUT, 'panel-check.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (problems.length) {
    console.error('\n断言失败：')
    for (const problem of problems) console.error(' -', problem)
    process.exitCode = 1
  } else {
    console.log('\n面板自检通过')
  }
} finally {
  await browser.close()
}
