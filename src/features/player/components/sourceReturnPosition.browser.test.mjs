// Start Vite and set SPMUSIC_PLAYWRIGHT to an existing installation.
// Real shell, source pages, Motion, card DOM and audio hook; native IO is controlled.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const { chromium } = createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'))
  assert(match,'resolve '+name);return match[1]
}
const existing=readFileSync(new URL('./allSongs.browser.test.mjs',import.meta.url),'utf8')
const literal=existing.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal)
const fixture=runInNewContext(literal[1],{dependency}).replace('length:50',process.env.SPMUSIC_TEST_FAR?'length:800':'length:50')
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'))
const fetchedSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
const realSurface=process.env.SPMUSIC_RETURN_POSITION_BASELINE
  ? fetchedSurface.replace('entryPosition: playlist.entryPosition,','') : fetchedSurface
if(process.env.SPMUSIC_RETURN_POSITION_BASELINE)assert.notEqual(realSurface,fetchedSurface,'baseline removes the library entry request')
const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as Surface} from '/__source_position_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(Surface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__source_position_fixture.js"')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
let passed=0
const panelSelector=kind=>kind==='all-songs'?'.playlist-management-content':'.playlist-panel'
const gridSelector=kind=>kind==='all-songs'?'.all-songs-list':'.playlist-grid:not(.all-songs-list)'
const cardSelector=(kind,id)=>gridSelector(kind)+' [data-playlist-track-id="'+id+'"]'
async function open(width,level,{late=false}={}){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'no-preference'}),errors=[]
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(level=>{
    localStorage.setItem('spmusic.player.startup-page.v1','media-library')
    localStorage.setItem('spmusic.all-songs.layout-level.v1',String(level))
    localStorage.setItem('spmusic.playlist.layout-level.v1',String(level))
  },level)
  await page.route('**/src/features/player/services/audioCommands.ts*',r=>r.fulfill({contentType:'text/javascript',body:service}))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*',r=>r.fulfill({contentType:'text/javascript',body:surface}))
  await page.route('**/__source_position_surface.js',r=>r.fulfill({contentType:'text/javascript',body:realSurface}))
  await page.route('**/__source_position_fixture.js',r=>r.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__source_position_test*',r=>r.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin+'/__source_position_test')
  await page.waitForFunction(()=>Boolean(window.vm))
  await page.evaluate(late=>{window.summaryGate=late;window.choice='many';window.vm.playlist.library.onSelectFolders()},late)
  await page.waitForFunction(()=>!window.vm.playlist.library.isImportPending&&window.vm.playlist.library.items.length===1)
  return {page,errors}
}
async function source(page,kind){
  await page.evaluate(kind=>window.vm.playlist.library.onSelectCategory(kind==='all-songs'?'songs':'folder'),kind)
  if(kind==='playlist')await page.getByRole('button',{name:'打开文件夹 Folder many',exact:true}).click()
  await page.locator(gridSelector(kind)+' .playlist-card').first().waitFor()
}
async function settle(page,kind,id){
  await page.evaluate(async({panelSelector,cardSelector})=>{
    let previous='',stable=0
    for(let i=0;i<180;i++){
      await new Promise(requestAnimationFrame)
      const panel=document.querySelector(panelSelector),card=document.querySelector(cardSelector)
      if(!panel||!card)continue
      const p=panel.getBoundingClientRect(),c=card.getBoundingClientRect(),value=[p.top,p.bottom,c.top,c.bottom,panel.scrollTop].map(n=>Math.round(n*10)).join(',')
      stable=value===previous?stable+1:0;previous=value
      if(stable>=5)return
    }
    throw Error('source geometry did not settle')
  },{panelSelector:panelSelector(kind),cardSelector:cardSelector(kind,id)})
}
const geometry=(page,kind,id)=>page.evaluate(({panelSelector,cardSelector})=>{
  const panel=document.querySelector(panelSelector),card=document.querySelector(cardSelector),p=panel.getBoundingClientRect(),c=card.getBoundingClientRect()
  return {scrollTop:panel.scrollTop,maxScroll:panel.scrollHeight-panel.clientHeight,panelTop:p.top,panelBottom:p.bottom,cardTop:c.top,cardBottom:c.bottom,visible:c.top>=p.top-2&&c.bottom<=p.bottom+2,entry:window.vm.playlist.entryPosition,current:window.vm.playback.track?.id}
},{panelSelector:panelSelector(kind),cardSelector:cardSelector(kind,id)})
async function player(page,kind){
  await page.locator('.playlist-playback-dock .playlist-playback-track-button').click()
  await page.waitForFunction(()=>!window.vm.playlist.isOpen)
  await page.locator(panelSelector(kind)).waitFor({state:'detached'})
}
async function returnCurrent(page,kind,id){
  await page.locator('.cover-collapse-button').first().click()
  await page.waitForFunction(()=>window.vm.playlist.isOpen)
  await settle(page,kind,id)
  const result=await geometry(page,kind,id)
  console.log('SOURCE_POSITION',JSON.stringify({kind,id,...result}))
  assert(result.scrollTop>0,'far current track is not returned to the top')
  assert(result.visible,'current card is fully inside the actual source viewport')
}
async function manualTop(page,kind,id){
  const panel=page.locator(panelSelector(kind)),rect=await panel.boundingBox()
  const polls=await page.evaluate(()=>window.calls.filter(call=>call.command==='audio_get_state').length)
  await page.mouse.move(rect.x+rect.width*.55,rect.y+Math.min(180,rect.height/2))
  await page.mouse.wheel(0,-100000)
  await page.waitForFunction(selector=>document.querySelector(selector).scrollTop<2,panelSelector(kind))
  await page.waitForFunction(count=>window.calls.filter(call=>call.command==='audio_get_state').length>count,polls)
  assert((await panel.evaluate(node=>node.scrollTop))<2,'manual scrolling survives a real playback-state publication')
}
async function check(name,kind,width,level,run){
  if(process.env.SPMUSIC_TEST_FILTER&&!name.includes(process.env.SPMUSIC_TEST_FILTER))return
  const {page,errors}=await open(width,level)
  try{
    await source(page,kind)
    await page.locator(cardSelector(kind,'many-42')).click()
    await page.waitForFunction(()=>window.vm.playback.track?.id==='many-42'&&!window.vm.playback.isSelectionPending&&!window.vm.playback.isAudioBusy)
    await player(page,kind)
    await returnCurrent(page,kind,'many-42')
    if(run)await run(page)
    assert.deepEqual(errors,[]);passed++;console.log('PASS',name)
  }finally{await page.close()}
}
async function delayedMetadata(cancel=false){
  const name=cancel?'late metadata honors explicit wheel navigation':'late metadata positions current card when rows arrive'
  if(process.env.SPMUSIC_TEST_FILTER&&!name.includes(process.env.SPMUSIC_TEST_FILTER))return
  const {page,errors}=await open(1440,7,{late:true})
  try{
    await page.waitForFunction(()=>window.pendingSummaries.length>0)
    // A restored/background source may still be waiting on its read-only tags.
    // The real playback callback receives its complete descriptor snapshot.
    await page.evaluate(()=>{
      const songs=window.vm.playlist.library.allSongs,current=songs.find(song=>song.trackId==='many-42')
      window.vm.playlist.library.onPlaySong(current.scope,current.trackId,songs.map(song=>({scope:song.scope,trackId:song.trackId})))
    })
    await page.waitForFunction(()=>window.vm.playback.track?.id==='many-42'&&!window.vm.playback.isSelectionPending&&!window.vm.playback.isAudioBusy)
    await player(page,'all-songs')
    await page.locator('.cover-collapse-button').first().click()
    await page.waitForFunction(()=>window.vm.playlist.isOpen)
    await page.locator('.playlist-management-content[data-metadata-loading]').waitFor()
    assert.equal(await page.locator('.all-songs-list .playlist-card').count(),0)
    if(cancel){
      const rect=await page.locator('.playlist-management-content').boundingBox()
      await page.mouse.move(rect.x+rect.width/2,rect.y+160)
      await page.mouse.wheel(0,-300)
    }
    await page.evaluate(()=>{window.summaryGate=false;window.pendingSummaries.splice(0).forEach(resolve=>resolve())})
    await page.locator(cardSelector('all-songs','many-42')).waitFor()
    await settle(page,'all-songs','many-42')
    const result=await geometry(page,'all-songs','many-42')
    console.log('LATE_SOURCE_POSITION',JSON.stringify({cancel,...result}))
    if(cancel)assert(result.scrollTop<2&&!result.visible,'late metadata does not override explicit top navigation')
    else assert(result.scrollTop>0&&result.visible,'pending return positions the current card once real rows arrive')
    assert.deepEqual(errors,[]);passed++;console.log('PASS',name)
  }finally{await page.close()}
}
try{
  if(process.env.SPMUSIC_TEST_FAR) {
    const {page,errors}=await open(640,7)
    try{
      await source(page,'all-songs')
      assert((await page.locator('.all-songs-list .playlist-card').count())<40,'distant source uses a bounded render window')
      await page.evaluate(()=>{
        const songs=window.vm.playlist.library.allSongs,target=songs.find(song=>song.trackId==='many-750')
        window.vm.playlist.library.onPlaySong(target.scope,target.trackId,songs.map(song=>({scope:song.scope,trackId:song.trackId})))
      })
      await page.waitForFunction(()=>window.vm.playback.track?.id==='many-750'&&!window.vm.playback.isSelectionPending&&!window.vm.playback.isAudioBusy)
      await player(page,'all-songs')
      await returnCurrent(page,'all-songs','many-750')
      assert((await page.locator('.all-songs-list .playlist-card').count())<40,'return preserves bounded rendering')
      await manualTop(page,'all-songs','many-750')
      assert.deepEqual(errors,[])
      passed++
      console.log('PASS all songs distant virtual row 750 and one-shot return')
    }finally{await page.close()}
  } else {
  await check('all songs wide multi-column current position and one-shot return','all-songs',1440,0,async page=>{
    await player(page,'all-songs')
    await page.locator('.control-dock .next-button').click()
    await page.waitForFunction(()=>window.vm.playback.track?.id==='many-43'&&!window.vm.playback.isSelectionPending&&!window.vm.playback.isAudioBusy)
    await returnCurrent(page,'all-songs','many-43')
    await manualTop(page,'all-songs','many-43')
    await player(page,'all-songs')
    await returnCurrent(page,'all-songs','many-43')
    await page.getByRole('button',{name:'返回列表顶部',exact:true}).click()
    assert((await geometry(page,'all-songs','many-43')).scrollTop<2)
    await page.getByRole('button',{name:'查找 Z 开头的歌曲',exact:true}).click()
    await settle(page,'all-songs','many-25')
    const indexed=await geometry(page,'all-songs','many-25')
    assert(Math.abs(indexed.cardTop-indexed.panelTop-8)<3,'quick index keeps its own positioning')
    await page.getByRole('button',{name:'搜索所有歌曲',exact:true}).click()
    const search=page.getByRole('searchbox',{name:'搜索歌曲标题、艺术家或专辑'})
    await search.fill('A Song 1')
    await page.waitForFunction(()=>document.querySelectorAll('.all-songs-list .playlist-card').length===11)
    await search.fill('')
    await page.waitForFunction(()=>document.querySelectorAll('.all-songs-list .playlist-card').length===50)
    await settle(page,'all-songs','many-43')
    assert.equal((await geometry(page,'all-songs','many-43')).visible,false,'clearing search does not replay an already consumed return request')
  })
  await check('all songs compact row current position','all-songs',640,7)
  await check('playlist wide multi-column control position','playlist',1440,0)
  await check('playlist compact row current position','playlist',640,7)
  await delayedMetadata()
  await delayedMetadata(true)
  }
  console.log('SOURCE_RETURN_POSITION_RESULT',passed,'passed')
}finally{await browser.close()}
