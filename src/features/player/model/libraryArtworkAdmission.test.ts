import assert from 'node:assert/strict'
import test from 'node:test'
import { admitLibraryArtwork } from './libraryArtworkAdmission.ts'

const paths=(prefix:string,count:number,edge=256)=>new Map(Array.from({length:count},(_,index)=>[`${prefix}-${index}`,edge]))

test('72 required covers reserve only eight optional slots in the eighty-entry cache',()=>{
  const required=paths('visible',72),optional=paths('nearby',40)
  const result=admitLibraryArtwork(required,optional,new Set(required.keys()),80,40)
  assert.equal(result.size,80)
  assert.deepEqual([...result.keys()],[...required.keys(),...Array.from({length:8},(_,index)=>`nearby-${index}`)])
})

test('a viewport larger than the nominal cache retains every required cover with zero optional work',()=>{
  const required=paths('visible',96),optional=paths('nearby',40)
  const result=admitLibraryArtwork(required,optional,new Set(['sidebar','pinned-fallback']),80,40)
  assert.deepEqual([...result],[...required],'dense visible rows cannot be demoted or evicted to satisfy the optional cache target')
})

test('protected paths are deduplicated and a pin reserves space without creating a cold request',()=>{
  const required=new Map([['visible-a',256],['visible-b',512]])
  const optional=new Map([['visible-a',128],['pinned-only',128],['near-a',128],['near-b',256]])
  const protectedPaths=new Set(['visible-a','visible-b','pinned-only'])
  const result=admitLibraryArtwork(required,optional,protectedPaths,5,40)
  assert.deepEqual([...result],[['visible-a',256],['visible-b',512],['near-a',128],['near-b',256]])
  assert(!result.has('pinned-only'),'pinning protects a retained bitmap; it cannot initiate an otherwise optional cold load')
  assert.deepEqual([...required],[['visible-a',256],['visible-b',512]])
  assert.equal(optional.size,4,'planning cannot modify the callers source order or descriptors')
})

test('adding and releasing sidebar or fallback protection recomputes only the spare optional budget',()=>{
  const required=paths('visible',72),optional=paths('nearby',40)
  const pins=new Set(Array.from({length:5},(_,index)=>`fallback-${index}`))
  assert.equal(admitLibraryArtwork(required,optional,pins,80,40).size,75)
  pins.delete('fallback-0');pins.delete('fallback-1');pins.delete('fallback-2')
  assert.equal(admitLibraryArtwork(required,optional,pins,80,40).size,78)
  pins.clear()
  assert.equal(admitLibraryArtwork(required,optional,pins,80,40).size,80)
  const withSidebar=new Map([...required,...paths('sidebar',6)])
  const shown=admitLibraryArtwork(withSidebar,optional,new Set(withSidebar.keys()),80,40)
  assert.equal(shown.size,80)
  assert([...paths('sidebar',6).keys()].every(key=>shown.has(key)),'visible sidebar covers retain required admission')
  const hidden=admitLibraryArtwork(required,optional,new Set(required.keys()),80,40)
  assert.equal([...hidden.keys()].filter(key=>key.startsWith('nearby-')).length,8,'releasing a source scope returns its spare slots')
})

test('optional admission obeys both the forty-entry ceiling and the zero-spare lower bound',()=>{
  const required=paths('visible',1),optional=paths('nearby',100)
  assert.equal(admitLibraryArtwork(required,optional,new Set(),200,40).size,41)
  assert.equal(admitLibraryArtwork(required,optional,new Set(),80,0).size,1)
  assert.deepEqual([...admitLibraryArtwork(paths('visible',8),optional,new Set(),5,40)],[...paths('visible',8)])
})
