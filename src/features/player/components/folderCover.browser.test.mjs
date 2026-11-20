// Native transport is mocked; the actual Shell, folder scenes, cache and SPXR parser run unchanged.
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
const require=createRequire(import.meta.url),{chromium}=require(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const match=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(match);return match[1]}
const shared=readFileSync(new URL('./folderHierarchy.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/);assert(literal)
let fixture=runInNewContext(literal[1],{dependency})
const extra=`
const originalInvoke=window.backendInvoke;window.folderPending=[];window.folderGate=new URLSearchParams(location.search).has('gate');window.emptyFolder=new URLSearchParams(location.search).has('empty');
window.backendInvoke=async(command,args)=>{
 if(command==='library_select_folders')return ['/music'];
 if(command==='library_add_folder')return {folders:[...roots]};
 if(command!=='audio_load_folder_thumbnail')return originalInvoke(command,args);
 const input=args.input;window.calls.push({command,input});
 if(window.folderGate)await new Promise(resolve=>window.folderPending.push(resolve));
 if(window.emptyFolder)return new Uint8Array(0);
 const bytes=new Uint8Array(44),view=new DataView(bytes.buffer);bytes.set([83,80,88,82]);view.setUint16(4,1,true);view.setUint16(6,40,true);
 for(const [offset,value]of [[8,1],[12,1],[16,4],[20,1],[24,4],[32,1],[36,1]])view.setUint32(offset,value,true);
 bytes.set(input.directoryPath==='/music'?[255,0,0,255]:input.rootPath==='/music'?[0,0,255,255]:[0,255,0,255],40);return bytes;
};
window.root=ReactDOM.createRoot(document.getElementById('root'));window.root.render(`
fixture=fixture.replace("ReactDOM.createRoot(document.getElementById('root')).render(",extra)
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
 .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
 .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
const surfaceSource=(await(await fetch(origin+'/src/features/player/components/PlayerSurface.tsx')).text()).replace(/(const \[allSongsCoverStore\] = useState\(createAllSongsCoverStore\);?)/,'$1;window.folderCoverStore=allSongsCoverStore;')
assert(surfaceSource.includes('window.folderCoverStore'))
const surface=`import React from '${dependency('react.js')}';import {PlayerSurface as RealSurface}from '/__folder_cover_surface.js';export function PlayerSurface(props){window.vm=props.viewModel;return React.createElement(RealSurface,props)}`
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__folder_cover_fixture.js"')
const out=process.env.SPMUSIC_TEST_SCREENSHOTS||'C:/Users/winkeses/.codex/tmp/folder-cover';mkdirSync(out,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'}),results=[]
async function open(query=''){
 const page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'}),errors=[]
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000)
 await page.addInitScript(()=>{
  localStorage.setItem('spmusic.player.startup-page.v1','media-library');localStorage.setItem('spmusic.folder-hierarchy.layout-level.v1','3');localStorage.removeItem('spmusic.player.session.v1')
  window.revoked=[];const revoke=URL.revokeObjectURL;URL.revokeObjectURL=url=>{window.revoked.push(url);return revoke(url)}
 })
 await page.route('**/src/features/player/services/audioCommands.ts*',route=>route.fulfill({contentType:'text/javascript',body:service}))
 await page.route('**/src/features/player/components/PlayerSurface.tsx*',route=>route.fulfill({contentType:'text/javascript',body:surface}))
 await page.route('**/__folder_cover_surface.js',route=>route.fulfill({contentType:'text/javascript',body:surfaceSource}))
 await page.route('**/__folder_cover_fixture.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__folder_cover_test*',route=>route.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__folder_cover_test?'+query)
 await page.waitForFunction(()=>window.vm?.playlist.library.allSongs.length===5)
 await page.evaluate(()=>window.vm.playlist.library.onSelectCategory('folders'))
 await page.waitForFunction(()=>window.vm.playlist.library.allSongsMetadataStatus==='ready')
 await page.locator('[data-folder-path="/music"]').waitFor()
 return{page,errors}
}
async function scene(page,path){await page.waitForFunction(path=>{const nodes=[...document.querySelectorAll('.folder-hierarchy-content')];return nodes.length===1&&nodes[0].dataset.directoryPath===path},path)}
async function image(page,selector){await page.waitForFunction(selector=>{const image=document.querySelector(selector);return image?.complete&&image.naturalWidth>0&&image.src.startsWith('blob:')},selector);return page.locator(selector).getAttribute('src')}
try{
 const{page,errors}=await open()
 const rootSelector='[data-folder-path="/music"] .folder-cover-image'
 const rootUrl=await image(page,rootSelector)
 await page.locator('[data-folder-path="/music"]').click();await scene(page,'/music')
 assert.equal(await image(page,'.playlist-hero-artwork img'),rootUrl,'card and root-directory hero reuse the decoded URL')
 const childSelector='[data-folder-path="/music/Album"] .folder-cover-image',childUrl=await image(page,childSelector)
 assert.notEqual(childUrl,rootUrl,'child directory uses its own folder resolver')
 await page.locator('[data-folder-path="/music/Album"]').click();await scene(page,'/music/Album')
 assert.equal(await image(page,'.playlist-hero-artwork img'),childUrl,'nested card and hero share the directory identity')
 await page.getByRole('button',{name:'返回上一级文件夹',exact:true}).click();await scene(page,'/music')
 await page.getByRole('button',{name:'返回上一级文件夹',exact:true}).click();await scene(page,'')
 assert.equal(await image(page,rootSelector),rootUrl,'return keeps prepared root artwork')
 const calls=await page.evaluate(()=>window.calls.filter(call=>call.command==='audio_load_folder_thumbnail'))
 assert(calls.every(({input})=>input.rootPath&&input.directoryPath&&input.maxEdge===256&&Number.isInteger(input.windowGeneration)))
 assert(!calls.some(({input})=>'sourcePath'in input||'trackId'in input),'folder requests carry no invented song fields')
 assert.equal(calls.filter(({input})=>input.rootPath==='/music'&&input.directoryPath==='/music').length,1,'warm hero never rereads the selected card')
 const live=await page.evaluate(()=>[...window.folderCoverStore.cache.values()].flatMap(row=>row.coverUrl?[row.coverUrl]:[]))
 assert(!(await page.evaluate(()=>window.revoked)).includes(rootUrl),'visible root URL stays owned')
 await page.evaluate(()=>window.vm.playlist.library.onSelectFolders())
 await page.waitForFunction(previous=>{const image=document.querySelector('[data-folder-path="/music"] .folder-cover-image');return image?.complete&&image.src.startsWith('blob:')&&image.src!==previous},rootUrl)
 const refreshedUrl=await page.locator(rootSelector).getAttribute('src')
 await page.locator('[data-folder-path="/music"]').click();await scene(page,'/music')
 assert.equal(await image(page,'.playlist-hero-artwork img'),refreshedUrl,'rescanned card and hero still share the new revision URL')
 await page.getByRole('button',{name:'返回上一级文件夹',exact:true}).click();await scene(page,'')
 await page.screenshot({path:out+'/root-return.png'})
 await page.evaluate(()=>window.root.unmount())
 const cleanup=await page.evaluate(()=>({cache:window.folderCoverStore.cache.size,listeners:window.folderCoverStore.listeners.size,leases:window.folderCoverStore.leases?.size??0,revoked:window.revoked}))
 assert.equal(cleanup.cache,0);assert.equal(cleanup.listeners,0);assert.equal(cleanup.leases,0)
 assert(live.every(url=>cleanup.revoked.includes(url)),'unmount releases every retained decoded URL')
 assert.deepEqual(errors,[]);results.push({scenario:'same-source-navigation',folderCalls:calls.length,cleanup});await page.close()
 const missing=await open('empty=1');await scene(missing.page,'')
 await missing.page.waitForFunction(()=>window.folderCoverStore.cache.size>=3)
 assert.equal(await missing.page.locator('[data-folder-path="/music"] .folder-cover-image').count(),0)
 assert.equal(await missing.page.locator('[data-folder-path="/music"] .folder-cover-placeholder').count(),1)
 await missing.page.locator('[data-folder-path="/music"]').click();await scene(missing.page,'/music')
 assert.equal(await missing.page.locator('.playlist-hero-artwork img').count(),0,'confirmed missing hero keeps the shared playlist placeholder surface')
 assert.notEqual(await missing.page.locator('.playlist-hero-artwork').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)','missing hero placeholder remains painted')
 await missing.page.getByRole('button',{name:'返回上一级文件夹',exact:true}).click();await scene(missing.page,'')
 await missing.page.evaluate(()=>{window.emptyFolder=false;window.vm.playlist.library.onSelectFolders()})
 await image(missing.page,rootSelector)
 await missing.page.locator('[data-folder-path="/music"]').click();await scene(missing.page,'/music')
 assert((await image(missing.page,'.playlist-hero-artwork img')).startsWith('blob:'),'same-path rescan replaces confirmed missing with artwork')
 assert.deepEqual(missing.errors,[]);results.push({scenario:'confirmed-missing'});await missing.page.close()
 const gated=await open('gate=1');await gated.page.waitForFunction(()=>window.folderPending.length>0)
 await gated.page.locator('[data-folder-path="/music"]').click();await scene(gated.page,'/music')
 await gated.page.getByRole('button',{name:'返回上一级文件夹',exact:true}).click();await scene(gated.page,'')
 await gated.page.evaluate(()=>{window.folderGate=false;for(const resolve of window.folderPending.splice(0))resolve()})
 await image(gated.page,rootSelector)
 assert.equal(await gated.page.locator('.folder-hierarchy-content').count(),1)
 assert.deepEqual(await gated.page.evaluate(()=>[...(window.folderCoverStore.leases?.keys()??[])]),[],'rapid return drops hero leases')
 await gated.page.evaluate(()=>window.root.unmount())
 assert.deepEqual(await gated.page.evaluate(()=>({cache:window.folderCoverStore.cache.size,listeners:window.folderCoverStore.listeners.size,leases:window.folderCoverStore.leases?.size??0})),{cache:0,listeners:0,leases:0})
 assert.deepEqual(gated.errors,[]);results.push({scenario:'late-response-after-rapid-return'});await gated.page.close()
 writeFileSync(out+'/report.json',JSON.stringify(results,null,2));console.log(JSON.stringify({pass:true,results},null,2))
}finally{await browser.close()}
