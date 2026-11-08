// Build and verify the FROZEN fixture that defines a legal target cohort.
//
// NEW file under tools/thumbnail-benchmark/. Nothing here modifies the existing
// helpers, the product, or the user's music library.
//
// Why this exists (plan section 3.2): the previous measurement picked its targets
// as "whatever cards happen to own an <img> this run", which is circular -- the
// run defines its own denominator and a card with no cover silently leaves the
// set. A fixture is captured ONCE from the pristine corpus, frozen with a digest,
// and reused unchanged by every arm and every pair. It therefore also records
// which entries genuinely have no cover, so an empty placeholder can never make
// "all covers ready" succeed early, and a missing cover cannot leave the
// denominator.
//
// The fixture holds three things:
//   * `labels`   - id -> {hasCover, mimeType, byteLen, ...} from the app's own
//                  `audio_probe_playlist_cover` command;
//   * `universe` - every card id the list produced, used by scroll exposure mode;
//   * `cohort`   - the first N cards in DOM order, used by the open action.
//
// Privacy (plan section 2): the artefact never stores an absolute music path.
// Each row carries a stable anonymous id, the SHA-256 of the path (one-way), a
// bounded content digest, and the labels; distributions are recorded instead of
// paths.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {
  sleep, sha256, sha256File, writeJson, mkdir, assertCacheScope,
  launchArm, closeViaApp, pinViewport, hostFacts, gitFacts, artifactFacts,
  hashHarness, cacheSnapshot, ensureListPanel, ensureReadyForSourceLoad, runtimeServingFacts,
} from './coverlane-common.mjs'
import {
  pageInstallScript, probeCoverScript, PAGE_CARD_IDS, PAGE_FINAL_STATE,
} from './coverlane-page.mjs'

const USAGE = `Usage:
  node coverlane-fixtures.mjs build --exe <app.exe> --corpus <corpus-paths.txt>
                                    --playlist <playlist.m3u8> --out <fixture.json> [options]
  node coverlane-fixtures.mjs verify --fixture <fixture.json>

Options for build:
  --scratch <dir>          scratch cache/profile dir (default: <out>.scratch)
  --cohort <n>             cohort size in DOM order (default 12)
  --viewport <w>x<h>       fixed viewport (default 1600x1000)
  --dpr <n>                device scale factor (default 1)
  --probe-limit <n>        probe only the first n corpus rows (default: all)
  --opacity <n>            reveal opacity threshold (default 0.99)
  --required-frames <n>    consecutive frames required (default 2)
  --port <n>               CDP port (default 9700)
`

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {
    command,
    cohort: 12,
    viewport: '1600x1000',
    dpr: 1,
    probeLimit: null,
    opacity: 0.99,
    requiredFrames: 2,
    port: 9700,
  }
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]
    const next = () => {
      const value = rest[++i]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      return value
    }
    switch (flag) {
      case '--exe': options.exe = next(); break
      case '--corpus': options.corpus = next(); break
      case '--playlist': options.playlist = next(); break
      case '--out': options.out = next(); break
      case '--fixture': options.fixture = next(); break
      case '--scratch': options.scratch = next(); break
      case '--cohort': options.cohort = Number(next()); break
      case '--viewport': options.viewport = next(); break
      case '--dpr': options.dpr = Number(next()); break
      case '--probe-limit': options.probeLimit = Number(next()); break
      case '--opacity': options.opacity = Number(next()); break
      case '--required-frames': options.requiredFrames = Number(next()); break
      case '--port': options.port = Number(next()); break
      default: throw new Error(`unknown option ${flag}\n\n${USAGE}`)
    }
  }
  return options
}

/** Strip a UTF-8 BOM, which the corpus file carries, and drop blank lines. */
function readCorpus(path) {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

/**
 * Bounded content digest.
 *
 * Hashing 3+ GiB of audio per batch is not worth the wall clock, so this hashes
 * the file size plus the first and last 64 KiB and says so in the field name. It
 * detects a replaced or truncated file, which is all the fixture needs.
 */
function boundedContentDigest(path) {
  const info = statSync(path)
  const sample = 64 * 1024
  const head = readFileSync(path, { length: Math.min(sample, info.size), position: 0 })
  const tailStart = Math.max(0, info.size - sample)
  const tail = info.size > sample ? readFileSync(path, { position: tailStart, length: sample }) : Buffer.alloc(0)
  const hash = createHash('sha256')
  hash.update(String(info.size))
  hash.update(head)
  hash.update(tail)
  return { digest: hash.digest('hex'), sizeBytes: info.size, fullFileHashed: false }
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return { count: 0, min: null, p50: null, p90: null, max: null, mean: null }
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]
  return {
    count: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1],
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  }
}

function countValues(values) {
  const out = {}
  for (const value of values) {
    const key = value === null || value === undefined ? 'none' : String(value)
    out[key] = (out[key] || 0) + 1
  }
  return out
}

function anonId(source) {
  return 'anon-' + sha256(source.toLowerCase()).slice(0, 16)
}

async function build(options) {
  if (!options.exe || !options.corpus || !options.playlist || !options.out) {
    throw new Error(`build needs --exe --corpus --playlist --out\n\n${USAGE}`)
  }
  const outPath = resolve(options.out)
  if (existsSync(outPath)) throw new Error(`fixture output already exists (fixtures are frozen): ${outPath}`)
  const scratch = resolve(options.scratch || join(outPath + '.scratch'))
  assertCacheScope(scratch, 'fixture scratch cache root')
  mkdir(scratch)
  mkdir(join(scratch, 'webview'))

  const [width, height] = options.viewport.split('x').map(Number)
  const corpusRows = readCorpus(options.corpus)
  const probeRows = options.probeLimit ? corpusRows.slice(0, options.probeLimit) : corpusRows

  const arm = await launchArm({
    executable: options.exe,
    cacheRoot: scratch,
    playlistPath: options.playlist,
    port: options.port,
  })
  const record = {
    fixtureVersion: 2,
    capturedAt: new Date().toISOString(),
    purpose: 'frozen target universe, cohort and has-cover labels for the coverlane harness',
    source: {
      executable: artifactFacts(options.exe),
      playlistSha256: sha256File(options.playlist),
      corpusFileSha256: sha256File(options.corpus),
      harnessSha256: hashHarness(),
      git: gitFacts(),
    },
    host: hostFacts(),
    viewport: null,
    privacy: {
      storesAbsoluteMusicPaths: false,
      sourcePathRepresentation: 'sha256(lowercased path) plus a stable anonymous id',
      contentDigest: 'sha256(size + first 64 KiB + last 64 KiB); fullFileHashed=false',
    },
    corpus: null,
    cohort: null,
    universe: null,
    labels: null,
    labelSplit: null,
    caveats: [],
  }
  let cdp = null
  try {
    cdp = await arm.connect()
    await cdp.send('Network.enable')
    record.serving = runtimeServingFacts(cdp.targetUrl)
    record.viewport = await pinViewport(cdp, { width, height, deviceScaleFactor: options.dpr })
    if (!await ensureReadyForSourceLoad(cdp)) throw new Error('open-audio control never appeared')
    await cdp.evaluate(pageInstallScript())

    // Prerequisite source load through the app's own control. Not a measured action.
    const sourceLoad = await cdp.evaluate(`(async () => {
      const t0 = performance.now()
      const button = document.querySelector('button.empty-open-audio-button:not(:disabled)')
        || [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '打开音频' && !b.disabled)
      if (!button) return { error: 'open control absent' }
      button.click()
      const deadline = t0 + 90000
      while (performance.now() < deadline) {
        const control = [...document.querySelectorAll('button')].find(b => ['播放列表','打开播放列表','显示播放列表'].includes(b.getAttribute('aria-label')))
        if (control) return { listControlMs: performance.now() - t0 }
        await new Promise(r => requestAnimationFrame(r))
      }
      return { error: 'list control never appeared' }
    })()`)
    record.prerequisite = { sourceLoad }
    if (sourceLoad.error) throw new Error(`source prerequisite failed: ${sourceLoad.error}`)
    await sleep(options.settleMs)

    const opened = await ensureListPanel(cdp, { settleMs: 1500 })
    record.prerequisite.openList = opened
    if (opened.failed) throw new Error(`list panel never mounted: ${JSON.stringify(opened.attemptsLog)}`)

    const cards = await cdp.evaluate(PAGE_CARD_IDS)
    if (cards.error) throw new Error(`cohort capture failed: ${cards.error}`)
    // Let the first screen settle so the label snapshot is not taken mid-reveal.
    await sleep(2500)

    // Label every probed corpus row through the app's own probe command. The
    // returned paths are used only to map a row to its track id, then dropped.
    const probe = await cdp.evaluate(probeCoverScript(probeRows), { timeoutMs: 900000 })
    if (probe.error) throw new Error(`cover probe failed: ${probe.error}`)
    const labelByHash = new Map()
    let probedPaths = 0
    for (const row of probe.rows) {
      if (!row.path) continue
      probedPaths += 1
      const pathHash = sha256(row.path.toLowerCase())
      labelByHash.set(pathHash, {
        hasCover: row.hasCover,
        mimeType: row.mimeType,
        byteLen: row.byteLen,
        hasFilePath: row.hasFilePath,
        hasDataUrl: row.hasDataUrl,
        error: row.error || null,
      })
      if (row.id) labelByHash.set('id:' + row.id, pathHash)
    }

    const audios = corpusRows.map((source, index) => {
      const content = boundedContentDigest(source)
      return {
        index,
        anonId: anonId(source),
        sourcePathSha256: sha256(source.toLowerCase()),
        sourceExtension: (source.split('.').pop() || '').toLowerCase(),
        content,
      }
    })
    const finalState = await cdp.evaluate(PAGE_FINAL_STATE)

    record.corpus = {
      rowCount: corpusRows.length,
      probedRowCount: probedPaths,
      formats: countValues(audios.map(a => a.sourceExtension)),
      audioBytes: distribution(audios.map(a => a.content.sizeBytes)),
      probedWithCover: probe.rows.filter(r => r.hasCover).length,
      probedWithoutCover: probe.rows.filter(r => r.hasCover === false).length,
      probedErrors: probe.rows.filter(r => r.error).length,
      probeErrorSamples: [...new Set(probe.rows.filter(r => r.error).map(r => r.error))].slice(0, 5),
      coverByteLengths: distribution(probe.rows.filter(r => r.hasCover).map(r => r.byteLen).filter(Number.isFinite)),
      coverMimeTypes: countValues(probe.rows.filter(r => r.hasCover).map(r => r.mimeType)),
      coverCache: cacheSnapshot(scratch),
      audioRows: audios.map(a => ({
        index: a.index,
        anonId: a.anonId,
        sourcePathSha256: a.sourcePathSha256,
        extension: a.sourceExtension,
        sizeBytes: a.content.sizeBytes,
        contentDigest: a.content.digest,
      })),
    }

    const domIds = cards.ids
    // The cohort is the FIRST SCREEN: cards in DOM order whose clipped area is
    // greater than zero at the captured viewport. Deriving it from captured
    // geometry rather than "the first N ids" keeps the target set reachable
    // without a scroll, so an open measurement never spends its budget waiting
    // for cards that cannot appear.
    const geometryById = new Map(cards.geometry.map(row => [row.id, row]))
    const firstScreenIds = domIds.filter(id => {
      const geometry = geometryById.get(id)
      return geometry && geometry.inViewArea > 0
    })
    const cohortIds = firstScreenIds.slice(0, options.cohort)
    const labelFor = id => {
      const pathHash = labelByHash.get('id:' + id)
      if (!pathHash) return { hasCover: null, reason: 'card id not matched to a probed corpus row' }
      const label = labelByHash.get(pathHash)
      if (!label) return { hasCover: null, reason: 'probe row missing' }
      return { ...label, sourcePathSha256: pathHash }
    }
    record.universe = {
      size: domIds.length,
      ids: domIds,
      definedBy: 'every card id the list mounted at fixture capture, in DOM order',
      usedFor: 'scroll exposure mode: the denominator is a frozen universe, not "whatever had an image"',
    }
    record.cohort = {
      size: cohortIds.length,
      ids: cohortIds,
      definedBy: 'first-screen cards in DOM order (clipped area > 0 at capture), capped at --cohort',
      firstScreenIds,
      opacityThreshold: options.opacity,
      requiredConsecutiveFrames: options.requiredFrames,
      geometry: cards.geometry.filter(row => cohortIds.includes(row.id)),
      grid: finalState.grid,
      bounds: finalState.bounds,
    }
    record.labels = Object.fromEntries(domIds.map(id => [id, labelFor(id)]))
    record.labelSplit = {
      withCover: Object.values(record.labels).filter(l => l.hasCover === true).length,
      withoutCover: Object.values(record.labels).filter(l => l.hasCover === false).length,
      unknown: Object.values(record.labels).filter(l => l.hasCover === null).length,
      total: domIds.length,
    }
    if (record.labelSplit.withoutCover === 0) {
      record.caveats.push(
        'No card in the captured universe is labelled no-cover, so the empty-placeholder ' +
        'completion path is not exercised by this fixture. That is an evidence gap, not a pass: ' +
        'labelling a no-cover entry would require editing the user music library, which the plan ' +
        'forbids, so a dedicated no-cover fixture corpus is still owed.',
      )
    }
    if (record.labelSplit.unknown > 0) {
      record.caveats.push(
        `${record.labelSplit.unknown} card ids could not be matched to a probed corpus row and ` +
        'carry hasCover=null; they are excluded from both cover classes rather than assumed either way.',
      )
    }
    if (record.corpus.probedErrors > 0) {
      record.caveats.push(`${record.corpus.probedErrors} corpus rows could not be probed: ${record.corpus.probeErrorSamples.join(' | ')}`)
    }
  } finally {
    if (cdp) await closeViaApp(cdp)
    if (cdp) cdp.close()
    await arm.shutdown()
  }
  record.fixtureDigest = sha256(JSON.stringify({
    universe: record.universe.ids,
    cohort: record.cohort.ids,
    labels: record.labels,
    opacity: record.cohort.opacityThreshold,
    frames: record.cohort.requiredConsecutiveFrames,
    viewport: record.viewport.requested,
  }))
  writeJson(outPath, record)
  console.log(JSON.stringify({
    fixture: outPath,
    fixtureDigest: record.fixtureDigest,
    universeSize: record.universe.size,
    cohortSize: record.cohort.size,
    labelSplit: record.labelSplit,
    corpus: {
      rows: record.corpus.rowCount,
      probed: record.corpus.probedRowCount,
      formats: record.corpus.formats,
      withCover: record.corpus.probedWithCover,
      withoutCover: record.corpus.probedWithoutCover,
      distinctCoverHashes: record.corpus.coverCache.distinctCoverHashes,
    },
    caveats: record.caveats,
  }, null, 2))
  return record
}

async function verify(options) {
  const path = resolve(options.fixture || '')
  if (!path || !existsSync(path)) throw new Error(`verify needs an existing --fixture <path>\n\n${USAGE}`)
  const fixture = JSON.parse(readFileSync(path, 'utf8'))
  const problems = []
  if (fixture.privacy?.storesAbsoluteMusicPaths !== false) problems.push('fixture claims to store absolute music paths')
  // The plan requires the build artifact, host and cache paths in the manifest, so
  // the privacy check is specifically about MUSIC sources: no string anywhere may
  // look like a path to an audio file.
  const text = JSON.stringify(fixture)
  const audioPath = text.match(/[A-Za-z]:\\(?:[^"\\]|\\.)*?\.(?:flac|mp3|m4a|aac|wav|ogg|opus|wma|ape|alac|aiff|aif|dsf|dff)\b/gi)
  if (audioPath) problems.push(`fixture contains ${audioPath.length} absolute music path(s), e.g. ${audioPath.slice(0, 2).join(' , ')}`)
  // A raw POSIX-style music path would be equally disqualifying.
  const posixAudio = text.match(/\/(?:[^/"\\]|\\.)+?\.(?:flac|mp3|m4a|aac|wav|ogg|opus|wma|ape)\b/gi)
  if (posixAudio) problems.push(`fixture contains ${posixAudio.length} path-like music reference(s), e.g. ${posixAudio.slice(0, 2).join(' , ')}`)
  if (!fixture.fixtureDigest) problems.push('fixture has no digest')
  if (!fixture.universe?.ids?.length) problems.push('fixture universe is empty')
  if (!fixture.cohort?.ids?.length) problems.push('fixture cohort is empty')
  if (fixture.cohort?.ids?.some(id => !fixture.universe.ids.includes(id))) problems.push('a cohort id is outside the universe')
  if (fixture.labels && Object.values(fixture.labels).some(l => !l || !('hasCover' in l))) problems.push('a label lacks hasCover')
  if (fixture.labels && Object.values(fixture.labels).every(l => l.hasCover === null)) {
    problems.push('no label is a definite true/false, so class splitting would be meaningless')
  }
  if (fixture.labels && Object.values(fixture.labels).some(l => l.sourcePath && typeof l.sourcePath === 'string')) {
    problems.push('a label carries a plaintext source path')
  }
  const result = {
    fixture: path,
    ok: problems.length === 0,
    problems,
    fixtureDigest: fixture.fixtureDigest,
    universeSize: fixture.universe?.ids?.length ?? 0,
    cohortSize: fixture.cohort?.ids?.length ?? 0,
    labelSplit: fixture.labelSplit ?? null,
    caveats: fixture.caveats ?? [],
  }
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
  return result
}

const options = parseArgs(process.argv.slice(2))
if (options.command === 'build') await build(options)
else if (options.command === 'verify') await verify(options)
else {
  console.log(USAGE)
  if (options.command) process.exitCode = 1
}
