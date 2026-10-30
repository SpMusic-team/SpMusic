import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
const require=createRequire(import.meta.url)
const ts=require('typescript')
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText).toString('base64')
const summaryUrl=compile(readFileSync(new URL('./playlistTrackSummary.ts',import.meta.url),'utf8'))
const source=readFileSync(new URL('./recentlyPlayed.ts',import.meta.url),'utf8').replace("'./playlistTrackSummary'",JSON.stringify(summaryUrl))
const {RecentlyPlayedTracker,readRecentlyPlayed,writeRecentlyPlayed,recentlyPlayedSongs}=await import(compile(source))
const state=(positionMs,overrides={})=>({phase:'playing',generation:1,currentTrackId:'a',positionMs,durationMs:4000,volume:1,error:null,transportTransition:null,transportSettledRequestId:null,...overrides})
test('ended terminal interval counts and replay in the same generation needs a fresh half',()=>{
 const t=new RecentlyPlayedTracker()
 assert.equal(t.sample(state(0),0),false)
 assert.equal(t.sample(state(1000),1000),false)
 assert.equal(t.sample(state(2000,{phase:'ended'}),2000),true)
 assert.equal(t.sample(state(0),2100),false)
 assert.equal(t.sample(state(1000),3100),false)
 assert.equal(t.sample(state(2000),4100),true)
 assert.equal(t.sample(state(3000),5100),false)
})
test('pause wall time and position changes are excluded while earned playback survives resume',()=>{
 const t=new RecentlyPlayedTracker()
 t.sample(state(0),0);t.sample(state(1000),1000)
 assert.equal(t.sample(state(1000,{phase:'paused'}),2000),false)
 assert.equal(t.sample(state(3000,{phase:'paused'}),20000),false)
 assert.equal(t.sample(state(3000),21000),false)
 assert.equal(t.sample(state(4000),22000),true)
})
test('seek jump, explicit blocked seek state, and a long suspend do not invent listening',()=>{
 const t=new RecentlyPlayedTracker()
 t.sample(state(0),0)
 assert.equal(t.sample(state(3000),100),false)
 t.breakBaseline()
 assert.equal(t.sample(state(500),500,true),false)
 assert.equal(t.sample(state(1000),1000),false)
 assert.equal(t.sample(state(2000),2000),false)
 assert.equal(t.sample(state(3000),3000),true)
 const suspend=new RecentlyPlayedTracker();suspend.sample(state(0),0)
 assert.equal(suspend.sample(state(4000),60000),false)
})
test('generation switch resets incomplete accumulation',()=>{
 const t=new RecentlyPlayedTracker();t.sample(state(0),0);t.sample(state(1500),1500)
 assert.equal(t.sample(state(0,{generation:2}),1600),false)
 assert.equal(t.sample(state(1000,{generation:2}),2600),false)
 assert.equal(t.sample(state(2000,{generation:2}),3600),true)
})
test('missing metadata delays commit without discarding already earned playback',()=>{
 const t=new RecentlyPlayedTracker();t.sample(state(0),0,false,false)
 t.sample(state(1000),1000,false,false)
 assert.equal(t.sample(state(2000),2000,false,false),false)
 assert.equal(t.sample(state(2000),2001,false,true),true)
 assert.equal(t.sample(state(2500),2501),false)
})
test('malformed storage is ignored, normalized duplicate keeps newer value, roundtrip preserves records',()=>{
 let raw='invalid';globalThis.localStorage={getItem:()=>raw,setItem:(_key,value)=>{raw=value}}
 assert.deepEqual(readRecentlyPlayed(),[])
 raw=JSON.stringify({version:1,entries:[{sourcePath:'C:\\a.flac',lastPlayedAt:1},{sourcePath:'C:/a.flac',lastPlayedAt:2},{sourcePath:'',lastPlayedAt:3},{sourcePath:'bad',lastPlayedAt:null}]})
 assert.deepEqual(readRecentlyPlayed(),[{sourcePath:'C:/a.flac',lastPlayedAt:2}])
 writeRecentlyPlayed(readRecentlyPlayed());assert.deepEqual(readRecentlyPlayed(),[{sourcePath:'C:/a.flac',lastPlayedAt:2}])
})
test('projection uses visible library intersection and recent timestamp without mutating input order',()=>{
 const songs=[{sourcePath:'C:/a.flac'},{sourcePath:'C:/b.flac'},{sourcePath:'C:/unplayed.flac'}]
 const entries=[{sourcePath:'C:/a.flac',lastPlayedAt:1},{sourcePath:'C:/b.flac',lastPlayedAt:2},{sourcePath:'C:/hidden.flac',lastPlayedAt:3}]
 assert.deepEqual(recentlyPlayedSongs(songs,entries).map(x=>x.sourcePath),['C:/b.flac','C:/a.flac'])
 assert.equal(songs[0].sourcePath,'C:/a.flac')
})
test('duplicate polls between progress events cannot reduce real listened duration',()=>{
 const t=new RecentlyPlayedTracker();t.sample(state(0),0)
 let result=false
 for(let i=1;i<=20;i++){
  t.sample(state((i-1)*100),i*100-10)
  result=t.sample(state(i*100),i*100)
 }
 assert.equal(result,true,'2000 ms of continuous playback must meet half of a 4000 ms song despite duplicate polls')
})
