// Compare the two sibling collection roots through their real React components.
// Start Vite on SPMUSIC_TEST_ORIGIN (defaults to http://127.0.0.1:5173).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `resolve ${name}`)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlaylistLibraryPanel} from '/src/features/player/components/PlaylistLibraryPanel.tsx';
import {FolderHierarchyPanel} from '/src/features/player/components/FolderHierarchyPanel.tsx';
import {createAllSongsCoverStore} from '/src/features/player/hooks/useAllSongsWindow.ts';
import {LibraryDockContext} from '/src/features/player/hooks/useLibraryDockBinding.ts';
import '/src/index.css';import '/src/features/player/styles/player.css';
const noop=()=>{};
const blob=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#478"/></svg>'],{type:'image/svg+xml'}));
const tracks=Array.from({length:Number(new URLSearchParams(location.search).get('count')||30)},(_,i)=>({id:'track-'+i,title:'Song '+i,artist:'Artist',album:'Album',durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:true,coverThumbnail:{src:blob,width:128,height:128,encodedBytes:256}}));
const items=tracks.map((track,i)=>({scope:'list-'+i,name:'Playlist '+i,sourceKind:'m3u8',trackCount:1,coverTrack:track}));
const roots=tracks.map((_,i)=>({path:'/music/root-'+i,directoryPaths:['/music/root-'+i],status:'ready'}));
const songs=tracks.map((track,i)=>({key:'/music/root-'+i+'/song.flac',sourcePath:'/music/root-'+i+'/song.flac',scope:'folder-'+i,trackId:track.id,track,available:true}));
window.actions=[];window.bindings=[];
function Fixture(){
 const category=new URLSearchParams(location.search).get('category')||'folders';
 const [sidebarOpen,setSidebarOpen]=React.useState(false);const store=React.useMemo(createAllSongsCoverStore,[]);const dockRef=React.useRef(null);window.setFixtureOverlay=setSidebarOpen;
 const publish=React.useCallback((owner,route,binding)=>{window.bindings.push({route,offset:binding.controllerOffsetY!==undefined,hidden:binding.controllerHidden!==undefined,search:binding.searchOpen});return noop},[]);
 const dock=React.useMemo(()=>({dockRef,activeRouteKey:'category:'+category,publish}),[category,publish]);
 const library={isOpen:true,route:{view:'category',categoryId:category},items,allSongs:songs,allSongsMetadataStatus:'ready',folderRoots:roots,folderLocation:null,onFolderLocationChange:value=>window.actions.push(value),currentScope:null,activeScope:null,onOpen:noop,onSelect:noop,onSelectCategory:noop,onOpenOverview:noop,onPlay:scope=>window.actions.push(scope),onPlaySong:noop,onShufflePlay:()=>true,onSelectFolders:noop,onImportPlaylist:noop};
 const playback={track:{...tracks[0],lyrics:[]},isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isSelectionPending:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:noop,onShuffleCycle:noop,onRepeatCycle:noop};
 const timeline={positionSeconds:0,durationSeconds:180,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop};
 const common={playlist:{isOpen:true,library,tracks,shuffleMode:'none',onShuffleCycle:noop,onOpenAudio:noop,onOpenChange:noop,isOpenAudioDisabled:false},allSongsCoverStore:store,librarySidebarOpen:sidebarOpen,onLibrarySidebarOpenChange:setSidebarOpen,playback,timeline,visualIsPlaying:false,playbackTransitionPending:false,onPlayToggle:noop,onOpenPlayer:noop};
 return React.createElement(LibraryDockContext.Provider,{value:dock},React.createElement('main',{className:'player-shell'},React.createElement(category==='folders'?FolderHierarchyPanel:PlaylistLibraryPanel,common),React.createElement('aside',{ref:dockRef,className:'parity-dock',style:{position:'fixed',bottom:0,height:60,width:'100%',pointerEvents:'auto'}},'Dock')));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AppearanceProvider,null,React.createElement(Fixture)));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__folder_management_parity_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const evidence = process.env.SPMUSIC_TEST_SCREENSHOTS
if (evidence) mkdirSync(evidence, { recursive: true })
const report = {}
async function open(category, width = 1280, level = '2', count = 30) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(level => {
    localStorage.setItem('spmusic.folder-hierarchy.layout-level.v1', level)
    localStorage.setItem('spmusic.playlist-management.layout-level.v2', level)
  },level)
  await page.route('**/__folder_management_parity_fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }))
  await page.route('**/__folder_management_parity_test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '/__folder_management_parity_test?category=' + category+'&count='+count)
  await page.locator(category === 'folders' ? '.folder-row' : '.playlist-management-card').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  return { page, errors }
}
async function geometry(page, category) {
  return page.evaluate(category => {
    const panel = document.querySelector('.playlist-management-content'), toolbar = panel.querySelector('.playlist-management-toolbar')
    const grid = panel.querySelector(category === 'folders' ? '.folder-directory-list' : '.playlist-management-grid')
    const card = grid.firstElementChild, cover = card.querySelector(category === 'folders' ? '.folder-cover' : '.playlist-management-cover')
    const p = panel.getBoundingClientRect(), g = grid.getBoundingClientRect(), c = cover.getBoundingClientRect()
    return { buttons: [...toolbar.querySelectorAll('button')].map(button => {
      const r=button.getBoundingClientRect(),style=getComputedStyle(button)
      return { width:r.width,height:r.height,padding:style.padding,fontSize:style.fontSize,borderRadius:style.borderRadius }
    }), gridLeft:g.left-p.left,coverLeft:c.left-p.left, gridJustify:getComputedStyle(grid).justifyContent, headingSize:getComputedStyle(panel.querySelector('h2')).fontSize }
  }, category)
}
async function hover(page) {
  const buttons = page.locator('.playlist-management-content .playlist-management-toolbar button')
  const styles=[]
  for(let index=0;index<await buttons.count();index++){
    const button=buttons.nth(index)
    await button.hover()
    await button.evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))))
    styles.push(await button.evaluate(node => { const style=getComputedStyle(node);return {background:style.backgroundColor,color:style.color,border:style.borderColor,transform:style.transform,translate:style.translate} }))
  }
  return styles
}
async function wheelAt(category, region) {
  const { page, errors } = await open(category)
  try {
    const selectors={header:'.playlist-management-heading',toolbar:'.playlist-management-toolbar',card:category==='folders'?'.folder-row':'.playlist-management-card-button',sidebar:'.playlist-management > .playlist-library-sidebar',dock:'.parity-dock',input:'.playlist-management-search input',dialog:'[role="dialog"]'}
    if(region==='input')await page.locator('.playlist-management-toolbar button').nth(2).click()
    if(region==='dialog'){await page.evaluate(()=>window.setFixtureOverlay(true));await page.getByRole('dialog').waitFor()}
    let point
    if(region==='blank') point=await page.locator('.playlist-management-content').evaluate(node=>{const r=node.getBoundingClientRect();return {x:r.right-24,y:r.bottom-100}})
    else {const r=await page.locator(selectors[region]).first().boundingBox();point={x:r.x+Math.min(45,r.width/2),y:r.y+Math.min(24,r.height/2)}}
    const level=()=>page.evaluate(category=>Number(localStorage.getItem(category==='folders'?'spmusic.folder-hierarchy.layout-level.v1':'spmusic.playlist-management.layout-level.v2')),category)
    const before=await level()
    await page.mouse.move(point.x,point.y)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0,120)
    await page.keyboard.up('Control')
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    const after=await level()
    assert.deepEqual(errors,[])
    return after-before
  } finally { await page.close() }
}
try {
  for(const width of [640,1280]) {
    const samples={}
    for(const category of ['playlists','folders']) {
      const {page,errors}=await open(category,width)
      try {
        samples[category]={geometry:await geometry(page,category),hover:await hover(page),compact:await page.locator('.playlist-controller-actions:not([aria-hidden="true"])').count(),bindings:await page.evaluate(()=>window.bindings)}
        await page.locator('.playlist-management-toolbar button').nth(2).click()
        const input=page.locator('.playlist-management-search input')
        await input.waitFor()
        assert.equal(await input.evaluate(node=>node===document.activeElement),true,'root search takes keyboard focus')
        await input.press('Escape')
        assert.equal(await input.count(),0,'Escape dismisses root search')
        if(evidence)await page.screenshot({path:`${evidence}/parity-${category}-${width}.png`})
        assert.deepEqual(errors,[])
      } finally {await page.close()}
    }
    report[width]=samples
    console.log('FOLDER_MANAGEMENT_GEOMETRY',width,JSON.stringify(samples))
  }
  report.wheel={playlists:{},folders:{}}
  report.sparseTiles=[]
  for(const width of [640,1280])for(const level of ['0','1','2']){
    const {page,errors}=await open('folders',width,level,1)
    try{
      const sample=await geometry(page,'folders')
      report.sparseTiles.push({width,level,coverLeft:sample.coverLeft})
      assert.equal(sample.gridJustify,'start')
      const expectedInset=level==='2'?30:40 // Figma: 25px list inset plus 15/15/5px card padding, without a phantom Button border.
      assert(Math.abs(sample.coverLeft-expectedInset)<1,'a single folder keeps its Figma inset instead of centering within leftover tile slots')
      assert.deepEqual(errors,[])
    }finally{await page.close()}
  }
  for(const category of ['playlists','folders'])for(const region of ['header','toolbar','blank','card','sidebar','dock','input','dialog'])report.wheel[category][region]=await wheelAt(category,region)
  console.log('FOLDER_MANAGEMENT_PARITY',JSON.stringify(report))
  for(const width of [640,1280]) {
    assert.deepEqual(report[width].folders.geometry.buttons,report[width].playlists.geometry.buttons,`root toolbar button geometry matches management at ${width}`)
    assert.equal(report[width].folders.geometry.headingSize,report[width].playlists.geometry.headingSize)
    assert.deepEqual(report[width].folders.hover,report[width].playlists.hover,`toolbar hover response matches management at ${width}`)
    assert.equal(report[width].folders.compact,0,'folder root adds no compact controller')
    assert(report[width].folders.bindings.every(binding=>!binding.offset&&!binding.hidden),'root dock binding does not publish detail controller motion')
    assert.equal(report[width].folders.geometry.gridJustify,'start','folder tiles align to the content start')
  }
  assert.deepEqual(report.wheel.folders,report.wheel.playlists,'physical Ctrl-wheel region matrix matches management')
  assert.deepEqual(report.wheel.playlists,{header:1,toolbar:1,blank:1,card:1,sidebar:0,dock:0,input:0,dialog:0},'management includes content regions and excludes sidebar/dock/inputs/dialogs')
  console.log('PASS folder root and playlist management geometry, hover, controller boundaries and wheel area parity')
} finally {await browser.close()}
