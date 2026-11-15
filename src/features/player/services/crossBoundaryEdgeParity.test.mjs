/**
 * Cross-boundary constant agreement (plan §8.2 FE7).
 *
 * `THUMBNAIL_PATH_MAX_EDGE` used to be a hand-written 512 in `audioCommands.ts` while the Rust
 * whitelist lived in `cover_pixels.rs`. The two drifted, and the failure mode is recorded in
 * OPT-0018-v2: every path-lane response was rejected as "metadata is inconsistent", which after
 * 8 attempts disabled the entire path lane for the session. A constant mismatch is therefore a
 * user-visible regression, not a cosmetic one.
 *
 * The comparison is textual on purpose: the Rust side is not importable from Node, and reading
 * both sources as text is exactly what makes the drift detectable.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const rustSource = readFileSync(
  new URL('../../../../src-tauri/src/audio/cover_pixels.rs', import.meta.url),
  'utf8',
)
const commandsSource = readFileSync(new URL('./audioCommands.ts', import.meta.url), 'utf8')
const selectorSource = readFileSync(new URL('./heroCoverEdge.ts', import.meta.url), 'utf8')

/** Parse `const NAME: [u32; N] = [ ... ]` out of the Rust source. */
function rustEdgeList(name) {
  const pattern = new RegExp(`const ${name}:\\s*\\[u32;\\s*\\d+\\]\\s*=\\s*\\[([^\\]]+)\\]`)
  const match = pattern.exec(rustSource)
  assert.ok(match, `the Rust whitelist ${name} must exist`)
  return match[1]
    .split(',')
    .map(part => Number(part.trim()))
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b)
}

/** Extract the numeric entries of a TS `const NAME = [ ... ]` array. */
function tsNumberList(source, name) {
  const pattern = new RegExp(`const ${name}[^=]*=\\s*\\[([^\\]]+)\\]`)
  const match = pattern.exec(source)
  assert.ok(match, `the TS constant ${name} must exist`)
  return match[1]
    .split(',')
    .map(part => Number(part.trim()))
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b)
}

/** Read the TS cap function's floor/ceiling operands so the formula can be reimplemented. */
function tsCapOperands() {
  const minMatch = /THUMBNAIL_PATH_MIN_BYTES\s*=\s*([0-9*\s]+)/.exec(commandsSource)
  const maxMatch = /THUMBNAIL_PATH_MAX_BYTES_CEILING\s*=\s*([0-9*\s]+)/.exec(commandsSource)
  assert.ok(minMatch, 'the TS floor constant must exist')
  assert.ok(maxMatch, 'the TS ceiling constant must exist')
  const evaluate = expr => expr.split('*').reduce((product, part) => product * Number(part.trim()), 1)
  return { floor: evaluate(minMatch[1]), ceiling: evaluate(maxMatch[1]) }
}

const rustCap = edge => Math.min(16 * 1024 * 1024, Math.max(1024 * 1024, Math.floor((edge * edge) / 2)))

describe('path-lane edge whitelist parity', () => {
  it('the TS accepted-edge list equals the Rust ALLOWED_PATH_MAX_EDGES', () => {
    const rust = rustEdgeList('ALLOWED_PATH_MAX_EDGES')
    const tsList = tsNumberList(commandsSource, 'THUMBNAIL_PATH_ALLOWED_EDGES')
    assert.deepEqual(tsList, rust,
      'a mismatch rejects every path response and eventually disables the lane for the session')
  })

  it('the playlist PIXEL whitelist stays narrower than the path lane', () => {
    // The pixel lane decodes RGBA into the managed budget, so it must not inherit the hero
    // tiers. This split is the whole reason the path lane got its own list (plan §1.2, T1/T4).
    const pixel = rustEdgeList('ALLOWED_PLAYLIST_MAX_EDGES')
    const path = rustEdgeList('ALLOWED_PATH_MAX_EDGES')
    for (const edge of pixel) {
      assert.ok(path.includes(edge), `every pixel edge must also be a path edge (${edge})`)
    }
    assert.deepEqual(path.filter(edge => !pixel.includes(edge)), [1024, 1536, 2048],
      'only the hero tiers may exist on the path lane and not on the pixel lane')
  })

  it('the player lane keeps its own superset', () => {
    assert.deepEqual(rustEdgeList('ALLOWED_MAX_EDGES'), [256, 512, 768, 1024, 1536, 2048, 3072])
    // 768 exists only for the player; it is not a list or hero tier.
    assert.ok(!rustEdgeList('ALLOWED_PATH_MAX_EDGES').includes(768))
  })

  it('the hero buckets are requestable and exclude the deferred tier', () => {
    // Whatever the selector may return must be in the Rust whiteitlist; 2048 is deferred by
    // plan D2 until a Release measurement of WebView bitmap residency exists.
    const path = rustEdgeList('ALLOWED_PATH_MAX_EDGES')
    const heroBuckets = tsNumberList(selectorSource, 'HERO_EDGE_BUCKETS')
    assert.deepEqual(heroBuckets, [1024, 1536])
    for (const edge of heroBuckets) {
      assert.ok(path.includes(edge), `hero edge ${edge} must be requestable`)
    }
  })
})

describe('no tier is silently truncated to the previous maximum', () => {
  it('neither artwork owner hard-codes 1536 as the top tier', () => {
    // Both owners once contained ">= 1536 -> 1536", written while 1536 was the cap. With 2048
    // enabled that silently truncates a legitimate request, and the symptom is invisible: the
    // hero simply never gets sharper. A source assertion is the only cheap guard, because the
    // truncation is a pure expression with no observable side effect.
    for (const rel of ['../hooks/useAudioPlayer.ts', '../hooks/useLibraryArtwork.ts']) {
      const source = readFileSync(new URL(rel, import.meta.url), 'utf8')
      assert.doesNotMatch(
        source,
        /measured >= 1536 \? 1536 : 1024|edge >= 1536 \? 1536 : 1024/,
        `${rel} must not cap hero tiers at 1536`,
      )
    }
  })

  it('the whitelist may be wider than the buckets (2048 reserved)', () => {
    // The path whitelist keeps 2048 so the channel CAN serve it, while the selector does not
    // offer it. This asymmetry is intentional and documented; assert it so neither half drifts.
    const path = rustEdgeList('ALLOWED_PATH_MAX_EDGES')
    assert.ok(path.includes(2048), 'the path channel keeps 2048 reserved')
    const selectorSource = readFileSync(new URL('./heroCoverEdge.ts', import.meta.url), 'utf8')
    assert.ok(!tsNumberList(selectorSource, 'HERO_EDGE_BUCKETS').includes(2048),
      'the selector must not offer 2048')
  })

  it('every hero bucket is accepted by the shared validator', () => {
    const selectorSource = readFileSync(new URL('./heroCoverEdge.ts', import.meta.url), 'utf8')
    const buckets = tsNumberList(selectorSource, 'HERO_EDGE_BUCKETS')
    const path = rustEdgeList('ALLOWED_PATH_MAX_EDGES')
    for (const bucket of buckets) {
      assert.ok(path.includes(bucket), `hero bucket ${bucket} must be a path-lane edge`)
    }
  })
})

describe('per-tier byte cap parity', () => {
  it('the TS floor and ceiling match the Rust formula', () => {
    const { floor, ceiling } = tsCapOperands()
    assert.equal(floor, 1024 * 1024, 'floor is 1 MiB')
    assert.equal(ceiling, 16 * 1024 * 1024, 'ceiling is 16 MiB')
  })

  it('the derived caps match at every accepted edge', () => {
    // Rust: `min(16 MiB, max(1 MiB, edge^2 / 2))`. If these disagree, the two sides disagree
    // about whether a published file is too large.
    for (const edge of rustEdgeList('ALLOWED_PATH_MAX_EDGES')) {
      const { floor, ceiling } = tsCapOperands()
      const tsDerived = Math.min(ceiling, Math.max(floor, Math.floor((edge * edge) / 2)))
      assert.equal(tsDerived, rustCap(edge), `cap mismatch at edge ${edge}`)
    }
  })

  it('the boundary values the plan names are exact', () => {
    assert.equal(rustCap(512), 1_048_576)
    assert.equal(rustCap(1024), 1_048_576)
    assert.equal(rustCap(1536), 1_179_648)
    assert.equal(rustCap(2048), 2_097_152)
    assert.equal(rustCap(8192), 16 * 1024 * 1024)
  })
})
