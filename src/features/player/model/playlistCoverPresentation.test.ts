import assert from 'node:assert/strict'
import test from 'node:test'
import {
  forgetPlaylistCoverDecoded,
  isPlaylistCoverDecoded,
  isPlaylistCoverPresented,
  markPlaylistCoverDecoded,
  markPlaylistCoverPresented,
} from './playlistCoverReadiness.ts'

const image = (name: string) => ({ src: `blob:cover-presentation-${name}`, width: 256, height: 256, encodedBytes: 262184 })

test('predecoding and first presentation have independent lifecycles', () => {
  const cover=image('decode-only')
  markPlaylistCoverDecoded(cover)
  assert.equal(isPlaylistCoverDecoded(cover),true)
  assert.equal(isPlaylistCoverPresented(cover),false,'the loader cannot consume a visual reveal before any image is shown')
  markPlaylistCoverPresented(cover)
  assert.equal(isPlaylistCoverPresented(cover),true)
  forgetPlaylistCoverDecoded(cover)
  assert.equal(isPlaylistCoverPresented(cover),true,'decode bookkeeping does not replay an already displayed cover')
})

test('warm resources, equivalent URL copies and raw URL cards share presentation identity', () => {
  const cover=image('shared-identity'), copy={...cover}
  markPlaylistCoverPresented(cover)
  assert.equal(isPlaylistCoverPresented(cover),true)
  assert.equal(isPlaylistCoverPresented(copy),true)
  assert.equal(isPlaylistCoverPresented(cover.src),true,'All Songs and resource cards agree for the same retained image URL')
  const replacement=image('new-source')
  assert.equal(isPlaylistCoverPresented(replacement),false,'a genuinely new source can have its own first reveal')
})

test('raw URL presentation history is bounded and reads do not alter eviction order', () => {
  const urls=Array.from({length:514},(_,index)=>`blob:presentation-lru-${index}`)
  for(const url of urls.slice(0,512))markPlaylistCoverPresented(url)
  assert.equal(isPlaylistCoverPresented(urls[0]),true)
  markPlaylistCoverPresented(urls[512])
  assert.equal(isPlaylistCoverPresented(urls[0]),false,'a has/read must not mutate render-time LRU ordering')
  markPlaylistCoverPresented(urls[1])
  markPlaylistCoverPresented(urls[513])
  assert.equal(isPlaylistCoverPresented(urls[1]),true,'a real presentation refreshes a retained URL')
  assert.equal(isPlaylistCoverPresented(urls[2]),false)
})

test('weakly owned live resources remain presented when their URL-only history ages out', () => {
  const cover=image('live-resource')
  markPlaylistCoverPresented(cover)
  const urls=Array.from({length:513},(_,index)=>`blob:presentation-live-eviction-${index}`)
  for(const url of urls)markPlaylistCoverPresented(url)
  assert.equal(isPlaylistCoverPresented(cover.src),false)
  assert.equal(isPlaylistCoverPresented(cover),true,'live resource ownership cannot be reset by unrelated URL churn')
})
