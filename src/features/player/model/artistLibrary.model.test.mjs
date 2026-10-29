import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const moduleUrl = async name => url(compile(await readFile(new URL(name, import.meta.url), 'utf8')))
const summaryUrl = await moduleUrl('./playlistTrackSummary.ts')
const selectionUrl = await moduleUrl('./folderSelection.ts')
const hierarchyUrl = url(compile(await readFile(new URL('./folderHierarchy.ts', import.meta.url), 'utf8')).replace("'./playlistTrackSummary'", JSON.stringify(summaryUrl)).replace("'./folderSelection'", JSON.stringify(selectionUrl)))
const quickUrl = await moduleUrl('./quickIndex.ts')
const source = compile(await readFile(new URL('./albumLibrary.ts', import.meta.url), 'utf8')).replace("'./folderHierarchy'", JSON.stringify(hierarchyUrl)).replace("'./quickIndex'", JSON.stringify(quickUrl))

const albumUrl=url(source)
const artistSource=compile(await readFile(new URL('./artistLibrary.ts',import.meta.url),'utf8')).replace("'./albumLibrary'",JSON.stringify(albumUrl)).replace("'./quickIndex'",JSON.stringify(quickUrl))
const {artistEntries,artistAlbums,splitArtists,uniqueArtistSongs,artistRoute}=await import(url(artistSource))
const {playlistTrackRowFromSummary,playlistTrackRowEqual}=await import(summaryUrl)
const song=(id,artist,album='Mixed',albumArtist=null)=>({key:'/music/Mix/'+id+'.flac',scope:'real:'+id,trackId:id,sourcePath:'/music/Mix/'+id+'.flac',available:true,track:{id,title:id,artist:artist??'Display Fallback',libraryArtistName:artist,libraryAlbumName:album,albumArtist,album:album??'本地音频'}})
test('artist scoped album year uses its own members rather than conflicting other artists',()=>{
 const a=song('a','A'),duet=song('duet','A/B'),b=song('b','B');a.track.libraryYear=2023;duet.track.libraryYear=2023;b.track.libraryYear=2024
 const artists=artistEntries([a,duet,b]);assert.equal(artistAlbums(artists.find(item=>item.name==='A'))[0].year,2023);assert.equal(artistAlbums(artists.find(item=>item.name==='B'))[0].year,null)
})
test('slash splits memberships, trims and deduplicates, preserves exceptions at whole segment boundaries',()=>{
 assert.deepEqual(splitArtists(' A / B /A// '),['A','B'])
 assert.deepEqual(splitArtists('Band/AC/DC/Guest/+/-'),['Band','AC/DC','Guest','+/-'])
 assert.deepEqual(splitArtists('XAC/DCY'),['XAC','DCY'])
 assert.deepEqual(splitArtists('A feat. B/C & D'),['A feat. B','C & D'])
})
test('raw artist only; pending excluded, missing differs from literal unknown and album artist',()=>{
 const missing=song('missing',null);missing.track.albumArtist='Ensemble'
 const entries=artistEntries([missing,song('pending',undefined),song('literal','未知艺术家')])
 assert.equal(entries.length,2);assert.equal(entries[0].name,entries[1].name);assert.notEqual(entries[0].key,entries[1].key)
 assert(!entries.some(e=>e.name==='Ensemble'))
})
test('cooperative track belongs to both and selection union preserves first real playable descriptor',()=>{
 const duet=song('duet','A/B/A'),a=song('a','A'),b=song('b','B')
 const entries=artistEntries([duet,a,b,{...duet,scope:'duplicate'}]);assert.equal(entries.length,2)
 assert.deepEqual(entries.find(e=>e.name==='A').songs.map(s=>s.trackId),['a','duet'])
 assert.deepEqual(entries.find(e=>e.name==='B').songs.map(s=>s.trackId),['b','duet'])
 const union=uniqueArtistSongs(entries.flatMap(e=>e.songs));assert.equal(union.length,3);assert.equal(union.find(s=>s.trackId==='duet').scope,'real:duet')
 assert.equal(artistAlbums(entries.find(e=>e.name==='A'))[0].songs.length,2)
 assert(!artistAlbums(entries.find(e=>e.name==='A'))[0].songs.some(s=>s.trackId==='b'))
})
test('directory isolation and multi-disc identity follow existing album model inside artist boundary',()=>{
 const a=song('a','A','Box','Ensemble'),b=song('b','A','Box','Ensemble');b.sourcePath='/other/Disc2/b.flac';b.key=b.sourcePath
 assert.equal(artistAlbums(artistEntries([a,b])[0]).length,1)
 a.track.albumArtist=null;b.track.albumArtist=null;assert.equal(artistAlbums(artistEntries([a,b])[0]).length,2)
})
test('raw metadata mapping/equality survive display fallback and route keys distinguish every layer',()=>{
 const row=playlistTrackRowFromSummary({id:'x',fileName:'x.flac'},{artist:null,albumArtist:'Ensemble'})
 assert.equal(row.artist,'Ensemble');assert.equal(row.libraryArtistName,null)
 assert.equal(playlistTrackRowEqual(row,{...row,libraryArtistName:'Ensemble'}),false)
 const keys=[null,{artistKey:'a',view:'albums'},{artistKey:'a',view:'songs'},{artistKey:'a',view:'album',albumKey:'mix'},{artistKey:'b',view:'album',albumKey:'mix'}].map(artistRoute)
 assert.equal(new Set(keys).size,5)
})
