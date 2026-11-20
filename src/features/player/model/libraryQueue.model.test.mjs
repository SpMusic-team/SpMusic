import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const modules = new Map()
const moduleUrl = async file => {
  if (modules.has(file.href)) return modules.get(file.href)
  let source = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  for (const path of new Set([...source.matchAll(/from ['"](\.[^'"]+)['"]/g)].map(match => match[1]))) {
    const dependency = await moduleUrl(new URL(path + '.ts', file))
    source = source.replaceAll("'" + path + "'", JSON.stringify(dependency)).replaceAll('"' + path + '"', JSON.stringify(dependency))
  }
  source = source.replace(/from ['"]react['"]/g, 'from '+JSON.stringify(new URL('../../../../node_modules/react/index.js', import.meta.url).href));
  const result = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  modules.set(file.href, result)
  return result
}

const m=await import(await moduleUrl(new URL('./libraryQueue.ts',import.meta.url)));
let stored=null;globalThis.localStorage={getItem:()=>stored,setItem:(k,v)=>{stored=v}};
const a={id:'a',sourcePath:'C:/music/a.flac',fileName:'a.flac',available:true},b={id:'b',sourcePath:'C:/music/b.flac',fileName:'b.flac',available:false};
test('same-operation dedupe; cross-operation duplicate; track-level played; re-add unplayed',()=>{
 const first=m.appendLibraryQueue([], [a,a,b],100);assert.equal(first.length,1);
 const second=m.appendLibraryQueue(first,[a],200);assert.equal(second.length,2);assert.notEqual(second[0].entryId,second[1].entryId);
 const played=m.markLibraryQueuePlayed(second,a.sourcePath,250);assert(played.every(e=>e.playedAt===250));
 assert.equal(m.markLibraryQueuePlayed(played,'C:/other.flac'),played);
 const third=m.appendLibraryQueue(played,[a],300);assert.equal(third[2].playedAt,null);
 m.writeLibraryQueue(third);assert.deepEqual(m.readLibraryQueue(),third);
});
test('corrupt/version/duplicate-id/timestamp validation',()=>{
 for(const value of ['{bad',null,'{}','{"version":2,"entries":[]}']){stored=value;assert.deepEqual(m.readLibraryQueue(),[])}
 const first=m.appendLibraryQueue([],[a],100);stored=JSON.stringify({version:1,entries:[first[0],first[0],{...first[0],entryId:'bad',playedAt:50}]});assert.equal(m.readLibraryQueue().length,1);
});

test('marking is idempotent and preserves every record and total',()=>{
 const initial=m.appendLibraryQueue([],[a],100);
 const duplicates=m.appendLibraryQueue(initial,[a],200);
 const played=m.markLibraryQueuePlayed(duplicates,a.sourcePath,250);
 assert.equal(played.length,2);assert.deepEqual(played.map(e=>e.entryId),duplicates.map(e=>e.entryId));
 assert.equal(m.markLibraryQueuePlayed(played,a.sourcePath,300),played);
 m.writeLibraryQueue(played);assert.deepEqual(m.readLibraryQueue(),played);
 m.writeLibraryQueue([]);assert.deepEqual(m.readLibraryQueue(),[]);
});
