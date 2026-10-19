// Optional same-scene before/after benchmark; no production dependency added.
// Set SPMUSIC_PLAYWRIGHT, start Vite, then use SPMUSIC_PERF_LABEL=before/after.
// Artifacts belong to this benchmark under TEMP/spmusic-playlist-elastic-performance.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const label = process.env.SPMUSIC_PERF_LABEL || 'current'
const artifactDir = process.env.SPMUSIC_PERF_ARTIFACTS || join(tmpdir(), 'spmusic-playlist-elastic-performance')
const counts = (process.env.SPMUSIC_PERF_COUNTS || '120,1797').split(',').map(Number)
const rates = (process.env.SPMUSIC_PERF_CPU_RATES || '1,4').split(',').map(Number)
const repeats = Number(process.env.SPMUSIC_PERF_REPEATS || 2)
const viewport = { width: 1920, height: 1280 }
const panelPath = '/src/features/player/components/PlaylistPanel.tsx'
const source = await (await fetch(origin + panelPath)).text()
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = filename => {
  const match = (source + '\n' + entry).match(new RegExp('"(/node_modules/\\.vite/deps/' + filename.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve ${filename}`)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import { AppearanceProvider } from '/src/features/appearance/components/AppearanceProvider.tsx';
import { PlaylistPanel } from '${panelPath}';
import '/src/index.css';
import '/src/features/player/styles/player.css';
const noop=()=>{};
const covers=Array.from({length:16},(_,variant)=>{
 let content='<rect width="512" height="512" fill="hsl('+variant*23+' 48% 28%)"/>';
 for(let i=0;i<100;i++)content+='<circle cx="'+((i*73+variant*17)%512)+'" cy="'+((i*137+variant*29)%512)+'" r="'+(8+i%23)+'" fill="hsl('+((i*19+variant*31)%360)+' 65% 55%)" opacity=".6"/>';
 content+='<path d="M0 0L512 512M0 512L512 0M0 256H512M256 0V512" stroke="#eac" stroke-width="9"/><text x="30" y="270" font-size="65" fill="white">COVER '+variant+'</text>';
 return URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">'+content+'</svg>'],{type:'image/svg+xml'}));
});
const count=Number(new URLSearchParams(location.search).get('count'));
const tracks=Array.from({length:count},(_,i)=>({id:'track-'+i,title:'Patterned song '+i,artist:'Artist '+i%11,album:'Album '+i%17,durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:true,coverThumbnail:{src:covers[i%16],width:512,height:512,encodedBytes:12000}}));
window.actions=[];window.demands=0;
const playback={track:{...tracks[0],lyrics:[]},isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:noop,onShuffleCycle:noop,onRepeatCycle:noop};
const timeline={positionSeconds:0,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
const root=ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(AppearanceProvider,null,React.createElement(PlaylistPanel,{tracks,currentTrackId:'track-0',shuffleMode:'none',onShuffleCycle:noop,onVisibleTrackIdsChange:()=>window.demands++,playback,timeline,visualIsPlaying:false,playbackTransitionPending:false,onPlayToggle:()=>window.actions.push('play'),onTrackSelect:id=>window.actions.push(id),onClose:noop})));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__elastic_perf_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
mkdirSync(artifactDir, { recursive: true })
const report = { label, browser: browser.version(), viewport, counts, rates, repeats, fixture: 'dense tile level2; 16 detailed 512px SVG covers; real artwork demand callback', results: [] }
console.log('PERF_ENV', JSON.stringify({ label, browser: report.browser, viewport, counts, rates, repeats, artifactDir }))
const metricNames = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount']
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] : 0
function frameSummary(frames, budget) {
  const values = frames.map(frame => frame.dt)
  return { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), max: Math.max(0, ...values),
    overBudget: values.filter(dt => dt > budget * 1.5).length, over33ms: values.filter(dt => dt > 33.4).length, over50ms: values.filter(dt => dt > 50).length }
}
async function stopTrace(cdp, path, count) {
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
  await cdp.send('Tracing.end')
  const { stream } = await complete
  let content = ''
  while (true) {
    const read = await cdp.send('IO.read', { handle: stream })
    content += read.base64Encoded ? Buffer.from(read.data, 'base64').toString('utf8') : read.data
    if (read.eof) break
  }
  await cdp.send('IO.close', { handle: stream })
  writeFileSync(path, content)
  const names = ['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'RasterTask', 'CompositeLayers', 'EventDispatch', 'FireAnimationFrame']
  const aggregate = Object.fromEntries(names.map(name => [name, { count: 0, cpuMs: 0, maxMs: 0 }]))
  const styleElements = []
  for (const event of JSON.parse(content).traceEvents) if (event.ph === 'X' && aggregate[event.name]) {
    const record = aggregate[event.name], ms = (event.dur || 0) / 1000
    record.count++; record.cpuMs += ms; record.maxMs = Math.max(record.maxMs, ms)
    if (event.name === 'UpdateLayoutTree') styleElements.push(event.args?.elementCount || 0)
  }
  aggregate.styleElements = { median: percentile(styleElements, .5), p95: percentile(styleElements, .95), max: Math.max(0, ...styleElements), fullTreeEvents: styleElements.filter(n => n >= count * 6).length }
  return aggregate
}
try {
  for (const count of counts) for (const rate of rates) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('spmusic.playlist.layout-level.v1', '2'))
    await page.route('**/__elastic_perf_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
    await page.route('**/__elastic_perf_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto(origin + '/__elastic_perf_test?count=' + count)
    await page.locator('.playlist-card').first().waitFor()
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))) })
    await page.waitForTimeout(1600)
    await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 0 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    await page.evaluate(() => {
      window.perfFrames = []; window.perfLongTasks = []; window.perfPhase = 'idle'; window.perfLastTime = null; window.perfCapture = true
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.perfLongTasks.push({ phase: window.perfPhase, duration: entry.duration, startTime: entry.startTime }) }).observe({ entryTypes: ['longtask'] })
      const capture = time => {
        if (!window.perfCapture) return
        if (window.perfLastTime !== null) window.perfFrames.push({ phase: window.perfPhase, dt: time - window.perfLastTime, time })
        window.perfLastTime = time
        requestAnimationFrame(capture)
      }
      requestAnimationFrame(capture)
    })
    await page.waitForTimeout(800)
    const idle = await page.evaluate(() => window.perfFrames.filter(frame => frame.phase === 'idle'))
    const budget = percentile(idle.map(frame => frame.dt), .5) || 16.7
    const initial = await page.evaluate(() => {
      const p = document.querySelector('.playlist-panel'), h = document.querySelector('.playlist-hero').getBoundingClientRect()
      return { scrollHeight: p.scrollHeight, heroHeight: h.height, point: { x: p.getBoundingClientRect().x + 8, y: 300 }, cards: document.querySelectorAll('.playlist-card').length,
        visibleCovers: [...document.querySelectorAll('.playlist-card-cover-image')].filter(image => { const r = image.getBoundingClientRect(); return r.bottom > 40 && r.top < innerHeight - 224 }).length }
    })
    assert.equal(initial.cards, count)
    assert(initial.visibleCovers > 5, 'warmed dense scene has painted cover artwork')
    const tracePath = join(artifactDir, `${label}-${count}-${rate}x.trace.json`)
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,cc,benchmark', transferMode: 'ReturnAsStream' })
    const phases = []
    const phase = async (name, input) => {
      const before = await metrics(cdp)
      await page.evaluate(name => { window.perfPhase = name; performance.mark(name + '-start') }, name)
      const start = performance.now()
      await input()
      const elapsedMs = performance.now() - start
      await page.evaluate(name => { performance.mark(name + '-end'); window.perfPhase = 'between' }, name)
      const after = await metrics(cdp)
      const captured = await page.evaluate(name => ({ frames: window.perfFrames.filter(frame => frame.phase === name), longTasks: window.perfLongTasks.filter(task => task.phase === name) }), name)
      phases.push({ name, elapsedMs, metrics: Object.fromEntries(metricNames.map(key => [key, (after[key] - before[key]) * (key.endsWith('Duration') ? 1000 : 1)])),
        frames: frameSummary(captured.frames, budget), longTasks: captured.longTasks, rawFrames: captured.frames })
    }
    for (let repeat = 0; repeat < repeats; repeat++) {
      await page.evaluate(() => { document.querySelector('.playlist-panel').scrollTop = 0 })
      await page.mouse.move(initial.point.x, initial.point.y)
      await page.mouse.down()
      await phase('drag-' + repeat, async () => {
        for (let step = 1; step <= 24; step++) { await page.mouse.move(initial.point.x, initial.point.y + step * (400 / 24)); await page.waitForTimeout(16) }
      })
      await phase('rebound-' + repeat, async () => { await page.mouse.up(); await page.waitForTimeout(650) })
      await page.mouse.move(initial.point.x, initial.point.y)
      await phase('wheel-' + repeat, async () => {
        for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40) }
        await page.waitForTimeout(650)
      })
      await page.waitForFunction(() => document.querySelector('.playlist-panel').getAnimations({ subtree: true }).length === 0)
      const final = await page.evaluate(() => { const p = document.querySelector('.playlist-panel'); return { scrollHeight: p.scrollHeight, scrollTop: p.scrollTop, offset: Number.parseFloat(getComputedStyle(p).getPropertyValue('--playlist-overscroll-offset')) || 0, actions: window.actions } })
      assert.equal(final.scrollHeight, initial.scrollHeight, 'benchmark preserves native scroll range')
      assert.equal(final.scrollTop, 0)
      assert(Math.abs(final.offset) < .1)
      assert.deepEqual(final.actions, [], 'profiling gesture never activates playback')
    }
    const trace = await stopTrace(cdp, tracePath, count)
    await page.evaluate(() => { window.perfCapture = false })
    assert.deepEqual(errors, [])
    const result = { count, rate, budgetMs: budget, idle: frameSummary(idle, budget), initial, phases, trace, tracePath }
    report.results.push(result)
    writeFileSync(join(artifactDir, label + '.json'), JSON.stringify(report, null, 2))
    console.log('PERF_CASE', JSON.stringify({ count, rate, budgetMs: budget, phases: phases.map(({ name, metrics, frames }) => ({ name, metrics, frames })), trace, tracePath }))
    await page.close()
  }
  console.log('PERF_COMPLETE', join(artifactDir, label + '.json'))
} finally { await browser.close() }
