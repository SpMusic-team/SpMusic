import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {test} from 'node:test'

const require=createRequire(import.meta.url),ts=require('typescript')
const source=readFileSync(new URL('./playlistArtworkRevision.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText
const {playlistArtworkRevision:revision}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('scan identity survives metadata and duration publication but changes on sidecar-only rescan',()=>{
  const source={directoryPaths:['/music'],tracks:[{id:'same',sourcePath:'/music/song.flac'}]}
  const initial=revision(source)
  assert.equal(revision({...source,tracks:source.tracks.map(row=>({...row,title:'Hydrated',durationMs:180000}))}),initial)
  assert.notEqual(revision({...source,directoryPaths:[...source.directoryPaths]}),initial)
})

test('legacy scan identity uses the stable descriptor array and isolates independent sources',()=>{
  const source={tracks:[{id:'same'}]},initial=revision(source)
  assert.equal(revision({...source}),initial)
  assert.notEqual(revision({tracks:[...source.tracks]}),initial)
  assert.notEqual(revision({directoryPaths:[],tracks:source.tracks}),initial)
})
