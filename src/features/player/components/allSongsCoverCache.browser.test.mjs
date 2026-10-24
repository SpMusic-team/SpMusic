// Run against Vite with SPMUSIC_PLAYWRIGHT pointing to the installed Playwright.
// Uses the real hook, image codec, decoder, and shared scheduler. Only the native
// transport is replaced; IntersectionObserver and scrolling use the browser.
// Optional before/after evidence: set SPMUSIC_COVER_CACHE_BASELINE_REF to a
// pre-fix revision. Default regressions always use the current working source.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const hookPath = 'src/features/player/hooks/useAllSongsWindow.ts'
const current = readFileSync(hookPath, 'utf8')
const baselineRef = process.env.SPMUSIC_COVER_CACHE_BASELINE_REF
const before = baselineRef ? execFileSync('git', ['show', baselineRef + ':' + hookPath], { encoding: 'utf8' }) : null
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/import \{([^}]+)\} from 'react';?/, (_, names) => `import React from 'react'; const {${names}}=React;`).replaceAll("from 'react'", `from '${dependency('react.js')}'`)
  .replace(/from '(@\/[^']+)'/g, (_, path) => `from '/src/${path.slice(2)}.ts'`)
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,
    'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
assert(service.includes('window.backendInvoke'))
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
const {createRoot}=ReactDOM;
import {createAllSongsCoverStore,disposeAllSongsCoverStore,useAllSongsWindow,useAllSongsCoverUrl} from '/__cover_cache_hook.js';
window.events={created:[],revoked:[],probes:[],pixels:[],active:0,maxActive:0};window.desired=new Set();window.hold=false;window.release=[];window.fail=new Set();
const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=create(blob);window.events.created.push(url);return url};
URL.revokeObjectURL=url=>{window.events.revoked.push(url);return revoke(url)};
const Observer=window.IntersectionObserver;
window.IntersectionObserver=class extends Observer{constructor(callback,options){super((entries,observer)=>{for(const e of entries){const key=e.target.dataset.songKey;if(e.isIntersecting)window.desired.add(key);else window.desired.delete(key)}callback(entries,observer)},options)}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_cover'){
  window.events.probes.push(input.path);
  if(window.fail.has(input.path))throw Error('fixture artwork read failed');
  return {id:input.path.split('/').at(-1),sourcePath:input.path,coverArt:{mimeType:'image/png',filePath:input.path+'.png',dataUrl:null,byteLen:44}};
 }
 if(command==='audio_load_track_thumbnail'){
  window.events.probes.push(input.sourcePath);
  if(window.fail.has(input.sourcePath))throw Error('fixture artwork read failed');
 }
 if(command==='audio_load_playlist_cover_pixels'||command==='audio_load_track_thumbnail'){
  window.events.pixels.push(input);window.events.active++;window.events.maxActive=Math.max(window.events.maxActive,window.events.active);
  if(window.hold)await new Promise(resolve=>window.release.push(resolve));
  const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);bytes.set([83,80,88,82]);view.setUint16(4,1,true);view.setUint16(6,40,true);
  view.setUint32(8,1,true);view.setUint32(12,1,true);view.setUint32(16,4,true);view.setUint32(20,1,true);view.setUint32(24,4,true);view.setUint32(32,1,true);view.setUint32(36,1,true);bytes.set([255,0,0,255],40);
  window.events.active--;return bytes;
 }
 throw Error('Unexpected native command '+command);
};
window.store=createAllSongsCoverStore();
window.items=Array.from({length:220},(_,i)=>({key:'/audio/'+i+'.flac',sourcePath:'/audio/'+i+'.flac',trackId:i+'.flac',scope:'folder',available:true,track:{title:'Song '+i}}));
function Card({item}){const url=useAllSongsCoverUrl(window.store,item.key,item.trackId,item.sourcePath);return React.createElement('div',{'data-song-key':item.key,className:'card'},url?React.createElement('img',{src:url}):null,item.track.title)}
function App(){const panel=React.useRef(null),list=React.useRef(null);useAllSongsWindow(window.items,panel,list,true,false,window.store);return React.createElement('section',{id:'panel',ref:panel},React.createElement('div',{id:'list',ref:list},window.items.map(item=>React.createElement(Card,{item,key:item.key}))))}
window.root=createRoot(document.getElementById('root'));window.root.render(React.createElement(App));
window.dispose=()=>{window.root.unmount();disposeAllSongsCoverStore(window.store)};
`
const html = `<html><head><style>body{margin:0}#panel{height:600px;width:900px;overflow:auto}#list{display:grid;grid-template-columns:repeat(11,80px)}.card{height:64px;font-size:10px}img{width:40px;height:40px}</style></head><body><div id="root"></div><script type="module" src="/__cover_cache_fixture.js"></script></body></html>`
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
async function open(source) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({ contentType: 'text/javascript', body: service }))
  await page.route('**/__cover_cache_hook.js', route => route.fulfill({ contentType: 'text/javascript', body: compile(source) }))
  await page.route('**/__cover_cache_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__cover_cache_test', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__cover_cache_test')
  await page.waitForFunction(() => window.desired?.size > 60).catch(async error => { console.error('fixture startup', errors, await page.locator('body').innerText()); throw error })
  return { page, errors }
}
async function settled(page) {
  await page.waitForFunction(() => window.desired.size > 0 && [...window.desired].every(key => window.store.cache.has(key) || window.fail.has(key)) && window.events.active === 0)
  await page.waitForFunction(() => [...document.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0))
}
async function evidence(page) {
  return page.evaluate(() => ({ demand:window.desired.size,cache:window.store.cache.size,probes:window.events.probes.length,pixels:window.events.pixels.length,
    uniqueProbes:new Set(window.events.probes).size,created:window.events.created.length,revoked:window.events.revoked.length,missing:[...window.desired].filter(key=>!window.store.cache.has(key)),
    revokedDesired:[...window.desired].filter(key=>window.events.revoked.includes(window.store.cache.get(key)?.coverUrl)),maxActive:window.events.maxActive }))
}
try {
  // The same real-browser demand and fixed successful native responses establish
  // whether cache eviction itself causes rereads, independent of disk/network.
  if (before) {
    const { page, errors } = await open(before)
    await page.waitForFunction(() => window.events.probes.length > window.desired.size + 30)
    const baseline = await evidence(page)
    assert(baseline.demand > 60 && baseline.missing.length > 0 && baseline.revoked > 0)
    assert(baseline.probes > baseline.uniqueProbes, 'successful native responses are reread without scrolling')
    console.log('BASELINE_CACHE_CHURN', JSON.stringify(baseline))
    assert.deepEqual(errors, [])
    await page.close()
  }
  {
    const { page, errors } = await open(current)
    await settled(page)
    const initial = await evidence(page)
    assert(initial.demand > 60)
    assert.equal(initial.cache, initial.demand, 'all desired rows remain resident beyond sixty')
    const urls = await page.evaluate(() => Object.fromEntries([...window.store.cache].map(([key,row])=>[key,row.coverUrl])))
    await page.waitForTimeout(500)
    assert.equal((await evidence(page)).probes, initial.probes, 'stationary large demand stops issuing cover reads')
    assert.deepEqual((await evidence(page)).missing, [])
    await page.locator('#panel').evaluate(node => { node.scrollTop = 500 })
    await page.waitForFunction(() => window.desired.has('/audio/180.flac'))
    await settled(page)
    const scrolled = await evidence(page)
    assert(scrolled.cache <= Math.max(60, scrolled.demand), 'cache obeys demand-aware bound after scroll')
    assert.deepEqual(scrolled.missing, [])
    assert.deepEqual(scrolled.revokedDesired, [])
    const overlap = await page.evaluate(urls => [...window.desired].filter(key=>urls[key]).map(key=>({key,before:urls[key],after:window.store.cache.get(key)?.coverUrl})), urls)
    assert(overlap.length > 0)
    assert(overlap.every(row => row.before === row.after), 'overlapping desired artwork keeps its decoded URL')
    const reads = scrolled.probes
    await page.waitForTimeout(500)
    assert.equal((await evidence(page)).probes, reads, 'scroll settle also stops rereads')
    await page.locator('#panel').evaluate(node => { node.style.height = '100px'; node.scrollTop = 1180 })
    await page.waitForFunction(() => window.desired.size < 60 && window.desired.size > 0)
    await settled(page)
    const shrunk = await evidence(page)
    assert.equal(shrunk.cache, 60, 'shrinking demand evicts offscreen overflow back to normal retention limit')
    assert.deepEqual(shrunk.missing, [])
    assert.deepEqual(shrunk.revokedDesired, [])
    assert.equal(shrunk.maxActive, 1, 'shared scheduler admits one native pixel request')
    assert(await page.evaluate(() => window.events.pixels.every(input=>input.maxEdge===256)))
    await page.evaluate(() => window.dispose())
    const disposed = await evidence(page)
    assert.equal(disposed.cache, 0)
    assert.equal(disposed.created, disposed.revoked, 'eviction plus disposal releases every created object URL')
    assert.deepEqual(errors, [])
    console.log('CURRENT_CACHE_STABLE', JSON.stringify({ initial, scrolled, shrunk, disposed, overlappingUrls: overlap.length }))
    await page.close()
  }
  {
    const { page, errors } = await open(current)
    await settled(page)
    await page.evaluate(() => {window.hold=true;document.querySelector('#panel').scrollTop=650})
    await page.waitForFunction(() => window.release.length === 1)
    const created = await page.evaluate(() => window.events.created.length)
    await page.evaluate(() => {window.dispose();window.hold=false;window.release.splice(0).forEach(resolve=>resolve())})
    await page.waitForFunction(() => window.events.active === 0)
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.events.created.length), created, 'in-flight pixels after unmount create no orphan URL')
    assert.equal(await page.evaluate(() => window.store.cache.size), 0)
    assert.equal(await page.evaluate(() => window.events.created.length), await page.evaluate(() => window.events.revoked.length))
    assert.deepEqual(errors, [])
    await page.close()
    console.log('CURRENT_UNMOUNT_CLEAN')
  }
  console.log('ALL_SONGS_COVER_CACHE_PASS')
} finally { await browser.close() }


