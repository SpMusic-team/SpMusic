// round-05: test the REAL path wrappers, not a re-implementation.
//
// The reviewer's objection to the round-04 TS test was that it "复写算法，未运行实际
// wrapper": it asserted against a copy of the cap formula, so a wrong wrapper would still
// pass. This file follows the project's existing harness convention
// (`folderCoverCommands.test.mjs`): transpile the actual `audioCommands.ts`, substitute
// only the native `invoke` boundary, and call the three real wrappers.
//
// What is asserted per wrapper:
//   * the invoked command name and the exact `edge` argument forwarded,
//   * acceptance of a legal response at 1024/1536,
//   * rejection of an illegal payload (too wide for the request, over the per-tier cap),
//   * `null` meaning "backend confirmed no artwork" and thrown errors passing through.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync(new URL('./audioCommands.ts', import.meta.url), 'utf8')

/**
 * Load the real module with only the native boundary substituted.
 *
 * `invoke` is replaced by a recorder; everything else (validators, wrappers, types) is
 * the production code under test.
 */
async function harness(response) {
  const calls = []
  globalThis.__pathInvoke = async (command, args) => {
    calls.push({ command, args })
    if (response instanceof Error) throw response
    return response
  }
  let compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  compiled = compiled
    .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/,
      'const invoke=globalThis.__pathInvoke;const convertFileSrc=path=>path;')
    .replace(/import \{ listen \} from [^;]+;/, 'const listen=()=>{};')
    .replace(/import \{ AUDIO_PLAYLIST_DURATION_BATCH_LIMIT \} from [^;]+;/,
      'const AUDIO_PLAYLIST_DURATION_BATCH_LIMIT=128;')
  assert(!/^import /m.test(compiled), 'only the native boundary may be substituted')
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Math.random()}`
  )
  return {
    module,
    calls,
    track: module.loadAudioTrackThumbnailPath,
    folder: module.loadAudioFolderThumbnailPath,
    playlist: module.loadAudioPlaylistCoverThumbnailPath,
  }
}

/** A well-formed path-lane response. */
const pathResponse = (width, height, byteLength) => ({
  path: 'C:\\cache\\audio\\thumbnails\\abc-512-t2-j1.jpg',
  width,
  height,
  byteLength,
})

const trackInput = (maxEdge) => ({
  clientId: 'c', sourcePath: 'D:/Music/a.flac', maxEdge, windowGeneration: 1,
})
const folderInput = (maxEdge) => ({
  clientId: 'c', rootPath: 'D:/Music', directoryPath: 'D:/Music/Album', maxEdge, windowGeneration: 1,
})
const playlistInput = (maxEdge) => ({
  clientId: 'c', filePath: 'D:/Music/a.flac', maxEdge, windowGeneration: 1,
})

// --- the three wrappers forward the real command name and edge -------------
test('track wrapper invokes the real command with the exact edge', async () => {
  const h = await harness(pathResponse(1536, 512, 900_000))
  await h.track(trackInput(1536))
  assert.deepEqual(h.calls, [{
    command: 'audio_load_track_thumbnail_path',
    args: { input: trackInput(1536) },
  }])
})

test('folder wrapper invokes the real command with the exact edge', async () => {
  const h = await harness(pathResponse(1024, 400, 500_000))
  await h.folder(folderInput(1024))
  assert.deepEqual(h.calls, [{
    command: 'audio_load_folder_thumbnail_path',
    args: { input: folderInput(1024) },
  }])
})

test('playlist wrapper invokes the real command with the exact edge', async () => {
  const h = await harness(pathResponse(1536, 300, 800_000))
  await h.playlist(playlistInput(1536))
  assert.deepEqual(h.calls, [{
    command: 'audio_load_playlist_cover_thumbnail_path',
    args: { input: playlistInput(1536) },
  }])
})

// --- legal hero tiers are accepted ----------------------------------------
test('each wrapper accepts a legal response at 1024 and 1536', async () => {
  for (const edge of [1024, 1536]) {
    // Width/height at the requested edge, bytes at the per-tier cap.
    const cap = edge === 1536 ? 1_179_648 : 1_048_576
    const body = pathResponse(edge, edge, cap)
    for (const loader of ['track', 'folder', 'playlist']) {
      const h = await harness(body)
      const result = await h[loader](
        loader === 'track' ? trackInput(edge)
          : loader === 'folder' ? folderInput(edge)
            : playlistInput(edge),
      )
      assert.equal(result.width, edge, `${loader} must accept width ${edge}`)
      assert.equal(result.byteLength, cap, `${loader} must accept exactly the cap`)
    }
  }
})

// --- illegal payloads are rejected ---------------------------------------
test('a response wider than the request is rejected by every wrapper', async () => {
  // A 1536 response must not be accepted for a 512 request.
  for (const loader of ['track', 'folder', 'playlist']) {
    const h = await harness(pathResponse(1536, 512, 900_000))
    const input = loader === 'track' ? trackInput(512)
      : loader === 'folder' ? folderInput(512) : playlistInput(512)
    await assert.rejects(h[loader](input), /metadata is inconsistent/,
      `${loader} must reject a 1536 payload at edge 512`)
  }
})

test('a payload one byte over the per-tier cap is rejected', async () => {
  for (const loader of ['track', 'folder', 'playlist']) {
    const h = await harness(pathResponse(1536, 512, 1_179_649))
    const input = loader === 'track' ? trackInput(1536)
      : loader === 'folder' ? folderInput(1536) : playlistInput(1536)
    await assert.rejects(h[loader](input), /metadata is inconsistent/,
      `${loader} must reject one byte over the 1536 cap`)
  }
})

test('a request at a deferred tier is rejected even with a plausible payload', async () => {
  // 2048 is not a path tier; the wrapper's own acceptance check must refuse it.
  for (const loader of ['track', 'folder', 'playlist']) {
    const h = await harness(pathResponse(2048, 512, 900_000))
    const input = loader === 'track' ? trackInput(2048)
      : loader === 'folder' ? folderInput(2048) : playlistInput(2048)
    await assert.rejects(h[loader](input), /metadata is inconsistent/,
      `${loader} must refuse the deferred 2048 tier`)
  }
})

test('a request at the intermediate 768 tier is rejected', async () => {
  for (const loader of ['track', 'folder', 'playlist']) {
    const h = await harness(pathResponse(768, 512, 400_000))
    const input = loader === 'track' ? trackInput(768)
      : loader === 'folder' ? folderInput(768) : playlistInput(768)
    await assert.rejects(h[loader](input), /metadata is inconsistent/,
      `${loader} must refuse the intermediate 768 tier`)
  }
})

// --- null and error semantics --------------------------------------------
test('null means confirmed-absent and is not an error', async () => {
  for (const loader of ['track', 'folder', 'playlist']) {
    const h = await harness(null)
    const input = loader === 'track' ? trackInput(512)
      : loader === 'folder' ? folderInput(512) : playlistInput(512)
    assert.equal(await h[loader](input), null,
      `${loader} must return null for a confirmed absence`)
  }
})

test('native errors propagate instead of becoming a placeholder', async () => {
  for (const loader of ['track', 'folder', 'playlist']) {
    const h = await harness(new Error('native failure'))
    const input = loader === 'track' ? trackInput(512)
      : loader === 'folder' ? folderInput(512) : playlistInput(512)
    await assert.rejects(h[loader](input), /native failure/,
      `${loader} must surface a native error`)
  }
})

test('a malformed response shape is rejected', async () => {
  for (const bad of [[], {}, { path: '' }, { path: 'x', width: 1.5, height: 1, byteLength: 1 }]) {
    const h = await harness(bad)
    await assert.rejects(h.track(trackInput(512)))
  }
})
