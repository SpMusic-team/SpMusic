import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
const require=createRequire(import.meta.url),ts=require('typescript')
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText).toString('base64')
const summaryUrl=compile(readFileSync(new URL('./playlistTrackSummary.ts',import.meta.url),'utf8'))
const source=readFileSync(new URL('./mostPlayed.ts',import.meta.url),'utf8').replace("'./playlistTrackSummary'",JSON.stringify(summaryUrl))
const m=await import(compile(source))
const song=(id,title=id)=>({sourcePath:'C:/'+id+'.flac',track:{title}})
const entry=(id,playCount,lastPlayedAt=100)=>({sourcePath:'C:/'+id+'.flac',playCount,lastPlayedAt})
test('TopN selection precedes ascending display, strict timestamp window uses cumulative count',()=>{
 const songs=[song('a'),song('b'),song('c'),song('d')],stats=[entry('a',20,50),entry('b',10,100),entry('c',3,100),entry('hidden',90,100)]
 const before=JSON.stringify(songs)
 assert.deepEqual(m.mostPlayedSongs(songs,stats,{limit:2,from:0,direction:'asc'}).map(x=>x.sourcePath),['C:/b.flac','C:/a.flac'])
 assert.deepEqual(m.mostPlayedSongs(songs,stats,{limit:2,from:50,direction:'desc'}).map(x=>x.sourcePath),['C:/b.flac','C:/c.flac'])
 assert.equal(JSON.stringify(songs),before)
 assert.equal(stats[1].playCount,10)
})
test('count ties select deterministically by title then path and normalized duplicate is one song',()=>{
 const songs=[song('z','Same'),song('a','Same'),song('b','Alpha'),{sourcePath:'C:\\b.flac',track:{title:'Alpha'}}]
 assert.deepEqual(m.mostPlayedSongs(songs,[entry('a',5),entry('z',5),entry('b',5)],{limit:2,from:0,direction:'desc'}).map(x=>x.sourcePath),['C:/b.flac','C:/a.flac'])
})
test('recording adds one without mutating input; safe integer cap cannot overflow',()=>{
 const original=[entry('a',1)]
 assert.equal(m.recordMostPlayed(original,'C:\\a.flac',200)[0].playCount,2)
 assert.equal(original[0].playCount,1)
 assert.equal(m.recordMostPlayed([entry('a',Number.MAX_SAFE_INTEGER)],'C:/a.flac',200)[0].playCount,Number.MAX_SAFE_INTEGER)
 assert.equal(m.recordMostPlayed([],'C:/a.flac',200)[0].playCount,1)
})
test('storage ignores malformed data, normalized duplicates keep newer not sum, roundtrips',()=>{
 let raw='broken';globalThis.localStorage={getItem:()=>raw,setItem:(_key,value)=>{raw=value}}
 assert.deepEqual(m.readMostPlayed(),[])
 raw=JSON.stringify({version:1,entries:[entry('a',5,100),{sourcePath:'C:\\a.flac',playCount:3,lastPlayedAt:200},entry('b',0),entry('c',1.5),entry('d',Number.MAX_SAFE_INTEGER+1),entry('e',1,-1)]})
 assert.deepEqual(m.readMostPlayed(),[entry('a',3,200)])
 m.writeMostPlayed(m.readMostPlayed());assert.deepEqual(m.readMostPlayed(),[entry('a',3,200)])
})
test('bad options fall back; unavailable option persistence does not throw',()=>{
 globalThis.localStorage={getItem:()=>'{"limit":1,"from":0,"direction":"asc"}',setItem:()=>{throw Error('quota')}}
 assert.deepEqual(m.readMostPlayedOptions(),{limit:100,from:0,direction:'desc'})
 for(const options of [{limit:1,from:0,direction:'asc'},{limit:2,from:-1,direction:'asc'},{limit:2,from:1e300,direction:'desc'},{limit:2,from:0,direction:'title'}]) assert.equal(m.isMostPlayedOptions(options),false)
 assert.doesNotThrow(()=>m.writeMostPlayedOptions({limit:2,from:0,direction:'asc'}))
 globalThis.localStorage={getItem:()=>{throw Error('blocked')}};assert.deepEqual(m.readMostPlayed(),[])
})
test('most-played queue origin and saved custom snapshot survive serializer validation',async()=>{
 const queueUrl=compile(readFileSync(new URL('./playbackQueue.ts',import.meta.url),'utf8'))
 const {isPlaybackQueueOrigin}=await import(queueUrl)
 assert.equal(isPlaybackQueueOrigin({kind:'most-played'}),true)
 assert.equal(isPlaybackQueueOrigin({kind:'most-played',sourceScope:'folder'}),false)
 const sessionCode=readFileSync(new URL('./playbackSessionStorage.ts',import.meta.url),'utf8').replace("'./playbackQueue.ts'",JSON.stringify(queueUrl))
 const session=await import(compile(sessionCode))
 let raw;globalThis.window={localStorage:{getItem:()=>raw,setItem:(_key,value)=>{raw=value}}}
 const value={version:1,sourcePath:'C:/a.flac',playlist:{sourceKind:'custom',sourcePath:'queue:most',customPlaylist:{sourceKind:'custom',sourcePath:'queue:most',tracks:[{id:'a',sourcePath:'C:/a.flac',fileName:'a.flac',available:true}],playbackQueue:{kind:'most-played'}}},positionMs:1000,wasPlaying:true,wasPaused:false,queueOpen:true,volume:50}
 session.persistPlaybackSession(value)
 assert.deepEqual(session.readPlaybackSession(),value)
})