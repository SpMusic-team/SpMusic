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
const definitions=[
 {id:'c',title:'Charlie',artist:'Zulu',album:'Blue',year:2004,duration:240,file:'b',disc:2,trackNumber:2,added:100,created:50,modified:400,bitDepth:32},
 {id:'a',title:'Alpha',artist:'Yankee',album:'Red',year:2001,duration:180,file:'d',disc:1,trackNumber:10,added:400,created:null,modified:null,bitDepth:16},
 {id:'d',title:'Delta',artist:'Whiskey',album:'Green',year:2003,duration:60,file:'a',disc:1,trackNumber:2,added:null,created:100,modified:null,bitDepth:24},
 {id:'b',title:'Bravo',artist:'Xray',album:'Amber',year:2002,duration:120,file:'c',disc:null,trackNumber:null,added:200,created:300,modified:200,bitDepth:24},
];
const initialSongs=definitions.map(({id,title,artist,album,year,duration,file,disc,trackNumber,added,created,modified,bitDepth})=>({key:'/music/'+file+'.flac',sourcePath:'/music/'+file+'.flac',scope:'source-A',trackId:id,available:true,fileCreatedAtMs:created,fileModifiedAtMs:modified,libraryAddedAtMs:added,
 track:{id,title,artist,album,durationSeconds:duration,fileExtension:'FLAC',coverTone:'lagoon',hasLocalArtwork:false,lyrics:[],libraryYear:year,libraryTrackNumber:trackNumber,libraryDiscNumber:disc,libraryAlbumName:album,libraryArtistName:artist,audioFormat:{bitDepth,sampleRateHz:96000,codec:'FLAC',bitrateKbps:null}}}));
const playedAt=new Map([['/music/b.flac',100],['/music/d.flac',200],['/music/c.flac',300]]);
const librarySettings={selectedFolderCount:2,status:'ready',errors:{},onClear:noop};
window.calls=[];
function Fixture(){
 const [route,setRoute]=React.useState({view:'category',categoryId:'songs'}),[open,setOpen]=React.useState(true),[songs,setSongs]=React.useState(new URLSearchParams(location.search).has('empty')?[]:initialSongs),[counts,setCounts]=React.useState(new Map([['/music/b.flac',2],['/music/d.flac',4],['/music/a.flac',1],['/music/c.flac',3]]));
 window.navigate=setRoute;window.setSongs=setSongs;window.setCounts=setCounts;window.republish=()=>setSongs(previous=>previous.map(item=>({...item,artworkRevision:(item.artworkRevision??0)+1})));
 const tracks=songs.map(item=>item.track);
 const library={route,isOpen:route.view!=='tracks',currentScope:'source-A',activeScope:'source-A',items:[{scope:'source-A',name:'Source A',trackCount:4,sourceKind:'m3u8'}],allSongs:songs,recentSongs:[...songs].reverse(),allSongsMetadataStatus:'ready',
 mostPlayedCounts:counts,allSongsLastPlayedAt:playedAt,
 onOpenOverview:()=>setRoute({view:'overview'}),onSelectCategory:categoryId=>setRoute({view:'category',categoryId}),onOpen:()=>setRoute({view:'category',categoryId:'playlists'}),onSelect:()=>setRoute({view:'tracks'}),
 onPlay:scope=>window.calls.push({type:'source-play',scope}),onPlaySong:(scope,id,ordered,sort)=>window.calls.push({type:'song-play',scope,id,ordered,sort}),
 onShufflePlay:async (ordered,sort)=>{window.calls.push({type:'shuffle',ordered,sort});return true},
 onSelectFolders:()=>window.calls.push({type:'folders'}),onImportPlaylist:()=>window.calls.push({type:'import'}),onCreatePlaylist:()=>null,onAddToQueue:snapshot=>{window.calls.push({type:'queue',snapshot});return true},
 onReorderSongs:async request=>{window.calls.push({type:'reorder',request});return {ok:true}}};
 const viewModel={playback:{track:tracks[0],contentState:tracks.length?'track':'empty',isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop},
 timeline:{positionSeconds:0,durationSeconds:240,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop},volume:{valuePercent:50,isBusy:false,isDisabled:false,onChange:noop},queue:{tracks,isOpen:false,onToggle:noop},
 playlist:{isOpen:open,onOpenChange:setOpen,tracks,playlistName:'Source A',currentTrackId:'c',shuffleMode:'none',isOpenAudioDisabled:false,onShuffleCycle:noop,onOpenAudio:noop,onTrackSelect:noop,library},feedback:{onToggle:noop,ratingsByTrackId:{a:4,b:2,c:3,d:1}}};
 window.viewModel=viewModel;return React.createElement(PlayerSurface,{viewModel,librarySettings});
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(Fixture))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__all_songs_options_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge', args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] })
const screenshotDir = process.env.SPMUSIC_TEST_SCREENSHOTS || join(tmpdir(), 'spmusic-all-songs-list-options')
mkdirSync(screenshotDir, { recursive: true })
for (const file of ['settings', 'radio-empty', 'radio-selected', 'checkbox', 'error-circle']) {
  assert(statSync(new URL('../../../assets/all-songs-list-options/' + file + '.svg', import.meta.url)).size > 0, 'local design asset is nonempty: ' + file)
}
const panel = page => page.locator('.playlist-management:not([inert])')
const trigger = page => panel(page).getByRole('button', { name: '更多列表操作', exact: true }).first()
const options = page => page.getByRole('dialog', { name: '列表选项：所有歌曲', exact: true })
const keys = page => panel(page).locator('.all-songs-list [data-song-key]').evaluateAll(nodes => nodes.map(node => node.dataset.songKey))
const expectedKeys = files => files.map(file => '/music/' + file + '.flac')
let passed = 0
async function open({ width = 1280, height = 900, empty = false, motion = false, hasTouch = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: motion ? 'no-preference' : 'reduce', hasTouch })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/__all_songs_options_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__all_songs_options_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__all_songs_options_test' + (empty ? '?empty' : ''), { waitUntil: 'commit' })
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
async function observeLayoutAnimations(page, pause = false) {
  await page.evaluate(pauseAtStart => {
    const animate = Element.prototype.animate
    window.layoutAnimations = []
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args)
      const grid = this.closest('.all-songs-list')
      if (grid && this.matches('.playlist-card-cover, .playlist-card-copy')) {
        const frames = animation.effect.getKeyframes()
        window.layoutAnimations.push({
          animation,
          element: this,
          part: this.classList.contains('playlist-card-cover') ? 'cover' : 'copy',
          level: grid.dataset.layoutLevel,
          from: frames[0]?.transform,
          to: frames.at(-1)?.transform,
          duration: animation.effect.getComputedTiming().duration,
        })
        if (pauseAtStart) animation.pause()
      }
      return animation
    }
  }, pause)
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
          focusInside: node.contains(document.activeElement), images: [...node.querySelectorAll('img')].map(image => ({ hint: Boolean(image.closest('.all-songs-options-view-hint')), loaded: image.complete && image.naturalWidth > 0, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height })) }
      })
      assert(geometry.bottom <= geometry.viewport && geometry.bottom > geometry.viewport - 80, 'dialog is anchored near viewport bottom')
      assert.equal(geometry.width, 615, 'design dialog width')
      assert.equal(geometry.height, 659, 'design dialog height')
      assert.equal(geometry.scrolls, 1, 'one inner content scroller')
      assert.equal(geometry.titleSize, '32px', 'design title typography')
      assert(geometry.focusInside, 'new dialog owns focus')
      assert(geometry.images.length > 0 && geometry.images.every(image => image.loaded && image.width > 0 && image.height > 0), 'all static images load with nonempty geometry')
      assert.deepEqual([geometry.images[0].width, geometry.images[0].height], [32, 32], 'header settings keeps design geometry')
      const hint = geometry.images.find(image => image.hint)
      assert.deepEqual([hint?.width, hint?.height], [16, 16], 'pinch icon keeps design geometry')
      assert(geometry.images.slice(1).filter(image => image !== hint).every(image => image.width === 24 && image.height === 24), 'radio and checkbox assets keep design geometry')
      if (mode === 'button') await options(page).screenshot({ path: join(screenshotDir, 'options-initial.png') })
      for (let i = 0; i < 35; i++) { await page.keyboard.press('Tab'); await page.waitForFunction(() => document.querySelector('.all-songs-options-dialog')?.contains(document.activeElement), null, { timeout: 1000 }) }
      await options(page).getByRole('radio', { name: '网格', exact: true }).scrollIntoViewIfNeeded()
      await options(page).screenshot({ path: join(screenshotDir, 'options-layout.png') })
      await closeOptions(page, mode)
    }
  })
  await check('settings gear opens the existing library settings and returns focus', async page => {
    await openOptions(page)
    const gear = options(page).getByRole('button', { name: '媒体库设置', exact: true })
    await gear.focus()
    await page.keyboard.press('Enter')
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.waitFor()
    await options(page).waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('dialog').count(), 1)
    await settings.getByText('已选择 2 个文件夹', { exact: true }).waitFor()
    await page.waitForFunction(() => document.activeElement?.textContent === '歌曲文件夹')
    await page.keyboard.press('Escape')
    await settings.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '更多列表操作')
  }, { motion: true })
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
    assert.deepEqual(await keys(page), expectedKeys(['a', 'c', 'd', 'b']), 'reverse makes duration shortest first')
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据随机顺序', exact: true }).click()
    await closeOptions(page)
    const shuffled = await keys(page)
    assert.deepEqual([...shuffled].sort(), expectedKeys(['a', 'b', 'c', 'd']))
    await panel(page).getByRole('button', { name: '随机播放所有歌曲', exact: true }).click()
    const shuffle = await page.evaluate(() => window.calls.at(-1))
    const trackByFile = new Map(expectedKeys(['a', 'b', 'c', 'd']).map((key, index) => [key, ['d', 'c', 'b', 'a'][index]]))
    assert.equal(shuffle.type, 'shuffle')
    assert.equal(shuffle.sort, 'random', 'engine receives the order source')
    assert.deepEqual(shuffle.ordered.map(entry => entry.trackId), shuffled.map(key => trackByFile.get(key)), 'shuffle uses the displayed candidate order')
    await page.evaluate(() => window.republish())
    assert.deepEqual(await keys(page), shuffled, 'visual republication preserves random order')
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.type === 'reorder').length), 0, 'display sort never writes manual order')
    await page.reload({ waitUntil: 'commit' })
    await panel(page).waitFor()
    assert.deepEqual(await keys(page), shuffled, 'random order persists across reload')
  })
  await check('supported fields, missing data, quick index and selection preserve order', async page => {
    const cases = [
      ['根据音轨号', ['b', 'a', 'd', 'c']],
      ['根据碟片和音轨号', ['a', 'd', 'b', 'c']],
      ['根据艺术家', ['a', 'c', 'd', 'b']],
      ['根据专辑', ['c', 'b', 'a', 'd']],
      ['根据年份', ['d', 'c', 'a', 'b']],
      ['根据年份/专辑', ['d', 'c', 'a', 'b']],
      ['根据添加到媒体库的日期', ['d', 'c', 'b', 'a']],
      ['根据添加/修改日期', ['b', 'c', 'a', 'd']],
      ['根据星级', ['d', 'b', 'c', 'a']],
      ['根据最后播放的时间', ['c', 'd', 'b', 'a']],
      ['根据播放次数', ['d', 'c', 'b', 'a']],
      ['根据路径', ['a', 'b', 'c', 'd']],
    ]
    await openOptions(page)
    const sortGroup = options(page).getByRole('group', { name: '排序', exact: true })
    assert.equal(await sortGroup.getByRole('radio').count(), 16)
    assert.equal(await sortGroup.getByRole('radio', { disabled: true }).count(), 0)
    for (const hint of ['文件系统日期/时间', '以该排序方式播放时，播放时间不会更新', '以该排序方式播放时，播放次数不会更新', '匹配实际随机播放顺序']) {
      assert.equal(await sortGroup.getByText(hint, { exact: true }).count(), 1)
    }
    await closeOptions(page)
    for (const [label, files] of cases) {
      await openOptions(page)
      await options(page).getByRole('radio', { name: label, exact: true }).click()
      await closeOptions(page)
      assert.deepEqual(await keys(page), expectedKeys(files), label)
      assert.equal(await panel(page).locator('.playlist-management-quick-index:visible').count(), 0, 'non-title order hides alphabetical navigation')
    }
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据音轨号', exact: true }).click()
    await options(page).getByRole('checkbox', { name: '倒序', exact: true }).click()
    await closeOptions(page)
    assert.deepEqual(await keys(page), expectedKeys(['d', 'a', 'b', 'c']), 'reverse changes known track order and leaves unknown track last')
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据最后播放的时间', exact: true }).click()
    await closeOptions(page)
    assert.deepEqual(await keys(page), expectedKeys(['b', 'd', 'c', 'a']), 'reverse makes known play times oldest first')
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据路径', exact: true }).click()
    await options(page).getByRole('checkbox', { name: '倒序', exact: true }).click()
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
    const songList = panel(page).locator('.all-songs-list')
    const titleOnly = options(page).getByRole('checkbox', { name: '仅显示标题', exact: true })
    const checkAudioSummary = async inline => {
      assert.equal(await songList.locator('.playlist-card-artist:visible').count(), 0, 'artist and album are hidden')
      for (const [file, text] of [['a', '1:00 | flac | 24bit'], ['b', '4:00 | flac | 32bit'], ['c', '2:00 | flac | 24bit'], ['d', '3:00 | flac']]) {
        const row = songList.locator(`[data-song-key="${expectedKeys([file])[0]}"]`)
        const format = row.locator('.playlist-card-format:visible')
        assert.equal((await format.innerText()).replace(/\s+/g, ' ').trim(), text, 'visible duration, lowercase format and bit depth of 24 or more')
        assert.equal(await format.locator('svg:visible').count(), 1, 'format retains the existing note icon')
        if (inline) {
          const titleBox = await row.locator('.playlist-card-title').boundingBox()
          const formatBox = await format.boundingBox()
          assert(Math.abs(titleBox.y + titleBox.height / 2 - formatBox.y - formatBox.height / 2) < 1, 'title and format are on the same line')
        }
      }
    }
    for (const [index, label] of labels.entries()) {
      await openOptions(page)
      const radio = options(page).getByRole('radio', { name: label, exact: true })
      await radio.click()
      assert(await radio.isChecked(), 'view is selected: ' + label)
      assert.equal(await titleOnly.isDisabled(), index < 3, 'single-line views have a fixed composition')
      await closeOptions(page)
      assert.equal(await songList.getAttribute('data-layout-level'), String(9 - index), 'menu uses existing layout levels')
      if (index < 3) await checkAudioSummary(true)
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
    await titleOnly.click()
    await closeOptions(page)
    await checkAudioSummary(false)
    assert.equal(await page.locator('.all-songs-list .playlist-card-title:visible').count(), 4)
    await page.locator('.all-songs-list').screenshot({ path: join(screenshotDir, 'songs-title-only.png') })
    await page.reload({ waitUntil: 'commit' })
    await panel(page).waitFor()
    await openOptions(page)
    assert(await titleOnly.isChecked(), 'title-only persists across reload')
    assert(await options(page).getByRole('radio', { name: '列表-小', exact: true }).isChecked(), 'view persists across reload')
    await options(page).getByRole('radio', { name: '紧凑单行', exact: true }).click()
    assert(await titleOnly.isDisabled(), 'the stored title-only preference does not apply to compact rows')
    await closeOptions(page)
    await checkAudioSummary(true)
    await openOptions(page)
    await options(page).getByRole('radio', { name: '列表-小', exact: true }).click()
    assert(await titleOnly.isChecked(), 'returning to a regular layout restores the title-only preference')
    await titleOnly.click()
    await closeOptions(page)
    assert(await page.locator('.all-songs-list .playlist-card-artist').first().isVisible(), 'turning title-only off restores metadata')
  })
  await check('dialog layout animation runs and replaces an interrupted transition', async page => {
    await openOptions(page)
    await observeLayoutAnimations(page, true)
    const selectView = label => options(page).getByRole('radio', { name: label, exact: true }).click()
    await selectView('网格')
    const first = await page.evaluate(() => window.layoutAnimations.map(({ part, level, from, to, duration }) => ({ part, level, from, to, duration })))
    assert.deepEqual(new Set(first.map(({ part }) => part)), new Set(['cover', 'copy']), 'dialog animates existing cover and text geometry')
    assert(first.every(({ level, from, to, duration }) => level === '0' && from.startsWith('translate(') && to === 'none' && duration > 0))

    await page.evaluate(() => {
      for (const { animation, duration } of window.layoutAnimations) animation.currentTime = duration / 3
    })
    await selectView('列表-极小')
    const second = await page.evaluate(count => ({
      stale: window.layoutAnimations.slice(0, count).map(({ animation }) => animation.playState),
      current: window.layoutAnimations.slice(count).map(({ level, from, to, duration }) => ({ level, from, to, duration })),
    }), first.length)
    assert(second.stale.every(state => state === 'idle'), 'new selection cancels the interrupted transforms')
    assert(second.current.length > 0 && second.current.every(({ level, from, to, duration }) => level === '5' && from !== 'none' && to === 'none' && duration > 0))
    await page.evaluate(count => {
      for (const { animation } of window.layoutAnimations.slice(count)) animation.play()
    }, first.length)
    await closeOptions(page)
    await page.waitForFunction(() => window.layoutAnimations.every(({ animation, element }) =>
      !animation.pending && ['idle', 'finished'].includes(animation.playState) && getComputedStyle(element).transform === 'none'))
    assert.equal(await panel(page).locator('.all-songs-list').getAttribute('data-layout-level'), '5')
  }, { motion: true })
  await check('dialog layout animation respects reduced motion', async page => {
    await openOptions(page)
    await observeLayoutAnimations(page)
    await options(page).getByRole('radio', { name: '网格', exact: true }).click()
    await closeOptions(page)
    assert.equal(await panel(page).locator('.all-songs-list').getAttribute('data-layout-level'), '0')
    assert.equal(await page.evaluate(() => window.layoutAnimations.length), 0, 'layout changes without card animations')
  })
  await check('touchscreen pinch synchronizes the view selector', async page => {
    const list = page.locator('.all-songs-list')
    await list.waitFor({ state: 'visible' })
    const { x, y, width, height } = await list.boundingBox()
    const middleX = Math.round(x + width / 2)
    const middleY = Math.round(y + Math.min(height, 120) / 2)
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, distance) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [-1, 1].map((sign, id) => ({ id, x: middleX + sign * distance, y: middleY, radiusX: 2, radiusY: 2, force: 1 })),
    })
    try {
      await touch('touchStart', 80)
      for (const distance of [70, 58, 45, 30]) await touch('touchMove', distance)
      await touch('touchEnd')
    } finally { await cdp.detach() }
    await page.waitForFunction(() => document.querySelector('.all-songs-list')?.dataset.layoutLevel === '5')
    assert.deepEqual(await page.evaluate(() => window.calls), [], 'pinch never starts playback')
    await openOptions(page)
    assert(await options(page).getByText('可使用双指缩放切换', { exact: true }).isVisible())
    assert(await options(page).getByRole('radio', { name: '列表-极小', exact: true }).isChecked())
    await closeOptions(page)
  }, { hasTouch: true })
  await check('play-count order uses live history and supplies the playback sort', async page => {
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据播放次数', exact: true }).click()
    await closeOptions(page)
    assert.deepEqual(await keys(page), expectedKeys(['d', 'c', 'b', 'a']))
    await panel(page).getByRole('button', { name: '播放所有歌曲', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).sort), 'play-count')
    await page.evaluate(() => window.setCounts(new Map([['/music/a.flac',4],['/music/b.flac',3],['/music/c.flac',2],['/music/d.flac',1]])))
    await page.waitForFunction(() => window.viewModel.playlist.library.mostPlayedCounts.get('/music/a.flac') === 4)
    assert.deepEqual(await keys(page), expectedKeys(['a', 'b', 'c', 'd']), 'statistics updated by other playback contexts change the order')
    await openOptions(page)
    await options(page).getByRole('radio', { name: '根据最后播放的时间', exact: true }).click()
    await closeOptions(page)
    await panel(page).getByRole('button', { name: '播放所有歌曲', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).sort), 'last-played')
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
    assert.deepEqual(await keys(page), expectedKeys(['c', 'd', 'b', 'a']), 'recent category sorts by its own playback history')
    await trigger(page).click()
    await page.getByRole('dialog', { name: '最近播放', exact: true }).getByRole('button', { name: '列表选项', exact: true }).click()
    const recentOptions = page.getByRole('dialog', { name: '列表选项：最近播放', exact: true })
    await recentOptions.waitFor()
    assert(await recentOptions.getByRole('radio', { name: '根据最后播放的时间', exact: true }).isChecked())
    assert.equal(await options(page).count(), 0, 'all-songs dialog does not override another category')
    await page.keyboard.press('Escape')
    await recentOptions.waitFor({ state: 'hidden' })
    await page.evaluate(() => window.navigate({ view: 'category', categoryId: 'songs' }))
    for (let index = 0; index < 4; index++) {
      await openOptions(page)
      assert(await options(page).getByRole('radio', { name: '根据持续时间', exact: true }).isChecked(), 'sort persists across category navigation')
      await closeOptions(page, 'escape')
    }
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
