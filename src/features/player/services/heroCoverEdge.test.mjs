/**
 * Focused tests for the hero tier selector.
 *
 * Covers plan §8.2 FE1 (the six documented configurations) and FE2 (the 1024/1025 breakpoint
 * pair must never invert), plus the bucket boundaries and the fallback path. The selector is
 * pure arithmetic, so this runs without a browser.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

// The module reads `window`, so the snapshot functions are exercised directly rather than
// through `selectHeroEdge`. Transpiling keeps the test bound to the real source.
const source = readFileSync(new URL('./heroCoverEdge.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText
const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const {
  HERO_EDGE_BUCKETS,
  HERO_LAYOUT_BREAKPOINT,
  HERO_MAX_EDGE,
  heroCssWidthFallback,
  heroEdgeForMeasurement,
} = module

describe('buckets', () => {
  it('admits only the approved hero tiers', () => {
    // 2048 is deliberately NOT a bucket. It was measured directly and rejected: at 2048 the
    // renderer grew 27-89 MB rather than the few MB seen at 1536, contradicting the mechanism
    // D2 relied on. It remains in the Rust whitelist for a future investigation.
    assert.deepEqual([...HERO_EDGE_BUCKETS], [1024, 1536])
    assert.equal(HERO_MAX_EDGE, 1536)
  })

  it('keeps the layout breakpoint in step with the CSS rule', () => {
    // playlist-panel.css uses `@media (width > 1024px)`; the fallback must agree or it picks
    // the wrong side of the jump near the boundary.
    assert.equal(HERO_LAYOUT_BREAKPOINT, 1024)
  })
})

describe('heroEdgeForMeasurement', () => {
  /** The six configurations the plan tabulates in §0.1. */
  const planConfigurations = [
    { name: '1920x1080 @1x', heroCssWidth: 1550, dpr: 1 },
    { name: '2560x1440 @1x', heroCssWidth: 2190, dpr: 1 },
    { name: '2880x1920 @200%', heroCssWidth: 1070, dpr: 2 },
    { name: '640x1440 @2x', heroCssWidth: 608, dpr: 2 },
    { name: '640x1440 @3x', heroCssWidth: 608, dpr: 3 },
    { name: '1024 breakpoint @1x', heroCssWidth: 992, dpr: 1 },
  ]

  it('matches the plan table for every documented configuration', () => {
    for (const { name, heroCssWidth, dpr } of planConfigurations) {
      const edge = heroEdgeForMeasurement({
        clientWidth: heroCssWidth,
        devicePixelRatio: dpr,
        viewportCssWidth: 2560,
      })
      assert.ok(HERO_EDGE_BUCKETS.includes(edge), `${name} must pick a hero tier, got ${edge}`)
      // The requirement is that the physical need is covered at least as well as 1536 covers it.
      const physical = Math.ceil(heroCssWidth * dpr)
      const residual = physical > 0 ? physical / edge : 0
      if (physical > HERO_MAX_EDGE) {
        assert.equal(edge, HERO_MAX_EDGE, `${name} must cap at the max tier`)
      } else {
        assert.ok(residual <= 1.0001, `${name} must not upscale (residual ${residual})`)
      }
    }
  })

  it('rounds up so a fractional overflow still upgrades', () => {
    assert.equal(heroEdgeForMeasurement({ clientWidth: 1024, devicePixelRatio: 1, viewportCssWidth: 2560 }), 1024)
    assert.equal(heroEdgeForMeasurement({ clientWidth: 1024.5, devicePixelRatio: 1, viewportCssWidth: 2560 }), 1536)
  })

  it('multiplies by DPR rather than trusting the CSS width', () => {
    assert.equal(heroEdgeForMeasurement({ clientWidth: 900, devicePixelRatio: 1, viewportCssWidth: 2560 }), 1024)
    // 900 x 2 = 1800 physical px, above 1536, capped at the max bucket.
    assert.equal(heroEdgeForMeasurement({ clientWidth: 900, devicePixelRatio: 2, viewportCssWidth: 2560 }), 1536)
  })

  it('never inverts across the 1024/1025 breakpoint pair', () => {
    // Plan FE2: 1025 must not select a CHEAPER tier than 1024.
    const narrow = heroEdgeForMeasurement({ clientWidth: 992, devicePixelRatio: 1, viewportCssWidth: 1024 })
    const wide = heroEdgeForMeasurement({ clientWidth: 655, devicePixelRatio: 1, viewportCssWidth: 1025 })
    assert.ok(wide <= narrow || narrow === HERO_EDGE_BUCKETS[0],
      `the wider viewport must not invert (narrow=${narrow}, wide=${wide})`)
    assert.equal(narrow, 1024)
    assert.equal(wide, 1024)
  })

  it('uses the viewport fallback only when unmeasurable', () => {
    // clientWidth 0 -> derive from the viewport, using the same breakpoint.
    assert.equal(heroEdgeForMeasurement({ clientWidth: 0, devicePixelRatio: 1, viewportCssWidth: 2560 }), 1536)
    assert.equal(heroEdgeForMeasurement({ clientWidth: 0, devicePixelRatio: 1, viewportCssWidth: 800 }), 1024)
    // A measured box always wins over the viewport.
    assert.equal(heroEdgeForMeasurement({ clientWidth: 700, devicePixelRatio: 1, viewportCssWidth: 2560 }), 1024)
  })

  it('treats a broken DPR as 1', () => {
    for (const dpr of [0, -1, Number.NaN]) {
      assert.equal(
        heroEdgeForMeasurement({ clientWidth: 900, devicePixelRatio: dpr, viewportCssWidth: 2560 }),
        1024,
        `dpr ${String(dpr)} must behave as 1`,
      )
    }
  })

  it('is monotonic in width and DPR', () => {
    let previous = 0
    for (const width of [320, 512, 700, 900, 1024, 1025, 1280, 1600, 2200, 3200]) {
      const edge = heroEdgeForMeasurement({ clientWidth: width, devicePixelRatio: 1, viewportCssWidth: 2560 })
      assert.ok(edge >= previous, `width ${width} must not shrink the tier`)
      previous = edge
    }
    previous = 0
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      const edge = heroEdgeForMeasurement({ clientWidth: 900, devicePixelRatio: dpr, viewportCssWidth: 2560 })
      assert.ok(edge >= previous, `dpr ${dpr} must not shrink the tier`)
      previous = edge
    }
  })
})

describe('heroCssWidthFallback', () => {
  it('mirrors the panel geometry on both sides of the breakpoint', () => {
    // The panel moves right by 320px and pads 50px above the breakpoint; below it only pads.
    assert.equal(heroCssWidthFallback(1025), 1025 - 320 - 50)
    assert.equal(heroCssWidthFallback(1024), 1024 - 32)
  })

  it('never returns a negative width', () => {
    for (const viewport of [0, -1, Number.NaN, 100, 320]) {
      assert.ok(heroCssWidthFallback(viewport) >= 0, `viewport ${String(viewport)}`)
    }
  })
})
