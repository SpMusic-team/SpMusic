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
const artistSource=compile(await readFile(new URL('./artistLibrary.ts',import.meta.url),'utf8')).replaceAll("'./albumLibrary'",JSON.stringify(albumUrl)).replace("'./quickIndex'",JSON.stringify(quickUrl))
const {artistEntries,artistAlbums,splitArtists,uniqueArtistSongs,artistRoute}=await import(url(artistSource))
const {playlistTrackRowFromSummary,playlistTrackRowEqual}=await import(summaryUrl)
const song=(id,artist,album='Mixed',albumArtist=null)=>({key:'/music/Mix/'+id+'.flac',scope:'real:'+id,trackId:id,sourcePath:'/music/Mix/'+id+'.flac',available:true,track:{id,title:id,artist:artist??'Display Fallback',libraryArtistName:artist,libraryAlbumName:album,albumArtist,album:album??'本地音频'}})
test('artist scoped album year uses its own members rather than conflicting other artists',()=>{
 const a=song('a','A'),duet=song('duet','A/B'),b=song('b','B');a.track.libraryYear=2023;duet.track.libraryYear=2023;b.track.libraryYear=2024
 const artists=artistEntries([a,duet,b]);assert(artistAlbums(artists.find(item=>item.name==='A')).every(album=>album.year===2023));assert.deepEqual(artistAlbums(artists.find(item=>item.name==='B')).map(album=>album.year).sort(),[2023,2024])
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
 assert.deepEqual(artistAlbums(entries.find(e=>e.name==='A')).map(album=>album.songs.map(s=>s.trackId)),[['a'],['duet']])
 assert(!artistAlbums(entries.find(e=>e.name==='A')).some(album=>album.songs.some(s=>s.trackId==='b')))
})
test('named artist albums merge across directories with or without album artist',()=>{
 const a=song('a','A','Box','Ensemble'),b=song('b','A','Box','Ensemble');b.sourcePath='/other/Disc2/b.flac';b.key=b.sourcePath
 assert.equal(artistAlbums(artistEntries([a,b])[0]).length,1)
 a.track.albumArtist=null;b.track.albumArtist=null;assert.equal(artistAlbums(artistEntries([a,b])[0]).length,1)
 a.track.libraryAlbumName=null;b.track.libraryAlbumName=null;assert.equal(artistAlbums(artistEntries([a,b])[0]).length,2)
})
test('raw metadata mapping/equality survive display fallback and route keys distinguish every layer',()=>{
 const row=playlistTrackRowFromSummary({id:'x',fileName:'x.flac'},{artist:null,albumArtist:'Ensemble'})
 assert.equal(row.artist,'Ensemble');assert.equal(row.libraryArtistName,null)
 assert.equal(playlistTrackRowEqual(row,{...row,libraryArtistName:'Ensemble'}),false)
 const keys=[null,{artistKey:'a',view:'albums'},{artistKey:'a',view:'songs'},{artistKey:'a',view:'album',albumKey:'mix'},{artistKey:'b',view:'album',albumKey:'mix'}].map(artistRoute)
 assert.equal(new Set(keys).size,5)
})

test('artist albums keep solo and cooperative credits separate within a directory',()=>{
 const solo=song('ether','Akira Complex','Hypersynthetic'),title=song('title','Akira Complex','Hypersynthetic'),duet=song('remix','Akira Complex/kors k','Hypersynthetic'),other=song('other','Akira Complex','Hypersynthetic')
 other.key=other.sourcePath='/other/Hypersynthetic/other.flac'
 solo.track.libraryYear=2018;title.track.libraryYear=2018;duet.track.libraryYear=2019
 const albums=artistAlbums(artistEntries([solo,title,duet,other]).find(e=>e.name==='Akira Complex'))
 assert.equal(albums.length,2)
 assert.deepEqual(albums.find(e=>e.songs.includes(duet)).songs,[duet])
 assert.deepEqual(albums.find(e=>e.songs.includes(solo)).songs,[solo,other,title])
 assert.equal(albums.find(e=>e.songs.includes(solo)).year,2018)
 assert.equal(albums.find(e=>e.songs.includes(duet)).year,2019)
 assert.equal(albums.find(e=>e.songs.includes(duet)).coverSong,duet)
 assert.equal(albums.find(e=>e.songs.includes(other)).songs.length,3)
})

test('credit identity normalizes ordering and preserves explicit album artist grouping',()=>{
 const a=song('a',' A / B / A '),b=song('b','B/A')
 const entry=artistAlbums(artistEntries([a,b]).find(e=>e.name==='A'))[0]
 assert.deepEqual(entry.songs,[a,b]);assert.equal(artistAlbums(artistEntries([b]).find(e=>e.name==='A'))[0].key,entry.key)
 a.track.albumArtist='Ensemble';b.track.albumArtist='Ensemble';b.sourcePath=b.key='/other/b.flac'
 const explicit=artistAlbums(artistEntries([a,b]).find(e=>e.name==='A'))
 assert.equal(explicit.length,1);assert.equal(explicit[0].artist,'Ensemble');assert.deepEqual(explicit[0].songs,[a,b])
})

test('unknown album with any explicit album artist preserves its base group regardless of title order',()=>{
 const a=song('a','A',null),duet=song('duet','A/B',null,'Ensemble')
 const groups=()=>artistAlbums(artistEntries([a,duet]).find(e=>e.name==='A'))
 assert.equal(groups().length,1);const key=groups()[0].key
 a.track.title='zz';duet.track.title='aa'
 assert.equal(groups().length,1);assert.equal(groups()[0].key,key);assert.equal(groups()[0].songs.length,2)
})

test('named artist albums merge directories and explicit/fallback credits independent of year and codec',()=>{
 const a=song('a','Akira Complex','Hypersynthetic'),b=song('b','Akira Complex',' Hypersynthetic ','Akira Complex')
 b.key=b.sourcePath='/other/Extended.mp3';a.track.libraryYear=2018;b.track.libraryYear=2019
 a.track.codec='FLAC';b.track.codec='MP3'
 const groups=artistAlbums(artistEntries([a,b]).find(e=>e.name==='Akira Complex'))
 assert.equal(groups.length,1);assert.deepEqual(groups[0].songs,[a,b]);assert.equal(groups[0].year,2018)
 assert.equal(groups[0].key,artistAlbums(artistEntries([b])[0])[0].key)
})

test('artist album earliest year ignores missing and invalid members without changing identity',()=>{
 const values=[null,undefined,0,-1,2023.5,NaN,Infinity,'2017',4294967296,2024,2018]
 const items=values.map((year,index)=>{const item=song(String(index),'A');item.sourcePath=item.key='/disc'+index+'/song.flac';item.track.libraryYear=year;return item})
 const group=artistAlbums(artistEntries(items)[0])[0]
 assert.equal(group.year,2018);assert.equal(group.songs.length,values.length)
 const key=group.key;for(const item of items)item.track.libraryYear=null
 assert.equal(artistAlbums(artistEntries(items)[0])[0].year,null)
 assert.equal(artistAlbums(artistEntries(items)[0])[0].key,key)
})

test('artist album derivation shares exactly the global grouping for the same member scope',async()=>{
 const {albumEntries}=await import(albumUrl)
 const items=[song('a','A'),song('duet','A/B'),song('other','A','Mixed','A')];items[2].key=items[2].sourcePath='/other/other.mp3'
 const entry=artistEntries(items).find(e=>e.name==='A')
 assert.deepEqual(artistAlbums(entry),albumEntries(entry.songs))
})
