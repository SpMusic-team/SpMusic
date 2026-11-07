import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import test from 'node:test'
const ts=createRequire(import.meta.url)('typescript')
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText).toString('base64')
const summary=compile(readFileSync(new URL('./playlistTrackSummary.ts',import.meta.url),'utf8'))
const source=readFileSync(new URL('./highestRated.ts',import.meta.url),'utf8').replace("'./playlistTrackSummary'",JSON.stringify(summary))
const {highestRatedSongs,lowestRatedSongs}=await import(compile(source))
const song=(id,title=id,path='C:/music/'+id+'.flac')=>({trackId:id,sourcePath:path,track:{title}})
test('ratings select only 2–5 from current library and descend without mutating input',()=>{
 const songs=[0,1,2,3,4,5].map(n=>song(String(n)));const before=JSON.stringify(songs)
 assert.deepEqual(highestRatedSongs(songs,{0:0,1:1,2:2,3:3,4:4,5:5,hidden:5}).map(s=>s.trackId),['5','4','3','2'])
 assert.equal(JSON.stringify(songs),before)
 assert.deepEqual(highestRatedSongs(songs,{}),[])
})
test('equal ratings sort title then normalized path independent of insertion order',()=>{
 const songs=[song('z','Same','C:\\music\\z.flac'),song('a','Same'),song('b','Alpha')],ratings={z:4,a:4,b:4}
 assert.deepEqual(highestRatedSongs(songs,ratings).map(s=>s.trackId),['b','a','z'])
 assert.deepEqual(highestRatedSongs([...songs].reverse(),ratings).map(s=>s.trackId),['b','a','z'])
})
test('subsequent score changes derive membership and order without stale values',()=>{
 const songs=[song('a'),song('b')]
 assert.deepEqual(highestRatedSongs(songs,{a:5,b:2}).map(s=>s.trackId),['a','b'])
 assert.deepEqual(highestRatedSongs(songs,{a:1,b:2}).map(s=>s.trackId),['b'])
 assert.deepEqual(highestRatedSongs(songs,{a:2,b:5}).map(s=>s.trackId),['b','a'])
})
test('thumbs membership is only 5 and switching modes restores 2–4 without changing scores',()=>{
 const songs=[0,1,2,3,4,5].map(n=>song(String(n))),ratings={0:0,1:1,2:2,3:3,4:4,5:5}
 const before=JSON.stringify(ratings)
 assert.deepEqual(highestRatedSongs(songs,ratings,'thumbs').map(s=>s.trackId),['5'])
 assert.deepEqual(highestRatedSongs(songs,ratings,'stars').map(s=>s.trackId),['5','4','3','2'])
 assert.deepEqual(highestRatedSongs(songs,ratings,'thumbs').map(s=>s.trackId),['5'])
 assert.equal(JSON.stringify(ratings),before)
})
test('lowest-rated selects only 1 and uses stable title/path order',()=>{
 const songs=[song('z','Same'),song('a','Same'),song('b','Alpha'),song('two'),song('five'),song('zero'),song('unset')]
 assert.deepEqual(lowestRatedSongs(songs,{z:1,a:1,b:1,two:2,five:5,zero:0}).map(s=>s.trackId),['b','a','z'])
 assert.deepEqual(lowestRatedSongs(songs,{}),[])
})
