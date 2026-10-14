// Real PlayerShell + duration hook + command parser; only desktop transport and
// presentation are replaced. Start Vite and point SPMUSIC_PLAYWRIGHT at an
// existing package. SPMUSIC_STATS_BASELINE=1 records the checked-in cold refresh.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.SPMUSIC_PLAYWRIGHT || 'playwright')
const origin = process.env.SPMUSIC_TEST_ORIGIN || 'http://127.0.0.1:5173'
const entry = await (await fetch(origin + '/src/main.tsx')).text()
const dependency = name => {
  const match = entry.match(new RegExp('"(/node_modules/\\.vite/deps/' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))
  assert(match, 'resolve ' + name)
  return match[1]
}
const hookPath = '/src/features/player/hooks/usePlaylistDuration.ts'
let baselineHook
if (process.env.SPMUSIC_STATS_BASELINE === '1') {
  const original = execFileSync('git', ['show', 'HEAD:' + hookPath.slice(1)], { encoding: 'utf8' })
  baselineHook = require('typescript').transpileModule(original, { compilerOptions: { target: 99, module: 99 } }).outputText
    .replace(/import \{([^}]+)\} from ['"]react['"];/, (_line, names) => `import baselineReact from '${dependency('react.js')}';const {${names}}=baselineReact;`)
    .replace(/from ['"]@\/([^'"]+)['"]/g, (_line, path) => `from '/src/${path}.ts'`)
}
const service = (await (await fetch(origin + '/src/features/player/services/audioCommands.ts')).text())
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const invoke=(...args)=>window.backendInvoke(...args);const convertFileSrc=path=>path;')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen=async(name,callback)=>{(window.listeners??={})[name]=callback;return ()=>delete window.listeners[name];};')
assert(service.includes('window.backendInvoke'), 'real command parser is retained')
const surface = `
import React from '${dependency('react.js')}';
import {formatPlaylistDurationLabel} from '/src/features/player/model/playlistDuration.ts';
export function PlayerSurface({viewModel}){
 window.viewModel=viewModel;
 React.useLayoutEffect(()=>{window.commits.push({open:viewModel.playlist.isOpen,count:viewModel.playlist.tracks.length,status:viewModel.playlist.totalDurationStatus,total:viewModel.playlist.totalDurationSeconds,time:performance.now()})});
 const p=viewModel.playlist;
 return React.createElement('main',{'data-view':p.isOpen?'playlist':'player'},p.isOpen&&React.createElement('output',null,p.tracks.length+' | '+formatPlaylistDurationLabel({status:p.totalDurationStatus,totalSeconds:p.totalDurationSeconds},p.tracks.length)));
}`
const fixture = `
import React from '${dependency('react.js')}';
import ReactDOM from '${dependency('react-dom_client.js')}';
import {PlayerShell} from '/src/features/player/components/PlayerShell.tsx';
import {usePlaylistDuration} from '${hookPath}';
window.calls=[];window.commits=[];window.pending=[];window.active=0;window.maxActive=0;
window.config={scope:'a',count:33,gate:false,probeMs:1000,itemFailure:null,invokeFailure:false,protocolFailure:false};
let state={phase:'idle',generation:null,currentTrackId:null,positionMs:0,durationMs:null,volume:.5,error:null,transportTransition:null,transportSettledRequestId:null},generation=0;
const descriptor=(scope,i)=>({id:scope+'-'+i,sourcePath:'/audio/'+scope+'/'+i+'.flac',fileName:i+'.flac',available:true});
const playlist=()=>({directoryPath:'/audio/'+window.config.scope,directoryName:window.config.scope,sourceKind:'m3u8',sourcePath:'/lists/'+window.config.scope+'.m3u8',sourceName:window.config.scope,selectedIndex:0,tracks:Array.from({length:window.config.count},(_,i)=>descriptor(window.config.scope,i))});
const track=(path,hydration=false)=>{const parts=path.split('/'),scope=parts.at(-2),i=Number(parts.at(-1).split('.')[0]);return {...descriptor(scope,i),durationMs:hydration?null:1000,metadata:{title:'Song '+i,artist:'Artist',album:'Album',albumArtist:null,genre:null,year:null,trackNumber:null,discNumber:null,comment:null,lyrics:null,audioFormat:null,coverArt:null}}};
window.backendInvoke=async(command,args)=>{
 const input=args?.input;window.calls.push({command,input,time:performance.now()});
 if(command==='audio_get_state')return state;
 if(command==='audio_get_output_info')return null;
 if(command==='audio_get_current_track')return state.currentTrackId?track('/audio/'+state.currentTrackId.replace('-','/')+'.flac'):null;
 if(command==='audio_open_source')return {kind:'playlist',playlist:playlist()};
 if(command==='audio_load_file'){const result=track(input.path);state={...state,phase:'ready',generation:++generation,currentTrackId:result.id,durationMs:1000};return result}
 if(command==='audio_load_and_play'){
  const result=track(input.path);state={...state,phase:'playing',generation:++generation,currentTrackId:result.id,durationMs:1000};
  const response={requestId:input.requestId,generation,trackId:result.id,fileName:result.fileName,state};
  setTimeout(()=>window.listeners?.audio_track_details_changed?.({payload:{kind:'ready',requestId:input.requestId,generation:response.generation,track:result}}),0);
  return response;
 }
 if(command==='audio_hydrate_track')return track(input.path,true);
 if(command==='audio_begin_playlist_cover_window')return 1;
 if(command==='audio_probe_playlist_durations'){
  window.active++;window.maxActive=Math.max(window.maxActive,window.active);
  try{
   if(window.config.gate)await new Promise(resolve=>window.pending.push(resolve));
   if(window.config.invokeFailure)throw {code:'INTERNAL_ERROR',message:'injected command failure',recoverable:true};
   if(window.config.protocolFailure)return [];
   return input.paths.map(sourcePath=>({sourcePath,durationMs:sourcePath===window.config.itemFailure?null:window.config.probeMs,error:sourcePath===window.config.itemFailure?{code:'UNREADABLE_FILE',message:'injected unreadable file',recoverable:true}:null}));
  }finally{window.active--}
 }
 throw new Error('Unexpected command '+command);
};
function HookFixture(){
 const [sources,setSources]=React.useState([]),[scope,setScope]=React.useState('a'),[known,setKnown]=React.useState(new Map());
 const result=usePlaylistDuration(sources,scope,known);
 window.updateHook=(entries,nextScope='a')=>{setSources(entries);setScope(nextScope)};
 window.updateKnown=entries=>setKnown(new Map(entries));
 window.hookResult=result;
 React.useLayoutEffect(()=>{window.commits.push({...result,count:sources.length,time:performance.now()})});
 return React.createElement('output',null,JSON.stringify(result));
}
const root=ReactDOM.createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();
root.render(React.createElement(new URLSearchParams(location.search).get('kind')==='hook'?HookFixture:PlayerShell));
`
const html = (await (await fetch(origin)).text()).replace(/src="\/src\/[^\"]+"/, 'src="/__statistics_fixture.js"')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
console.log('BROWSER', browser.version())
const report = []
async function open(kind = 'shell') {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/src/features/player/services/audioCommands.ts*', route => route.fulfill({contentType:'text/javascript',body:service}))
  await page.route('**/src/features/player/components/PlayerSurface.tsx*', route => route.fulfill({contentType:'text/javascript',body:surface}))
  if (baselineHook) await page.route('**/src/features/player/hooks/usePlaylistDuration.ts*', route => route.fulfill({contentType:'text/javascript',body:baselineHook}))
  await page.route('**/__statistics_fixture.js', route => route.fulfill({contentType:'text/javascript',body:fixture}))
  await page.route('**/__statistics_test?*', route => route.fulfill({contentType:'text/html',body:html}))
  await page.goto(origin + '/__statistics_test?kind=' + kind)
  await page.waitForFunction(kind => kind==='hook'?Boolean(window.updateHook):Boolean(window.viewModel),kind)
  return {page,errors}
}
const probeCount = page => page.evaluate(() => window.calls.filter(c=>c.command==='audio_probe_playlist_durations').length)
const result = page => page.evaluate(() => window.hookResult)
const waitReady = (page,total,kind='hook') => page.waitForFunction(({total,kind})=>{const p=kind==='shell'?window.viewModel.playlist:window.hookResult;return (p.status??p.totalDurationStatus)==='ready'&&(p.totalSeconds??p.totalDurationSeconds)===total},{total,kind})
const release = page => page.evaluate(()=>{window.config.gate=false;window.pending.splice(0).forEach(resolve=>resolve())})
const update = (page,entries,scope='a')=>page.evaluate(({entries,scope})=>window.updateHook(entries,scope),{entries,scope})
try {
  const {page,errors}=await open()
  await page.evaluate(()=>window.viewModel.playlist.onOpenAudio())
  await waitReady(page,33,'shell')
  assert.equal(await page.locator('output').count(),0,'statistics finish while playlist is unmounted')
  const initial=await page.evaluate(()=>({count:window.viewModel.playlist.tracks.length,status:window.viewModel.playlist.totalDurationStatus,total:window.viewModel.playlist.totalDurationSeconds,batches:window.calls.filter(c=>c.command==='audio_probe_playlist_durations').map(c=>c.input.paths.length),maxActive:window.maxActive}))
  assert.equal(initial.count,33)
  assert(initial.batches.every(n=>n<=16))
  assert.equal(initial.maxActive,1)
  const initialProbes=await probeCount(page)
  await page.evaluate(()=>{window.commits=[];window.viewModel.playlist.onOpenChange(true)})
  await page.waitForFunction(()=>document.querySelector('output')?.textContent==='33 | 0:33')
  const first=await page.evaluate(()=>window.commits.find(c=>c.open))
  assert.deepEqual({count:first.count,status:first.status,total:first.total},{count:33,status:'ready',total:33})
  await page.evaluate(()=>window.viewModel.playlist.onOpenChange(false))
  await page.evaluate(()=>window.viewModel.playlist.onOpenChange(true))
  await page.evaluate(()=>window.viewModel.playlist.onTrackSelect('a-1'))
  await page.waitForFunction(()=>window.viewModel.playlist.currentTrackId==='a-1'&&!window.viewModel.playback.isSelectionPending)
  assert.equal(await probeCount(page),initialProbes,'view entry and track navigation reuse prepared statistics')
  await waitReady(page,33,'shell')
  assert.deepEqual(errors,[])
  report.push({case:'closed selection, first commit, reopen, track navigation',...initial})
  await page.close()

  const {page:warm,errors:warmErrors}=await open('hook')
  const entries=[{sourcePath:'first'},{sourcePath:'second'}]
  await update(warm,entries)
  await waitReady(warm,2)
  await warm.evaluate(()=>{window.config.gate=true;window.config.probeMs=2000;window.commits=[]})
  await update(warm,entries.map(e=>({...e,available:true,id:'presentation-only'})))
  await warm.waitForFunction(()=>window.pending.length===1)
  const firstRefresh=await warm.evaluate(()=>window.commits[0])
  if (baselineHook) {
    assert.equal(firstRefresh.status,'loading')
    assert.equal(firstRefresh.totalSeconds,undefined)
    console.log('BASELINE',JSON.stringify({existingClosedPreload:initial,equivalentRefresh:firstRefresh,probes:await probeCount(warm)}))
  } else {
    assert.equal(firstRefresh.status,'ready','equivalent descriptors keep prepared total in first commit')
    assert.equal(firstRefresh.totalSeconds,2)
    assert.equal(await probeCount(warm),2,'reselection revalidates native file duration in background')
  }
  await release(warm)
  await waitReady(warm,4)
  assert.deepEqual(warmErrors,[])
  report.push({case:'equivalent refresh retains total and revalidates changed file duration',firstRefresh:firstRefresh.status,updatedTotal:4})
  await warm.close()

  if (!baselineHook) {
    const {page:changes,errors:changeErrors}=await open('hook')
    await update(changes,entries)
    await waitReady(changes,2)
    const cases=[
      {name:'order',entries:[...entries].reverse(),total:2},
      {name:'duplicate',entries:[entries[0],entries[1],entries[0]],total:3},
      {name:'availability',entries:[entries[0],{...entries[1],available:false},entries[0]],total:2},
      {name:'path',entries:[{sourcePath:'replacement'}],total:1},
      {name:'scope',entries:[{sourcePath:'replacement'}],scope:'b',total:1},
    ]
    for (const c of cases) {
      await changes.evaluate(()=>{window.config.gate=true;window.commits=[]})
      const before=await probeCount(changes)
      await update(changes,c.entries,c.scope)
      await changes.waitForFunction(()=>window.pending.length===1)
      assert.equal((await result(changes)).status,'loading',c.name+' invalidates old total')
      assert.equal((await result(changes)).totalSeconds,undefined)
      assert.equal(await probeCount(changes),before+1)
      await release(changes)
      await waitReady(changes,c.total)
    }
    assert.deepEqual(changeErrors,[])
    report.push({case:'ordered sources, duplicates, availability, path and scope invalidate',variants:cases.map(c=>c.name)})
    await changes.close()

    const {page:stale,errors:staleErrors}=await open('hook')
    await stale.evaluate(()=>window.config.gate=true)
    await update(stale,Array.from({length:33},(_,i)=>({sourcePath:'old-'+i})))
    await stale.waitForFunction(()=>window.pending.length===1)
    await update(stale,[{sourcePath:'new'}],'new')
    assert.equal(await probeCount(stale),1,'replacement waits for pending native batch')
    await release(stale)
    await waitReady(stale,1)
    const staleCalls=await stale.evaluate(()=>window.calls.filter(c=>c.command==='audio_probe_playlist_durations').map(c=>c.input.paths))
    assert.deepEqual(staleCalls.map(batch=>batch[0]),['old-0','new'],'remaining old batches canceled')
    assert.equal(await stale.evaluate(()=>window.maxActive),1)
    await stale.evaluate(()=>{window.config.gate=true;window.commits=[]})
    await update(stale,[{sourcePath:'disposed'}],'disposed')
    await stale.waitForFunction(()=>window.pending.length===1)
    await stale.evaluate(()=>window.unmountFixture())
    const commitCount=await stale.evaluate(()=>window.commits.length)
    await release(stale)
    await stale.waitForFunction(()=>window.active===0)
    assert.equal(await stale.evaluate(()=>window.commits.length),commitCount,'unmounted hook publishes no late result')
    assert.deepEqual(staleErrors,[])
    report.push({case:'replacement and disposal',batches:staleCalls.map(batch=>batch.length),maxActive:1})
    await stale.close()

    for (const failure of ['itemFailure','invokeFailure','protocolFailure']) {
      const {page:failed,errors:failureErrors}=await open('hook')
      await failed.evaluate(failure=>{window.config[failure]=failure==='itemFailure'?'bad':true},failure)
      await update(failed,[{sourcePath:'good'},{sourcePath:'bad'}])
      const expected=failure==='itemFailure'?'unknown':'error'
      await failed.waitForFunction(expected=>window.hookResult.status===expected,expected)
      assert.equal((await result(failed)).totalSeconds,undefined,'failed full total cannot publish partial sum')
      const before=await probeCount(failed)
      await failed.evaluate(()=>window.updateKnown([['good',1000]]))
      assert.equal(await probeCount(failed),before,'metadata hydration does not retry failed native command')
      await failed.evaluate(()=>window.updateKnown([['good',1000],['bad',2000]]))
      await waitReady(failed,3)
      assert.equal(await probeCount(failed),before,'truthful later metadata completes without restart')
      assert.deepEqual(failureErrors,[])
      report.push({case:failure,status:expected,metadataRecoveredTotal:3,probes:before})
      await failed.close()
    }
  }
  console.log('PASS',JSON.stringify(report))
} finally { await browser.close() }
