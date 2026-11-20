import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const COMPONENT = readFileSync(new URL('./PlaylistCoverImage.tsx', import.meta.url), 'utf8')
const READINESS = readFileSync(new URL('../model/playlistCoverReadiness.ts', import.meta.url), 'utf8')

/**
 * Harness for the cover element protocol.
 *
 * The point of these tests is the *shape* of what reaches the owner, because a
 * component that dispatches a bare URL leaves the owner unable to tell a stale
 * report from a current one. Both source paths the component supports must produce
 * the same protocol: an enumerated string `src` and a resource object.
 */
async function harness() {
  const dispatched = []
  const layoutEffects = []
  const states = []
  const refs = []
  let refIndex = 0
  let effectIndex = 0

  const compile = (source) => ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      // Classic JSX emits `React.createElement`; the prelude supplies the tiny
      // `createElement` recorder the component's returned tree is inspected with.
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const stripImports = (code) => code.replace(/^import[\s\S]*?from ['"][^'"]+['"];?[ \t]*$/gm, '')

  globalThis.__coverElementTest = {
    useState: (initial) => {
      const index = states.length
      states.push(typeof initial === 'function' ? initial() : initial)
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useRef: (value) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useLayoutEffect: (effect) => { layoutEffects.push(effect) },
    useCallback: (callback) => callback,
    location: { href: 'http://localhost/' },
    dispatchEvent: (event) => { dispatched.push(event); return true },
    matchMedia: () => ({ matches: false }),
    document: { querySelectorAll: () => [] },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail } },
    COVER_IMAGE_LOAD_EVENT: 'spmusic:playlist-cover-image-load',
    COVER_IMAGE_ERROR_EVENT: 'spmusic:playlist-cover-image-error',
  }
  globalThis.window = globalThis.__coverElementTest

  const readinessUrl = `data:text/javascript;base64,${Buffer.from(compile(READINESS)).toString('base64')}`
  const readiness = await import(`${readinessUrl}#readiness-${Math.random()}`)

  const stripped = compile(COMPONENT).replace(/^import[\s\S]*?from ['"][^'"]+['"];?[ \t]*$/gm, '')
  assert(!/^import\b/m.test(stripped), 'every runtime import is substituted')
  const prelude = `
    const { useState, useRef, useLayoutEffect, useCallback, dispatchEvent, CustomEvent } = globalThis.__coverElementTest
    const window = globalThis.__coverElementTest
    // Classic JSX runtime: record the element tree the component returns so the
    // tests can assert the props React would have applied.
    const React = {
      createElement: (type, props, ...children) => ({
        type,
        props: { ...props, children: children.length > 1 ? children : children[0] },
      }),
    }
  `
  const readinessImport = `import { ` +
    `COVER_IMAGE_LOAD_EVENT, COVER_IMAGE_ERROR_EVENT, coverAbsoluteUrl, forgetPlaylistCoverDecoded, ` +
    `isPlaylistCoverDecoded, isPlaylistCoverPresented, markPlaylistCoverDecoded, ` +
    `markPlaylistCoverPresented, reportCoverPresentation ` +
    `} from ${JSON.stringify(readinessUrl)};\n`
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(readinessImport + prelude + stripped).toString('base64')}#element-${Math.random()}`,
  )

  const presentation = {
    src: 'asset://localhost/cache/cover-1.jpg',
    token: {
      key: '/music/a.flac',
      identity: '["track","track-a","/music/a.flac",1]',
      sessionGeneration: 4,
      publishGeneration: 2,
      url: 'asset://localhost/cache/cover-1.jpg',
    },
  }

  const run = (props, imageElement) => {
    refs.length = 0
    refIndex = 0
    effectIndex = 0
    states.length = 0
    // `imageRef` is the component's first ref; seeding it lets the layout effect
    // observe a real element, which is how the cached-state branch is reached.
    refs[0] = { current: imageElement ?? null }
    const element = module.PlaylistCoverImage(props)
    const effect = layoutEffects.splice(0).at(-1)
    return { element, effect }
  }

  return { module, presentation, dispatched, states, run, readiness }
}

/** A stand-in `<img>` element with the properties the component inspects. */
function fakeElement({ src, complete = false, naturalWidth = 0, currentSrc } = {}) {
  return {
    complete, naturalWidth,
    src,
    currentSrc: currentSrc ?? src,
    getAttribute: (name) => (name === 'src' ? src : null),
    closest: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    set hidden(value) { this._hidden = value },
  }
}

test('an enumerated string src reports the published token, not just the URL', async () => {
  const h = await harness()
  const { element } = h.run({ src: h.presentation.src, presentation: h.presentation })
  assert.equal(element.type, 'img')
  assert.equal(element.props.src, h.presentation.src)
  // A URL-only report would leave the owner unable to verify currentness.
  element.props.onError({ currentTarget: fakeElement({ src: h.presentation.src }) })
  assert.equal(h.dispatched.length, 1)
  const event = h.dispatched[0]
  assert.equal(event.type, 'spmusic:playlist-cover-image-error')
  assert.equal(event.detail.token.sessionGeneration, 4)
  assert.equal(event.detail.token.publishGeneration, 2)
  assert.equal(event.detail.token.identity, h.presentation.token.identity)
  assert.equal(event.detail.actualUrl, new URL(h.presentation.src, 'http://localhost/').href)
})

test('a resource object reports the same protocol as a string src', async () => {
  const h = await harness()
  const image = { src: 'blob:cover-9', width: 256, height: 256, encodedBytes: 12 }
  const presentation = { image, src: image.src, token: { ...h.presentation.token, url: image.src } }
  const { element } = h.run({ image, presentation })
  element.props.onLoad({ currentTarget: fakeElement({ src: image.src, complete: true, naturalWidth: 256 }) })
  assert.equal(h.dispatched.length, 1)
  const event = h.dispatched[0]
  assert.equal(event.type, 'spmusic:playlist-cover-image-load')
  assert.equal(event.detail.token.key, h.presentation.token.key)
  assert.equal(event.detail.actualUrl, new URL(image.src, 'http://localhost/').href)
})

test('without a presentation the legacy URL-shaped report is kept', async () => {
  const h = await harness()
  const { element } = h.run({ src: 'asset://localhost/cache/legacy.jpg' })
  element.props.onError({ currentTarget: fakeElement({ src: 'asset://localhost/cache/legacy.jpg' }) })
  assert.equal(h.dispatched.length, 1)
  // Preserved on purpose: consumers that only match on URL keep working, while the
  // all-songs owner will still reject a tokenless report as unverifiable.
  assert.equal(h.dispatched[0].detail, 'asset://localhost/cache/legacy.jpg')
})

test('a cached element that is already complete reports success without a load event', async () => {
  const h = await harness()
  // `complete && naturalWidth > 0` at commit: the load event already fired before
  // React attached it, so the effect must decide the outcome itself.
  const element = fakeElement({ src: h.presentation.src, complete: true, naturalWidth: 256 })
  const { effect } = h.run({ src: h.presentation.src, presentation: h.presentation }, element)
  effect()
  assert.equal(h.dispatched.length, 1, 'the completed element is reported exactly once')
  assert.equal(h.dispatched[0].type, 'spmusic:playlist-cover-image-load')
  assert.equal(h.dispatched[0].detail.token.publishGeneration, h.presentation.token.publishGeneration)
})

test('a cached element with zero natural width reports failure, because no error event follows', async () => {
  const h = await harness()
  const element = fakeElement({ src: h.presentation.src, complete: true, naturalWidth: 0 })
  const { effect } = h.run({ src: h.presentation.src, presentation: h.presentation }, element)
  effect()
  assert.equal(h.dispatched.length, 1, 'a broken cached resource is reported without an error event')
  assert.equal(h.dispatched[0].type, 'spmusic:playlist-cover-image-error')
  assert.equal(h.dispatched[0].detail.token.key, h.presentation.token.key)
  assert.equal(h.states.at(-1) ?? true, false, 'data-loaded is not left claiming readiness')
})

test('an element still loading at commit reports nothing', async () => {
  const h = await harness()
  const element = fakeElement({ src: h.presentation.src, complete: false, naturalWidth: 0 })
  const { effect } = h.run({ src: h.presentation.src, presentation: h.presentation }, element)
  effect()
  assert.equal(h.dispatched.length, 0, 'an in-flight request is not settled early')
})

test('a failure clears data-loaded instead of keeping a false ready claim', async () => {
  const h = await harness()
  const { element } = h.run({ src: h.presentation.src, presentation: h.presentation, reveal: true })
  element.props.onError({ currentTarget: fakeElement({ src: h.presentation.src }) })
  // `data-loaded="true"` must not survive a resource that just failed.
  const after = h.run({ src: h.presentation.src, presentation: h.presentation, reveal: true })
  assert.equal(after.element.props['data-loaded'], 'false')
})
