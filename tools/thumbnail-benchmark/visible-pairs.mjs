// Real Release WebView2 comparison. Only the native picker is replaced, using
// the real backend's playlist result; rendering and all data commands stay real.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { VISIBLE_MEASUREMENT } from './visible-measurement.mjs'

const [baselineArg, candidateArg, manifestArg, outputArg] = process.argv.slice(2)
if (!outputArg) throw new Error('Usage: node visible-pairs.mjs <baseline-app.exe> <candidate-app.exe> <private-corpus-manifest> <new-output>')
const output = resolve(outputArg)
const pairs = Number(process.env.THUMB_UI_PAIRS || 5)
const dwellMs = Number(process.env.THUMB_UI_DWELL_MS || 6500)
const layoutLevel = String(process.env.THUMB_UI_LAYOUT_LEVEL || '1')
const includeWarm = process.env.THUMB_UI_INCLUDE_WARM !== '0'
if (existsSync(output)) throw new Error('Output must not exist')
mkdirSync(output, { recursive: true })
const manifest = JSON.parse(readFileSync(manifestArg, 'utf8'))
const playlistPath = process.env.THUMB_UI_PLAYLIST ? resolve(process.env.THUMB_UI_PLAYLIST) : join(output, 'input.m3u8')
if (!process.env.THUMB_UI_PLAYLIST) writeFileSync(playlistPath, '#EXTM3U\n' + manifest.rows.map(row => row.source).join('\n') + '\n')
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
writeFileSync(join(output, 'identity.json'), JSON.stringify({ baselineSha256: hash(baselineArg), candidateSha256: hash(candidateArg),
  stage2Sha256: process.env.THUMB_UI_STAGE2_EXE ? hash(process.env.THUMB_UI_STAGE2_EXE) : null,
  corpusDigest: manifest.digest, corpusCount: manifest.count, playlistSha256: hash(playlistPath),
  scenario: process.env.THUMB_UI_REOPEN === '1' ? 'reopened-after-summary-ready' : 'first-open',
  measurement: 'frozen visible covers; first visible preview and final quality separate', pairs, layoutLevel, includeWarm,
  dwellMs,
  protocol: 'AB/BA paired isolated caches; disk-warm is a new process/profile reusing only its arm storage after fresh pass; OS cache uncontrolled; native picker disabled; real backend',
}, null, 2))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function connect(port) {
  let target
  for (let i = 0; i < 120; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes('tauri.localhost')) } catch { /* startup */ }
    if (target) break
    await sleep(250)
  }
  if (!target) throw new Error('Isolated WebView did not expose CDP')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let nextId = 0
  const pending = new Map()
  const handlers = new Map()
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method && handlers.has(message.method)) handlers.get(message.method)(message.params)
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.error) item.reject(new Error(JSON.stringify(message.error)))
    else item.resolve(message.result)
  })
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 60000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  return { send, evaluate, on: (method, handler) => handlers.set(method, handler), close: () => ws.close() }
}

async function run(executable, pair, arm, cacheMode) {
  const root = join(output, `${pair}-${arm}-${cacheMode}`)
  const storageRoot = join(output, `${pair}-${arm}-storage`)
  mkdirSync(root)
  mkdirSync(storageRoot, { recursive: true })
  const port = Number(process.env.THUMB_UI_PORT_BASE || 9450) + pair * 8 + ({ baseline: 0, stage2: 2, candidate: 4 }[arm]) + (cacheMode === 'disk-warm' ? 1 : 0)
  const child = spawn(resolve(executable), [], { windowsHide: true, env: { ...process.env,
    THUMB_UI_ROOT: storageRoot, WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview'), RUST_LOG: 'off',
    THUMB_UI_PLAYLIST: playlistPath,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', chunk => { logs += chunk })
  child.stderr.on('data', chunk => { logs += chunk })
  const exit = new Promise(resolve => child.once('exit', resolve))
  let cdp
  let sampler
  const commandTrace = []
  try {
    cdp = await connect(port)
    if (process.env.THUMB_UI_TRACE === '1') {
      cdp.on('Network.requestWillBeSent', event => {
        try { const url = new URL(event.request.url); if (url.hostname === 'ipc.localhost') commandTrace.push({ command: url.pathname, time: event.timestamp }) } catch { /* non-URL */ }
      })
      await cdp.send('Network.enable')
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.THUMB_UI_WIDTH || 2560), height: Number(process.env.THUMB_UI_HEIGHT || 1439), deviceScaleFactor: 1, mobile: false })
    await cdp.evaluate(`localStorage.setItem('spmusic.playlist.layout-level.v1', ${JSON.stringify(layoutLevel)})`)
    await cdp.send('Page.reload')
    await sleep(500)
    for (let i = 0; i < 100; i++) {
      if (await cdp.evaluate(`Boolean(document.querySelector('button[aria-label="打开音频"]:not(:disabled)'))`)) break
      await sleep(50)
    }
    sampler = spawn('powershell.exe', ['-NoProfile', '-File', fileURLToPath(new URL('./sample-ui.ps1', import.meta.url)), '-RootProcessId', String(child.pid), '-OutputDirectory', root], { windowsHide: true, stdio: 'ignore' })
    for (let i = 0; i < 100 && !existsSync(join(root, 'sampler-ready')); i++) await sleep(50)
    if (!existsSync(join(root, 'sampler-ready'))) throw new Error('Memory sampler failed to start')
    const opened = await cdp.evaluate(`(() => {
      const button = document.querySelector('button[aria-label="打开音频"]');
      if (!button) return {error:'open button absent',buttons:[...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))};
      const disabled=button.disabled;button.click(); return {disabled};
    })()`)
    if (opened.error) throw new Error(JSON.stringify(opened))
    await sleep(80)
    // The list is explicitly opened through the existing application's control.
    const controls = await cdp.evaluate(`(() => {
      if (document.querySelector('.playlist-panel')) return {panel:true};
      const buttons=[...document.querySelectorAll('button')];
      const button=buttons.find(b=>['播放列表','打开播放列表','显示播放列表'].includes(b.getAttribute('aria-label')));
      if(button){button.click();return {clicked:button.getAttribute('aria-label')}};
      return {buttons:buttons.map(b=>b.getAttribute('aria-label'))};
    })()`)
    if (!controls.panel && !controls.clicked) throw new Error(`List control unresolved: ${JSON.stringify(controls)}`)
    let cardsMounted = false
    for (let i = 0; i < 300; i++) {
      cardsMounted = await cdp.evaluate(`Boolean(document.querySelector('.playlist-grid [data-playlist-track-id]'))`)
      if (cardsMounted) break
      await sleep(100)
    }
    if (!cardsMounted) throw new Error('The real playlist did not mount cards within 30 seconds')
    if (process.env.THUMB_UI_REOPEN === '1') {
      const closed = await cdp.evaluate(`(() => {const button=document.querySelector('.playlist-playback-dock button[aria-label^="打开播放界面"]');if(!button)return false;button.click();return true})()`)
      if (!closed) throw new Error('Cannot close the ready playlist through its real control')
      for (let i = 0; i < 100; i++) {
        if (!await cdp.evaluate(`Boolean(document.querySelector('.playlist-grid'))`)) break
        await sleep(50)
      }
      const reopened = await cdp.evaluate(`(() => {const button=document.querySelector('button[aria-label="播放列表"]');if(!button)return false;button.click();return true})()`)
      if (!reopened) throw new Error('Cannot reopen the playlist through its real control')
      for (let i = 0; i < 100; i++) {
        if (await cdp.evaluate(`Boolean(document.querySelector('.playlist-grid [data-playlist-track-id]'))`)) break
        await sleep(50)
      }
    }
    // Entry animation is outside the measured scrolling interval. No per-card
    // geometry polling or timing hook is injected into production code.
    await sleep(500)
    const result = await cdp.evaluate(`(${VISIBLE_MEASUREMENT})(${JSON.stringify({ dwellMs, fractions: [0,.25,.5,.75,.95,.5,.25] })})`)
    writeFileSync(join(root, 'result.json'), JSON.stringify({ ...result, commandTrace }, null, 2))
    if (!result.episodes.some(episode => episode.rows.length > 0)) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(root, 'invalid.png'), Buffer.from(screenshot.data, 'base64'))
      writeFileSync(join(root, 'invalid-dom.json'), JSON.stringify(await cdp.evaluate(`({buttons:[...document.querySelectorAll('button')].map(b=>({label:b.getAttribute('aria-label'),disabled:b.disabled})),loading:document.querySelectorAll('.playlist-loading').length,empty:document.querySelectorAll('.playlist-empty').length,grid:document.querySelectorAll('.playlist-grid').length})`), null, 2))
      throw new Error(`No visible targets: inspect result.json geometry; opened=${JSON.stringify(opened)}`)
    }
    console.log(JSON.stringify({ pair, arm, cacheMode, episodes: result.episodes.map(e => ({ fraction:e.fraction, targets:e.rows.length, complete:e.rows.filter(r=>r.complete).length, alreadyReady:e.rows.filter(r=>r.alreadyReady).length })) }))
    return { pair, arm, cacheMode, ...result }
  } finally {
    if (sampler) writeFileSync(join(root, 'sampler-stop'), '')
    if (cdp) { await cdp.evaluate(`setTimeout(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}).catch(()=>null),20);true`).catch(()=>{}); cdp.close() }
    await Promise.race([exit,sleep(3000)])
    if (child.exitCode === null) child.kill()
    if (sampler) {
      for (let i = 0; i < 50 && !existsSync(join(root, 'memory.csv')); i++) await sleep(50)
    }
    writeFileSync(join(root, 'process.log'), logs)
  }
}
const rows=[]
for(let pair=1;pair<=pairs;pair++){
  const order = process.env.THUMB_UI_STAGE2_EXE
    ? (pair%2 ? ['baseline','stage2','candidate'] : ['candidate','stage2','baseline'])
    : (pair%2 ? ['baseline','candidate'] : ['candidate','baseline'])
  for(const arm of order){
    const executable = arm === 'baseline' ? baselineArg : arm === 'stage2' ? process.env.THUMB_UI_STAGE2_EXE : candidateArg
    for (const cacheMode of includeWarm ? ['fresh','disk-warm'] : ['fresh']) {
      rows.push(await run(executable,pair,arm,cacheMode))
      writeFileSync(join(output,'results.json'),JSON.stringify(rows,null,2))
    }
  }
}
