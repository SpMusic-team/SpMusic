// Real painted-frame acceptance of folder card <-> directory hero projection.
// SPMUSIC_FOLDER_NAV_BASELINE=1 records missing motion without accepting it.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const require=createRequire(import.meta.url)
const {chromium}=require(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match);return match[1]}
const shared=readFileSync(new URL('./folderHierarchy.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal,'reuse the real native-transport fixture')
const fixture=runInNewContext(literal[1],{dependency}).replace("ReactDOM.createRoot(document.getElementById('root')).render(","window.folderTestRoot=ReactDOM.createRoot(document.getElementById('root'));window.folderTestRoot.render(")
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const surfaceSource=(await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()).replace(/(const \[allSongsCoverStore\] = useState\(createAllSongsCoverStore\);?)/,'$1;window.folderCoverStore=allSongsCoverStore;')
assert(surfaceSource.includes('window.folderCoverStore'),'expose the real cover store for lease/disposal assertions')
const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface} from '/__folder_nav_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;window.settings=props.librarySettings;return React.createElement(RealSurface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__folder_nav_fixture.js"')
const directory=process.env.SPMUSIC_TEST_SCREENSHOTS||'C:/Users/winkeses/.codex/tmp/folder-navigation-motion'
mkdirSync(directory,{recursive:true})
const baseline=process.env.SPMUSIC_FOLDER_NAV_BASELINE==='1'
const browser=await chromium.launch({headless:true,channel:'msedge'})
const failures=[],report=[]
const expect=(condition,message)=>{if(!condition)failures.push(message)}
async function open({width=1280,motion='no-preference',large=false}={}){
 const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:motion});page.setDefaultTimeout(12000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>{
  localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.setItem('spmusic.folder-hierarchy.layout-level.v1','3')
  window.revocations=[];const revoke=URL.revokeObjectURL;URL.revokeObjectURL=url=>{window.revocations.push({url,time:performance.now()});return revoke(url)}
 })
 await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
 await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
 await page.route('**/__folder_nav_surface.js',route=>route.fulfill({contentType:'text/javascript',body:surfaceSource}))
 await page.route('**/__folder_nav_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__folder_nav_test?*',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__folder_nav_test?cover=1'+(large?'&large=1':''))
 await page.waitForFunction(count=>window.vm?.playlist.library.allSongs.length===count,large?180:5)
 await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('folders'))
 await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')
 await page.locator('.folder-row').first().waitFor();await page.evaluate(()=>document.fonts.ready)
 return{page,errors}
}
async function waitSettled(page,path){
 await page.waitForFunction(path=>{
  const panes=[...document.querySelectorAll('.folder-hierarchy-content')]
  return panes.length===1&&panes[0].dataset.directoryPath===path&&!panes[0].closest('[inert],[aria-hidden="true"]')
 },path).catch(async error=>{
  const diagnostic=await page.locator('.folder-hierarchy-content').evaluateAll(nodes=>nodes.map(node=>({directory:node.dataset.directoryPath,inert:node.hasAttribute('inert'),hidden:node.getAttribute('aria-hidden'),className:node.className,animations:node.getAnimations({subtree:true}).map(animation=>({target:animation.effect?.target?.className,state:animation.playState}))})))
  writeFileSync(`${directory}/${page.viewportSize().width}-${path.replaceAll('/','_')||'root'}-settle-failure.json`,JSON.stringify(diagnostic,null,2));console.error('FOLDER_NAVIGATION_SETTLE_FAILURE',JSON.stringify(diagnostic))
  await page.screenshot({path:`${directory}/${page.viewportSize().width}-settle-failure.png`});throw error
 })
}
async function trace(page,{name,sourceSelector,targetSelector,action,finalPath,projection=true,motion='no-preference'}){
 name=page.viewportSize().width+'-'+name
 await page.waitForFunction(selector=>{
  const node=[...document.querySelectorAll(selector)].at(-1),image=node?.querySelector('img.folder-cover-image,img.playlist-hero-image')
  return image?.complete&&image.naturalWidth>0
 },sourceSelector)
 const before=await page.locator(sourceSelector).last().evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
 const sourceTitleSelector=sourceSelector.replace('.folder-cover','.folder-name').replace('.playlist-hero-artwork','.playlist-hero-title')
 const targetTitleSelector=targetSelector.replace('.folder-cover','.folder-name').replace('.playlist-hero-artwork','.playlist-hero-title')
 const beforeTitle=await page.locator(sourceTitleSelector).last().evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
 const sourceUrl=await page.locator(sourceSelector).last().locator('img').evaluateAll(images=>images.find(img=>img.src.startsWith('blob:'))?.src??null)
 const cdp=await page.context().newCDPSession(page),painted=[]
 cdp.on('Page.screencastFrame',frame=>{painted.push(frame);void cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{})})
 await cdp.send('Page.startScreencast',{format:'png',maxWidth:page.viewportSize().width,maxHeight:1000,everyNthFrame:1})
 const promise=page.evaluate(async({sourceSelector,targetSelector,targetTitleSelector})=>{
  const box=node=>{const r=node.getBoundingClientRect();let opacity=1;for(let p=node;p;p=p.parentElement){const s=getComputedStyle(p);opacity*=Number(s.opacity);if(s.display==='none'||s.visibility==='hidden')opacity=0}const pane=node.closest('.folder-hierarchy-content'),group=pane?new DOMMatrixReadOnly(getComputedStyle(pane).transform):new DOMMatrixReadOnly();return{x:r.x,y:r.y,width:r.width,height:r.height,opacity,offsetWidth:node.offsetWidth,offsetHeight:node.offsetHeight,localTransform:getComputedStyle(node).transform,groupScale:group.a,groupTransform:group.toString()}}
  const start=performance.now(),frames=[];window.folderTraceReady=true
  while(performance.now()-start<800){
   const source=[...document.querySelectorAll(sourceSelector)].map(box),target=[...document.querySelectorAll(targetSelector)].map(box)
   const visibleImages=[...document.querySelectorAll(sourceSelector+' img,'+targetSelector+' img')].map(img=>({src:img.src,ready:img.complete&&img.naturalWidth>0,...box(img)})).filter(img=>img.opacity>.01&&img.width>1&&img.height>1)
   frames.push({time:performance.now(),source,target,title:[...document.querySelectorAll(targetTitleSelector)].map(box),visibleImages,revocations:[...window.revocations],panes:document.querySelectorAll('.folder-hierarchy-content').length})
   await new Promise(requestAnimationFrame)
  }
  return frames
 },{sourceSelector,targetSelector,targetTitleSelector})
 await page.waitForFunction(()=>window.folderTraceReady)
 await action()
 const frames=await promise
 await cdp.send('Page.stopScreencast');await cdp.detach()
 writeFileSync(`${directory}/${name}-captured.json`,JSON.stringify({before,frames,paintedFrames:painted.length},null,2))
 await waitSettled(page,finalPath).catch(async error=>{
  const diagnostic=await page.locator('.folder-hierarchy-content').evaluateAll(nodes=>nodes.map(node=>({directory:node.dataset.directoryPath,key:node.dataset.navigationKey,root:node.dataset.folderRoot,inert:node.hasAttribute('inert'),hidden:node.getAttribute('aria-hidden'),className:node.className,animations:node.getAnimations({subtree:true}).map(animation=>({target:animation.effect?.target?.className,state:animation.playState}))})))
  writeFileSync(`${directory}/${name}-failure.json`,JSON.stringify(diagnostic,null,2));console.error('FOLDER_NAVIGATION_PRESENCE_FAILURE',JSON.stringify(diagnostic))
  await page.screenshot({path:`${directory}/${name}-failure.png`});throw error
 })
 const after=await page.locator(targetSelector).last().evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
 const afterTitle=await page.locator(targetTitleSelector).last().evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
 const targetUrl=await page.locator(targetSelector).last().locator('img').evaluateAll(images=>images.find(img=>img.src.startsWith('blob:'))?.src??null)
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.width-b.width,a.height-b.height)
 const candidates=frames.flatMap(frame=>frame.target.filter(rect=>rect.opacity>.01))
 const intermediate=candidates.filter(rect=>distance(rect,before)>2&&distance(rect,after)>2
  &&rect.width>Math.min(before.width,after.width)+1&&rect.width<Math.max(before.width,after.width)-1
  &&rect.height>Math.min(before.height,after.height)+1&&rect.height<Math.max(before.height,after.height)-1)
 // The approved playlist return scales/translates the whole incoming pane.
 // Reject extra cover projection after removing that common parent scale.
 const offscreenFlying=projection?[]:candidates.filter(rect=>rect.groupScale<.99||rect.groupScale>1.51||Math.abs(rect.width/rect.groupScale-rect.offsetWidth)>1||Math.abs(rect.height/rect.groupScale-rect.offsetHeight)>1||!['none','matrix(1, 0, 0, 1, 0, 0)'].includes(rect.localTransform))
 const titleIntermediate=frames.flatMap(frame=>frame.title).filter(rect=>rect.opacity>.01&&distance(rect,beforeTitle)>2&&distance(rect,afterTitle)>2)
 const revokedVisible=frames.flatMap(frame=>frame.visibleImages.filter(img=>img.src.startsWith('blob:')&&frame.revocations.some(record=>record.url===img.src)))
 const result={name,before,after,frames:frames.length,paintedFrames:painted.length,intermediateFrames:intermediate.length,titleIntermediateFrames:titleIntermediate.length,sameCoverUrl:Boolean(sourceUrl&&sourceUrl===targetUrl),revokedVisible:revokedVisible.length,maxPanes:Math.max(...frames.map(frame=>frame.panes)),finalPanes:await page.locator('.folder-hierarchy-content').count()}
 report.push(result);writeFileSync(`${directory}/${name}.json`,JSON.stringify({result,frames},null,2))
 for(const[index,label]of[[0,'first'],[Math.floor(painted.length/2),'middle'],[painted.length-1,'last']])if(painted[index])writeFileSync(`${directory}/${name}-${label}.png`,Buffer.from(painted[index].data,'base64'))
 console.log('FOLDER_NAVIGATION_MOTION',JSON.stringify(result))
 expect(painted.length>=2,`${name}: capture real painted frames`)
 if(projection&&motion==='no-preference'){
  expect(intermediate.length>=2,`${name}: cover geometry has intermediate frames between its card and hero bounds`)
  expect(titleIntermediate.length>=2,`${name}: title geometry has intermediate frames between its card and hero slots`)
 }
 expect(result.sameCoverUrl,`${name}: the card and its directory hero reuse the same decoded source URL`)
 expect(!revokedVisible.length,`${name}: no visible projected cover URL is revoked`)
 if(!projection)expect(!offscreenFlying.length,`${name}: incoming pane follows the playlist local 1.5-to-1 scale without extra cover projection`)
 expect(result.maxPanes<=2,`${name}: at most outgoing and incoming panes coexist`)
 expect(result.finalPanes===1,`${name}: only one interactive page survives navigation`)
 await page.evaluate(()=>{window.folderTraceReady=false})
 return result
}
try{
 for(const width of [640,1280]){
  const{page,errors}=await open({width})
  const rootCover='[data-folder-path="/music"] .folder-cover',hero='.folder-hierarchy-content[data-directory-path="/music"] .playlist-hero-artwork'
  await page.locator('[data-folder-path="/music"]').scrollIntoViewIfNeeded()
  await page.locator('.folder-hierarchy-content').evaluate(node=>{node.scrollTop+=100})
  const rootScroll=await page.locator('.folder-hierarchy-content').evaluate(node=>node.scrollTop)
  await page.waitForFunction(()=>document.querySelector('[data-folder-path="/music"] .folder-cover-image')?.complete)
  const rootEntry=await trace(page,{name:'root-to-directory',sourceSelector:rootCover,targetSelector:hero,finalPath:'/music',action:()=>page.locator('[data-folder-path="/music"]').click()})
  await page.locator('.folder-hierarchy-content').evaluate(node=>{node.scrollTop=100})
  const parentScroll=await page.locator('.folder-hierarchy-content').evaluate(node=>node.scrollTop)
  const childCover='.folder-hierarchy-content[data-directory-path="/music"] [data-folder-path="/music/Album"] .folder-cover',childHero='.folder-hierarchy-content[data-directory-path="/music/Album"] .playlist-hero-artwork'
  const childEntry=await trace(page,{name:'parent-to-child',sourceSelector:childCover,targetSelector:childHero,finalPath:'/music/Album',action:()=>page.locator('[data-folder-path="/music/Album"]').click()})
  const deepCover='.folder-hierarchy-content[data-directory-path="/music/Album"] [data-folder-path="/music/Album/Disc"] .folder-cover',deepHero='.folder-hierarchy-content[data-directory-path="/music/Album/Disc"] .playlist-hero-artwork'
  await trace(page,{name:'child-to-grandchild',sourceSelector:deepCover,targetSelector:deepHero,finalPath:'/music/Album/Disc',action:()=>page.locator('[data-folder-path="/music/Album/Disc"]').click()})
  await trace(page,{name:'grandchild-to-child',sourceSelector:deepHero,targetSelector:deepCover,finalPath:'/music/Album',action:()=>page.getByRole('button',{name:'返回上一级文件夹',exact:true}).click()})
  const childReturn=await trace(page,{name:'child-to-parent',sourceSelector:childHero,targetSelector:childCover,finalPath:'/music',action:()=>page.getByRole('button',{name:'返回上一级文件夹',exact:true}).click()})
  expect(parentScroll>0&&await page.locator('.folder-hierarchy-content').evaluate(node=>node.scrollTop)===parentScroll,`${width}: returning parent restores nonzero scrollTop`)
  expect(Math.abs(childReturn.after.y-childEntry.before.y)<1,`${width}: returning parent restores card geometry`)
  const rootReturn=await trace(page,{name:'directory-to-root',sourceSelector:hero,targetSelector:rootCover,finalPath:'',action:()=>page.getByRole('button',{name:'返回上一级文件夹',exact:true}).click()})
  expect(Math.abs(rootReturn.after.y-rootEntry.before.y)<1,`${width}: returning root restores the clicked card's scroll position`)
  expect(rootScroll>0&&await page.locator('.folder-hierarchy-content').evaluate(node=>node.scrollTop)===rootScroll,`${width}: returning root restores nonzero scrollTop`)
  for(let i=0;i<3;i++){
   await page.locator('[data-folder-path="/music"]').dispatchEvent('click')
   await page.waitForFunction(()=>window.vm.playlist.library.folderLocation?.directoryPath==='/music')
   await page.evaluate(()=>window.vm.playlist.library.onFolderLocationChange(null))
   await waitSettled(page,'')
  }
  expect(await page.locator('.folder-hierarchy-content').count()===1,'rapid enter/back leaves one root page')
  const leases=await page.evaluate(()=>[...(window.folderCoverStore.leases??[])])
  console.log('FOLDER_NAVIGATION_LEASES',width,JSON.stringify(leases))
  expect(leases.length===0,`${width}: transition leases are released after rapid return`)
  await page.locator('[data-folder-path="/music"]').click();await waitSettled(page,'/music')
  await page.evaluate(()=>window.vm.playlist.library.onOpenOverview())
  await page.waitForFunction(()=>document.querySelectorAll('.folder-hierarchy').length===0)
  expect(await page.evaluate(()=>window.folderCoverStore.leases?.size??0)===0,`${width}: global overview exit releases transition leases`)
  const disposed=await page.evaluate(()=>{window.folderTestRoot.unmount();return{cache:window.folderCoverStore.cache.size,leases:window.folderCoverStore.leases?.size??0,listeners:window.folderCoverStore.listeners.size}})
  assert.deepEqual(disposed,{cache:0,leases:0,listeners:0},'unmount disposes the real cover store and subscribers')
  assert.deepEqual(errors,[]);await page.close()
 }
 {
  const{page,errors}=await open({large:true})
  await page.locator('[data-folder-path="/big"]').click();await waitSettled(page,'/big')
  await page.locator('.folder-hierarchy-content').evaluate(node=>{node.scrollTop=900})
  await page.waitForFunction(()=>document.querySelector('.playlist-hero').getBoundingClientRect().bottom<40)
  await trace(page,{name:'offscreen-return',sourceSelector:'.playlist-hero-artwork',targetSelector:'[data-folder-path="/big"] .folder-cover',finalPath:'',projection:false,action:()=>page.evaluate(()=>window.vm.playlist.library.onFolderLocationChange(null))})
  assert.deepEqual(errors,[]);await page.close()
 }
 {
  const{page,errors}=await open({motion:'reduce'})
  await page.locator('[data-folder-path="/music"]').scrollIntoViewIfNeeded()
  await trace(page,{name:'reduced-enter',sourceSelector:'[data-folder-path="/music"] .folder-cover',targetSelector:'.folder-hierarchy-content[data-directory-path="/music"] .playlist-hero-artwork',finalPath:'/music',motion:'reduce',action:()=>page.locator('[data-folder-path="/music"]').click()})
  await page.getByRole('button',{name:'返回上一级文件夹',exact:true}).click();await waitSettled(page,'')
  expect(await page.locator('.folder-hierarchy-content').evaluate(node=>node.getAnimations({subtree:true}).filter(animation=>animation.constructor.name!=='CSSTransition').length)===0,'reduced motion leaves no active navigation animation')
  assert.deepEqual(errors,[]);await page.close()
 }
 writeFileSync(`${directory}/report.json`,JSON.stringify({report,failures},null,2))
 console.log(`${baseline?'BASELINE':'FINAL'} folder navigation: ${report.length} traces; ${failures.length} failures; ${directory}`)
 if(failures.length)console.log(failures.join('\n'))
 if(!baseline)assert.deepEqual(failures,[])
}finally{await browser.close()}
