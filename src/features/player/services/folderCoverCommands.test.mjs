import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {test} from 'node:test'

const require=createRequire(import.meta.url),ts=require('typescript')
const source=readFileSync(new URL('./audioCommands.ts',import.meta.url),'utf8')
async function harness(response){
 const calls=[]
 globalThis.__folderCommandInvoke=async(command,args)=>{calls.push({command,args});if(response instanceof Error)throw response;return response}
 let compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText
 compiled=compiled.replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,"const invoke=globalThis.__folderCommandInvoke;const convertFileSrc=path=>path;")
  .replace(/import \{ listen \} from [^;]+;/,'const listen=()=>{};')
  .replace(/import \{ AUDIO_PLAYLIST_DURATION_BATCH_LIMIT \} from [^;]+;/,'const AUDIO_PLAYLIST_DURATION_BATCH_LIMIT=128;')
 assert(!/^import /m.test(compiled),'only native and unrelated duration boundaries are substituted')
 const module=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Math.random()}`)
 return {load:module.loadAudioFolderThumbnail,calls}
}
const input={clientId:'folder-client',rootPath:'D:/Music',directoryPath:'D:/Music/Album',maxEdge:256,windowGeneration:7}
function pixels(){
 const bytes=new Uint8Array(44),view=new DataView(bytes.buffer)
 bytes.set([83,80,88,82]);view.setUint16(4,1,true);view.setUint16(6,40,true)
 for(const [offset,value] of [[8,1],[12,1],[16,4],[20,1],[24,4],[32,1],[36,1]])view.setUint32(offset,value,true)
 bytes.set([17,34,51,255],40);return bytes
}
test('folder request forwards the exact native contract and parses raw SPXR',async()=>{
 const h=await harness(pixels()),result=await h.load(input)
 assert.deepEqual(h.calls,[{command:'audio_load_folder_thumbnail',args:{input}}])
 assert.equal(result.width,1);assert.equal(result.height,1);assert.deepEqual([...result.pixels],[17,34,51,255])
})
test('only zero binary bytes mean missing folder artwork',async()=>{
 for(const response of [new Uint8Array(0),new ArrayBuffer(0)])assert.equal(await (await harness(response)).load(input),null)
 for(const response of [null,[],{},new Uint8Array([83,80])])await assert.rejects((await harness(response)).load(input))
})
test('malformed folder pixels fail instead of silently becoming placeholder',async()=>{
 const bytes=pixels();new DataView(bytes.buffer).setUint32(8,257,true)
 await assert.rejects((await harness(bytes)).load(input),/metadata is inconsistent/)
})
test('native folder errors retain their failure identity for retry lifecycle',async()=>{
 const error=new Error('directory unreadable'),h=await harness(error)
 await assert.rejects(h.load(input),value=>value===error)
})
