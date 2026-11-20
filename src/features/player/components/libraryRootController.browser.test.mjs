// Real PlayerSurface and all root-page motion hooks; parent data is deterministic.
// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing Playwright installation.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

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
import {useAppearance} from '/src/features/appearance/hooks/useAppearance.ts';
import {PlayerSurface} from '/src/features/player/components/PlayerSurface.tsx';
import '/src/index.css';
const noop=()=>{},params=new URLSearchParams(location.search),count=Number(params.get('count')??100);
const tracks=Array.from({length:100},(_,i)=>({id:'song-'+i,title:'Song '+String(i).padStart(3,'0'),artist:'Artist '+i,album:'Album '+i,libraryArtistName:'Artist '+i,libraryAlbumName:'Album '+i,durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false,lyrics:[]}));
const allSongs=tracks.slice(0,count).map((track,i)=>({key:'/music/Root'+i+'/song.flac',scope:'source-'+i,trackId:track.id,sourcePath:'/music/Root'+i+'/song.flac',track,available:true}));
const items=allSongs.map((song,i)=>({scope:song.scope,name:'List '+String(i).padStart(3,'0'),trackCount:1,sourceKind:'m3u8'}));
const folderRoots=allSongs.map((song,i)=>({path:'/music/Root'+i,directoryPaths:['/music/Root'+i],status:'ready'}));
window.calls=[];
function Fixture(){
 const appearance=useAppearance();window.setMotionOff=()=>appearance.previewAppearance({...appearance.appearance,motion:{...appearance.appearance.motion,level:'off'}});
 const [route,setRoute]=React.useState({view:'category',categoryId:params.get('category')??'songs'}),[open,setOpen]=React.useState(true);
 const [albumLocation,setAlbumLocation]=React.useState(null),[artistLocation,setArtistLocation]=React.useState(null),[folderLocation,setFolderLocation]=React.useState(null),[flatFolderLocation,setFlatFolderLocation]=React.useState(null);
 window.navigate=categoryId=>{setAlbumLocation(null);setArtistLocation(null);setFolderLocation(null);setFlatFolderLocation(null);setRoute({view:'category',categoryId})};
 const library={route,isOpen:route.view!=='tracks',currentScope:'source-0',activeScope:'source-0',items,allSongs,allSongsMetadataStatus:'ready',folderRoots,
 albumLocation,onAlbumLocationChange:setAlbumLocation,artistLocation,onArtistLocationChange:setArtistLocation,folderLocation,onFolderLocationChange:setFolderLocation,flatFolderLocation,onFlatFolderLocationChange:setFlatFolderLocation,
 onOpenOverview:()=>setRoute({view:'overview'}),onSelectCategory:window.navigate,onOpen:()=>window.navigate('playlists'),onSelect:()=>setRoute({view:'tracks'}),
 onPlay:scope=>window.calls.push({type:'list',scope}),onPlaySong:(scope,id)=>window.calls.push({type:'song',scope,id}),onShufflePlay:()=>true,onSelectFolders:noop,onImportPlaylist:noop,onCreatePlaylist:()=>null};
 const viewModel={playback:{track:tracks[0],contentState:'track',isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop},
 timeline:{positionSeconds:45,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop},volume:{valuePercent:50,isBusy:false,isDisabled:false,onChange:noop},queue:{tracks,isOpen:false,onToggle:noop},
 playlist:{isOpen:open,onOpenChange:setOpen,tracks,playlistName:'List 000',currentTrackId:'song-0',shuffleMode:'none',onShuffleCycle:noop,onOpenAudio:noop,onTrackSelect:noop,library},feedback:{onToggle:noop}};
 window.viewModel=viewModel;return React.createElement(PlayerSurface,{viewModel});
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(Fixture))));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__root_controller_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
const panel = '.playlist-management:not([inert]) .playlist-management-content:not([inert])'
const actions = '.playlist-management:not([inert]) .playlist-controller-actions'
const dock = '.playlist-playback-dock:not([data-dock-superseded])'
const roots = ['songs', 'playlists', 'album', 'artist', 'folder', 'folders']
let passed = 0

async function open(category, { mode = 'movable', reduced = true, count = 100 } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(mode => {
    localStorage.setItem('spmusic.player.playlist-controller-mode.v1', mode)
    for (const key of ['all-songs', 'playlist', 'playlist-library', 'albums', 'artist-root', 'flat-folders', 'folder-hierarchy']) localStorage.setItem('spmusic.' + key + '.layout-level.v1', '7')
  }, mode)
  await page.route('**/__root_controller_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__root_controller_test*', route => route.fulfill({ contentType: 'text/html', body: html }))
  // Optional causal probe restores the old management-trigger class in the
  // browser response only, without reverting shared workspace changes.
  if (process.env.SPMUSIC_ROOT_CONTROL_BASELINE === '1') await page.route('**/src/features/player/components/LibraryRootMenu.tsx*', async route => {
    const response = await route.fetch(), source = await response.text()
    assert(source.includes('playlist-hero-icon playlist-hero-more-button'), 'baseline probe locates the corrected trigger')
    await route.fulfill({ response, body: source.replace('playlist-hero-icon playlist-hero-more-button', 'playlist-management-more') })
  })
  await page.goto(origin + '/__root_controller_test?category=' + category + '&count=' + count)
  await page.locator(panel).waitFor()
  await page.locator(dock).waitFor()
  return { page, errors }
}
async function check(name, category, run, options) {
  if (process.env.SPMUSIC_TEST_FILTER && !name.includes(process.env.SPMUSIC_TEST_FILTER)) return
  const { page, errors } = await open(category, options)
  try {
    await run(page)
    assert.deepEqual(errors, [], 'no unhandled React/browser errors')
    console.log('PASS', name)
    passed++
  } catch (error) {
    console.log('ROOT_FAILURE', name, await page.evaluate(({ panel, dock, actions }) => {
      const p = document.querySelector(panel), d = document.querySelector(dock), a = document.querySelector(actions)
      return { route: window.viewModel?.playlist.library.route, top: p?.scrollTop, max: p ? p.scrollHeight-p.clientHeight : null, dock: d?.getAttribute('style'), actions: a?.outerHTML.slice(0, 500), text: document.body.innerText.slice(0, 500) }
    }, { panel, dock, actions }))
    throw error
  } finally { await page.close() }
}
async function scroll(page, top) {
  await page.locator(panel).evaluate((node, value) => { node.scrollTop = value }, top)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function offset(page, hidden) {
  await page.waitForFunction(({ dock, hidden }) => {
    const node = document.querySelector(dock), style = getComputedStyle(node)
    const travel = node.offsetHeight + parseFloat(style.bottom)
    return Math.abs(node.getBoundingClientRect().top - (innerHeight-travel) - (hidden ? travel : 0)) < .5
  }, { dock, hidden })
}
async function compact(page, visible) {
  await page.waitForFunction(({ actions, visible }) => {
    const node = document.querySelector(actions)
    return node?.dataset.actionsVisible === String(visible) && Math.abs(Number(getComputedStyle(node).opacity) - Number(visible)) < .001
  }, { actions, visible })
}
async function navigate(page, category) {
  await page.evaluate(category => window.navigate(category), category)
  await page.waitForFunction(({ panel, category }) => {
    const nodes = document.querySelectorAll(panel)
    return nodes.length === 1 && window.viewModel.playlist.library.route.categoryId === category && nodes[0].querySelector('.playlist-management-heading')
  }, { panel, category })
}
async function controlAppearance(row) {
  return row.locator('button').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button), icon = button.querySelector('svg'), iconStyle = icon ? getComputedStyle(icon) : null
    return {
      width: style.width, height: style.height, minHeight: style.minHeight,
      radius: style.borderRadius, border: style.borderWidth, background: style.backgroundColor,
      color: style.color, shadow: style.boxShadow,
      iconWidth: iconStyle?.width, iconHeight: iconStyle?.height,
      iconMarkup: icon?.innerHTML, iconViewBox: icon?.getAttribute('viewBox'),
    }
  }))
}
try {
  for (const category of roots) {
    await check(category + ' control appearance and more menu', category, async page => {
      // The existing playlist detail is the actual appearance reference.
      await page.evaluate(() => window.viewModel.playlist.library.onSelect('source-0'))
      await page.locator('.playlist-panel').waitFor()
      await page.locator('.playlist-panel').evaluate(node => { node.scrollTop = 600 })
      await offset(page, true)
      await page.locator('.playlist-panel').evaluate(node => { node.scrollTop = 580 })
      await offset(page, false)
      const referenceRow = page.locator('.playlist-controller-actions:not([inert])')
      await referenceRow.waitFor()
      const reference = await controlAppearance(referenceRow)
      assert.equal(reference.length, 6)
      assert.equal(reference[5].width, '36px')
      assert.equal(reference[5].height, '36px')
      assert.notEqual(reference[5].background, 'rgba(0, 0, 0, 0)', 'reference more button has a filled surface')
      assert(reference[5].iconMarkup.includes('More Vertical'), 'default reference icon is vertical ellipsis')
      await navigate(page, category)
      await scroll(page, 600)
      await offset(page, true)
      await scroll(page, 580)
      await offset(page, false)
      await compact(page, true)
      const actual = await controlAppearance(page.locator(actions))
      assert.equal(actual.length, 6)
      for (let index = 0; index < actual.length; index++) {
        const { iconMarkup: actualMarkup, iconViewBox: actualViewBox, ...actualStyle } = actual[index]
        const { iconMarkup: referenceMarkup, iconViewBox: referenceViewBox, ...referenceStyle } = reference[index]
        assert.deepEqual(actualStyle, referenceStyle, category + ' button ' + index + ' matches playlist dimensions/material')
        if (index === 5) {
          assert.equal(actualMarkup, referenceMarkup, category + ' more uses the same system vertical ellipsis')
          assert.equal(actualViewBox, referenceViewBox)
        }
      }
      const more = page.locator(actions).locator('button').last()
      await more.click()
      const menu = page.getByRole('dialog').or(page.getByRole('menu'))
      await menu.waitFor()
      assert((await menu.innerText()).trim().length > 0, 'more opens the page menu')
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'hidden' })
      console.log('ROOT_CONTROL_APPEARANCE', category, JSON.stringify({ ...actual[5], iconMarkup: undefined }))
    })
    await check(category + ' movable threshold/reverse/top/search/selection', category, async page => {
      await compact(page, false)
      await offset(page, false)
      const threshold = await page.locator(panel).evaluate(node => node.querySelector('.playlist-management-toolbar').getBoundingClientRect().bottom-node.getBoundingClientRect().top)
      await scroll(page, Math.max(1, Math.floor(threshold)-2))
      await compact(page, false)
      await offset(page, false)
      await scroll(page, 600)
      await compact(page, true)
      await offset(page, true)
      assert.equal(await page.locator(dock).evaluate(node => node.inert), true, 'hidden controller cannot take focus')
      await scroll(page, 580)
      await offset(page, false)
      await page.locator(actions + ' .playlist-search-button').click()
      await page.getByRole('searchbox').waitFor()
      await offset(page, false)
      await page.getByRole('searchbox').press('Escape')
      await scroll(page, 650)
      await scroll(page, 630)
      await compact(page, true)
      await offset(page, false)
      await page.locator(actions + ' .playlist-select-toggle').click()
      await offset(page, false)
      await scroll(page, 700)
      await offset(page, false)
      await navigate(page, category === 'songs' ? 'playlists' : 'songs')
      await offset(page, false)
      await compact(page, false)
      await scroll(page, 600)
      await offset(page, true)
      await scroll(page, 0)
      await offset(page, false)
      await compact(page, false)
    })
    await check(category + ' fixed mode', category, async page => {
      await scroll(page, 600)
      await compact(page, true)
      await offset(page, false)
      assert.equal(await page.locator(dock).evaluate(node => node.inert), false)
      await scroll(page, 0)
      await compact(page, false)
    }, { mode: 'fixed' })
    for (const count of [0, 1]) await check(category + ' short/empty ' + count, category, async page => {
      assert.equal(await page.locator(panel).evaluate(node => node.scrollHeight-node.clientHeight), 0)
      await scroll(page, 600)
      await offset(page, false)
      await compact(page, false)
    }, { count })
  }
  await check('normal motion overlap and appearance motion off', 'playlists', async page => {
    await page.evaluate(({ dock, actions }) => {
      window.frames=[];window.capture=true
      const capture=()=>{
        const d=document.querySelector(dock),a=document.querySelector(actions),s=getComputedStyle(d)
        window.frames.push({y:d.getBoundingClientRect().top-(innerHeight-d.offsetHeight-parseFloat(s.bottom)),gap:d.getBoundingClientRect().top-a.getBoundingClientRect().bottom,opacity:Number(getComputedStyle(a).opacity),travel:d.offsetHeight+parseFloat(s.bottom)})
        if(window.capture)requestAnimationFrame(capture)
      };requestAnimationFrame(capture)
    }, { dock, actions })
    await scroll(page, 600)
    await offset(page, true)
    await compact(page, true)
    const frames = await page.evaluate(() => { window.capture=false;return window.frames })
    const overlap = frames.filter(frame => frame.y>1 && frame.y<frame.travel-1 && frame.opacity>.01 && frame.opacity<.99)
    assert(overlap.length>0, 'button entry overlaps controller downward travel')
    assert(frames.every(frame => Math.abs(frame.gap-12)<.6), 'buttons and controller share vertical movement')
    console.log('ROOT_MOTION_EVIDENCE', JSON.stringify({ frames:frames.length, overlap:overlap.length }))
    await page.evaluate(() => window.setMotionOff())
    await page.locator('html[data-motion="off"]').waitFor()
    await scroll(page, 580)
    await offset(page, false)
    await scroll(page, 600)
    await offset(page, true)
  }, { reduced:false })
  await check('all 19 categories retain one dock on route changes', 'songs', async page => {
    const categories = ['songs','folder','folders','album','artist','album-artist','genre','year','composer','playlists','streams','queue','bookmarks','most-played','highest-rated','lowest-rated','recent-played','recent-added','long-tracks']
    await page.locator(dock).evaluate(node => { window.originalDock=node })
    for (const category of categories) {
      await navigate(page, category)
      await offset(page, false)
      assert.equal(await page.locator(dock).count(), 1)
      assert.equal(await page.locator(dock).evaluate(node => node === window.originalDock), true, category + ' retains dock identity')
    }
  })
  console.log('LIBRARY_ROOT_CONTROLLER_RESULT', passed, 'passed')
} finally { await browser.close() }
