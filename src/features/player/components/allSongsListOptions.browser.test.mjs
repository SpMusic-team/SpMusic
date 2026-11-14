// Run against Vite with SPMUSIC_PLAYWRIGHT pointing to an existing Playwright package.
// Uses the real surface, collection, dialogs, cards and layout hook; only parent data is deterministic.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, statSync } from 'node:fs'
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
const definitions=[['c','Charlie','Zulu','Blue',2004,240,'b'],['a','Alpha','Yankee','Red',2001,180,'d'],['d','Delta','Whiskey','Green',2003,60,'a'],['b','Bravo','Xray','Amber',2002,120,'c']];
const initialSongs=definitions.map(([id,title,artist,album,year,duration,file])=>({key:'/music/'+file+'.flac',sourcePath:'/music/'+file+'.flac',scope:'source-A',trackId:id,available:true,fileCreatedAtMs:year,
 track:{id,title,artist,album,durationSeconds:duration,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false,lyrics:[],libraryYear:year,libraryAlbumName:album,libraryArtistName:artist,audioFormat:{bitDepth:24,sampleRateHz:96000,codec:'FLAC',bitrateKbps:null}}}));
window.calls=[];
function Fixture(){
 const [route,setRoute]=React.useState({view:'category',categoryId:'songs'}),[open,setOpen]=React.useState(true),[songs,setSongs]=React.useState(new URLSearchParams(location.search).has('empty')?[]:initialSongs),[counts,setCounts]=React.useState(new Map([['/music/b.flac',2],['/music/d.flac',4],['/music/a.flac',1],['/music/c.flac',3]]));
 window.navigate=setRoute;window.setSongs=setSongs;window.setCounts=setCounts;window.republish=()=>setSongs(previous=>previous.map(item=>({...item,artworkRevision:(item.artworkRevision??0)+1})));
 const tracks=songs.map(item=>item.track);
 const library={route,isOpen:route.view!=='tracks',currentScope:'source-A',activeScope:'source-A',items:[{scope:'source-A',name:'Source A',trackCount:4,sourceKind:'m3u8'}],allSongs:songs,recentSongs:[...songs].reverse(),allSongsMetadataStatus:'ready',
 mostPlayedCounts:counts,
 onOpenOverview:()=>setRoute({view:'overview'}),onSelectCategory:categoryId=>setRoute({view:'category',categoryId}),onOpen:()=>setRoute({view:'category',categoryId:'playlists'}),onSelect:()=>setRoute({view:'tracks'}),
 onPlay:scope=>window.calls.push({type:'source-play',scope}),onPlaySong:(scope,id,ordered)=>window.calls.push({type:'song-play',scope,id,ordered}),
 onShufflePlay:async ordered=>{window.calls.push({type:'shuffle',ordered});return true},
 onSelectFolders:()=>window.calls.push({type:'folders'}),onImportPlaylist:()=>window.calls.push({type:'import'}),onCreatePlaylist:()=>null,onAddToQueue:snapshot=>{window.calls.push({type:'queue',snapshot});return true},
 onReorderSongs:async request=>{window.calls.push({type:'reorder',request});return {ok:true}}};
 const viewModel={playback:{track:tracks[0],contentState:tracks.length?'track':'empty',isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop},
 timeline:{positionSeconds:0,durationSeconds:240,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop},volume:{valuePercent:50,isBusy:false,isDisabled:false,onChange:noop},queue:{tracks,isOpen:false,onToggle:noop},
 playlist:{isOpen:open,onOpenChange:setOpen,tracks,playlistName:'Source A',currentTrackId:'c',shuffleMode:'none',isOpenAudioDisabled:false,onShuffleCycle:noop,onOpenAudio:noop,onTrackSelect:noop,library},feedback:{onToggle:noop,ratingsByTrackId:{a:4,b:2,c:3,d:1}}};
 window.viewModel=viewModel;return React.createElement(PlayerSurface,{viewModel});
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(Fixture))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__all_songs_options_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const screenshotDir = process.env.SPMUSIC_TEST_SCREENSHOTS || join(tmpdir(), 'spmusic-all-songs-list-options')
mkdirSync(screenshotDir, { recursive: true })
for (const file of ['settings', 'radio-empty', 'radio-selected', 'checkbox']) {
  assert(statSync(new URL('../../../assets/all-songs-list-options/' + file + '.svg', import.meta.url)).size > 0, 'local design asset is nonempty: ' + file)
}
const panel = page => page.locator('.playlist-management:not([inert])')
const trigger = page => panel(page).getByRole('button', { name: '更多列表操作', exact: true }).first()
const options = page => page.getByRole('dialog', { name: '列表选项：所有歌曲', exact: true })
const keys = page => panel(page).locator('.all-songs-list [data-song-key]').evaluateAll(nodes => nodes.map(node => node.dataset.songKey))
const expectedKeys = files => files.map(file => '/music/' + file + '.flac')
let passed = 0
async function open({ width = 1280, height = 900, empty = false, motion = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: motion ? 'no-preference' : 'reduce' })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/__all_songs_options_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__all_songs_options_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__all_songs_options_test' + (empty ? '?empty' : ''))
  await panel(page).waitFor()
  await page.evaluate(() => document.fonts.ready)
  return { page, errors }
}
async function openOptions(page) {
  await trigger(page).click()
  const menu = page.getByRole('dialog', { name: '所有歌曲', exact: true })
  await menu.getByRole('button', { name: '列表选项', exact: true }).click()
  await options(page).waitFor()
  await menu.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('dialog').count(), 1, 'menu hands over to one active dialog')
}
async function closeOptions(page, mode = 'button') {
  if (mode === 'escape') await page.keyboard.press('Escape')
  else if (mode === 'outside') await page.mouse.click(4, 4)
  else await options(page).getByRole('button', { name: '关闭', exact: true }).click()
  await options(page).waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '更多列表操作')
}
async function check(name, run, settings) {
  if (process.env.SPMUSIC_TEST_FILTER && !name.includes(process.env.SPMUSIC_TEST_FILTER)) return
  const { page, errors } = await open(settings)
  try {
    await run(page)
    assert.deepEqual(errors, [], 'no unhandled browser errors')
    console.log('PASS', name)
    passed++
  } catch (error) {
    if (await options(page).count()) console.log('AX', await options(page).ariaSnapshot())
    console.log('FAIL_STATE', JSON.stringify({ errors, ...await page.evaluate(() => ({ text: document.body.innerText.slice(0, 2400), focus: { tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute('role'), class: document.activeElement?.className }, checkboxes: [...document.querySelectorAll('[data-slot="checkbox"]')].map(node => {const ancestors=[];for(let a=node;a;a=a.parentElement)ancestors.push({tag:a.tagName,hidden:a.hidden,ariaHidden:a.getAttribute('aria-hidden'),inert:a.inert,visibility:getComputedStyle(a).visibility,display:getComputedStyle(a).display});return {role:node.getAttribute('role'),label:node.getAttribute('aria-label'),ancestors}}), calls: window.calls })) }))
    await page.screenshot({ path: join(screenshotDir, 'failure.png') })
    throw error
  } finally { await page.close() }
}

try {
  await check('bottom overlay transfer, scroll, assets, focus and dismiss', async page => {
    for (const mode of ['button', 'escape', 'outside']) {
      await openOptions(page)
      const geometry = await options(page).evaluate(node => {
        const rect = node.getBoundingClientRect()
        const scrolls = [...node.querySelectorAll('*')].filter(child => child.scrollHeight > child.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(child).overflowY))
        return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom, viewport: innerHeight, scrolls: scrolls.length,
          titleSize: getComputedStyle(node.querySelector('[data-slot="dialog-title"]')).fontSize,
          focusInside: node.contains(document.activeElement), images: [...node.querySelectorAll('img')].map(image => ({ loaded: image.complete && image.naturalWidth > 0, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height })) }
      })
      assert(geometry.bottom <= geometry.viewport && geometry.bottom > geometry.viewport - 80, 'dialog is anchored near viewport bottom')
      assert.equal(geometry.width, 615, 'design dialog width')
      assert.equal(geometry.height, 659, 'design dialog height')
      assert.equal(geometry.scrolls, 1, 'one inner content scroller')
      assert.equal(geometry.titleSize, '32px', 'design title typography')
      assert(geometry.focusInside, 'new dialog owns focus')
      assert(geometry.images.length > 0 && geometry.images.every(image => image.loaded && image.width > 0 && image.height > 0), 'all static images load with nonempty geometry')
      assert.deepEqual([geometry.images[0].width, geometry.images[0].height], [32, 32], 'header settings keeps design geometry')
      assert(geometry.images.slice(1).every(image => image.width === 24 && image.height === 24), 'radio and checkbox assets keep design geometry')
      if (mode === 'button') await options(page).screenshot({ path: join(screenshotDir, 'options-initial.png') })
      for (let i = 0; i < 35; i++) { await page.keyboard.press('Tab'); await page.waitForFunction(() => document.querySelector('.all-songs-options-dialog')?.contains(document.activeElement), null, { timeout: 1000 }) }
      await options(page).getByRole('radio', { name: '网格', exact: true }).scrollIntoViewIfNeeded()
      await options(page).screenshot({ path: join(screenshotDir, 'options-layout.png') })
      await closeOptions(page, mode)
    }
  })
  await check('sort changes rendered and playback order, reverse and metadata updates', async page => {
    assert.deepEqual(await keys(page), expectedKeys(['d', 'c', 'b', 'a']), 'default title order')
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据文件名', exact: true }).click()
    await closeOptions(page)
    assert.deepEqual(await keys(page), expectedKeys(['a', 'b', 'c', 'd']))
    await panel(page).getByRole('button', { name: '播放所有歌曲', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1).ordered.map(item => item.trackId)), ['d', 'c', 'b', 'a'], 'playback consumes selected sort')
    await openOptions(page)
    await options(page).getByRole('checkbox', { name: '倒序', exact: true }).click()
    await closeOptions(page)
    assert.deepEqual(await keys(page), expectedKeys(['d', 'c', 'b', 'a']))
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据持续时间', exact: true }).click()
    await closeOptions(page)
    assert.deepEqual(await keys(page), expectedKeys(['b', 'd', 'c', 'a']), 'duration descending')
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据随机顺序', exact: true }).click()
    await closeOptions(page)
    const shuffled = await keys(page)
    assert.deepEqual([...shuffled].sort(), expectedKeys(['a', 'b', 'c', 'd']))
    await page.evaluate(() => window.republish())
    assert.deepEqual(await keys(page), shuffled, 'visual republication preserves random order')
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.type === 'reorder').length), 0, 'display sort never writes manual order')
  })
  await check('supported fields, unavailable data, quick index and selection preserve order', async page => {
    const cases = [['根据艺术家', ['a', 'c', 'd', 'b']], ['根据专辑', ['c', 'b', 'a', 'd']], ['根据年份', ['d', 'c', 'a', 'b']], ['根据年份/专辑', ['d', 'c', 'a', 'b']], ['根据星级', ['a', 'c', 'b', 'd']], ['根据播放次数', ['a', 'b', 'c', 'd']], ['根据路径', ['a', 'b', 'c', 'd']]]
    for (const [label, files] of cases) {
      await openOptions(page)
      await options(page).getByRole('radio', { name: label, exact: true }).click()
      await closeOptions(page)
      assert.deepEqual(await keys(page), expectedKeys(files), label)
      assert.equal(await panel(page).locator('.playlist-management-quick-index:visible').count(), 0, 'non-title order hides alphabetical navigation')
    }
    await openOptions(page)
    for (const label of ['根据碟片和音轨号', '根据添加到媒体库的日期', '根据添加/修改日期', '根据最后播放的时间']) {
      assert(await options(page).getByRole('radio', { name: label, exact: true }).isDisabled(), label + ' honestly unavailable')
    }
    assert.match(await options(page).innerText(), /尚无.*数据/)
    await closeOptions(page)
    await panel(page).getByRole('button', { name: '选择', exact: true }).first().click()
    await page.locator('.playlist-selection-panel').getByRole('button', { name: '全选', exact: true }).click()
    await page.locator('.playlist-selection-panel').getByRole('button', { name: '选择帮助', exact: true }).click()
    await page.getByRole('dialog', { name: '选择帮助', exact: true }).getByRole('button', { name: '播放选中', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1).ordered.map(item => item.trackId)), ['d', 'c', 'b', 'a'], 'selected playback follows sorted visible list')
    await page.locator('.playlist-selection-panel').getByRole('button', { name: '退出选择', exact: true }).click()
    await openOptions(page)
    await closeOptions(page)
  })
  await check('ten views, wheel synchronization, storage isolation and title-only output', async page => {
    const labels = ['网格-紧凑一行', '紧凑单行', '单行', '列表-不显示图像', '列表-极小', '列表-小', '列表', '网格-极小', '网格-小', '网格']
    for (const [index, label] of labels.entries()) {
      await openOptions(page)
      const radio = options(page).getByRole('radio', { name: label, exact: true })
      await radio.click()
      assert(await radio.isChecked(), 'view is selected: ' + label)
      await closeOptions(page)
      assert.equal(await page.locator('.all-songs-list').getAttribute('data-layout-level'), String(9 - index), 'menu uses existing layout levels')
      assert.equal(await page.evaluate(() => localStorage.getItem('spmusic.all-songs.layout-level.v1')), String(9 - index))
      assert.equal(await page.evaluate(() => localStorage.getItem('spmusic.playlist.layout-level.v1')), null, 'detail layout preference stays separate')
    }
    await page.keyboard.down('Control')
    await page.locator('.all-songs-list').dispatchEvent('wheel', { ctrlKey: true, deltaY: 40, bubbles: true, cancelable: true })
    await page.keyboard.up('Control')
    await page.waitForFunction(() => document.querySelector('.all-songs-list')?.dataset.layoutLevel === '1')
    await openOptions(page)
    assert(await options(page).getByRole('radio', { name: '网格-小', exact: true }).isChecked(), 'wheel is reflected in view radio')
    await options(page).getByRole('radio', { name: '列表-小', exact: true }).click()
    await options(page).getByRole('checkbox', { name: '仅显示标题', exact: true }).click()
    await closeOptions(page)
    const metadata = await page.locator('.all-songs-list').evaluate(node => [...node.querySelectorAll('.playlist-card-artist,.playlist-card-format')].map(child => getComputedStyle(child).display))
    assert(metadata.length > 0 && metadata.every(display => display === 'none'), 'only-title actually hides artist/album/format')
    assert.equal(await page.locator('.all-songs-list .playlist-card-title:visible').count(), 4)
    await page.locator('.all-songs-list').screenshot({ path: join(screenshotDir, 'songs-title-only.png') })
    await openOptions(page)
    assert(await options(page).getByRole('checkbox', { name: '仅显示标题', exact: true }).isChecked())
    await options(page).getByRole('checkbox', { name: '仅显示标题', exact: true }).click()
    await closeOptions(page)
    assert(await page.locator('.all-songs-list .playlist-card-artist').first().isVisible(), 'turning title-only off restores metadata')
  })
  await check('play-count snapshot remains stable while playback counts advance', async page => {
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据播放次数', exact: true }).click()
    await closeOptions(page)
    assert.deepEqual(await keys(page), expectedKeys(['a', 'b', 'c', 'd']))
    await page.evaluate(() => window.setCounts(new Map([['/music/a.flac',4],['/music/b.flac',3],['/music/c.flac',2],['/music/d.flac',1]])))
    await page.waitForFunction(() => window.viewModel.playlist.library.mostPlayedCounts.get('/music/a.flac') === 4)
    assert.deepEqual(await keys(page), expectedKeys(['a', 'b', 'c', 'd']), 'playing a song does not destabilize current count ordering')
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据标题', exact: true }).click()
    await options(page).getByRole('radio', { name: '根据播放次数', exact: true }).click()
    await closeOptions(page)
    assert.deepEqual(await keys(page), expectedKeys(['d', 'c', 'b', 'a']), 'reselecting count mode takes a fresh snapshot')
  })
  await check('compact controller retains original menu entries and import actions', async page => {
    await page.evaluate(() => window.setSongs(previous => Array.from({ length: 100 }, (_, index) => ({ ...previous[0], key: '/many/' + index + '.flac', sourcePath: '/many/' + index + '.flac', trackId: 'many-' + index, track: { ...previous[0].track, id: 'many-' + index, title: 'Song ' + String(index).padStart(3, '0') } }))))
    const content = panel(page).locator('.playlist-management-content')
    await content.evaluate(node => { node.scrollTop = 600 })
    await page.waitForFunction(() => document.querySelector('.playlist-management:not([inert]) .playlist-controller-actions')?.dataset.actionsVisible === 'true')
    await content.evaluate(node => { node.scrollTop = 580 })
    const more = panel(page).locator('.playlist-controller-actions').getByRole('button', { name: '更多列表操作', exact: true })
    const show = async () => {
      await content.evaluate(node => { node.scrollTop = 600 })
      await page.waitForFunction(() => document.querySelector('.playlist-management:not([inert]) .playlist-controller-actions')?.dataset.actionsVisible === 'true')
      await content.evaluate(node => { node.scrollTop = 580 })
      await more.click()
      await page.getByRole('menuitem', { name: '选择文件夹', exact: true }).waitFor()
    }
    await show()
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['选择文件夹', '导入 M3U8 播放列表', '选择全部可见歌曲', '新建播放列表'])
    await page.getByRole('menuitem', { name: '选择文件夹', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).type), 'folders')
    await show()
    await page.getByRole('menuitem', { name: '导入 M3U8 播放列表', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).type), 'import')
    await show()
    await page.getByRole('menuitem', { name: '选择全部可见歌曲', exact: true }).click()
    await page.getByRole('status', { name: '已选 100 项，共 100 项', exact: true }).waitFor()
    assert.equal(await options(page).count(), 0, 'compact controls retain their original contract')
  })
  await check('category isolation, repeated transfer and route cleanup', async page => {
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据持续时间', exact: true }).click()
    await closeOptions(page)
    await page.evaluate(() => window.navigate({ view: 'category', categoryId: 'recent-played' }))
    await page.waitForFunction(() => window.viewModel.playlist.library.route.categoryId === 'recent-played')
    assert.deepEqual(await keys(page), expectedKeys(['c', 'a', 'd', 'b']), 'recent category retains supplied chronological order')
    await trigger(page).click()
    await page.getByRole('dialog', { name: '最近播放', exact: true }).getByRole('button', { name: '列表选项', exact: true }).click()
    assert.equal(await options(page).count(), 0, 'all-songs dialog does not override another category')
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.navigate({ view: 'category', categoryId: 'songs' }))
    for (let index = 0; index < 4; index++) { await openOptions(page); await closeOptions(page, 'escape') }
    await openOptions(page)
    await page.evaluate(() => window.navigate({ view: 'overview' }))
    await options(page).waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('dialog').count(), 0, 'navigation retires stale options')
  }, { motion: true })
  for (const size of [{ width: 360, height: 420 }, { width: 640, height: 1440 }]) {
    await check('responsive empty collection ' + size.width, async page => {
      await openOptions(page)
      const bounds = await options(page).boundingBox()
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width + .5 && bounds.y + bounds.height <= size.height + .5, 'dialog stays in viewport')
      await options(page).getByRole('radio', { name: '网格', exact: true }).scrollIntoViewIfNeeded()
      await options(page).getByRole('radio', { name: '网格', exact: true }).click()
      const close = options(page).getByRole('button', { name: '关闭', exact: true })
      const closeBounds = await close.boundingBox()
      assert(closeBounds.y >= bounds.y && closeBounds.y + closeBounds.height <= bounds.y + bounds.height + .5, 'close stays reachable after scrolling')
      await options(page).screenshot({ path: join(screenshotDir, 'options-empty-' + size.width + '.png') })
      await closeOptions(page)
    }, { ...size, empty: true })
  }
} finally {
  await browser.close()
}
console.log('ALL_SONGS_LIST_OPTIONS_PASS', passed, 'screenshots', screenshotDir)
