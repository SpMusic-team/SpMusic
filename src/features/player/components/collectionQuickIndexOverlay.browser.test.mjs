// Geometry/interaction regression: quick-index visibility must not reserve content space.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match);return match[1]}
const fixtureFrom=file=>{const source=readFileSync(new URL(file,import.meta.url),'utf8');const match=source.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/);assert(match);return runInNewContext(match[1],{dependency})}
const fixtures={filesystem:fixtureFrom('./artistLibrary.browser.test.mjs'),playlists:fixtureFrom('./playlistManagementLayouts.browser.test.mjs')}
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
 .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
 .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()
const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__index_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__index_fixture.js"')
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']})
const report=[]
async function open(width,kind){
 const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(12000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
 await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
 await page.route('**/__index_real_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}))
 await page.route('**/__index_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixtures[kind]}))
 await page.route('**/__index_test?*',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.addInitScript(()=>{localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.removeItem('spmusic.player.session.v1')})
 await page.goto(origin+'/__index_test?fixture='+kind);await page.evaluate(()=>document.fonts.ready)
 if(kind==='filesystem')await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50&&!window.vm.playlist.library.isImportPending)
 return {page,errors}
}
async function verify(page,category,width){
 console.log('QUICK_INDEX_CASE',category,width)
 const nav=page.locator('.playlist-management-quick-index').last();await nav.waitFor()
 const snapshot=()=>nav.evaluate(node=>{
  const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
  const panel=node.parentElement.querySelector('.playlist-management-content:not([inert])')
  const grid=panel.querySelector('.all-songs-list,.album-list,.folder-directory-list,.playlist-management-grid')
  const cards=[...grid.querySelectorAll('.playlist-card,.folder-row,.playlist-management-card')]
  return {panel:rect(panel),grid:rect(grid),columns:getComputedStyle(grid).gridTemplateColumns,padding:[getComputedStyle(grid).paddingLeft,getComputedStyle(grid).paddingRight],cards:cards.map(rect)}
 })
 const geometry=await nav.evaluate(node=>({position:getComputedStyle(node).position,pointer:getComputedStyle(node).pointerEvents,parentWidth:node.parentElement.getBoundingClientRect().width,right:node.getBoundingClientRect().right}))
 assert.equal(geometry.position,'absolute',category+' index is an overlay');assert.equal(geometry.pointer,'auto')
 const shown=await snapshot();assert(shown.cards.length>0,category+' has actual cards')
 if(category==='songs')assert.equal(shown.padding[0],shown.padding[1],'songs has no asymmetric index reservation')
 else assert(parseFloat(shown.padding[1])<=parseFloat(shown.padding[0]),category+' has no additional right-side index reservation')
 await nav.evaluate(node=>node.style.display='none');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 assert.deepEqual(await snapshot(),shown,category+' index visibility does not change content bbox, cards or columns')
 await nav.evaluate(node=>node.style.display='');await nav.getByRole('button',{name:'返回列表顶部',exact:true}).press('Enter')
 assert.equal(await nav.getByRole('button',{name:'返回列表顶部',exact:true}).getAttribute('aria-current'),'true',category+' overlay still handles keyboard activation')
 report.push({category,width,columns:shown.columns,padding:shown.padding,panelWidth:shown.panel.width,gridWidth:shown.grid.width,cards:shown.cards.length})
}
try{
 for(const width of [640,1280]){
  const {page,errors}=await open(width,'filesystem')
  for(const category of ['songs','folder','folders','album','artist']){
   await page.evaluate(category=>window.vm.playlist.library.onSelectCategory(category),category)
   await page.waitForFunction(category=>window.vm.playlist.library.route.categoryId===category,category)
   await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')
   await verify(page,category,width)
  }
  assert.deepEqual(errors,[]);await page.close()
  const management=await open(width,'playlists');await verify(management.page,'playlists',width);assert.deepEqual(management.errors,[]);await management.page.close()
 }
 console.log('QUICK_INDEX_OVERLAY_GEOMETRY',JSON.stringify(report))
}finally{await browser.close()}
