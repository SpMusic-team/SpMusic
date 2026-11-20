// Actual useAudioPlayer and audioCommands parser; reuse the existing native
// transport fixture. Viewport movement must preserve prepared metadata without
// invoking the full player-hydration lane or evicting it through scrolling.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const {chromium}=createRequire(import.meta.url)(process.env.SPMUSIC_PLAYWRIGHT||'playwright')
const origin=process.env.SPMUSIC_TEST_ORIGIN||'http://127.0.0.1:5173'
const entry=await(await fetch(origin+'/src/main.tsx')).text()
const dependency=name=>{const m=entry.match(new RegExp('"(/node_modules/\\.vite/deps/'+name.replaceAll('.','\\.')+'[^"\\n]*)"'));assert(m,'resolve '+name);return m[1]}
const shared=readFileSync(new URL('./playlistManagementMotion.browser.test.mjs',import.meta.url),'utf8')
const literal=shared.match(/const fixture = (`[\s\S]*?`)\r?\nconst html/)
assert(literal,'reuse actual hook/native transport fixture')
let fixture=runInNewContext(literal[1],{dependency})
fixture=fixture.replace('window.calls=[];','window.hydrationPending=[];window.metadataRenders=[];window.detailEvents=[];window.calls=[];')
fixture=fixture.replace("title:'Song '+scope+' '+i,artist:'Artist '+scope,album:'Album '+scope,albumArtist:null", "title:window.config.noTagsIndex===i?null:'Song '+scope+' '+i,artist:window.config.noTagsIndex===i?null:'Artist '+scope,album:window.config.noTagsIndex===i?null:'Album '+scope,albumArtist:null")
fixture=fixture.replace("setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation:response.generation,track:result}}),0);return response;",`const details={kind:'ready',requestId:input.requestId,generation:response.generation,track:result};if(window.config.deferDetails)window.detailEvents.push(details);else setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:details}),0);return response;`)
fixture=fixture.replace("if(command==='audio_hydrate_track')return track(input.path);",`if(command==='audio_hydrate_track'){
 if(window.config.hydrationGate&&Number(input.path.split('/').at(-1).split('.')[0])>=8)await new Promise(resolve=>window.hydrationPending.push({path:input.path,resolve}));
 const result=track(input.path);window.calls.push({command:'hydrate-complete',path:input.path,time:performance.now()});return result;
}`)
fixture=fixture.replace("function HookFixture(){window.playerApi=useAudioPlayer();return React.createElement('output',null,window.playerApi.track?.id??'empty')}",`function HookFixture(){window.playerApi=useAudioPlayer();const p=window.playerApi;window.metadataRenders.push({time:performance.now(),id:p.track?.id,sourcePath:p.track?.sourcePath,title:p.track?.title,artist:p.track?.artist,album:p.track?.album,currentAudioTitle:p.currentAudioTrack?.metadata.title,busy:p.audioBusy,pending:p.selectionPending});return React.createElement('output',null,JSON.stringify(window.metadataRenders.at(-1)))}`)
assert(fixture.includes('hydrate-complete')&&fixture.includes('metadataRenders.push'),'instrument native completion / actual hook renders only')
const service=(await(await fetch(origin+'/src/features/player/services/audioCommands.ts')).text())
 .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
 .replace(/import \{ listen \} from [^;]+;/,'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>{if(window.listeners[name]===callback)delete window.listeners[name]};};')
assert(service.includes('window.backendInvoke'),'only native transport is replaced')
const html=(await(await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/,'src="/__metadata_fixture.js"')
const browser=await chromium.launch({headless:true,channel:process.env.SPMUSIC_BROWSER_CHANNEL||'msedge'})
const directory=join(tmpdir(),'spmusic-preview-metadata'),label=(process.env.SPMUSIC_METADATA_LABEL||'current').replaceAll(/[^a-z0-9-]/gi,'-')
mkdirSync(directory,{recursive:true})
let passed=0
async function open({playing=false,noTagsIndex=null}={}){
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGEERROR',e.message)})
 await page.route('**/src/features/player/services/audioCommands.ts*',r=>r.fulfill({contentType:'text/javascript',body:service}))
 await page.route('**/__metadata_fixture.js',r=>r.fulfill({contentType:'text/javascript',body:fixture}))
 await page.route('**/__metadata_test*',r=>r.fulfill({contentType:'text/html',body:html}))
 await page.goto(origin+'/__metadata_test?kind=hook')
 await page.waitForFunction(()=>Boolean(window.playerApi))
 await page.evaluate(noTagsIndex=>{Object.assign(window.config,{count:24,hydrationGate:true,noTagsIndex});window.playerApi.openAudio()},noTagsIndex)
 await page.waitForFunction(()=>window.playerApi.track?.id==='a-0'&&!window.playerApi.audioBusy&&!window.playerApi.selectionPending)
 if(playing){await page.evaluate(()=>window.playerApi.togglePlayback());await page.waitForFunction(()=>window.playerApi.playing&&!window.playerApi.transportBusy)}
 return {page,errors}
}
async function frames(page,n=2){await page.evaluate(async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame)},n)}
async function check(name,run,options){
 if(process.env.SPMUSIC_TEST_FILTER&&!name.includes(process.env.SPMUSIC_TEST_FILTER))return
 const {page,errors}=await open(options)
 try{await run(page);assert.deepEqual(errors,[]);passed++;console.log('PASS',name)}finally{await page.close()}
}
async function commitGated(page){
 await page.evaluate(()=>{window.config.gate=true;window.commitAccepted=window.playerApi.commitTrackCardPreview(window.token.id)})
 await page.waitForFunction(()=>window.playerApi.track?.id==='a-1');await frames(page)
}
async function finishLoad(page){
 await page.waitForFunction(()=>window.pending.length>0)
 await page.evaluate(()=>{window.config.gate=false;for(const resolve of window.pending.splice(0))resolve()})
 await page.waitForFunction(()=>!window.playerApi.audioBusy&&!window.playerApi.selectionPending);await frames(page)
}
function assertTagged(renders,id='a-1'){
 const target=renders.filter(r=>r.id===id);assert(target.length>0)
 const scope=id.split('-')[0],index=id.split('-')[1]
 assert(target.every(r=>r.title==='Song '+scope+' '+index&&r.artist==='Artist '+scope&&r.album==='Album '+scope),'every same-target render retains hydrated metadata')
 assert(target.every(r=>r.sourcePath==='/audio/'+scope+'/'+index+'.flac'),'metadata remains bound to the exact source identity')
}
async function moveViewportAfterPrepare(page){
 await page.evaluate(async()=>{window.token=await window.playerApi.prepareTrackCardPreview(1);window.preparedAt=performance.now()})
 assert.equal(await page.evaluate(()=>window.token.track.title),'Song a 1','prepare returns actual hydrated tags')
 const before=await page.evaluate(()=>window.calls.filter(c=>c.command==='audio_hydrate_track').length)
 await page.evaluate(()=>{
  window.playerApi.setVisiblePlaylistTrackIds(Array.from({length:11},(_,i)=>'a-'+(i+8)),false,false)
  window.config.hydrationGate=false;for(const job of window.hydrationPending.splice(0))job.resolve()
 })
 await frames(page,5)
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='audio_hydrate_track').length),before,'viewport registration does not read full player metadata or churn its LRU')
 assert.equal(await page.evaluate(()=>window.playerApi.playlistTrackMetadata['a-1']?.title),'Song a 1','real preview hydration publishes the correctly tagged row')
 const completions=await page.evaluate(()=>window.calls.filter(c=>c.command==='hydrate-complete'&&c.time>window.preparedAt).map(c=>c.path))
 // Previously queued genuine player artwork-prefetch hydration may complete
 // here. The unchanged invocation count above proves the viewport added none.
 return completions
}
async function evidence(page,name){const data=await page.evaluate(()=>({token:window.token,preparedAt:window.preparedAt,calls:window.calls,renders:window.metadataRenders,accepted:window.commitAccepted}));writeFileSync(join(directory,label+'-'+name+'.json'),JSON.stringify(data,null,2));console.log('PREVIEW_METADATA_TRACE',JSON.stringify({name,preview:{title:data.token.track.title,artist:data.token.track.artist,album:data.token.track.album},accepted:data.accepted,tail:data.renders.slice(-4),hydrationsAfterPrepare:data.calls.filter(c=>c.command==='hydrate-complete'&&c.time>data.preparedAt).map(c=>c.path)}));return data}
try{
 await check('hydrated preview survives viewport movement and paused native load',async page=>{
  await moveViewportAfterPrepare(page)
  await commitGated(page)
  const data=await evidence(page,'viewport-commit'),current=data.renders.at(-1)
  assert.equal(data.accepted,true,'same valid prepared token commits')
  assert.equal(current.title,'Song a 1','viewport movement cannot replace prepared tags with the filename')
  assert.equal(current.artist,'Artist a');assert.equal(current.album,'Album a')
  await finishLoad(page)
  const confirmed=await evidence(page,'viewport-confirmed');assertTagged(confirmed.renders)
  assert.equal(confirmed.renders.at(-1).currentAudioTitle,'Song a 1','confirmed native identity exposes the correct hydrated audio model')
 })
 await check('playing details error retains the prepared metadata after viewport movement',async page=>{
  await moveViewportAfterPrepare(page);await page.evaluate(()=>window.config.deferDetails=true);await commitGated(page);await finishLoad(page)
  await page.waitForFunction(()=>window.detailEvents.length===1&&window.playerApi.detailsPending)
  await page.evaluate(()=>{const ready=window.detailEvents[0];window.listeners.audio_track_details_changed({payload:{kind:'error',requestId:ready.requestId,generation:ready.generation,trackId:ready.track.id,error:{code:'UNREADABLE_FILE',message:'injected metadata read failure',recoverable:true}}})})
  await page.waitForFunction(()=>!window.playerApi.detailsPending);await frames(page)
  const data=await evidence(page,'details-error');assertTagged(data.renders)
  assert.equal(data.renders.at(-1).currentAudioTitle,'Song a 1','state-only play response retains the seeded audio model even when details fail')
 },{playing:true})
 await check('truly untagged target uses its own filename and local defaults',async page=>{
  await page.evaluate(async()=>{window.token=await window.playerApi.prepareTrackCardPreview(1);window.preparedAt=performance.now()})
  assert.equal(await page.evaluate(()=>window.token.track.title),'1','untagged preview already has the legitimate fallback')
  await commitGated(page);await finishLoad(page)
  const data=await evidence(page,'untagged'),target=data.renders.filter(r=>r.id==='a-1')
  assert(target.length>0&&target.every(r=>r.title==='1'&&r.artist==='本地音频'&&r.album==='本地音频'),'cross-track initialization never borrows previous tags')
 },{noTagsIndex:1})
 await check('complete authoritative null tags replace a formerly tagged preview',async page=>{
  await moveViewportAfterPrepare(page);await commitGated(page)
  assertTagged((await evidence(page,'before-authority')).renders)
  // A complete native response can legitimately report no tags (for example
  // after the source file changes). It remains authoritative over the seed.
  await page.evaluate(()=>window.config.noTagsIndex=1);await finishLoad(page)
  const data=await evidence(page,'authoritative-null'),last=data.renders.at(-1)
  assert.equal(last.id,'a-1');assert.equal(last.title,'1');assert.equal(last.artist,'本地音频');assert.equal(last.album,'本地音频')
 })
 await check('new scope rejects an old token and ignores late old-generation details',async page=>{
  await moveViewportAfterPrepare(page);await page.evaluate(()=>window.config.deferDetails=true);await commitGated(page);await finishLoad(page)
  await page.waitForFunction(()=>window.detailEvents.length===1)
  await page.evaluate(async()=>{window.staleToken=await window.playerApi.prepareTrackCardPreview(1)})
  assert.equal(await page.evaluate(()=>window.staleToken.targetTrackId),'a-2','scope switch invalidates a still-prepared token, not an already consumed one')
  await page.evaluate(()=>{Object.assign(window.config,{scope:'b',hydrationGate:false});window.playerApi.openAudio()})
  await page.waitForFunction(()=>window.playerApi.track?.id==='b-0'&&!window.playerApi.audioBusy&&!window.playerApi.selectionPending)
  await page.evaluate(()=>{window.oldCommitAccepted=window.playerApi.commitTrackCardPreview(window.staleToken.id);window.listeners.audio_track_details_changed({payload:window.detailEvents[0]})});await frames(page,4)
  const data=await evidence(page,'scope-late')
  assert.equal(await page.evaluate(()=>window.oldCommitAccepted),false,'old token cannot seed another scope/source')
  assertTagged(data.renders,'b-0');assert.equal(data.renders.at(-1).id,'b-0')
 },{playing:true})
 console.log('PLAYLIST_PREVIEW_METADATA_RESULT',passed,'passed; artifacts:',directory)
}finally{await browser.close()}
