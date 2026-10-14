import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregatePlaylistDuration, createPlaylistDurationScanner, formatPlaylistDurationLabel, resolvePlaylistDuration, type PlaylistDurationProbeItem, type PlaylistDurationScanResult } from './playlistDuration.ts'

const noMetadata = new Map<string, number>()
function requireScan(result: PlaylistDurationScanResult | null): PlaylistDurationScanResult {
  assert.ok(result, 'current scan must return its per-path evidence')
  return result
}

test('empty queue is zero; incomplete or invalid duration never becomes a partial total', () => {
  assert.deepEqual(aggregatePlaylistDuration([]), { status: 'ready', totalSeconds: 0 })
  assert.deepEqual(aggregatePlaylistDuration([{ sourcePath: 'a', durationMs: 0 }]), { status: 'ready', totalSeconds: 0 })
  for (const durationMs of [undefined, null, -1, NaN, Infinity]) {
    assert.deepEqual(aggregatePlaylistDuration([{ sourcePath: 'known', durationMs: 1000 }, { sourcePath: 'unknown', durationMs }]), { status: 'unknown' })
  }
})

test('probe is bounded to 16, deduplicates paths, and counts every duplicate queue entry', async () => {
  const batches: string[][] = []
  const scan = createPlaylistDurationScanner(async (paths) => {
    batches.push(paths)
    return paths.map((sourcePath) => ({ sourcePath, durationMs: 1000, error: null }))
  })
  const sources = Array.from({ length: 34 }, (_, index) => ({ sourcePath: `file-${index}` }))
  const entries = [...sources, sources[0]!, { sourcePath: 'known', durationMs: 5000 }]
  const result = requireScan(await scan(entries, () => true))
  assert.deepEqual(batches.map((batch) => batch.length), [16, 16, 2])
  assert.equal(result.durationsByPath.size, 35)
  assert.deepEqual(resolvePlaylistDuration(entries, noMetadata, result), { status: 'ready', totalSeconds: 40 })
})

test('可用歌曲的未知时长和读取错误保留证据，不发布不完整数字', async () => {
  const error = { code: 'FILE_NOT_FOUND' }
  const entries = [{ sourcePath: 'missing' }, { sourcePath: 'unknown' }, { sourcePath: 'known' }]
  const scan = createPlaylistDurationScanner(async (paths) => paths.map((sourcePath) => ({
    sourcePath, durationMs: sourcePath === 'unknown' ? null : 1000, error: sourcePath === 'missing' ? error : null,
  })))
  const result = requireScan(await scan(entries, () => true))
  assert.equal(result.durationsByPath.get('known'), 1000)
  assert.equal(result.durationsByPath.has('missing'), false)
  assert.deepEqual(result.itemFailures.get('missing'), { kind: 'probe-error', error })
  assert.deepEqual(result.itemFailures.get('unknown'), { kind: 'unknown-duration' })
  const resolved = resolvePlaylistDuration(entries, noMetadata, result)
  assert.equal(resolved.status, 'unknown')
  assert.equal(resolved.totalSeconds, undefined)
  assert.equal(result.commandFailure, undefined)
})

test('replacement waits for in-flight batch, discards old result, and cancels remaining old batches', async () => {
  let firstCurrent = true
  let finish: ((items: PlaylistDurationProbeItem[]) => void) | undefined
  let started: (() => void) | undefined
  const startedPromise = new Promise<void>((resolve) => { started = resolve })
  const calls: string[][] = []
  const scan = createPlaylistDurationScanner(async (paths) => {
    calls.push(paths)
    if (calls.length === 1) return new Promise<PlaylistDurationProbeItem[]>((resolve) => { finish = resolve; started?.() })
    return paths.map((sourcePath) => ({ sourcePath, durationMs: 2000, error: null }))
  })
  const old = scan(Array.from({ length: 32 }, (_, index) => ({ sourcePath: `old-${index}` })), () => firstCurrent)
  await startedPromise
  firstCurrent = false
  const nextSources = [{ sourcePath: 'new' }]
  const next = scan(nextSources, () => true)
  await Promise.resolve()
  assert.equal(calls.length, 1)
  finish?.(calls[0]!.map((sourcePath) => ({ sourcePath, durationMs: 1000, error: null })))
  assert.equal(await old, null)
  const nextResult = requireScan(await next)
  assert.deepEqual(resolvePlaylistDuration(nextSources, noMetadata, nextResult), { status: 'ready', totalSeconds: 2 })
  assert.deepEqual([...nextResult.durationsByPath.keys()], ['new'])
  assert.deepEqual(calls.map((paths) => paths[0]), ['old-0', 'new'])
})

test('already canceled scope performs no native work', async () => {
  const scan = createPlaylistDurationScanner(async () => { assert.fail('canceled scope must not probe') })
  assert.equal(await scan([{ sourcePath: 'old' }], () => false), null)
})

test('部分补水只探测未知路径，保留毫秒精度且总和溢出不会发布数字', async () => {
  const calls: string[][] = []
  const scan = createPlaylistDurationScanner(async (paths) => {
    calls.push(paths)
    return paths.map((sourcePath) => ({ sourcePath, durationMs: 1250, error: null }))
  })
  const entries = [{ sourcePath: 'known', durationMs: 2250 }, { sourcePath: 'pending' }]
  const result = requireScan(await scan(entries, () => true))
  assert.deepEqual(resolvePlaylistDuration(entries, noMetadata, result), { status: 'ready', totalSeconds: 3.5 })
  assert.deepEqual(calls, [['pending']])
  assert.deepEqual(aggregatePlaylistDuration([
    { sourcePath: 'a', durationMs: Number.MAX_VALUE }, { sourcePath: 'b', durationMs: Number.MAX_VALUE },
  ]), { status: 'unknown' })
})

test('命令返回路径乱序、少项或非法时长归类为协议失败，整批不得发布虚假总和', async () => {
  const responseCases: PlaylistDurationProbeItem[][] = [
    [{ sourcePath: 'b', durationMs: 1000, error: null }, { sourcePath: 'a', durationMs: 2000, error: null }],
    [{ sourcePath: 'a', durationMs: 1000, error: null }],
    [{ sourcePath: 'a', durationMs: 1000, error: null }, { sourcePath: 'b', durationMs: Infinity, error: null }],
  ]
  const entries = [{ sourcePath: 'a' }, { sourcePath: 'b' }]
  for (const response of responseCases) {
    const scan = createPlaylistDurationScanner(async () => response)
    const result = requireScan(await scan(entries, () => true))
    assert.equal(result.commandFailure?.kind, 'protocol')
    assert.equal(result.durationsByPath.size, 0)
    const resolved = resolvePlaylistDuration(entries, noMetadata, result)
    assert.equal(resolved.status, 'error')
    assert.equal(resolved.totalSeconds, undefined)
  }
})

test('前一命令拒绝后新列表仍能扫描成功，拒绝不会泄漏到新列表', async () => {
  let calls = 0
  const scan = createPlaylistDurationScanner(async (paths) => {
    calls += 1
    if (calls === 1) throw new Error('first request failed')
    return paths.map((sourcePath) => ({ sourcePath, durationMs: 7000, error: null }))
  })
  const old = requireScan(await scan([{ sourcePath: 'old' }], () => true))
  assert.equal(old.commandFailure?.kind, 'invoke')
  assert.equal(resolvePlaylistDuration([{ sourcePath: 'old' }], noMetadata, old).status, 'error')
  const next = requireScan(await scan([{ sourcePath: 'new' }], () => true))
  assert.equal(next.commandFailure, undefined)
  assert.deepEqual(resolvePlaylistDuration([{ sourcePath: 'new' }], noMetadata, next), { status: 'ready', totalSeconds: 7 })
  assert.equal(calls, 2)
})

test('不可用条目不发探测且不贡献总时长，即使存在旧补水和探测时长', async () => {
  for (const durationMs of [undefined, 5000]) {
    const calls: string[][] = []
    const scan = createPlaylistDurationScanner(async (paths) => {
      calls.push(paths)
      return paths.map((sourcePath) => ({ sourcePath, durationMs: 2000, error: null }))
    })
    const entries = [{ sourcePath: 'missing', available: false, durationMs }, { sourcePath: 'valid' }]
    const result = requireScan(await scan(entries, () => true))
    assert.deepEqual(calls, [['valid']])
    const staleResult = { ...result, durationsByPath: new Map([...result.durationsByPath, ['missing', 999000] as const]) }
    assert.deepEqual(resolvePlaylistDuration(entries, new Map([['missing', 5000]]), staleResult), { status: 'ready', totalSeconds: 2 })
  }
})

test('不可用副本的旧时长不污染相同路径的可用条目', async () => {
  const calls: string[][] = []
  const scan = createPlaylistDurationScanner(async (paths) => {
    calls.push(paths)
    return paths.map((sourcePath) => ({ sourcePath, durationMs: 2000, error: null }))
  })
  const entries = [
    { sourcePath: 'same', available: false, durationMs: 999000 }, { sourcePath: 'same', available: true },
  ]
  const result = requireScan(await scan(entries, () => true))
  assert.equal(result.durationsByPath.get('same'), 2000)
  const resolved = resolvePlaylistDuration(entries, noMetadata, result)
  assert.deepEqual(resolved, { status: 'ready', totalSeconds: 2 })
  assert.deepEqual(calls, [['same']])
})

test('成功探测A与失败B后来的补水合并为完整3秒，既不重扫也不丢失A', async () => {
  let calls = 0
  const entries = [{ sourcePath: 'a' }, { sourcePath: 'b' }]
  const scan = createPlaylistDurationScanner(async (paths) => {
    calls += 1
    return paths.map((sourcePath) => ({
      sourcePath, durationMs: sourcePath === 'a' ? 1000 : null, error: sourcePath === 'b' ? { code: 'UNREADABLE_FILE' } : null,
    }))
  })
  const result = requireScan(await scan(entries, () => true))
  assert.equal(result.durationsByPath.get('a'), 1000)
  const incomplete = resolvePlaylistDuration(entries, noMetadata, result)
  assert.equal(incomplete.status, 'unknown')
  assert.equal(incomplete.totalSeconds, undefined)
  assert.deepEqual(resolvePlaylistDuration(entries, new Map([['b', 2000]]), result), { status: 'ready', totalSeconds: 3 })
  assert.equal(calls, 1)
  assert.equal(result.itemFailures.get('b')?.kind, 'probe-error')
})

test('第二批invoke失败保留首批成功；后补水可以恢复完整总和但不能提前给partialsum', async () => {
  let calls = 0
  const entries = Array.from({ length: 33 }, (_, index) => ({ sourcePath: String(index) }))
  const scan = createPlaylistDurationScanner(async (paths) => {
    calls += 1
    if (calls === 2) throw new Error('native command unavailable')
    return paths.map((sourcePath) => ({ sourcePath, durationMs: 1000, error: null }))
  })
  const result = requireScan(await scan(entries, () => true))
  assert.equal(calls, 2)
  assert.equal(result.durationsByPath.size, 16)
  assert.equal(result.commandFailure?.kind, 'invoke')
  const unresolved = resolvePlaylistDuration(entries, noMetadata, result)
  assert.equal(unresolved.status, 'error')
  assert.equal(unresolved.totalSeconds, undefined)
  const later = new Map(entries.slice(16).map((entry) => [entry.sourcePath, 2000]))
  assert.deepEqual(resolvePlaylistDuration(entries, later, result), { status: 'ready', totalSeconds: 50 })
})

test('协议parser异常与invoke异常区分，成功前批保持原始精度', async () => {
  let calls = 0
  const entries = Array.from({ length: 17 }, (_, index) => ({ sourcePath: String(index) }))
  const scan = createPlaylistDurationScanner(async (paths) => {
    calls += 1
    if (calls === 2) {
      const error = new Error('invalid response fields')
      error.name = 'PlaylistDurationProtocolError'
      throw error
    }
    return paths.map((sourcePath) => ({ sourcePath, durationMs: 1250, error: null }))
  })
  const result = requireScan(await scan(entries, () => true))
  assert.equal(result.commandFailure?.kind, 'protocol')
  assert.equal(result.durationsByPath.size, 16)
  assert.equal(resolvePlaylistDuration(entries, noMetadata, result).status, 'error')
  assert.deepEqual(resolvePlaylistDuration(entries, new Map([['16', 1000]]), result), { status: 'ready', totalSeconds: 21 })
})

test('最新合法补水覆盖探测旧值；非法补水不掩盖探测成功，零时长合法', () => {
  const entries = [{ sourcePath: 'a' }, { sourcePath: 'b' }]
  const result: PlaylistDurationScanResult = { durationsByPath: new Map([['a', 1000], ['b', 2000]]), itemFailures: new Map() }
  assert.deepEqual(resolvePlaylistDuration(entries, new Map([['a', 4000], ['b', 0]]), result), { status: 'ready', totalSeconds: 4 })
  for (const invalid of [-1, NaN, Infinity]) {
    assert.deepEqual(resolvePlaylistDuration(entries, new Map([['a', invalid]]), result), { status: 'ready', totalSeconds: 3 })
  }
})

test('待扫描scope不读取历史完整数字，合法全补水能直接ready', () => {
  const entries = [{ sourcePath: 'same' }]
  const pending = resolvePlaylistDuration(entries, noMetadata, undefined, true)
  assert.equal(pending.status, 'loading')
  assert.equal(pending.totalSeconds, undefined)
  assert.deepEqual(resolvePlaylistDuration(entries, new Map([['same', 2000]]), undefined, true), { status: 'ready', totalSeconds: 2 })
})

test('未知诊断只计算未恢复文件，迟到补水不继续报告历史读取失败', () => {
  const entries = [{ sourcePath: 'failed' }, { sourcePath: 'unknown' }]
  const result: PlaylistDurationScanResult = {
    durationsByPath: new Map(),
    itemFailures: new Map([
      ['failed', { kind: 'probe-error', error: { code: 'UNREADABLE_FILE' } }],
      ['unknown', { kind: 'unknown-duration' }],
    ]),
  }
  assert.match(resolvePlaylistDuration(entries, noMetadata, result).detail ?? '', /2 首歌曲时长未知，1 个文件读取失败/)
  const restored = resolvePlaylistDuration(entries, new Map([['failed', 1000]]), result)
  assert.equal(restored.status, 'unknown')
  assert.match(restored.detail ?? '', /1 首歌曲时长未知/)
  assert.doesNotMatch(restored.detail ?? '', /读取失败/)
  assert.equal(restored.totalSeconds, undefined)
})

test('m3u8的1797条目数量保留，时长只累计找到的1796首，补齐后加入恢复文件时长', async () => {
  const entries = Array.from({ length: 1797 }, (_, index) => ({ sourcePath: `track-${index}`, available: index !== 1263 }))
  const probedPaths: string[] = []
  const scan = createPlaylistDurationScanner(async (paths) => {
    assert.ok(paths.length <= 16)
    probedPaths.push(...paths)
    return paths.map((sourcePath) => ({ sourcePath, durationMs: sourcePath === 'track-0' ? 387467470 : 1000, error: null }))
  })
  const result = requireScan(await scan(entries, () => true))
  assert.equal(probedPaths.length, 1796)
  assert.equal(probedPaths.includes('track-1263'), false)
  const incomplete = resolvePlaylistDuration(entries, new Map([['track-1263', 999000]]), result)
  assert.equal(entries.length, 1797)
  assert.deepEqual(incomplete, { status: 'ready', totalSeconds: 389262.470 })
  assert.equal(formatPlaylistDurationLabel(incomplete, entries.length), '108:07:42')
  assert.equal(`${entries.length} | ${formatPlaylistDurationLabel(incomplete, entries.length)}`, '1797 | 108:07:42')
  const restored = entries.map((entry) => ({ ...entry, available: true }))
  assert.deepEqual(resolvePlaylistDuration(restored, new Map([['track-1263', 2000]]), result), { status: 'ready', totalSeconds: 389264.470 })
})

test('重复有效条目分别计时，失效条目计零，全部失效显示零秒，可用未知仍不发布数字', () => {
  const scan: PlaylistDurationScanResult = { durationsByPath: new Map([['known', 1250], ['zero', 0]]), itemFailures: new Map() }
  const duplicated = resolvePlaylistDuration([
    { sourcePath: 'known' }, { sourcePath: 'known' },
    { sourcePath: 'missing', available: false }, { sourcePath: 'missing', available: false },
  ], noMetadata, scan)
  assert.deepEqual(duplicated, { status: 'ready', totalSeconds: 2.5 })
  const zero = resolvePlaylistDuration([{ sourcePath: 'zero' }, { sourcePath: 'missing', available: false }], noMetadata, scan)
  assert.deepEqual(zero, { status: 'ready', totalSeconds: 0 })
  const missing = resolvePlaylistDuration([{ sourcePath: 'missing', available: false }], noMetadata, scan)
  assert.deepEqual(missing, { status: 'ready', totalSeconds: 0 })
  assert.equal(formatPlaylistDurationLabel(missing, 1), '0:00')
  const unknown = resolvePlaylistDuration([{ sourcePath: 'existing-unknown', available: true }], noMetadata, scan)
  assert.equal(unknown.status, 'unknown')
  assert.equal(unknown.totalSeconds, undefined)
})

test('pending与command失败优先于已缓存成功，不能伪装统计结束', () => {
  const entries = [{ sourcePath: 'a' }, { sourcePath: 'b' }]
  const completed: PlaylistDurationScanResult = { durationsByPath: new Map([['a', 1000]]), itemFailures: new Map() }
  const loading = resolvePlaylistDuration(entries, noMetadata, completed, true)
  assert.equal(loading.status, 'loading')
  assert.equal(loading.totalSeconds, undefined)
  for (const kind of ['invoke', 'protocol'] as const) {
    const failed = { ...completed, commandFailure: { kind, message: 'request failed' } }
    const error = resolvePlaylistDuration(entries, noMetadata, failed)
    assert.equal(error.status, 'error')
    assert.equal(error.totalSeconds, undefined)
    assert.deepEqual(resolvePlaylistDuration(entries, new Map([['b', 2000]]), failed), { status: 'ready', totalSeconds: 3 })
  }
})

test('可用未知文件补齐前不发布数字，取消时不发布结果', async () => {
  const entries = [{ sourcePath: 'a' }, { sourcePath: 'b' }, { sourcePath: 'c' }]
  const result: PlaylistDurationScanResult = {
    durationsByPath: new Map([['a', 1250]]),
    itemFailures: new Map([['b', { kind: 'unknown-duration' }], ['c', { kind: 'unknown-duration' }]]),
  }
  const incomplete = resolvePlaylistDuration(entries, new Map([['b', 2250]]), result)
  assert.equal(incomplete.status, 'unknown')
  assert.equal(incomplete.totalSeconds, undefined)
  assert.deepEqual(resolvePlaylistDuration(entries, new Map([['b', 2250], ['c', 1500]]), result), { status: 'ready', totalSeconds: 5 })
  let current = true
  let finish: ((items: PlaylistDurationProbeItem[]) => void) | undefined
  let started: (() => void) | undefined
  const startedPromise = new Promise<void>((resolve) => { started = resolve })
  const scan = createPlaylistDurationScanner(async () => new Promise<PlaylistDurationProbeItem[]>((resolve) => { finish = resolve; started?.() }))
  const canceled = scan(entries, () => current)
  await startedPromise
  current = false
  finish?.(entries.map(({ sourcePath }) => ({ sourcePath, durationMs: sourcePath === 'a' ? 1250 : null, error: null })))
  assert.equal(await canceled, null)
})

test('标签显示可用歌曲总时长，不附加已知或未知首数，未完成和错误状态保留', () => {
  assert.equal(formatPlaylistDurationLabel({ status: 'ready', totalSeconds: 389262.47 }, 1797), '108:07:42')
  assert.equal(formatPlaylistDurationLabel({ status: 'ready', totalSeconds: 0 }, 1797), '0:00')
  assert.equal(formatPlaylistDurationLabel({ status: 'unknown' }, 1), '时长未知')
  assert.equal(formatPlaylistDurationLabel({ status: 'loading', totalSeconds: 389262.47 }, 1797), '统计中…')
  assert.equal(formatPlaylistDurationLabel({ status: 'error', totalSeconds: 389262.47 }, 1797), '统计失败')
  for (const totalSeconds of [undefined, NaN, Infinity, -1]) {
    assert.equal(formatPlaylistDurationLabel({ status: 'ready', totalSeconds }, 2), '未知')
  }
})
