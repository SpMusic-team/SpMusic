// Start Vite and point SPMUSIC_PLAYWRIGHT at an existing Playwright package.
// Uses unchanged PlayerSurface, PlaylistPanel and SettingsDialog. Audio view
// model and shortcut-settings IPC are fixtures; no native/global key is registered.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const source = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = source.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, `Vite dependency ${name}`)
  return match[1]
}
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {AppearanceProvider} from '/src/features/appearance/components/AppearanceProvider.tsx';
import {PlayerSurface} from '/src/features/player/components/PlayerSurface.tsx';
import {setGlobalShortcutsSuspended} from '/src/features/shortcuts/services/globalShortcutCommands.ts';
import '/src/index.css';
const noop=()=>{};
const tracks=[
  {id:'alpha',title:'Alpha Moon',artist:'Artist One',album:'First Album'},
  {id:'beta',title:'Beta Sun',artist:'Singer Two',album:'Second Album'},
  {id:'gamma',title:'Gamma Star',artist:'Artist Three',album:'Third Album'},
  ...(new URLSearchParams(location.search).has('manyTracks') ? Array.from({length:80},(_,index)=>({id:'scroll-'+index,title:'Scroll Track '+index,artist:'Scroll Artist',album:'Scroll Album'})) : []),
].map(t=>({...t,durationSeconds:180,fileExtension:'flac',coverTone:'lagoon',hasLocalArtwork:false}));
window.playlistRequests=[];
window.suspendCapture=value=>setGlobalShortcutsSuspended(value);
function Fixture(){
  const [open,setOpen]=React.useState(false);
  const [searchOpen,setSearchOpen]=React.useState(false);
  const request=React.useCallback(value=>{window.playlistRequests.push(value);setOpen(value)},[]);
  window.setPlaylistOpen=setOpen;
  const viewModel={
    search:{isOpen:searchOpen,onOpenChange:setSearchOpen},
    playback:{track:null,contentState:'empty',isPlaying:false,shuffleMode:'none',repeatMode:'list-loop',isAudioBusy:false,isTransportBusy:false,statusText:'',onOpenAudio:noop,onPrevious:noop,onNext:noop,onPlayToggle:async r=>({requestId:r.requestId,completed:true}),onShuffleCycle:noop,onRepeatCycle:noop},
    timeline:{positionSeconds:0,durationSeconds:0,interaction:'following',onPreviewStart:noop,onPreview:noop,onCommit:noop,onCancelPreview:noop},
    volume:{valuePercent:50,isBusy:false,isDisabled:false,onChange:noop},
    queue:{tracks,isOpen:false,onToggle:noop},
    playlist:{library:{isOpen:false,route:{view:'tracks'},items:[],allSongs:tracks.map(t=>({key:t.id,scope:'fixture',trackId:t.id,sourcePath:t.id,available:true,track:t})),onOpen:noop,onSelect:noop,onPlay:noop},isOpen:open,onOpenChange:request,tracks,currentTrackId:new URLSearchParams(location.search).has('farCurrent')?'scroll-79':undefined,shuffleMode:'none',onShuffleCycle:noop,onOpenAudio:noop,onTrackSelect:noop},
    feedback:{onToggle:noop},
  };
  return React.createElement(PlayerSurface,{viewModel});
}
const root=ReactDOM.createRoot(document.getElementById('root'));
window.unmountFixture=()=>root.unmount();
root.render(React.createElement(React.StrictMode,null,React.createElement(AppearanceProvider,null,React.createElement(Fixture))));
`
const core = `
export const isTauri=()=>true;
export const convertFileSrc=value=>value;
export async function invoke(command,args){
  window.commands.push({command,args});
  if(command==='global_shortcuts_get_settings')return structuredClone(window.shortcutSettings);
  if(command==='global_shortcuts_set_suspended'){
    window.shortcutSettings.suspended=args.suspended;
    return structuredClone(window.shortcutSettings);
  }
  if(command==='global_shortcuts_update_settings'){
    window.shortcutSettings.bindings=structuredClone(args.input.bindings);
    return structuredClone(window.shortcutSettings);
  }
  throw new Error('unexpected IPC '+command);
}
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__local_search_fixture.js"')
const browser = await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge'})
console.log('BROWSER', browser.version())
let passed = 0
async function open(manyTracks=false) {
  const page = await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'})
  const errors = []
  page.on('pageerror', error => {errors.push(error.message);console.log('PAGEERROR',error.message)})
  await page.addInitScript(() => {
    localStorage.setItem('spmusic.playlist.layout-level.v1','7')
    window.commands=[]
    window.shortcutSettings={bindings:{previous:'Ctrl+Alt+ArrowLeft',next:'Ctrl+Alt+ArrowRight',volumeUp:'Ctrl+Alt+ArrowUp',volumeDown:'Ctrl+Alt+ArrowDown',togglePlayback:'Ctrl+KeyP'},issues:[],suspended:false}
    window.keyListeners=[]
    const add=EventTarget.prototype.addEventListener, remove=EventTarget.prototype.removeEventListener
    EventTarget.prototype.addEventListener=function(type,listener,options){
      if(this===window && type==='keydown')window.keyListeners.push({listener,active:true,source:String(listener)})
      return add.call(this,type,listener,options)
    }
    EventTarget.prototype.removeEventListener=function(type,listener,options){
      if(this===window && type==='keydown')for(const entry of window.keyListeners)if(entry.listener===listener)entry.active=false
      return remove.call(this,type,listener,options)
    }
  })
  await page.route('**/@tauri-apps_api_core.js*',route=>route.fulfill({contentType:'text/javascript',body:core}))
  await page.route('**/__local_search_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__local_search_test*',route=>route.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin+'/__local_search_test'+(manyTracks?'?manyTracks=1'+(manyTracks==='current'?'&farCurrent=1':''):''))
  await page.locator('.player-shell').waitFor()
  await page.waitForFunction(()=>window.keyListeners.some(entry=>entry.active&&entry.source.includes('searchRequestSequenceRef')))
  return {page,errors}
}
async function check(name,run,manyTracks=false){
  if(process.env.SPMUSIC_TEST_FILTER&&!name.includes(process.env.SPMUSIC_TEST_FILTER))return
  console.log('CHECK',name)
  const {page,errors}=await open(manyTracks)
  try{
    await run(page)
    assert.deepEqual(errors,[],'no unhandled page errors')
    console.log('PASS',name);passed++
  }finally{await page.close()}
}
const input=page=>page.getByRole('searchbox',{name:'聚合搜索',exact:true})
async function assertFocused(page){
  await input(page).waitFor()
  await page.waitForFunction(()=>document.activeElement===document.querySelector('.search-page input'))
}
async function dispatch(page,extra={}){
  return page.evaluate(extra=>{
    const event=new KeyboardEvent('keydown',{key:'f',code:'KeyF',ctrlKey:true,bubbles:true,cancelable:true,...extra})
    window.dispatchEvent(event)
    return event.defaultPrevented
  },extra)
}
try{
  await check('Ctrl+F opens independent search, preserves its query and returns without changing the source page',async page=>{
    assert.equal(await dispatch(page),true)
    await assertFocused(page)
    await input(page).fill('Beta')
    await page.waitForFunction(()=>document.querySelectorAll('.search-songs .playlist-card').length===1)
    assert.equal(await page.locator('.search-songs .playlist-card').getAttribute('data-playlist-track-id'),'beta')
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
    await page.keyboard.press('Control+f')
    await page.locator('.search-page').waitFor({state:'hidden'})
    await page.keyboard.press('Control+f')
    await assertFocused(page)
    assert.equal(await input(page).inputValue(),'Beta')
    await page.locator('.playlist-playback-dock').getByRole('button',{name:'搜索',exact:true}).click()
    await page.locator('.search-page').waitFor({state:'hidden'})
  })
  await check('unrelated combinations and repeat events do not open search; source list survives a round trip',async page=>{
    for(const event of [{ctrlKey:false},{altKey:true},{shiftKey:true},{metaKey:true},{repeat:true},{isComposing:true},{key:'g',code:'KeyG'}]) assert.equal(await dispatch(page,event),false)
    assert.equal(await page.locator('.search-page').isVisible(),false)
    await page.evaluate(()=>window.setPlaylistOpen(true))
    await page.locator('.playlist-panel').waitFor()
    await page.keyboard.press('Control+f');await assertFocused(page)
    await page.keyboard.press('Control+f')
    await page.locator('.search-page').waitFor({state:'hidden'})
    assert.equal(await page.locator('.playlist-panel').isVisible(),true)
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
  })
  await check('settings and recording own Ctrl+F; modal events are not hijacked',async page=>{
    await page.getByRole('button',{name:'设置',exact:true}).click()
    await page.getByRole('dialog').waitFor()
    assert.equal(await dispatch(page),false,'open settings protects even window-target input')
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
    await page.locator('#shortcut-next').click()
    await page.getByText('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。',{exact:true}).waitFor()
    await page.keyboard.press('Control+f')
    await page.waitForFunction(()=>!window.shortcutSettings.suspended)
    assert.equal(await page.locator('#shortcut-next').innerText(),'Ctrl + F','recording receives Ctrl+F')
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
    assert.equal(await page.locator('.playlist-panel').count(),0)
  })
  await check('capture gate alone and consumed events suppress local search',async page=>{
    await page.evaluate(()=>window.suspendCapture(true))
    assert.equal(await dispatch(page),false)
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
    await page.evaluate(()=>window.suspendCapture(false))
    // Exercise the role-based modal guard independently of an open SettingsDialog.
    const prevented=await page.evaluate(()=>{
      const modal=document.createElement('div');modal.setAttribute('role','alertdialog')
      const target=document.createElement('textarea');modal.append(target);document.body.append(modal)
      const event=new KeyboardEvent('keydown',{key:'f',code:'KeyF',ctrlKey:true,bubbles:true,cancelable:true})
      target.dispatchEvent(event);modal.remove();return event.defaultPrevented
    })
    assert.equal(prevented,false)
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
    const handled=await page.evaluate(()=>{
      const event=new KeyboardEvent('keydown',{key:'f',code:'KeyF',ctrlKey:true,bubbles:true,cancelable:true})
      event.preventDefault();window.dispatchEvent(event);return event.defaultPrevented
    })
    assert.equal(handled,true)
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
    assert.equal(await dispatch(page),true)
    await assertFocused(page)
    assert.equal(await page.evaluate(()=>window.commands.some(command=>command.command==='global_shortcuts_update_settings')),false,'local search never updates native bindings')
  })
  await check('StrictMode has one local listener and unmount releases it',async page=>{
    const listeners=await page.evaluate(()=>window.keyListeners.filter(entry=>entry.source.includes('searchRequestSequenceRef')).map(entry=>entry.active))
    assert.equal(listeners.filter(Boolean).length,1)
    assert.ok(listeners.includes(false),'StrictMode first mount cleaned')
    await page.keyboard.press('Control+f');await assertFocused(page)
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
    await page.evaluate(()=>window.unmountFixture())
    assert.equal(await page.evaluate(()=>window.keyListeners.filter(entry=>entry.active&&entry.source.includes('searchRequestSequenceRef')).length),0)
    assert.equal(await dispatch(page),false)
    assert.deepEqual(await page.evaluate(()=>window.playlistRequests),[])
  })
  console.log('LOCAL_SEARCH_RESULT',passed,'passed; real player/list UI, fixture audio and settings IPC')
}finally{await browser.close()}
