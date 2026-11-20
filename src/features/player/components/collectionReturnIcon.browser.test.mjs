// Mechanical return-icon regression; baseline captures real pre-change glyph/button geometry.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const require=createRequire(import.meta.url),{chromium}=require(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173',baseline=process.env.SPMUSIC_BACK_ICON_BASELINE==='1'
const entry=await(await fetch(origin+'/src/main.tsx')).text(),dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match);return match[1]}
const literal=file=>{const source=readFileSync(new URL(file,import.meta.url),'utf8'),match=source.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/);assert(match);return runInNewContext(match[1],{dependency})}
const fixtures={filesystem:literal('./artistLibrary.browser.test.mjs'),playlist:literal('./playlistManagementLayouts.browser.test.mjs').replace("[view,setView]=React.useState('management')","[view,setView]=React.useState('detail')")}
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text()).replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;').replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const realSurface=await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text(),surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__return_real_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__return_fixture.js"')
const browser=await chromium.launch({headless:true,channel:'msedge',args:['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']})
const directory=process.env.SPMUSIC_TEST_SCREENSHOTS||'C:/Users/winkeses/AppData/Local/Temp/spmusic-return-icons';mkdirSync(directory,{recursive:true});const report=[]
async function open(kind){
 const page=await browser.newPage({viewport:{width:640,height:600},reducedMotion:'reduce'});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}));await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}));await page.route('**/__return_real_surface.js',route=>route.fulfill({contentType:'text/javascript',body:realSurface}));await page.route('**/__return_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixtures[kind]}));await page.route('**/__return_test?*',route=>route.fulfill({contentType:'text/html',body:html}));await page.addInitScript(()=>{localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.removeItem('spmusic.player.session.v1')})
 await page.goto(origin+'/__return_test?large=1');if(kind==='filesystem')await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===230&&!window.vm.playlist.library.isImportPending);else await page.locator('.playlist-panel').waitFor();return {page,errors}
}
async function geometry(button){return button.evaluate(node=>{const icon=node.querySelector('svg'),r=icon.getBoundingClientRect(),b=node.getBoundingClientRect(),s=getComputedStyle(icon);return {width:r.width,height:r.height,buttonWidth:b.width,buttonHeight:b.height,aria:node.getAttribute('aria-label'),class:icon.getAttribute('class'),color:s.color}})}
async function inspect(page,category){
 const hero=page.locator('.playlist-hero-category');await hero.waitFor();const first=await geometry(hero);report.push({category,slot:'hero',...first});console.log('RETURN_ICON',JSON.stringify(report.at(-1)))
 const panel=page.locator(category==='playlist'?'.playlist-panel':'.playlist-management-content:not([inert])');await panel.evaluate(node=>node.scrollTop=node.scrollHeight)
 const compact=page.locator('.playlist-controller-actions[data-actions-visible="true"] .playlist-controller-back-button').last();await compact.waitFor()
 const last=await geometry(compact);report.push({category,slot:'compact',...last});console.log('RETURN_ICON',JSON.stringify(report.at(-1)))
 if(!baseline){
  const expected=process.env.SPMUSIC_BACK_ICON_BASELINE_FILE?JSON.parse(readFileSync(process.env.SPMUSIC_BACK_ICON_BASELINE_FILE,'utf8')):Object.entries({album:[94,'返回专辑'],artist:[114,'返回艺术家'],folder:[114,'返回上一级文件夹'],folders:[202,'返回上一级文件夹'],playlist:[136,'返回播放列表管理']}).flatMap(([category,[width,aria]])=>[{category,slot:'hero',width:28,height:28,buttonWidth:width,buttonHeight:36,aria},{category,slot:'compact',width:24,height:24,buttonWidth:36,buttonHeight:36,aria:'返回'}])
  for(const [slot,actual] of [['hero',first],['compact',last]]){const before=expected.find(item=>item.category===category&&item.slot===slot);for(const key of ['width','height','buttonWidth','buttonHeight','aria'])assert.equal(actual[key],before[key],category+' '+slot+' retains '+key)}
 }
 return {hero,compact,panel}
}
async function openDetail(page,category){
 if(category==='playlist'){await page.evaluate(()=>window.showDetail());await page.locator('.playlist-panel').waitFor()}
 else if(category==='album')await page.locator('.album-card').filter({has:page.locator('.folder-name',{hasText:/^Large$/})}).click()
 else if(category==='artist')await page.locator('.artist-card').filter({has:page.locator('.folder-name',{hasText:/^Large Singer$/})}).click()
 else await page.locator('.folder-row[data-folder-path="'+(category==='folder'?'/music/Large':'/music')+'"]').first().click()
}
async function expectRoot(page,category){
 if(category==='playlist')await page.locator('.playlist-management-grid').waitFor()
 else await page.waitForFunction(category=>{const lib=window.vm.playlist.library;return category==='album'?lib.albumLocation===null:category==='artist'?lib.artistLocation===null:category==='folder'?lib.flatFolderLocation===null:lib.folderLocation===null},category)
}
async function verifyAsset(button,page){
 const expected=(await page.evaluate(async()=>(await import('/src/assets/playlist-library/427b5.svg?import')).default))
 const actual=await button.evaluate(node=>{const svg=node.querySelector('svg');return {mask:getComputedStyle(svg).maskImage,paths:svg.querySelectorAll('path').length}})
 assert(actual.mask?.includes(expected),'return icon uses the exact approved original asset mask');assert.equal(actual.paths,0,'no independent Lucide path remains')
 const theme=await button.evaluate(node=>{const icon=node.querySelector('svg'),old=icon.style.color;icon.style.color='rgb(17, 34, 51)';const result=getComputedStyle(icon.querySelector('rect')).fill;icon.style.color=old;return result})
 assert.equal(theme,'rgb(17, 34, 51)','original return graphic follows currentColor')
}
async function verifyNavigation(page,category,controls){
 await verifyAsset(controls.compact,page);await controls.compact.focus();await page.keyboard.press('Enter');await expectRoot(page,category)
 await openDetail(page,category);const hero=page.locator('.playlist-hero-category');await hero.waitFor();await verifyAsset(hero,page);await hero.scrollIntoViewIfNeeded();await page.screenshot({path:directory+'/'+category+'-return.png'});await hero.click();await expectRoot(page,category)
}
try{
 for(const category of ['album','artist','folder','folders']){
  const {page,errors}=await open('filesystem');await page.evaluate(category=>window.vm.playlist.library.onSelectCategory(category),category);await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')
  await openDetail(page,category)
  const controls=await inspect(page,category);if(!baseline)await verifyNavigation(page,category,controls);assert.deepEqual(errors,[]);await page.close()
 }
 const {page,errors}=await open('playlist');const controls=await inspect(page,'playlist');if(!baseline)await verifyNavigation(page,'playlist',controls);assert.deepEqual(errors,[]);await page.close()
 writeFileSync(directory+(baseline?'/baseline.json':'/result.json'),JSON.stringify(report,null,2));console.log('return icons '+(baseline?'baseline':'regression')+' complete '+directory)
}finally{await browser.close()}
