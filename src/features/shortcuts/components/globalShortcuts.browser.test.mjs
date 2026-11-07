// Start Vite first. SPMUSIC_PLAYWRIGHT may point at an existing Playwright package.
// Real browser/component tests with simulated IPC; native registration has separate Rust coverage.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
function dependency(name) {
  const path = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))?.[1]
  assert(path, `Vite dependency ${name}`)
  return path
}
const defaults = {
  previous: 'Ctrl+Alt+ArrowLeft', next: 'Ctrl+Alt+ArrowRight', volumeUp: 'Ctrl+Alt+ArrowUp',
  volumeDown: 'Ctrl+Alt+ArrowDown', togglePlayback: 'Ctrl+KeyP',
}
const core = `
export const isTauri = () => window.desktopAvailable;
export async function invoke(command,args) {
  window.commands.push({command,args});
  if (command==='global_shortcuts_get_settings') {
    if(window.getFailure) throw {message:'native state unreadable'};
    return structuredClone(window.effective);
  }
  if (command==='global_shortcuts_set_suspended') {
    if (args.suspended && window.pauseGate) await window.pauseGate;
    if (!args.suspended && window.resumeFailure) throw {message:'native resume failed'};
    window.effective.suspended=args.suspended;
    if (!args.suspended && window.resumeIssues) window.effective.issues=window.resumeIssues;
    return structuredClone(window.effective);
  }
  if (command==='global_shortcuts_update_settings') {
    if (window.saveFailure) throw {code:'REGISTER_FAILED',message:window.saveFailure};
    window.effective={bindings:structuredClone(args.input.bindings),issues:[],suspended:false};
    localStorage.setItem('__shortcuts_test',JSON.stringify(window.effective));
    return structuredClone(window.effective);
  }
  throw new Error('unexpected command '+command);
}
`
const events = `
export async function listen(name, callback) {
  const id=++window.listenerSequence;
  await new Promise(resolve=>setTimeout(resolve,35));
  window.listeners.set(id,{name,callback});
  return ()=>{ window.listeners.delete(id); window.cleanupCount++; };
}
`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {GlobalShortcutSettings} from '/src/features/shortcuts/components/GlobalShortcutSettings.tsx';
import {SettingsDialog} from '/src/features/player/components/SettingsDialog.tsx';
import {useGlobalShortcuts} from '/src/features/shortcuts/hooks/useGlobalShortcuts.ts';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {TooltipProvider} from '/src/components/ui/tooltip.tsx';
import '/src/index.css';
import '/src/features/player/styles/player/settings-dialog.css';
const {useState,StrictMode}=React;
function Fixture() {
  const [shown,setShown]=useState(true);
  const [player,setPlayer]=useState({track:{id:'song'},volume:72,volumeDisabled:false});
  window.setPlayer=patch=>setPlayer(p=>({...p,...patch}));
  window.hideSettings=()=>setShown(false);
  window.showSettings=()=>setShown(true);
  useGlobalShortcuts({...player,
    previous:()=>window.actions.push({type:'previous'}),
    next:()=>window.actions.push({type:'next'}),
    togglePlayback:()=>window.actions.push({type:'toggle'}),
    changeVolume:value=>{window.actions.push({type:'volume',value});setPlayer(p=>({...p,volume:value}));},
  });
  return React.createElement('main',null,shown&&React.createElement(window.useSettingsDialog?SettingsDialog:GlobalShortcutSettings));
}
const root=ReactDOM.createRoot(document.getElementById('root'));
window.unmountFixture=()=>root.unmount();
root.render(React.createElement(StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(TooltipProvider,null,React.createElement(Fixture)))));
`
console.log('BROWSER_START', origin)
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
console.log('BROWSER_READY', browser.version())
let passed = 0
async function open(desktop = true, dialog = false) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGEERROR', error.message) })
  await page.addInitScript(({ defaults, desktop, dialog }) => {
    window.useSettingsDialog = dialog
    window.desktopAvailable = desktop
    window.effective = JSON.parse(localStorage.getItem('__shortcuts_test') || 'null') || { bindings: defaults, issues: [], suspended: false }
    window.commands = []; window.actions = []; window.listeners = new Map(); window.listenerSequence = 0; window.cleanupCount = 0
    window.emitShortcut = action => {
      for (const { callback } of window.listeners.values()) callback({ payload: { action } })
    }
  }, { defaults, desktop, dialog: dialog || process.env.SPMUSIC_SETTINGS_DIALOG === '1' })
  await page.route('**/@tauri-apps_api_core.js*', route => route.fulfill({ contentType: 'text/javascript', body: core }))
  await page.route('**/@tauri-apps_api_event.js*', route => route.fulfill({ contentType: 'text/javascript', body: events }))
  await page.route('**/__shortcut_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__shortcut_fixture.js"')
  await page.route('**/__shortcut_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__shortcut_test')
  if (dialog || process.env.SPMUSIC_SETTINGS_DIALOG === '1') await page.getByRole('button',{name:'设置',exact:true}).click()
  await page.getByText('全局快捷键', { exact: true }).waitFor()
  if (desktop) await page.waitForFunction(() => window.listeners.size === 1 && !document.querySelector('#shortcut-previous').disabled)
  return { page, errors }
}
async function check(name, run, desktop = true, dialog = false) {
  if (process.env.SPMUSIC_TEST_FILTER && !name.includes(process.env.SPMUSIC_TEST_FILTER)) return
  console.log('CHECK', name)
  const { page, errors } = await open(desktop, dialog)
  try {
    await run(page)
    assert.deepEqual(errors, [], 'no unhandled browser errors')
    console.log('PASS', name); passed++
  } catch (reason) {
    console.log('FAILED_STATE', JSON.stringify(await page.evaluate(() => ({
      effective: window.effective,
      fields: [...document.querySelectorAll('[data-slot="field"]')].map(element => ({
        html: element.outerHTML.slice(0, 1300), rect: element.getBoundingClientRect().toJSON(),
        style: { display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility },
      })),
      alerts: [...document.querySelectorAll('[role="alert"]')].map(element => ({
        text: element.textContent, rect: element.getBoundingClientRect().toJSON(),
        ancestors: [element,element.parentElement,element.parentElement.parentElement,element.parentElement.parentElement.parentElement,element.closest('fieldset')].map(el => ({class:el.className,rect:el.getBoundingClientRect().toJSON(),display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility,contentVisibility:getComputedStyle(el).contentVisibility,containerType:getComputedStyle(el).containerType,contain:getComputedStyle(el).contain,height:getComputedStyle(el).height})),
      })),
    }))))
    throw reason
  } finally { await page.close() }
}
async function record(page, action, chord) {
  await page.locator('#shortcut-' + action).click()
  await page.getByText('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。', { exact: true }).waitFor()
  await page.keyboard.press(chord)
  await page.waitForFunction(() => !window.effective.suspended && !document.querySelector('#shortcut-previous').disabled)
  await page.waitForFunction(action => !document.querySelector('#shortcut-' + action).textContent.includes('正在录制'), action)
}
const save = page => page.getByRole('button', { name: '保存快捷键', exact: true })

try {
  await check('default labels, clear/save/reload, custom/save and restore', async page => {
    for (const [action, label] of Object.entries({previous:'Ctrl + Alt + ←',next:'Ctrl + Alt + →',volumeUp:'Ctrl + Alt + ↑',volumeDown:'Ctrl + Alt + ↓',togglePlayback:'Ctrl + P'})) {
      assert.equal(await page.locator('#shortcut-' + action).innerText(), label)
    }
    assert.equal(await save(page).isDisabled(), true)
    await page.getByRole('button', { name: '清除上一首快捷键', exact: true }).click()
    await save(page).click(); await page.getByText('快捷键已保存并生效。', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.effective.bindings.previous), null)
    await page.reload(); await page.waitForFunction(() => !document.querySelector('#shortcut-previous').disabled)
    assert.equal(await page.locator('#shortcut-previous').innerText(), '未设置')
    await record(page, 'previous', 'Control+Alt+K')
    await save(page).click(); await page.getByText('快捷键已保存并生效。', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.effective.bindings.previous), 'Ctrl+Alt+KeyK')
    await page.getByRole('button', { name: '恢复默认', exact: true }).click(); await save(page).click()
    await page.getByText('快捷键已保存并生效。', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.effective.bindings), defaults)
  })
  await check('duplicate, unmodified key and auto-repeat reject without invoking update', async page => {
    await record(page, 'next', 'Control+Alt+ArrowLeft')
    await page.getByText(/快捷键重复/).first().waitFor()
    assert.equal(await save(page).isDisabled(), true)
    assert.equal(await page.evaluate(() => window.commands.filter(c => c.command === 'global_shortcuts_update_settings').length), 0)
    await page.getByRole('button', { name: '恢复默认', exact: true }).click()
    await page.locator('#shortcut-next').click()
    await page.getByText('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。', { exact: true }).waitFor()
    await page.keyboard.press('A'); assert.match(await page.locator('main').innerText(), /请使用 Ctrl/)
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyX',ctrlKey:true,repeat:true,bubbles:true})))
    assert.equal(await page.locator('#shortcut-next').innerText(), '正在录制…')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !window.effective.suspended)
    assert.equal(await page.locator('#shortcut-next').innerText(), 'Ctrl + Alt + →')
  })
  await check('Esc while holding a recorded candidate discards it', async page => {
    await page.locator('#shortcut-next').click()
    await page.getByText('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。', { exact: true }).waitFor()
    await page.keyboard.down('Control'); await page.keyboard.down('K')
    await page.keyboard.press('Escape')
    await page.keyboard.up('K'); await page.keyboard.up('Control')
    await page.waitForFunction(() => !window.effective.suspended && !document.querySelector('#shortcut-next').disabled)
    assert.equal(await page.locator('#shortcut-next').innerText(), 'Ctrl + Alt + →')
    assert.equal(await save(page).isDisabled(), true)
  })
  await check('failed save exposes reason, retains draft and effective configuration', async page => {
    await record(page, 'next', 'Control+Alt+K')
    await page.evaluate(() => { window.saveFailure = 'next shortcut occupied by another application' })
    await save(page).click()
    await page.getByText('next shortcut occupied by another application', { exact: true }).waitFor()
    assert.equal(await page.locator('#shortcut-next').innerText(), 'Ctrl + Alt + K')
    assert.deepEqual(await page.evaluate(() => window.effective.bindings), defaults)
    assert.equal(await page.getByText('快捷键已保存并生效。', { exact: true }).count(), 0)
    await page.evaluate(() => { window.saveFailure = null })
    await save(page).click(); await page.getByText('快捷键已保存并生效。', { exact: true }).waitFor()
  })
  await check('capture suspends action dispatch until every modifier releases', async page => {
    await page.locator('#shortcut-togglePlayback').click()
    await page.getByText('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。', { exact: true }).waitFor()
    await page.keyboard.down('Control'); await page.keyboard.down('K')
    await page.evaluate(() => window.emitShortcut('togglePlayback'))
    await page.keyboard.up('K'); assert.equal(await page.evaluate(() => window.effective.suspended), true)
    assert.equal(await page.evaluate(() => window.actions.length), 0)
    await page.keyboard.up('Control')
    await page.waitForFunction(() => !window.effective.suspended)
    assert.equal(await page.locator('#shortcut-togglePlayback').innerText(), 'Ctrl + K')
    await page.evaluate(() => window.emitShortcut('togglePlayback'))
    assert.deepEqual(await page.evaluate(() => window.actions), [{ type: 'toggle' }])
  })
  await check('cancelled pending suspension restores in order, then listener teardown ignores late callbacks', async page => {
    await page.evaluate(() => { window.pauseGate = new Promise(resolve => { window.releasePause = resolve }) })
    await page.locator('#shortcut-next').click()
    await page.getByText('正在暂停全局快捷键…', { exact: true }).waitFor()
    await page.getByRole('button', { name: '取消录制', exact: true }).click()
    await page.evaluate(() => window.releasePause())
    await page.waitForFunction(() => window.commands.filter(c => c.command === 'global_shortcuts_set_suspended').length === 2 && !window.effective.suspended)
    assert.deepEqual(await page.evaluate(() => window.commands.filter(c => c.command === 'global_shortcuts_set_suspended').map(c => c.args.suspended)), [true, false])
    await page.evaluate(() => { window.oldCallbacks = [...window.listeners.values()].map(l => l.callback); window.unmountFixture() })
    await page.waitForFunction(() => window.listeners.size === 0)
    await page.evaluate(() => window.oldCallbacks.forEach(callback => callback({ payload: { action: 'next' } })))
    assert.equal(await page.evaluate(() => window.actions.length), 0)
  })
  await check('unmount during pending capture resumes shortcuts and blur cancels a live capture', async page => {
    await page.evaluate(() => { window.pauseGate = new Promise(resolve => { window.releasePause = resolve }) })
    await page.locator('#shortcut-next').click(); await page.getByText('正在暂停全局快捷键…', { exact: true }).waitFor()
    await page.evaluate(() => { window.hideSettings(); window.releasePause() })
    await page.waitForFunction(() => window.commands.filter(c => c.command === 'global_shortcuts_set_suspended').length === 2 && !window.effective.suspended)
    await page.evaluate(() => { window.pauseGate = null; window.showSettings() })
    await page.locator('#shortcut-next').waitFor(); await page.waitForFunction(() => !document.querySelector('#shortcut-next').disabled)
    await page.locator('#shortcut-next').click(); await page.getByText('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。', { exact: true }).waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForFunction(() => !window.effective.suspended && !document.querySelector('#shortcut-next').disabled)
  })
  await check('resume failures expose recovery and per-action startup conflict', async page => {
    await page.locator('#shortcut-next').click(); await page.getByText('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。', { exact: true }).waitFor()
    await page.evaluate(() => { window.resumeFailure = true })
    await page.keyboard.press('Escape'); await page.getByText('恢复快捷键失败：native resume failed', { exact: true }).waitFor()
    assert.equal(await save(page).isDisabled(), true)
    await page.evaluate(() => { window.resumeFailure = false; window.resumeIssues = [{ action: 'next', message: 'next native chord occupied' }] })
    await page.getByRole('button', { name: '恢复快捷键', exact: true }).click()
    await page.getByText('next native chord occupied', { exact: true }).waitFor()
    assert.equal(await page.locator('#shortcut-next').getAttribute('aria-invalid'), 'true')
    assert.equal(await page.evaluate(() => window.effective.suspended), false)
  })
  await check('resume rejection reconciles native false and resumes action dispatch', async page => {
    await page.locator('#shortcut-next').click(); await page.getByText('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。', { exact: true }).waitFor()
    await page.evaluate(() => { window.resumeFailure = true; window.effective.suspended = false })
    await page.keyboard.press('Escape')
    await page.getByText('恢复快捷键失败：native resume failed', { exact: true }).waitFor()
    await page.evaluate(() => window.emitShortcut('next'))
    assert.deepEqual(await page.evaluate(() => window.actions), [{type:'next'}])
    assert.equal(await page.getByRole('button', {name:'恢复快捷键',exact:true}).count(), 0)
  })
  await check('resume plus read failure retains visible recovery and event suppression', async page => {
    await page.locator('#shortcut-next').click(); await page.getByText('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。', { exact: true }).waitFor()
    await page.evaluate(() => { window.resumeFailure = true; window.getFailure = true })
    await page.keyboard.press('Escape')
    await page.getByText('恢复快捷键失败：native resume failed', { exact: true }).waitFor()
    await page.getByRole('button', {name:'恢复快捷键',exact:true}).waitFor()
    await page.evaluate(() => window.emitShortcut('next'))
    assert.equal(await page.evaluate(() => window.actions.length), 0)
    await page.evaluate(() => { window.resumeFailure = false; window.getFailure = false })
    await page.getByRole('button', {name:'恢复快捷键',exact:true}).click()
    await page.waitForFunction(() => !window.effective.suspended)
    await page.evaluate(() => window.emitShortcut('next'))
    assert.deepEqual(await page.evaluate(() => window.actions), [{type:'next'}])
  })
  await check('StrictMode has one listener; actions use latest player state and volume boundaries', async page => {
    assert.equal(await page.evaluate(() => window.listeners.size), 1)
    assert.ok(await page.evaluate(() => window.cleanupCount) >= 1, 'late StrictMode first listener cleaned')
    await page.evaluate(() => { window.emitShortcut('previous'); window.emitShortcut('next'); window.emitShortcut('togglePlayback'); window.emitShortcut('invalid') })
    assert.deepEqual(await page.evaluate(() => window.actions.map(a => a.type)), ['previous', 'next', 'toggle'])
    for (const [volume, action, expected] of [[98,'volumeUp',100],[1,'volumeDown',0],[100,'volumeUp',100],[0,'volumeDown',0]]) {
      await page.evaluate(volume => window.setPlayer({ volume }), volume)
      await page.evaluate(action => window.emitShortcut(action), action)
      assert.equal(await page.evaluate(() => window.actions.at(-1).value), expected)
    }
    await page.evaluate(() => window.setPlayer({ track: null, volumeDisabled: true }))
    const count = await page.evaluate(() => window.actions.length)
    await page.evaluate(() => { window.emitShortcut('togglePlayback'); window.emitShortcut('volumeUp') })
    assert.equal(await page.evaluate(() => window.actions.length), count)
    await page.evaluate(() => window.setPlayer({ track: {id:'new'}, volume: 40, volumeDisabled: false }))
    await page.evaluate(() => window.emitShortcut('volumeUp'))
    await page.evaluate(() => window.emitShortcut('volumeUp'))
    assert.deepEqual((await page.evaluate(() => window.actions)).slice(-2), [{type:'volume',value:45},{type:'volume',value:50}])
  })
  await check('browser preview reports unavailable and disables save', async page => {
    await page.getByText('全局快捷键仅在桌面应用中可用。', { exact: true }).waitFor()
    assert.equal(await save(page).isDisabled(), true)
    assert.equal(await page.locator('#shortcut-next').isDisabled(), true)
    assert.equal(await page.evaluate(() => window.listeners.size), 0)
  }, false)
  await check('actual settings dialog keeps all rows and duplicate errors visible after capture', async page => {
    await record(page, 'next', 'Control+Alt+ArrowLeft')
    await page.getByText(/快捷键重复/).first().waitFor()
    assert.equal(await save(page).isDisabled(), true)
    const geometry = await page.locator('.global-shortcut-settings').evaluate(element => ({
      groupHeight: element.querySelector('[data-slot="field-group"]').getBoundingClientRect().height,
      rows: [...element.querySelectorAll('[data-slot="field"]')].map(row => row.getBoundingClientRect().height),
      errors: [...element.querySelectorAll('[role="alert"]')].map(error => error.getBoundingClientRect().height),
    }))
    assert.equal(geometry.rows.length, 5)
    assert.ok(geometry.groupHeight > 0 && geometry.rows.every(height => height > 0) && geometry.errors.every(height => height > 0))
    console.log('DIALOG_GEOMETRY', JSON.stringify(geometry))
  }, true, true)
  console.log(`BROWSER_RESULT ${passed} passed (${browser.version()}); IPC mocked, native OS behavior tested separately`)
} finally { await browser.close() }
