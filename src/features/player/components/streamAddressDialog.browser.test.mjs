// Focused acceptance: real LibraryRootMenu, shared primitives and appearance.
// Native stream registration is controlled; this does not test network playback.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const directory = process.env.SPMUSIC_TEST_SCREENSHOTS || path.join(tmpdir(), 'spmusic-stream-address-dialog-evidence')
mkdirSync(directory, { recursive: true })
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {LibraryRootMenu} from '/src/features/player/components/LibraryRootMenu.tsx';
import '/src/index.css';import '/src/features/player/styles/player.css';
window.calls=[];window.mode='success';
const library={pinnedCategoryIds:[],onAddStream:async(input)=>{window.calls.push(input);if(window.mode==='hold')return new Promise(resolve=>{window.release=resolve});if(window.mode==='throw')throw Error('controlled native failure');return window.mode!=='failure'}};
createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement('main',{style:{padding:40}},React.createElement('h1',null,'流'),React.createElement(LibraryRootMenu,{categoryId:'streams',library,rootToolbar:true}))));
`
const server = await createServer({
  cacheDir: mkdtempSync(path.join(tmpdir(), 'spmusic-dialog-vite-')),
  server: { host: '127.0.0.1', port: Number(process.env.SPMUSIC_TEST_PORT || 5182), strictPort: true },
  plugins: [{ name: 'stream-address-test-fixture',
    resolveId(id) { if (id === '/__dialog_fixture.jsx') return '\0stream-address-fixture.jsx' },
    load(id) { if (id === '\0stream-address-fixture.jsx') return fixture },
    configureServer(vite) { vite.middlewares.use('/__dialog_test', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end(await vite.transformIndexHtml('/__dialog_test', '<html><head></head><body><div id="root"></div><script type="module" src="/__dialog_fixture.jsx"></script></body></html>'))
    }) },
  }],
})
let browser
const evidence = []
const errors = []
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: 'light' })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.config.server.port + '/__dialog_test')
  const trigger = page.getByRole('button', { name: '更多列表操作', exact: true })
  const dialog = page.getByRole('dialog', { name: '添加地址', exact: true })
  const input = page.getByRole('textbox', { name: '地址', exact: true })
  async function waitForTriggerFocus() {
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '更多列表操作')
  }
  async function open() {
    await trigger.click()
    await page.getByRole('dialog', { name: '流', exact: true }).getByRole('button', { name: '添加地址', exact: true }).click()
    await dialog.waitFor()
    await input.waitFor()
    await page.waitForFunction(() => document.activeElement?.tagName === 'INPUT')
    await dialog.evaluate(async node => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
    })
  }
  await open()
  const geometry = await dialog.evaluate(node => {
    const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    const title = node.querySelector('[data-slot="dialog-title"]')
    const input = node.querySelector('input')
    const buttons = [...node.querySelectorAll('button')]
    return { box: box(node), radius: getComputedStyle(node).borderRadius, background: getComputedStyle(node).backgroundColor,
      title: { ...box(title), textX: box(title).x + parseFloat(getComputedStyle(title).paddingLeft), size: getComputedStyle(title).fontSize, line: getComputedStyle(title).lineHeight, color: getComputedStyle(title).color },
      input: { ...box(input), size: getComputedStyle(input).fontSize, borderBottom: getComputedStyle(input).borderBottomWidth },
      buttons: buttons.map(button => ({ ...box(button), text: button.textContent, size: getComputedStyle(button).fontSize, radius: getComputedStyle(button).borderRadius })),
      inputCount: node.querySelectorAll('input').length, closeCount: node.querySelectorAll('[data-slot="dialog-close"]').length }
  })
  console.log('Dialog geometry: ' + JSON.stringify(geometry))
  await dialog.screenshot({ path: path.join(directory, 'dialog-default.png') })
  assert.equal(geometry.box.width, 566)
  assert.equal(geometry.box.height, 255)
  assert.equal(geometry.radius, '40px')
  assert.equal(geometry.title.size, '28px')
  assert.equal(geometry.title.line, '36px')
  assert.equal(Math.round(geometry.title.textX - geometry.box.x), 38)
  assert.equal(Math.round(geometry.title.y - geometry.box.y), 14)
  assert.equal(geometry.input.size, '28px')
  // Chromium may snap a fractional CSS border to its layout pixel grid.
  assert(Math.abs(parseFloat(geometry.input.borderBottom) - 2.5) <= 0.5)
  assert.equal(geometry.inputCount, 1)
  assert.equal(geometry.closeCount, 0)
  assert.deepEqual(geometry.buttons.map(button => button.text), ['取消', '添加'])
  assert(geometry.buttons.every(button => button.height === 62 && button.size === '22px' && button.radius === '30px'))
  evidence.push({ scenario: 'figma-default-geometry', geometry })

  assert.equal(await input.inputValue(), 'http://')
  await input.fill('')
  assert(await dialog.getByRole('button', { name: '添加', exact: true }).isDisabled())
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await waitForTriggerFocus()
  assert(await trigger.evaluate(node => document.activeElement === node), 'Escape restores focus')
  await open()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('dialog', { name: '流', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '流', exact: true }).waitFor({ state: 'hidden' })
  await waitForTriggerFocus()
  assert(await trigger.evaluate(node => document.activeElement === node), 'cancel restores focus')
  evidence.push({ scenario: 'empty-disabled-escape-cancel-focus', passed: true })

  await open()
  await input.fill('ftp://example.test/radio')
  await dialog.getByRole('button', { name: '添加', exact: true }).click()
  await page.getByText('请输入有效的 HTTP(S) 地址，不支持带用户名或密码的地址。', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.calls.length), 0)
  assert.equal(await input.getAttribute('aria-invalid'), 'true')
  await input.fill('https://user:secret@example.test/radio')
  await dialog.getByRole('button', { name: '添加', exact: true }).click()
  assert.equal(await page.evaluate(() => window.calls.length), 0)
  evidence.push({ scenario: 'scheme-credentials-rejected', passed: true })

  await page.evaluate(() => { window.mode = 'failure' })
  await input.fill('https://example.test/Radio?Token=ABC')
  await dialog.getByRole('button', { name: '添加', exact: true }).click()
  await page.getByText('添加失败，请检查地址并重试。', { exact: true }).waitFor()
  await dialog.screenshot({ path: path.join(directory, 'dialog-error.png') })
  assert.equal(await page.evaluate(() => window.calls.length), 1)
  await page.evaluate(() => { window.mode = 'hold' })
  await dialog.getByRole('button', { name: '添加', exact: true }).click()
  await page.waitForFunction(() => window.calls.length === 2)
  assert(await input.isDisabled())
  assert(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled())
  assert(await dialog.getByRole('button', { name: '保存中…', exact: true }).isDisabled())
  await dialog.locator('form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 1)
  assert.equal(await page.evaluate(() => window.calls.length), 2)
  await page.evaluate(() => window.release(true))
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), { url: 'https://example.test/Radio?Token=ABC' })
  await waitForTriggerFocus()
  assert(await trigger.evaluate(node => document.activeElement === node))
  evidence.push({ scenario: 'failure-retry-pending-duplicate-blocked-success', passed: true })

  await page.setViewportSize({ width: 360, height: 640 })
  await open()
  await input.fill('https://example.test/' + 'long-path-'.repeat(100))
  const narrow = await dialog.evaluate(node => {
    const r = node.getBoundingClientRect()
    return { x: r.x, right: r.right, width: r.width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      inputWidth: node.querySelector('input').getBoundingClientRect().width, bodyScroll: document.documentElement.scrollWidth }
  })
  assert(narrow.x >= 0 && narrow.right <= 360 && narrow.scrollWidth <= narrow.clientWidth)
  assert(narrow.bodyScroll <= 360 && narrow.inputWidth > 0)
  await dialog.screenshot({ path: path.join(directory, 'dialog-narrow.png') })
  evidence.push({ scenario: 'narrow-long-url-no-overflow', narrow })
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
  writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify({ evidence, errors }, null, 2))
  console.log(JSON.stringify({ passed: true, scenarios: evidence.length, directory, evidence }, null, 2))
} finally {
  if (browser) await browser.close()
  await server.close()
}
