import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import test from 'node:test'
const ts=createRequire(import.meta.url)('typescript')
const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText).toString('base64')
const m=await import(compile(readFileSync(new URL('./trackRatingStorage.ts',import.meta.url),'utf8')))
let raw
const storage=()=>{globalThis.localStorage={getItem:()=>raw,setItem:(_key,value)=>{raw=value}}}
test('all integer ratings roundtrip; zero deletes and never serializes; orphan IDs retained',()=>{
 storage();let ratings={orphan:4}
 for(let n=1;n<=5;n++)ratings=m.updateTrackRating(ratings,'id'+n,n)
 m.writeTrackRatings(ratings);assert.deepEqual(m.readTrackRatings(),ratings)
 const cleared=m.updateTrackRating(ratings,'id5',0);assert.equal(ratings.id5,5);assert.equal(Object.hasOwn(cleared,'id5'),false)
 m.writeTrackRatings(cleared);assert.equal(m.readTrackRatings().id5,undefined);assert.equal(m.readTrackRatings().orphan,4)
 assert(JSON.parse(raw).entries.every(e=>e.rating>=1&&e.rating<=5))
})
test('malformed envelope is empty, malformed rows ignored, last valid duplicate wins',()=>{
 storage();for(raw of ['bad','null','[]','{"version":2,"entries":[]}','{"version":1,"entries":{}}'])assert.deepEqual(m.readTrackRatings(),{})
 raw=JSON.stringify({version:1,entries:[null,1,{},...[0,6,-1,1.2,'5',null].map(rating=>({trackId:'invalid',rating})),{trackId:' ',rating:5},{trackId:'ok',rating:2},{trackId:'ok',rating:4},{trackId:'ok',rating:9}]})
 assert.deepEqual(m.readTrackRatings(),{ok:4})
})
test('unavailable reads safely empty, failed writes are explicit for hook feedback',()=>{
 globalThis.localStorage={getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('quota')}}
 assert.deepEqual(m.readTrackRatings(),{});assert.throws(()=>m.writeTrackRatings({a:5}),/quota/)
 delete globalThis.localStorage;assert.deepEqual(m.readTrackRatings(),{})
})
test('dangerous property names remain own data; invalid mutations cannot alter prototype',()=>{
 storage();raw=JSON.stringify({version:1,entries:[{trackId:'__proto__',rating:5},{trackId:'constructor',rating:1}]})
 const ratings=m.readTrackRatings();assert.equal(Object.getPrototypeOf(ratings),Object.prototype);assert.equal(Object.hasOwn(ratings,'__proto__'),true);assert.equal(ratings.__proto__,5)
 const changed=m.updateTrackRating(ratings,'__proto__',2);assert.equal(changed.__proto__,2);assert.equal(Object.getPrototypeOf(changed),Object.prototype)
 for(const [id,n]of [['',5],[' ',3],['ok',9],['ok',1.2]])assert.deepEqual(m.updateTrackRating(changed,id,n),changed)
})
