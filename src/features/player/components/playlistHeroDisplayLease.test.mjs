/**
 * 头图显示租约（方案 §3）的纯逻辑测试。
 *
 * 这些断言直接钉住「什么时候可以继续显示上一张图、什么时候必须立刻丢掉」，
 * 也就是粘性持有唯一的风险面。浏览器侧另有逐帧探针（见实现报告），本条覆盖
 * 状态迁移本身，因为它们全都是纯函数。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'playlistHeroDisplayLease.ts'), 'utf8')

/**
 * Transpile the real lease module so every assertion runs against production code.
 *
 * Stripping the types by hand would be a second implementation that could drift;
 * this is the same `transpileModule` route `heroTierDowngrade.test.mjs` already uses
 * for the hero selector.
 */
async function loadLeaseModule() {
  const body = source.replace(/^import type .*$/gm, '')
  const transpiled = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`)
}

const { decideHeroLease, commitHeroLease, isSameHeroLease, heroLeaseNeedsCopy } = await loadLeaseModule()

const surface = readFileSync(join(here, 'PlayerSurface.tsx'), 'utf8')
const panel = readFileSync(join(here, 'PlaylistPanel.tsx'), 'utf8')

const image = (src, width = 1536) => ({ src, width, height: width, encodedBytes: width })
const presentation = (src, publishGeneration = 1) => ({
  src,
  token: { key: 'a-0\u0000hero', identity: 'id', sessionGeneration: 1, publishGeneration, url: src },
})
const heroKey = (scope, id) => JSON.stringify([scope, id, `/audio/${scope}/${id}.flac`, 'hero'])

const publication = (overrides = {}) => ({
  heroKey: heroKey('m3u8\u0000/lists/a.m3u8', 'a-0'),
  identity: JSON.stringify(['playlist-hero', 'm3u8\u0000/lists/a.m3u8', 'a-0', '/audio/a/0.flac', 1]),
  edge: 1536,
  image: image('asset://localhost/a0-1536'),
  presentation: presentation('asset://localhost/a0-1536'),
  ...overrides,
})

const leaseOf = (p) => commitHeroLease(decideHeroLease({ lease: undefined, publication: p, currentHeroKey: p.heroKey }))

describe('the hold only ever shows the page it was published for', () => {
  it('adopts the owner publication when there is one', () => {
    const p = publication()
    const decision = decideHeroLease({ lease: undefined, publication: p, currentHeroKey: p.heroKey })
    assert.equal(decision.fromOwner, true)
    assert.equal(decision.render.image.src, 'asset://localhost/a0-1536')
    assert.equal(decision.render.heroKey, p.heroKey)
  })

  it('keeps the held image while the same page has no publication yet (the handover window)', () => {
    const p = publication()
    const lease = leaseOf(p)
    const decision = decideHeroLease({ lease, publication: undefined, currentHeroKey: p.heroKey })
    assert.equal(decision.fromOwner, false, 'a hold is never attributed to the owner')
    assert.equal(decision.render, lease, 'the exact held snapshot is handed back')
  })

  it('drops the held image as soon as the page is a different one', () => {
    const lease = leaseOf(publication())
    const otherKey = heroKey('m3u8\u0000/lists/b.m3u8', 'b-0')
    const decision = decideHeroLease({ lease, publication: undefined, currentHeroKey: otherKey })
    assert.equal(decision.render, undefined, 'a hold must never leak into another playlist')
  })

  it('keeps holding through the frames where the panel has no first track yet', () => {
    // `undefined` means "cannot tell yet" (rows not mounted), not "different page".
    // Dropping it here produced a single 256px frame mid-handover in measurement.
    const lease = leaseOf(publication())
    const decision = decideHeroLease({ lease, publication: undefined, currentHeroKey: undefined })
    assert.equal(decision.render, lease)
  })

  it('prefers the owner over a stale hold even when the identities differ', () => {
    const lease = leaseOf(publication())
    const next = publication({
      identity: JSON.stringify(['playlist-hero', 'm3u8\u0000/lists/a.m3u8', 'a-0', '/audio/a/0.flac', 2]),
      image: image('asset://localhost/a0-1536-v2'),
      presentation: presentation('asset://localhost/a0-1536-v2'),
    })
    const decision = decideHeroLease({ lease, publication: next, currentHeroKey: next.heroKey })
    assert.equal(decision.fromOwner, true)
    assert.equal(decision.render.image.src, 'asset://localhost/a0-1536-v2',
      'a rescan (new revision) must show the new image, not the held one')
  })

  it('hands over as soon as the incoming owner publishes the same key', () => {
    const lease = leaseOf(publication())
    const republished = publication({
      image: image('asset://localhost/a0-1536-new-owner'),
      presentation: presentation('asset://localhost/a0-1536-new-owner', 7),
    })
    const decision = decideHeroLease({ lease, publication: republished, currentHeroKey: republished.heroKey })
    assert.equal(decision.fromOwner, true)
    assert.equal(decision.render.image.src, 'asset://localhost/a0-1536-new-owner',
      'the hold ends when the new owner publishes; it never keeps priority')
  })
})

describe('committed lease state', () => {
  it('is cleared when nothing may be rendered, so a stale image cannot be reused', () => {
    const lease = leaseOf(publication())
    const dropped = commitHeroLease(decideHeroLease({
      lease, publication: undefined, currentHeroKey: heroKey('m3u8\u0000/lists/b.m3u8', 'b-0'),
    }))
    assert.equal(dropped, undefined)
  })

  it('does not hold a row fallback as if it were a hero publication', () => {
    // Structural guarantee: only `HeroLeasePublication` can become a lease, and the
    // panel only produces one from a snapshot that carries the owner's token.
    const withToken = publication()
    assert.ok(leaseOf(withToken), 'a tokened publication is holdable')
    assert.ok(
      /publication: HeroLeasePublication \| undefined = hero\?\.coverThumbnail && hero\.presentation && heroKey/.test(panel),
      'the panel must require a token before reporting a publication',
    )
    assert.ok(
      /publication: undefined \}/.test(panel),
      'the row fallback must report no publication at all',
    )
  })

  it('compares by content, so re-reporting the same publication does not loop', () => {
    const p = publication()
    const a = leaseOf(p)
    const b = leaseOf({ ...p, image: { ...p.image }, presentation: { ...p.presentation } })
    assert.equal(isSameHeroLease(a, b), true, 'a fresh object with the same content is the same hold')
    assert.equal(isSameHeroLease(a, leaseOf(publication({
      presentation: presentation('asset://localhost/a0-1536', 9),
    }))), false, 'a new publish generation is a different hold')
    assert.equal(isSameHeroLease(undefined, undefined), true)
    assert.equal(isSameHeroLease(a, undefined), false)
  })
})

describe('only blob images need a private copy', () => {
  it('leaves asset URLs alone: release is a spec-level no-op on them', () => {
    assert.equal(heroLeaseNeedsCopy(image('asset://localhost/cover')), false)
    assert.equal(heroLeaseNeedsCopy(image('data:image/png;base64,AAAA')), false)
    assert.equal(heroLeaseNeedsCopy(image('http://127.0.0.1:5173/cover.png')), false)
  })

  it('copies blob URLs, which the releasing owner revokes', () => {
    assert.equal(heroLeaseNeedsCopy(image('blob:http://127.0.0.1:5173/abc')), true)
  })
})

describe('the production wiring keeps the invariant visible', () => {
  it('the hold lives outside the panel remount key', () => {
    // The key is on `<OwnedPlaylistPanel ...>`; the hold hook must be called by
    // `PlayerSurface` itself, not inside the keyed subtree.
    assert.match(surface, /const \{ hold: heroHold, record: recordHeroPublication \} = useHeroDisplayHold\(\)/)
    const keyed = surface.match(/key=\{playlist\.deleteScope[^\n]*\n/)
    assert.ok(keyed, 'the remount key still exists and was not removed')
    assert.doesNotMatch(panel, /useHeroDisplayHold/, 'the panel must not own the hold across its own remount')
  })

  it('a row fallback never wins over a held hero', () => {
    // The precedence line is the whole point: `hero ?? row` alone reintroduces the
    // downgrade for the frames before the incoming owner publishes its hero tier.
    assert.ok(
      /heroArtwork\.heroLane \? heroArtwork\.image : \(heldHero \?\? heroArtwork\)\.image/.test(panel),
      'a row fallback must not win over a held hero',
    )
  })

  it('the demand is re-reported to the incoming owner', () => {
    // Without this the incoming owner never received demand at all: measured zero
    // hero-lane requests after a track click, so the hero stayed at 256 for good.
    assert.ok(
      /metadataStatus, onVisibleTrackIdsChange, artworkOwnerId,/.test(panel),
      'the demand effect keys on the owner',
    )
    assert.ok(
      /\$\{artworkOwnerId\}/.test(panel),
      'the dedupe key also contains the owner',
    )
    assert.ok(
      /artworkOwnerKey=\{playlist\.artworkSource\?\.store\}/.test(surface),
      'PlayerSurface passes the live owner down',
    )
  })
})
