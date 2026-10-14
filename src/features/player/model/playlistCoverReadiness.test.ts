import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { forgetPlaylistCoverDecoded, isPlaylistCoverDecoded, markPlaylistCoverDecoded } from './playlistCoverReadiness.ts'

// Exercise the real TSX consumers with the project's existing React/TypeScript
// packages. No DOM/test framework or browser globals are needed for first paint.
const require = createRequire(import.meta.url)
function loadComponent(name: string): ComponentType<Record<string, unknown>> {
  const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} as Record<string, ComponentType<Record<string, unknown>>> }
  const resolve = (id: string): unknown => {
    if (id.endsWith('/playlistCoverReadiness')) return { forgetPlaylistCoverDecoded, isPlaylistCoverDecoded, markPlaylistCoverDecoded }
    if (id.endsWith('/PlaylistCoverImage')) return { PlaylistCoverImage: loadComponent('PlaylistCoverImage') }
    if (id.endsWith('/useAppearance')) return { useSystemIcons: () => ({ music: () => null }) }
    if (id.endsWith('/playerCopy')) return { appCopy: { playlistPage: { moreUnavailable: '不可用' } } }
    return require(id)
  }
  new Function('require', 'module', 'exports', compiled)(resolve, module, module.exports)
  return module.exports[name]!
}

test('a successfully loaded cover stays ready across temporary consumers', () => {
  const image = { src: 'blob:cover', width: 128, height: 128, encodedBytes: 65536 }
  assert.equal(isPlaylistCoverDecoded(image), false)
  markPlaylistCoverDecoded(image)
  assert.equal(isPlaylistCoverDecoded(image), true)
  // A panel/card can mount again with the same owned resource.
  assert.equal(isPlaylistCoverDecoded(image), true)
})

test('new or failed resources do not inherit readiness from another cover', () => {
  const loaded = { src: 'blob:cover', width: 128, height: 128, encodedBytes: 65536 }
  markPlaylistCoverDecoded(loaded)
  const replacement = { src: 'blob:upgrade', width: 256, height: 256, encodedBytes: 262144 }
  const separateResource = { ...loaded }
  assert.equal(isPlaylistCoverDecoded(replacement), false)
  assert.equal(isPlaylistCoverDecoded(separateResource), false)
  markPlaylistCoverDecoded(replacement)
  assert.equal(isPlaylistCoverDecoded(replacement), true)
  assert.equal(isPlaylistCoverDecoded(separateResource), false)
})

test('a failed resource loses readiness without invalidating its successful fallback', () => {
  const fallback = { src: 'blob:fallback', width: 128, height: 128, encodedBytes: 65536 }
  const upgrade = { src: 'blob:failed-upgrade', width: 256, height: 256, encodedBytes: 262144 }
  markPlaylistCoverDecoded(fallback)
  markPlaylistCoverDecoded(upgrade)
  forgetPlaylistCoverDecoded(upgrade)
  assert.equal(isPlaylistCoverDecoded(upgrade), false)
  assert.equal(isPlaylistCoverDecoded(fallback), true)
  markPlaylistCoverDecoded(upgrade)
  assert.equal(isPlaylistCoverDecoded(upgrade), true)
})

test('real image consumer renders a warm resource ready on the first remount frame', () => {
  const Image = loadComponent('PlaylistCoverImage')
  const image = { src: 'blob:ready-remount', width: 128, height: 128, encodedBytes: 65536 }
  assert.match(renderToStaticMarkup(createElement(Image, { image })), /data-loaded="false"/)
  markPlaylistCoverDecoded(image)
  assert.match(renderToStaticMarkup(createElement(Image, { image })), /data-loaded="true"/)
  assert.match(renderToStaticMarkup(createElement(Image, { image: { ...image, src: 'blob:new-cover' } })), /data-loaded="false"/)
})

test('real card keeps its owned cover when only the viewport/layout flag changes', () => {
  const Card = loadComponent('PlaylistCard')
  const coverThumbnail = { src: 'blob:retained-card', width: 128, height: 128, encodedBytes: 65536 }
  markPlaylistCoverDecoded(coverThumbnail)
  const props = {
    track: { id: 'track', title: '歌曲', artist: '艺术家', album: '专辑', coverThumbnail },
    current: false, unavailable: false, canActivate: true, selectMode: false, selected: false,
    showExtendedMetadata: false, onActivate: () => {}, onToggleSelect: () => {},
  }
  for (const artworkVisible of [true, false, true]) {
    const markup = renderToStaticMarkup(createElement(Card, { ...props, artworkVisible }))
    assert.match(markup, /src="blob:retained-card"/)
    assert.match(markup, /data-cover-state="ready"/)
    assert.match(markup, /data-loaded="true"/)
  }
})
