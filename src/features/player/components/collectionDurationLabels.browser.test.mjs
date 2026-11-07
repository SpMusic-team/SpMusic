// Read real collection heroes and artist menu text after native duration transport.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match);return match[1]}
const source=readFileSync(new URL('./artistLibrary.browser.test.mjs',import.meta.url),'utf8'),literal=source.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/);assert(literal)
const fixture=runInNewContext(literal[1],{dependency}).replace('window.calls=[];','const duration=Number(new URLSearchParams(location.search).get("seconds")??399)*1000;window.calls=[];').replaceAll('180000','duration')
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text()).replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;').replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text(),surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__duration_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__duration_fixture.js"')
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']})
const directory=process.env.SPMUSIC_TEST_SCREENSHOTS
if(directory)mkdirSync(directory,{recursive:true})
const report=[]
const clock=seconds=>{const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60,remaining=String(seconds%60).padStart(2,'0');return hours?`${hours}:${String(minutes).padStart(2,'0')}:${remaining}`:`${minutes}:${remaining}`}
async function open(seconds){
 const page=await browser.newPage({viewport:{width:640,height:1440},reducedMotion:'reduce'});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}));await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}));await page.route('**/__duration_real_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}));await page.route('**/__duration_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}));await page.route('**/__duration_test?*',route=>route.fulfill({contentType:'text/html',body:html}));await page.addInitScript(()=>{localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.removeItem('spmusic.player.session.v1')})
 await page.goto(origin+'/__duration_test?seconds='+seconds);await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===50&&!window.vm.playlist.library.isImportPending);return {page,errors}
}
const select=async(page,id)=>{await page.evaluate(id=>window.vm.playlist.library.onSelectCategory(id),id);await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')}
async function verifyHero(page,selector,seconds,label){
 const meta=page.locator(selector+' .playlist-hero-meta:not(.collection-hero-parent-meta)');await meta.waitFor()
 await page.waitForFunction(selector=>document.querySelector(selector+' .playlist-hero-meta:not(.collection-hero-parent-meta)')?.textContent.includes('|'),selector)
 const text=(await meta.textContent()).trim(),match=text.match(/^(\d+)\s*\|\s*(.+)$/);assert(match);assert.equal(match[2],clock(Number(match[1])*seconds));report.push({label,text});return text
}
try{
 const {page,errors}=await open(399);await select(page,'artist');await page.locator('.artist-card').filter({hasText:'Singer A'}).click();await verifyHero(page,'.album-hero',399,'artist albums')
 await page.locator('.artist-all-songs').click();await page.locator('.album-hero').waitFor();assert.equal(await page.locator('.album-hero .playlist-hero-meta').textContent(),'4 首歌曲','artist songs design uses count-only metadata');await page.locator('.playlist-hero-category').click()
 await page.locator('.album-card').filter({hasText:'Mixed'}).click();await verifyHero(page,'.album-hero',399,'artist album subset')
 await page.locator('.album-hero .playlist-hero-more-button').click();const artistMenu=page.getByRole('dialog',{name:'艺术家更多操作',exact:true});await artistMenu.waitFor();assert.match(await artistMenu.locator('.playlist-hero-more-info p').textContent(),/4\s*\|\s*26:36/);await page.keyboard.press('Escape')
 await select(page,'album');await page.locator('.album-card').filter({hasText:'Mixed'}).click();await verifyHero(page,'.album-hero',399,'global album')
 for(const category of ['folder','folders']){
  await select(page,category);const path=category==='folder'?'/music/Compilation':'/music';await page.locator('.folder-row[data-folder-path="'+path+'"]').first().click();await verifyHero(page,'.folder-hero',399,category)
 }
 assert.deepEqual(errors,[]);await page.close()
 const long=await open(1299);await select(long.page,'artist');await long.page.locator('.artist-card').filter({hasText:'Singer A'}).click();await verifyHero(long.page,'.album-hero',1299,'artist over hour')
 await long.page.locator('.album-hero .playlist-hero-more-button').click();const menu=long.page.getByRole('dialog',{name:'艺术家更多操作',exact:true});await menu.waitFor();assert.match(await menu.locator('.playlist-hero-more-info p').textContent(),/4\s*\|\s*1:26:36/)
 await long.page.setViewportSize({width:360,height:260})
 await long.page.waitForFunction(()=>{const rect=document.querySelector('.playlist-hero-more-menu').getBoundingClientRect();return rect.width<=innerWidth-32+.1&&rect.height<=innerHeight-32+.1&&rect.top>=0&&rect.bottom<=innerHeight})
 const last=menu.getByRole('button',{name:'列表选项',exact:true});await last.focus()
 const visible=await last.evaluate(node=>{const r=node.getBoundingClientRect(),el=node.closest('[role="dialog"]'),dialog=el.getBoundingClientRect();return {visible:r.top>=dialog.top&&r.bottom<=dialog.bottom&&dialog.bottom<=innerHeight,row:r.toJSON(),dialog:dialog.toJSON(),scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,overflow:getComputedStyle(el).overflowY,viewport:innerHeight}});if(!visible.visible)console.error('ARTIST_TINY_GEOMETRY',visible);assert(visible.visible,'tiny artist dialog keeps the last action keyboard reachable')
 if(directory)await menu.screenshot({path:directory+'/artist-tiny-native-overflow.png'});await long.page.keyboard.press('Enter');await long.page.getByRole('dialog',{name:'列表选项',exact:true}).waitFor();await long.page.keyboard.press('Escape');assert.deepEqual(long.errors,[]);await long.page.close()
 console.log('COLLECTION_DURATION_LABELS',JSON.stringify(report))
}finally{await browser.close()}
