import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const duration = url(compile(await readFile(new URL('../model/playlistDuration.ts', import.meta.url), 'utf8')))
const source = compile(await readFile(new URL('./audioCommands.ts', import.meta.url), 'utf8'))
  .replace(/import \{ convertFileSrc, invoke \} from [^;]+;/, 'const convertFileSrc = value => value; const invoke = (...args) => globalThis.summaryTestInvoke(...args);')
  .replace(/import \{ listen \} from [^;]+;/, 'const listen = async () => () => {};')
  .replace("'../model/playlistDuration'", JSON.stringify(duration))
const { probeAudioPlaylistTrackSummaries } = await import(url(source))

test('summary year accepts u32 positive integers and degrades missing or invalid values without losing other tags', async () => {
  const years = [undefined, null, 0, -1, 2023.5, NaN, Infinity, '2023', {}, 4294967296, Number.MAX_SAFE_INTEGER + 1, 1, 2023, 4294967295]
  const paths = years.map((_, index) => `/music/${index}.flac`)
  const tags = { title: 'Title', artist: 'Artist', album: 'Album', albumArtist: 'Album Artist', bitDepth: 24, sampleRateHz: 96000, bitrateKbps: null, codec: 'FLAC' }
  globalThis.summaryTestInvoke = async (command, args) => {
    assert.equal(command, 'audio_probe_playlist_track_summaries')
    assert.deepEqual(args, { input: { paths } })
    return years.map((year, index) => ({ sourcePath: paths[index], summary: { ...tags, ...(year === undefined ? {} : { year }) }, error: null }))
  }
  try {
    const rows = await probeAudioPlaylistTrackSummaries(paths)
    assert.deepEqual(rows.map(row => row.summary.year), [...Array(11).fill(null), 1, 2023, 4294967295])
    for (const row of rows) { const { year, ...rest } = row.summary; assert.deepEqual(rest, { ...tags, composer: null }); assert.equal(row.error, null); assert.equal(typeof year === 'number' || year === null, true) }
  } finally { delete globalThis.summaryTestInvoke }
})

test('composer text is independent, normalizes old missing responses, and rejects malformed values', async () => {
  const values = [undefined, null, 'Writer A / Writer B']
  const paths = values.map((_, index) => `/music/composer-${index}.flac`)
  globalThis.summaryTestInvoke = async () => values.map((composer, index) => ({
    sourcePath: paths[index], summary: { artist: 'Performer', albumArtist: 'Album Credit', ...(composer === undefined ? {} : { composer }) }, error: null,
  }))
  try {
    const rows = await probeAudioPlaylistTrackSummaries(paths)
    assert.deepEqual(rows.map(row => row.summary.composer), [null, null, 'Writer A / Writer B'])
    assert(rows.every(row => row.summary.artist === 'Performer' && row.summary.albumArtist === 'Album Credit'))
    globalThis.summaryTestInvoke = async () => [{ sourcePath: paths[0], summary: { composer: 7 }, error: null }]
    await assert.rejects(probeAudioPlaylistTrackSummaries([paths[0]]), /text field is invalid/)
  } finally { delete globalThis.summaryTestInvoke }
})
