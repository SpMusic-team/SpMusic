import assert from 'node:assert/strict'
import test from 'node:test'
import { orderPlaylistArtworkRows } from './playlistArtworkOrder.ts'

type Entry = { id: string; rowTop: number; domIndex: number; inViewport: boolean; viewportDistance: number; side: -1 | 0 | 1 }
const visible = (id: string, rowTop: number, domIndex: number): Entry => ({ id, rowTop, domIndex, inViewport: true, viewportDistance: 0, side: 0 })

test('initial direction preserves visible DOM order before nearby prefetch', () => {
  const entries: Entry[] = [
    { id: 'prefetch', rowTop: 280, domIndex: 8, inViewport: false, viewportDistance: 40, side: 1 },
    visible('third', 180, 5), visible('first', 20, 1), visible('second', 100, 3),
  ]
  assert.deepEqual(orderPlaylistArtworkRows(entries,0).map(entry=>entry.id),['first','second','third','prefetch'])
})

test('each direction preserves original horizontal order inside a dense row', () => {
  const entries=[visible('right',40,5),visible('left',40,3),visible('middle',40,4)]
  for(const direction of [-1,0,1] as const) {
    assert.deepEqual(orderPlaylistArtworkRows(entries,direction).map(entry=>entry.id),['left','middle','right'])
  }
})

test('the measured reference maps negative scroll delta to bottom-first rows and positive to top-first', () => {
  const entries=[visible('top-left',20,0),visible('top-right',20,1),
    visible('middle-left',100,2),visible('middle-right',100,3),
    visible('bottom-left',180,4),visible('bottom-right',180,5)]
  assert.deepEqual(orderPlaylistArtworkRows(entries,-1).map(entry=>entry.id),
    ['bottom-left','bottom-right','middle-left','middle-right','top-left','top-right'])
  assert.deepEqual(orderPlaylistArtworkRows(entries,1).map(entry=>entry.id),
    ['top-left','top-right','middle-left','middle-right','bottom-left','bottom-right'])
})

test('nearby prefetch follows the actual scrolling side after all visible rows', () => {
  const entries: Entry[]=[visible('visible',20,10),
    {id:'above-near-left',rowTop:-60,domIndex:4,inViewport:false,viewportDistance:10,side:-1},
    {id:'above-near-right',rowTop:-60,domIndex:5,inViewport:false,viewportDistance:10,side:-1},
    {id:'above-far',rowTop:-140,domIndex:2,inViewport:false,viewportDistance:90,side:-1},
    {id:'below',rowTop:400,domIndex:20,inViewport:false,viewportDistance:160,side:1}]
  assert.deepEqual(orderPlaylistArtworkRows(entries,-1).map(entry=>entry.id),
    ['visible','above-near-left','above-near-right','above-far','below'])
  assert.deepEqual(orderPlaylistArtworkRows(entries,1).map(entry=>entry.id),
    ['visible','below','above-near-left','above-near-right','above-far'])
})

test('visible entries stay ahead of either side of overscan without mutating inputs or payloads', () => {
  const entries: Entry[]=[
    {id:'above',rowTop:-80,domIndex:0,inViewport:false,viewportDistance:10,side:-1},
    visible('visible-b',100,3),visible('visible-a',20,1),
    {id:'below',rowTop:280,domIndex:8,inViewport:false,viewportDistance:10,side:1},
  ]
  const original=[...entries]
  for(const direction of [-1,0,1] as const) {
    const sorted=orderPlaylistArtworkRows(entries,direction)
    assert(sorted.slice(0,2).every(entry=>entry.inViewport))
    assert(sorted.slice(2).every(entry=>!entry.inViewport))
    assert.deepEqual(entries,original)
    assert(sorted.every(entry=>original.includes(entry)),'sorting preserves source descriptors by reference')
  }
})
