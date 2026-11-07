import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const cache = new Map()
const sourceRoot = new URL('../../../', import.meta.url)
async function moduleUrl(file) {
  if(cache.has(file.href))return cache.get(file.href)
  let source = file.pathname.endsWith('/services/audioCommands.ts')
    ? 'export const audioCoverArtUrl=()=>undefined;export const audioCoverArtFallbackUrl=()=>undefined;'
    : ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText
  for(const match of [...source.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    if(!match[1].startsWith('.')&&!match[1].startsWith('@/'))continue
    const target=match[1].startsWith('@/')?new URL(match[1].slice(2)+'.ts',sourceRoot):new URL(match[1]+'.ts',file)
    source=source.replace(match[0],`from '${await moduleUrl(target)}'`)
  }
  const result=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  cache.set(file.href,result)
  return result
}
const {audioTrackToTrack,audioTrackToPlaylistVisual}=await import(await moduleUrl(new URL('./audioTrackModel.ts',import.meta.url)))
const fixture=(artist=null,albumArtist=null)=>({id:'radio',sourceKind:'stream',sourcePath:'https://radio.test/live',fileName:'radio',durationMs:null,metadata:{title:'Radio',artist,albumArtist,album:null,coverArt:null}})

test('stream playback preserves real artists and trims metadata, with genuine album-artist fallback',()=>{
  assert.equal(audioTrackToTrack(fixture('  Artist Name  ')).artist,'Artist Name')
  assert.equal(audioTrackToTrack(fixture(' ','  Album Artist  ')).artist,'Album Artist')
  assert.equal(audioTrackToTrack(fixture('First','Second')).artist,'First')
})
test('missing stream artists remain empty and do not fabricate local-audio labels',()=>{
  assert.equal(audioTrackToTrack(fixture()).artist,'')
  assert.equal(audioTrackToTrack(fixture('  ','  ')).artist,'')
  assert.equal(audioTrackToTrack(fixture()).stream.url,'https://radio.test/live')
})
test('stream list metadata stays URL-oriented, while local artist mapping remains unchanged',()=>{
  assert.equal(audioTrackToPlaylistVisual(fixture('Playing Artist')).artist,'')
  assert.equal(audioTrackToPlaylistVisual(fixture('Playing Artist')).stream.url,'https://radio.test/live')
  assert.equal(audioTrackToTrack({...fixture('Local Artist'),sourceKind:'file',sourcePath:'/music/local.wav'}).artist,'Local Artist')
})
