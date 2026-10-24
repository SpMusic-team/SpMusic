// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright installation.
// Real PlayerSurface, library/detail pages, dock, settings, and motion hooks;
// deterministic parent data isolates page motion and callback ownership.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve Vite dependency ' + name)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerSurface} from '/src/features/player/components/PlayerSurface.tsx';
import '/src/index.css';
const noop=()=>{};
const tracks=Array.from({length:100},(_,i)=>({id:'song-'+i,title:'Song '+String(i).padStart(3,'0'),artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false,lyrics:[]}));
const allSongs=tracks.map((track,i)=>({key:'/music/'+i+'.flac',scope:i%2?'source-B':'source-A',trackId:track.id,sourcePath:'/music/'+i+'.flac',track,available:i!==99}));
window.calls=[];
function Fixture(){
 const [route,setRoute]=React.useState({view:'category',categoryId:'songs'}),[open,setOpen]=React.useState(true),[busy,setBusy]=React.useState(false),[metadata,setMetadata]=React.useState('ready');
 window.navigate=setRoute;window.setBusy=setBusy;window.setMetadata=setMetadata;
 const library={route,isOpen:route.view!=='tracks',currentScope:'source-A',activeScope:'source-A',items:[{scope:'source-A',name:'Source A',trackCount:100,sourceKind:'m3u8'}],allSongs,allSongsMetadataStatus:metadata,
 onOpenOverview:()=>setRoute({view:'overview'}),onSelectCategory:categoryId=>setRoute({view:'category',categoryId}),onOpen:()=>setRoute({view:'category',categoryId:'playlists'}),onSelect:()=>setRoute({view:'tracks'}),
 onPlay:scope=>window.calls.push({type:'source-play',scope}),onPlaySong:(scope,id,ordered)=>window.calls.push({type:'song-play',scope,id,ordered}),onShufflePlay:async(ordered)=>{const target=ordered[1]??ordered[0];window.calls.push({type:'song-play',scope:target.scope,id:target.trackId,ordered});return true},
 onSelectFolders:()=>window.calls.push({type:'folders'}),onImportPlaylist:()=>window.calls.push({type:'import'}),onCreatePlaylist:()=>null};
 const viewModel={playback:{track:tracks[0],contentState:'track',isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:busy,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:()=>window.calls.push({type:'shuffle-mode'}),onRepeatCycle:noop},
 timeline:{positionSeconds:45,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop},volume:{valuePercent:50,isBusy:false,isDisabled:false,onChange:noop},queue:{tracks,isOpen:false,onToggle:noop},
 playlist:{isOpen:open,onOpenChange:setOpen,tracks,playlistName:'Source A',currentTrackId:'song-0',shuffleMode:'none',isOpenAudioDisabled:busy,onShuffleCycle:()=>window.calls.push({type:'shuffle-mode'}),onOpenAudio:noop,onTrackSelect:id=>window.calls.push({type:'detail-play',id}),library},feedback:{onToggle:noop}};
 window.viewModel=viewModel;
 return React.createElement(PlayerSurface,{viewModel});
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(Fixture))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__all_songs_controller_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
let passed = 0
const panel = '.playlist-management:not([inert]) .playlist-management-content'
const actions = '.playlist-management:not([inert]) .playlist-controller-actions'
const dock = '.playlist-playback-dock:not([data-dock-superseded])'

async function open({ mode = 'movable', reduced = true, width = 1280 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(mode => {
    localStorage.setItem('spmusic.player.playlist-controller-mode.v1', mode)
    localStorage.setItem('spmusic.all-songs.layout-level.v1', '7')
    localStorage.setItem('spmusic.playlist.layout-level.v1', '7')
  }, mode)
  await page.route('**/__all_songs_controller_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__all_songs_controller_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__all_songs_controller_test')
  await page.locator(panel).waitFor()
  await page.locator(dock).waitFor()
  return { page, errors }
}
async function check(name, run, options) {
  if (process.env.SPMUSIC_TEST_FILTER && !name.includes(process.env.SPMUSIC_TEST_FILTER)) return
  const { page, errors } = await open(options)
  try {
    await run(page)
    assert.deepEqual(errors, [], 'no unhandled browser/React errors')
    passed++
    console.log('PASS', name)
  } catch (error) {
    console.log('FAIL_STATE', JSON.stringify({ errors, ...await page.evaluate(() => ({ route: window.viewModel?.playlist.library.route, calls: window.calls, actions: [...document.querySelectorAll('.playlist-controller-actions')].map(node => ({ ...node.dataset, inert: node.inert })), docks: document.querySelectorAll('.playlist-playback-dock').length, text: document.body.innerText.slice(0, 800) })) }))
    throw error
  } finally { await page.close() }
}
async function scroll(page, top) {
  await page.locator(panel).evaluate((node, top) => { node.scrollTop = top }, top)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function compact(page, visible) {
  await page.waitForFunction(({ actions, visible }) => {
    const node = document.querySelector(actions)
    return node && node.dataset.actionsVisible === String(visible) && Math.abs(Number(getComputedStyle(node).opacity) - (visible ? 1 : 0)) < .001
  }, { actions, visible })
}
async function offset(page, hidden) {
  await page.waitForFunction(({ dock, hidden }) => {
    const node = document.querySelector(dock), style = getComputedStyle(node)
    const y = node.getBoundingClientRect().top - (innerHeight - node.offsetHeight - parseFloat(style.bottom))
    return Math.abs(y - (hidden ? node.offsetHeight + parseFloat(style.bottom) : 0)) < .5
  }, { dock, hidden })
}
async function showCompact(page) {
  await scroll(page, 600)
  await compact(page, true)
  // Upward scrolling reveals the movable dock without returning the toolbar.
  await scroll(page, 580)
  await offset(page, false)
}
async function assertSameDock(page) {
  assert.equal(await page.locator('.playlist-playback-dock').count(), 1)
  assert.equal(await page.locator(dock).evaluate(node => node === window.originalDock), true, 'library navigation retains the same dock DOM instance')
}

try {
  await check('toolbar threshold, shared downward motion, reverse and hidden focus', async page => {
    await compact(page, false)
    await offset(page, false)
    assert.equal(await page.locator(actions).evaluate(node => node.inert), true)
    await page.locator(panel).evaluate(node => {
      const toolbar = node.querySelector('.playlist-management-toolbar')
      node.scrollTop += toolbar.getBoundingClientRect().bottom - node.getBoundingClientRect().top - 1
    })
    await compact(page, false)
    await scroll(page, 600)
    await compact(page, true)
    await offset(page, true)
    assert.equal(await page.locator(dock).evaluate(node => node.inert), true)
    await page.locator(dock + ' .playlist-playback-toggle').evaluate(node => node.focus())
    assert.equal(await page.locator(dock).evaluate(node => node.contains(document.activeElement)), false)
    await page.keyboard.press('Control+f')
    const search = page.getByRole('searchbox', { name: '搜索歌曲标题、艺术家或专辑' })
    await search.waitFor()
    await offset(page, false)
    await search.press('Escape')
    await scroll(page, 620)
    await offset(page, true)
    await scroll(page, 580)
    await offset(page, false)
    const geometry = await page.evaluate(({ dock, actions }) => {
      const d = document.querySelector(dock).getBoundingClientRect(), a = document.querySelector(actions).getBoundingClientRect()
      return { gap: d.top - a.bottom, opacity: Number(getComputedStyle(document.querySelector(dock)).opacity) }
    }, { dock, actions })
    assert.equal(geometry.gap, 12, 'compact actions preserve the playlist dock gap')
    assert.equal(geometry.opacity, 1)
    await scroll(page, 0)
    await compact(page, false)
    await offset(page, false)
  })

  await check('fixed mode, current-page play, search, select and more semantics', async page => {
    await showCompact(page)
    const screenshot = process.env.SPMUSIC_SCREENSHOT_PATH || join(tmpdir(), 'spmusic-all-songs-controller.png')
    await page.screenshot({ path: screenshot })
    console.log('ALL_SONGS_CONTROLLER_SCREENSHOT', screenshot)
    const row = page.locator(actions)
    assert.equal(await row.locator('button').count(), 6)
    await row.getByRole('button', { name: '播放', exact: true }).click()
    const firstPlay = await page.evaluate(() => window.calls.at(-1))
    assert.equal(firstPlay.scope, 'source-A')
    assert.equal(firstPlay.id, 'song-0')
    assert.equal(firstPlay.ordered.length, 99, 'play uses the current playable aggregate, excluding unavailable songs')
    await row.getByRole('button', { name: '随机播放全部歌曲', exact: true }).click()
    const random = await page.evaluate(() => window.calls.at(-1))
    assert.equal(random.type, 'song-play')
    assert.notEqual(random.id, 'song-99', 'unavailable song is never a random candidate')
    assert.equal(await page.evaluate(() => window.calls.some(call => call.type === 'shuffle-mode' || call.type === 'source-play')), false)
    await row.getByRole('button', { name: '更多列表操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '选择文件夹', exact: true }).waitFor()
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['选择文件夹', '导入 M3U8 播放列表', '选择全部可见歌曲', '新建播放列表'])
    await page.getByRole('menuitem', { name: '选择文件夹', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).type), 'folders')
    await row.getByRole('button', { name: '更多列表操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '导入 M3U8 播放列表', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).type), 'import')
    await row.getByRole('button', { name: '更多列表操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '选择全部可见歌曲', exact: true }).click()
    await row.getByRole('button', { name: '更多列表操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '新建播放列表', exact: true }).click()
    await page.getByRole('dialog', { name: '新建播放列表' }).waitFor()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await row.getByRole('button', { name: '完成', exact: true }).click()
    await row.getByRole('button', { name: '搜索', exact: true }).click()
    const search = page.getByRole('searchbox', { name: '搜索歌曲标题、艺术家或专辑' })
    await search.fill('Song 007')
    await page.waitForFunction(() => document.querySelectorAll('.all-songs-list .playlist-card').length === 1)
    await offset(page, false)
    await page.locator('.playlist-management-actions').getByRole('button', { name: '播放所有歌曲', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), { type: 'song-play', scope: 'source-B', id: 'song-7', ordered: [{ scope: 'source-B', trackId: 'song-7' }] })
    await page.locator('.playlist-management-actions').getByRole('button', { name: '选择', exact: true }).click()
    const filtered = page.locator('[data-song-key="/music/7.flac"]')
    await filtered.click()
    await page.locator('.playlist-management-actions').getByRole('button', { name: '播放所有歌曲', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).id), 'song-7')
    await page.evaluate(() => window.setBusy(true))
    const playAll = page.locator('.playlist-management-actions').getByRole('button', { name: '播放所有歌曲', exact: true })
    await page.waitForFunction(() => [...document.querySelectorAll('.playlist-management-actions button')]
      .some(button => button.getAttribute('aria-label') === '播放所有歌曲' && button.disabled))
    assert.equal(await playAll.isDisabled(), true)
    await search.press('Escape')
    await page.getByRole('searchbox').waitFor({ state: 'hidden' })
  }, { mode: 'fixed' })

  await check('dock identity and successor search ownership across retired pages', async page => {
    await page.locator(dock).evaluate(node => { window.originalDock = node })
    await showCompact(page)
    await page.locator(actions).getByRole('button', { name: '返回', exact: true }).click()
    await page.locator('.media-library-overview').waitFor()
    await assertSameDock(page)
    await offset(page, false)
    assert.equal(await page.locator(dock + ' button[aria-label="搜索"]').isDisabled(), true, 'overview clears page search binding')
    for (let index = 0; index < 3; index++) {
      await page.evaluate(() => window.navigate({ view: 'tracks' }))
      await page.locator('.playlist-panel:not([inert])').waitFor()
      await assertSameDock(page)
      await page.locator(dock + ' button[aria-label="搜索"]').click()
      await page.locator('.playlist-filter-input').waitFor()
      await page.evaluate(() => window.navigate({ view: 'category', categoryId: 'songs' }))
      await page.locator(panel).waitFor()
      await page.locator('.playlist-panel').waitFor({ state: 'detached' })
      await assertSameDock(page)
      await page.locator(dock + ' button[aria-label="搜索"]').click()
      await page.getByRole('searchbox', { name: '搜索歌曲标题、艺术家或专辑' }).waitFor()
      assert.equal(await page.locator('.playlist-filter-input').count(), 0, 'dock targets successor search after old detail cleanup')
      await page.getByRole('searchbox').press('Escape')
      await showCompact(page)
    }
    await page.locator(dock + ' .playlist-playback-track-button').click()
    await page.waitForFunction(() => !window.viewModel.playlist.isOpen)
    await page.locator('.cover-collapse-button').first().click()
    await page.waitForFunction(() => window.viewModel.playlist.isOpen)
    await page.locator(panel).waitFor()
    assert.deepEqual(await page.evaluate(() => window.viewModel.playlist.library.route), { view: 'category', categoryId: 'songs' })
  }, { reduced: false })

  await check('normal motion overlap and 320px button bounds', async page => {
    await page.evaluate(({ panel, dock, actions }) => {
      window.motionFrames = [];window.sampleMotion = true
      function sample() {
        const p=document.querySelector(panel), d=document.querySelector(dock), a=document.querySelector(actions)
        if(p&&d&&a){const ds=getComputedStyle(d),as=getComputedStyle(a);window.motionFrames.push({y:d.getBoundingClientRect().top-(innerHeight-d.offsetHeight-parseFloat(ds.bottom)),gap:d.getBoundingClientRect().top-a.getBoundingClientRect().bottom,opacity:Number(as.opacity),travel:d.offsetHeight+parseFloat(ds.bottom)})}
        if(window.sampleMotion)requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }, { panel, dock, actions })
    await scroll(page, 600)
    await offset(page, true)
    await compact(page, true)
    const frames = await page.evaluate(() => { window.sampleMotion=false;return window.motionFrames })
    const overlap = frames.filter(f => f.y > 1 && f.y < f.travel-1 && f.opacity > .01 && f.opacity < .99)
    assert(overlap.length > 0, 'compact fade and dock movement overlap on painted frames')
    assert(frames.every(f => Math.abs(f.gap-12)<.6), 'actions and dock share the same vertical trajectory')
    console.log('ALL_SONGS_MOTION_EVIDENCE', JSON.stringify({ frames:frames.length, overlap:overlap.length }))
    await scroll(page, 580)
    await offset(page, false)
    await page.setViewportSize({ width:320, height:800 })
    await showCompact(page)
    const rects=await page.locator(actions+' button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top}}))
    assert.equal(rects.length,6)
    rects.forEach((r,i)=>{assert(r.left>=0&&r.right<=320);if(i)assert(r.left>=rects[i-1].right)})
  }, { reduced:false })
  console.log('ALL_SONGS_CONTROLLER_RESULT', passed, 'passed')
} finally { await browser.close() }
