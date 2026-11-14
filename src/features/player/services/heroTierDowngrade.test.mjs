/**
 * Contract: a shrinking viewport must DOWNGRADE the hero tier (found by the S8 capture).
 *
 * The S8 run showed the playlist hero keeping a 1536 image inside a 982 CSS px box: the tier was
 * measured once when the artwork hook seeded its detail paths and never again, and even if the
 * demand HAD dropped, the pump only re-admitted when the demand wanted a LARGER edge.
 *
 * These tests pin both halves of the fix as pure rules, so neither can regress silently:
 *
 *   1. the selector lowers its answer when the box shrinks (already true, asserted here so the
 *      downgrade path has a documented lower bound),
 *   2. the pump's admission predicate treats "demand is smaller than the cached edge" as a
 *      reason to re-read, for hero tiers only.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

/** Transpile the real selector module so the assertions run against production code. */
const selectorSource = readFileSync(new URL('./heroCoverEdge.ts', import.meta.url), 'utf8')
const selectorModule = await import(
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(selectorSource, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText).toString('base64')}`
)
const { heroEdgeForMeasurement } = selectorModule

/**
 * The pump's admission rule, mirrored from `useLibraryArtwork`.
 *
 * Mirrored rather than imported because the rule lives inside a React hook and pulling the whole
 * hook into a unit test would require stubbing every runtime boundary. Keeping the copy adjacent
 * to the assertions it protects — and asserting the SOURCE still contains it — avoids a silent
 * divergence.
 */
function admitsReRead(entryEdge, demandedEdge) {
  if (entryEdge === undefined) return true
  if (entryEdge < demandedEdge) return true
  if (entryEdge > demandedEdge && demandedEdge > 256) return true
  return false
}

describe('selector lowers its answer when the box shrinks', () => {
  it('a 2180px box needs 1536 while a 982px box needs 1024', () => {
    const wide = heroEdgeForMeasurement({ clientWidth: 2180, devicePixelRatio: 1, viewportCssWidth: 2560 })
    const narrow = heroEdgeForMeasurement({ clientWidth: 982, devicePixelRatio: 1, viewportCssWidth: 1024 })
    assert.equal(wide, 1536)
    assert.equal(narrow, 1024)
    assert.ok(narrow < wide, 'the narrower box must select the lower tier')
  })

  it('the answer is monotonic in the box width', () => {
    let previous = 0
    for (const width of [982, 1100, 1200, 1400, 1600, 1800, 2180]) {
      const edge = heroEdgeForMeasurement({ clientWidth: width, devicePixelRatio: 1, viewportCssWidth: 2560 })
      assert.ok(edge >= previous, `width ${width} must not select a cheaper tier than a narrower box`)
      previous = edge
    }
  })
})

describe('pump admission treats a lower hero demand as a reason to re-read', () => {
  it('downgrades an oversized hero entry', () => {
    // The S8 case: a cached 1536 hero while the layout now needs only 1024.
    assert.equal(admitsReRead(1536, 1024), true, 'a 1536 hero must be replaced when 1024 is needed')
  })

  it('still upgrades when the demand grows', () => {
    assert.equal(admitsReRead(1024, 1536), true)
    assert.equal(admitsReRead(256, 1536), true)
  })

  it('does not churn ordinary rows', () => {
    // Rows live at 256; a "smaller demand" for them must not cause repeated re-reads.
    assert.equal(admitsReRead(256, 256), false, 'an exact match is not a re-read')
    assert.equal(admitsReRead(512, 256), false, 'a row must not be downgraded by this rule')
  })

  it('admits when nothing is cached yet', () => {
    assert.equal(admitsReRead(undefined, 1536), true)
  })
})

describe('the source still contains the downgrade branch', () => {
  it('useLibraryArtwork re-admits on a smaller hero edge', () => {
    // Guards the mirrored rule above against divergence: if the production condition is edited
    // away, this fails and points at the copy that needs re-deriving.
    const hookSource = readFileSync(new URL('../hooks/useLibraryArtwork.ts', import.meta.url), 'utf8')
    assert.match(
      hookSource,
      /entry\.edge > edge && edge > 256/,
      'the pump must still contain the hero-downgrade admission branch',
    )
  })

  it('the DISPATCH guard compares exactly, not "at least"', () => {
    // A "`>=`" here means a 1536 hero never gets a 1024 job created.
    const hookSource = readFileSync(new URL('../hooks/useAudioPlayer.ts', import.meta.url), 'utf8')
    assert.match(
      hookSource,
      /playlistVisualEdgeRef\.current\.get\(descriptor\.id\) === targetEdgeFor\(descriptor\.id\)/,
      'the dispatch guard must require an exact edge match',
    )
    assert.doesNotMatch(
      hookSource,
      /playlistVisualEdgeRef\.current\.get\(descriptor\.id\) \?\? 0\) >= targetEdgeFor/,
      'the dispatch guard must not treat "at least" as satisfied',
    )
  })

  it('the PUBLISH guard also compares exactly', () => {
    // Second copy of the rule: with "`>=`" the downgrade job runs, succeeds, and its image is
    // thrown away because the cached edge is still "at least" the requested one.
    const hookSource = readFileSync(new URL('../hooks/useAudioPlayer.ts', import.meta.url), 'utf8')
    assert.match(
      hookSource,
      /playlistVisualEdgeRef\.current\.get\(job\.trackId\) === job\.maxEdge/,
      'the publish guard must require an exact edge match',
    )
    assert.doesNotMatch(
      hookSource,
      /playlistVisualEdgeRef\.current\.get\(job\.trackId\) \?\? 0\) >= job\.maxEdge/,
      'the publish guard must not treat "at least" as satisfied',
    )
  })

  it('the demand carries a measured hero tier', () => {
    const viewModel = readFileSync(new URL('../model/playerUiViewModel.ts', import.meta.url), 'utf8')
    assert.match(viewModel, /heroEdge\?: number/, 'PlaylistArtworkDemand must expose heroEdge')
  })
})
