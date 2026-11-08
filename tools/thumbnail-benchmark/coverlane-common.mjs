// Shared plumbing for the coverlane measurement harness.
//
// NEW file under tools/thumbnail-benchmark/. It does not replace or modify the
// author's existing scripts (prepare.mjs, prepare-ui.mjs, ui-pairs.mjs,
// visible-pairs.mjs, visible-measurement.mjs, run-pairs.mjs, sample-ui.ps1,
// summarize-*.mjs, probe.rs).
//
// What lives here
//   * the `$CACHE` asset-scope guard. A cache root outside LOCALAPPDATA makes
//     every convertFileSrc request answer 403, so the path lane looks broken for
//     reasons unrelated to the code under test. That mistake invalidated a whole
//     earlier batch; here it is a hard refusal instead of a silent regression.
//   * a CDP client plus a Network recorder that turns IPC/asset traffic into
//     counted facts (native request count, attempt identity, real bytes).
//   * process launching, warm/cold profile handling, and the run manifest
//     required by the closeout plan section 2.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..', '..')

export const HARNESS_SCRIPTS = [
  'coverlane-common.mjs',
  'coverlane-page.mjs',
  'coverlane-fixtures.mjs',
  'coverlane-ab.mjs',
  'coverlane-stress.mjs',
  'coverlane-isolation.patch.mjs',
  'coverlane-memory.ps1',
]

/** Bumped whenever the recorded schema changes; old batches stay interpretable. */
export const SCHEMA_VERSION = 1

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function sha256File(path) {
  return sha256(readFileSync(path))
}

export function hashHarness() {
  const out = {}
  for (const name of HARNESS_SCRIPTS) {
    const path = join(HERE, name)
    if (existsSync(path)) out[name] = sha256File(path)
  }
  return out
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2))
}

export function mkdir(path) {
  mkdirSync(path, { recursive: true })
  return path
}

export function rmTree(path) {
  if (!existsSync(path)) return
  spawnSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'rmdir', '/s', '/q', path] : ['-rf', path])
}

export function requireFresh(path, what) {
  const absolute = resolve(path)
  if (existsSync(absolute)) throw new Error(`${what} must not exist: ${absolute}`)
  return absolute
}

// ---------------------------------------------------------------------------
// $CACHE scope guard (plan section 6 / the earlier 403 incident)
// ---------------------------------------------------------------------------

export function assertCacheScope(cacheRoot, label) {
  const local = process.env.LOCALAPPDATA
  if (!local) throw new Error(`${label}: LOCALAPPDATA is unset, so $CACHE cannot be resolved`)
  const absoluteRoot = resolve(cacheRoot)
  const absoluteLocal = resolve(local)
  const rel = relative(absoluteLocal, absoluteRoot)
  if (!isAbsolute(absoluteRoot) || rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `${label}: the cache root must live inside $CACHE (LOCALAPPDATA=${absoluteLocal}) so the ` +
      `asset protocol scope "$CACHE/**" covers it; got ${absoluteRoot}. Widening the asset scope ` +
      `is not an acceptable way to make the experiment pass, and a 403-per-request run measures ` +
      `nothing but the scope violation.`,
    )
  }
  return { cacheRoot: absoluteRoot, localAppData: absoluteLocal }
}

// ---------------------------------------------------------------------------
// Host / environment facts (plan section 2)
// ---------------------------------------------------------------------------

function walkVersions(root) {
  if (!existsSync(root)) return { root, exists: false, versions: [] }
  let entries = []
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return { root, exists: true, versions: [] } }
  const versions = entries
    .filter(e => e.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(e.name))
    .map(e => e.name)
    .sort((a, b) => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
      return 0
    })
  return { root, exists: true, versions }
}

export function webView2Facts() {
  const roots = [
    walkVersions(join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'EdgeWebView', 'Application')),
    walkVersions(join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'EdgeWebView', 'Application')),
  ]
  const all = roots.flatMap(r => r.versions)
  all.sort((a, b) => {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
    return 0
  })
  return {
    evergreenRoots: roots,
    newestEvergreen: all.length ? all[all.length - 1] : null,
    // WebView2 picks the newest evergreen runtime unless overridden, so this is
    // an inference about which build a run likely used, not an observation.
    selectedInference: 'newestEvergreen unless WEBVIEW2_BROWSER_EXECUTABLE_FOLDER / fixed runtime is set',
    fixedRuntimeEnv: process.env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER || null,
  }
}

/**
 * Run PowerShell with UTF-8 output forced.
 *
 * Windows PowerShell defaults to the OEM code page, which turns a non-ASCII power
 * plan name into mojibake in the manifest. Setting `[Console]::OutputEncoding`
 * before the work keeps the captured text faithful.
 */
function powershell(script) {
  const wrapped = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', wrapped], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return (result.stdout || '').trim()
}

/** Well-known Windows power scheme GUIDs, so the manifest is readable. */
const KNOWN_POWER_SCHEMES = {
  '381b4222-f694-41f0-9685-ff5bb260df2e': 'Balanced',
  '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c': 'High performance',
  'a1841308-3541-4fab-bc81-f71556f20b4a': 'Power saver',
}

/**
 * Read the active power plan as Unicode.
 *
 * `powercfg /getactivescheme` prints through the OEM code page, so its localized
 * plan name arrives as mojibake when captured from Node. The registry values are
 * Unicode, so the GUID is read from there; a GUID that matches a well-known plan
 * is named from that table, and one that does not keeps `name: null` with the
 * reason recorded rather than a guessed or garbled string.
 */
function activePowerPlan() {
  const line = powershell(String.raw`
$base = 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes'
$guid = $null
try { $guid = (Get-ItemProperty -Path $base -Name ActivePowerScheme -ErrorAction Stop).ActivePowerScheme } catch {}
if (-not $guid) { $guid = '' }
$friendly = ''
if ($guid) {
  try {
    $value = (Get-ItemProperty -Path (Join-Path $base $guid) -Name FriendlyName -ErrorAction Stop).FriendlyName
    if ($value -and ($value -notlike '@*')) { $friendly = $value }
  } catch {}
}
'{0}|{1}' -f $guid, $friendly
  `)
  const [rawGuid, friendly] = line.split('|')
  const guid = rawGuid ? rawGuid.trim().toUpperCase() : null
  if (!guid) {
    const cli = spawnSync('powercfg', ['/getactivescheme'], { encoding: 'latin1', windowsHide: true })
    const match = (cli.stdout || '').match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/)
    return {
      guid: match ? match[1].toUpperCase() : null,
      name: match ? KNOWN_POWER_SCHEMES[match[1].toLowerCase()] ?? null : null,
      source: 'powercfg /getactivescheme (GUID only: OEM code page garbles the localised name)',
    }
  }
  const known = KNOWN_POWER_SCHEMES[guid.toLowerCase()] ?? null
  return {
    guid,
    name: known || (friendly || null),
    nameSource: known ? 'well-known GUID table' : (friendly ? 'registry FriendlyName' : null),
    nameUnavailableReason: known || friendly ? null : 'custom scheme with a MUI resource reference name',
    source: 'registry PowerSchemes (Unicode)',
  }
}

export function hostFacts() {
  const cpus = os.cpus()
  const osLine = powershell(
    "$o = Get-CimInstance Win32_OperatingSystem; '{0}|{1}|{2}' -f $o.Caption, $o.Version, $o.BuildNumber",
  )
  const parts = osLine.split('|')
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    os: { caption: parts[0] || null, version: parts[1] || null, build: parts[2] || null },
    cpu: { model: cpus[0]?.model || null, count: cpus.length },
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytesAtStart: os.freemem(),
    localAppData: process.env.LOCALAPPDATA || null,
    powerPlan: activePowerPlan(),
    webView2: webView2Facts(),
  }
}

export function gitFacts() {
  const run = args => spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const head = run(['rev-parse', 'HEAD'])
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = run(['status', '--short'])
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    branch: branch.status === 0 ? branch.stdout.trim() : null,
    statusShort: status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean) : [],
  }
}

/**
 * Facts about one arm's built executable.
 *
 * The `markers` block is a HINT, not proof. A production Tauri build serves the
 * frontend over the custom `tauri.localhost` protocol; a bare `cargo build
 * --release` (without the `custom-protocol` feature) falls back to loading
 * `http://localhost:5173`. Those strings may or may not survive optimisation, so
 * the decisive evidence is the URL the WebView actually navigates to, which
 * `CdpClient.targetUrl` records per run. Both are kept, labelled as what they are.
 */
export function artifactFacts(path) {
  const absolute = resolve(path)
  if (!existsSync(absolute)) throw new Error(`artifact missing: ${absolute}`)
  const bytes = readFileSync(absolute)
  const text = bytes.toString('latin1')
  const stat = statSync(absolute)
  return {
    path: absolute,
    sha256: sha256(bytes),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    markers: {
      kind: 'string-scan hints; the runtime CDP target URL is the authoritative signal',
      customProtocolStringPresent: text.includes('custom-protocol'),
      devServerUrlStringPresent: text.includes('localhost:5173'),
      isolationRootStringPresent: text.includes('THUMB_UI_ROOT'),
      isolationPlaylistStringPresent: text.includes('THUMB_UI_PLAYLIST'),
    },
  }
}

/**
 * The decisive production-vs-dev signal, taken from the URL the WebView loaded.
 *
 * `http://tauri.localhost/...` is the custom protocol (production asset serving).
 * `http://localhost:5173/...` means the binary was built without the
 * `custom-protocol` feature and is talking to a dev server, which disqualifies it
 * as a comparable release artifact.
 */
export function runtimeServingFacts(targetUrl) {
  let url = null
  try { url = new URL(targetUrl) } catch { /* keep null */ }
  const customProtocol = url?.hostname === 'tauri.localhost'
  const devServer = url?.hostname === 'localhost' && url?.port === '5173'
  return {
    observedTargetUrl: targetUrl,
    servingMode: customProtocol ? 'custom-protocol (production)' : devServer ? 'dev-server (not comparable)' : 'unknown',
    isCustomProtocol: customProtocol,
    isDevServer: devServer,
    comparableReleaseArtifact: customProtocol && !devServer,
  }
}

// ---------------------------------------------------------------------------
// Cache / profile inspection
// ---------------------------------------------------------------------------

const THUMBNAIL_EXTENSIONS = ['jpg', 'spxr']

/**
 * Cache files are REPORTED, never used as evidence of fallback. Plan section 4
 * forbids concluding "0 .spxr therefore 0 fallbacks"; the lane recorder supplies
 * the direct count and this snapshot only describes disk state.
 */
export function cacheSnapshot(cacheRoot) {
  const thumbnails = join(cacheRoot, 'cache', 'audio', 'thumbnails')
  const covers = join(cacheRoot, 'cache', 'audio', 'covers')
  const out = {
    thumbnailDirectory: thumbnails,
    coverDirectory: covers,
    exists: existsSync(thumbnails),
    total: 0,
    byExtension: {},
    bytesByExtension: {},
    totalBytes: 0,
    coverFileCount: 0,
    distinctCoverHashes: 0,
  }
  if (out.exists) {
    let names = []
    try { names = readdirSync(thumbnails) } catch { names = [] }
    for (const name of names) {
      let info
      try { info = statSync(join(thumbnails, name)) } catch { continue }
      if (!info.isFile()) continue
      const ext = name.split('.').pop()?.toLowerCase()
      if (!THUMBNAIL_EXTENSIONS.includes(ext)) continue
      out.total += 1
      out.byExtension[ext] = (out.byExtension[ext] || 0) + 1
      out.bytesByExtension[ext] = (out.bytesByExtension[ext] || 0) + info.size
      out.totalBytes += info.size
    }
  }
  if (existsSync(covers)) {
    let names = []
    try { names = readdirSync(covers) } catch { names = [] }
    const hashes = new Set()
    for (const name of names) {
      hashes.add(name.split('.')[0])
      out.coverFileCount += 1
    }
    out.distinctCoverHashes = hashes.size
  }
  return out
}

// ---------------------------------------------------------------------------
// CDP
// ---------------------------------------------------------------------------

export class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.closed = false
    ws.addEventListener('message', event => this.#onMessage(event))
  }

  static async connect(port, { attempts = 240, intervalMs = 250 } = {}) {
    let target = null
    for (let i = 0; i < attempts; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        target = list.find(t => t.type === 'page' && /tauri\.localhost/.test(t.url))
      } catch { /* still starting */ }
      if (target) break
      await sleep(intervalMs)
    }
    if (!target) throw new Error(`WebView2 did not expose a CDP page target on port ${port}`)
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', rej, { once: true })
    })
    const client = new CdpClient(ws)
    client.targetUrl = target.url
    return client
  }

  #onMessage(event) {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    if (message.method) {
      const handler = this.handlers.get(message.method)
      if (handler) {
        try { handler(message.params) } catch { /* a listener must never abort the batch */ }
      }
      return
    }
    const item = this.pending.get(message.id)
    if (!item) return
    this.pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.error) item.reject(new Error(`${item.method}: ${JSON.stringify(message.error)}`))
    else item.resolve(message.result)
  }

  on(method, handler) {
    this.handlers.set(method, handler)
  }

  send(method, params = {}, timeoutMs = 60000) {
    return new Promise((resolvePromise, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolvePromise, reject, timer, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, { timeoutMs = 180000 } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    }, timeoutMs)
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails
      const text = detail.exception?.description || detail.text || JSON.stringify(detail)
      throw new Error(`in-page evaluation failed: ${text}`)
    }
    return result.result.value
  }

  close() {
    if (this.closed) return
    this.closed = true
    try { this.ws.close() } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------
// Network recorder: direct counts for plan section 4
// ---------------------------------------------------------------------------

/**
 * Counting basis, stated because plan section 4 forbids estimation:
 *   * native request count = distinct CDP `requestId`, so a deduped/shared job
 *     counts once no matter how many DOM consumers asked for it;
 *   * attempt identity = the IPC request body tuple
 *     (clientId, windowGeneration, sourcePath|filePath, maxEdge), which is
 *     literally the frontend scheduler's dedupe key -- not a heuristic;
 *   * bytes = `Network.dataReceived.dataLength` (decoded body) and
 *     `Network.loadingFinished.encodedDataLength`, both measured, never a fixed
 *     100 B estimate;
 *   * request bytes = UTF-8 length of the serialized JSON request body.
 */
export class LaneRecorder {
  constructor() {
    this.requests = new Map()
    this.order = 0
  }

  install(client) {
    client.on('Network.requestWillBeSent', params => {
      const url = params.request.url
      const kind = /\/\/ipc\.localhost\//.test(url) ? 'ipc' : /\/\/asset\.localhost\//.test(url) ? 'asset' : null
      if (!kind) return
      let command = null
      if (kind === 'ipc') {
        try { command = decodeURIComponent(new URL(url).pathname) } catch { command = url }
      }
      this.requests.set(params.requestId, {
        requestId: params.requestId,
        order: this.order++,
        kind,
        command,
        url,
        startedAtMs: params.timestamp * 1000,
        postData: params.request.postData ?? null,
        status: null,
        mime: null,
        fromDiskCache: false,
        decodedBytes: 0,
        encodedBytes: 0,
        failedText: null,
        canceled: false,
        finishedAtMs: null,
      })
    })
    client.on('Network.responseReceived', params => {
      const record = this.requests.get(params.requestId)
      if (!record) return
      record.status = params.response.status
      record.mime = params.response.mimeType || null
      record.fromDiskCache = Boolean(params.response.fromDiskCache)
    })
    client.on('Network.dataReceived', params => {
      const record = this.requests.get(params.requestId)
      if (record) record.decodedBytes += params.dataLength || 0
    })
    client.on('Network.loadingFinished', params => {
      const record = this.requests.get(params.requestId)
      if (!record) return
      record.encodedBytes = params.encodedDataLength || record.decodedBytes
      record.finishedAtMs = params.timestamp * 1000
    })
    client.on('Network.loadingFailed', params => {
      const record = this.requests.get(params.requestId)
      if (!record) return
      record.failedText = params.errorText || 'unknown'
      record.canceled = Boolean(params.canceled)
      record.finishedAtMs = params.timestamp * 1000
    })
  }

  beginWindow() {
    this.requests.clear()
    this.order = 0
  }

  snapshot() {
    const all = [...this.requests.values()]
    const ipc = all.filter(r => r.kind === 'ipc')
    const asset = all.filter(r => r.kind === 'asset')
    const byCommand = new Map()
    for (const record of ipc) {
      const key = record.command || '<unnamed>'
      const bucket = byCommand.get(key) || {
        command: key, lane: laneOfCommand(key), kind: kindOfCommand(key),
        nativeRequests: 0, ok: 0, nonOkStatus: 0, failed: 0, canceled: 0, inFlightAtSnapshot: 0,
        decodedBytes: 0, encodedBytes: 0, requestBytes: 0, mime: new Set(), durationsMs: [],
      }
      bucket.nativeRequests += 1
      if (record.status === 200) bucket.ok += 1
      else if (record.status !== null) bucket.nonOkStatus += 1
      else bucket.inFlightAtSnapshot += 1
      if (record.failedText) bucket.failed += 1
      if (record.canceled) bucket.canceled += 1
      bucket.decodedBytes += record.decodedBytes
      bucket.encodedBytes += record.encodedBytes
      bucket.requestBytes += record.postData ? Buffer.byteLength(record.postData) : 0
      if (record.mime) bucket.mime.add(record.mime)
      if (record.finishedAtMs !== null) bucket.durationsMs.push(record.finishedAtMs - record.startedAtMs)
      byCommand.set(key, bucket)
    }
    return {
      basis: {
        nativeRequestCount: 'distinct CDP requestId; deduped/shared work is counted once',
        attemptIdentity: 'IPC body tuple (clientId, windowGeneration, sourcePath|filePath, maxEdge) = scheduler dedupe key',
        decodedBytes: 'sum of Network.dataReceived.dataLength',
        encodedBytes: 'sum of Network.loadingFinished.encodedDataLength',
        requestBytes: 'UTF-8 byte length of the serialized JSON request body',
        estimatedSizesUsed: false,
      },
      ipc: [...byCommand.values()].map(bucket => ({
        ...bucket,
        mime: [...bucket.mime],
        durationP50Ms: percentile(bucket.durationsMs, 0.5),
        durationP95Ms: percentile(bucket.durationsMs, 0.95),
        durationMaxMs: bucket.durationsMs.length ? Math.max(...bucket.durationsMs) : null,
        durationsMs: undefined,
      })).sort((a, b) => b.nativeRequests - a.nativeRequests),
      ipcTotals: {
        nativeRequests: ipc.length,
        decodedBytes: ipc.reduce((a, r) => a + r.decodedBytes, 0),
        encodedBytes: ipc.reduce((a, r) => a + r.encodedBytes, 0),
        requestBytes: ipc.reduce((a, r) => a + (r.postData ? Buffer.byteLength(r.postData) : 0), 0),
        failed: ipc.filter(r => r.failedText).length,
        canceled: ipc.filter(r => r.canceled).length,
        nonOkStatus: ipc.filter(r => r.status !== null && r.status !== 200).length,
        inFlightAtSnapshot: ipc.filter(r => r.status === null && !r.failedText).length,
      },
      asset: {
        nativeRequests: asset.length,
        decodedBytes: asset.reduce((a, r) => a + r.decodedBytes, 0),
        encodedBytes: asset.reduce((a, r) => a + r.encodedBytes, 0),
        statuses: countBy(asset.map(r => r.status)),
        mimes: countBy(asset.map(r => r.mime)),
        fromDiskCache: asset.filter(r => r.fromDiskCache).length,
        failed: asset.filter(r => r.failedText).length,
        canceled: asset.filter(r => r.canceled).length,
        forbiddenOrProtocolError: asset.filter(r => r.status === 403).length,
        inFlightAtSnapshot: asset.filter(r => r.status === null && !r.failedText).length,
        // Each asset URL must decode to a path under LOCALAPPDATA, otherwise the
        // $CACHE asset scope does not cover it and a 403-per-request run would be
        // measuring a scope violation rather than the code under test.
        allUrlsInsideCacheRoot: asset.every(r => isAssetUrlInsideCacheRoot(r.url)),
        outsideCacheRootUrls: asset.filter(r => !isAssetUrlInsideCacheRoot(r.url)).map(r => r.url).slice(0, 5),
        durationsMs: undefined,
      },
      laneAttempts: laneAttemptSummary(ipc),
      requests: ipc.map(compactRequest),
      assetRequests: asset.map(compactRequest),
    }
  }
}

export function percentile(values, q) {
  if (!values || values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))
  return sorted[index]
}

function countBy(values) {
  const out = {}
  for (const value of values) {
    const key = value === null || value === undefined ? 'none' : String(value)
    out[key] = (out[key] || 0) + 1
  }
  return out
}

function compactRequest(record) {
  return {
    order: record.order,
    command: record.command,
    status: record.status,
    mime: record.mime,
    decodedBytes: record.decodedBytes,
    encodedBytes: record.encodedBytes,
    requestBytes: record.postData ? Buffer.byteLength(record.postData) : 0,
    failed: record.failedText,
    canceled: record.canceled,
    fromDiskCache: record.fromDiskCache,
    durationMs: record.finishedAtMs !== null ? record.finishedAtMs - record.startedAtMs : null,
  }
}

function isAssetUrlInsideCacheRoot(url) {
  let decoded
  try {
    // `convertFileSrc` produces http://asset.localhost/<percent-encoded absolute
    // path>, so the pathname carries a leading slash before the drive letter.
    decoded = decodeURIComponent(new URL(url).pathname).replace(/^\//, '')
  } catch { return false }
  const local = process.env.LOCALAPPDATA
  if (!local) return false
  return decoded.toLowerCase().startsWith(local.toLowerCase())
}

/** `audio_load_track_thumbnail_path` -> path; `audio_load_track_thumbnail` -> pixels. */
export function laneOfCommand(command) {
  if (!command) return 'unknown'
  if (/_path$/.test(command)) return 'path'
  if (/cover_pixels|_thumbnail$/.test(command)) return 'pixels'
  return 'other'
}

/** `..._playlist_cover_...` -> cover; `..._folder_...` -> folder; else track. */
export function kindOfCommand(command) {
  if (!command) return null
  if (/playlist_cover/.test(command)) return 'cover'
  if (/_folder_thumbnail/.test(command)) return 'folder'
  if (/_track_thumbnail/.test(command) || /load_cover_pixels/.test(command)) return 'track'
  return null
}

export function normalizeSource(source) {
  if (typeof source !== 'string' || !source) return null
  return source.replace(/^\\\\\?\\/, '').replace(/\//g, '\\').toLowerCase()
}

/**
 * Attempt-level counts plus the directly counted fallback verdict.
 *
 * One identity is `lane|kind|clientId|generation|source|maxEdge`. A fallback is
 * counted when the *same* (kind, generation, source, maxEdge) appears through
 * both lanes. That is a request-level fact and it is what answers "did the path
 * lane fall back" -- not the presence or absence of `.spxr` files.
 */
export function laneAttemptSummary(ipcRequests) {
  const identities = new Map()
  const sources = new Map()
  for (const record of ipcRequests) {
    const lane = laneOfCommand(record.command)
    const kind = kindOfCommand(record.command)
    if (!kind || (lane !== 'path' && lane !== 'pixels')) continue
    let body = null
    try { body = record.postData ? JSON.parse(record.postData) : null } catch { body = null }
    const input = body && body.input ? body.input : {}
    const source = normalizeSource(input.sourcePath ?? input.filePath ?? null)
    if (!source) continue
    const clientId = typeof input.clientId === 'string' ? input.clientId : null
    const generation = Number.isInteger(input.windowGeneration) ? input.windowGeneration : null
    const maxEdge = Number.isInteger(input.maxEdge) ? input.maxEdge : null
    const identityKey = [lane, kind, clientId, generation, source, maxEdge].join('|')
    const identity = identities.get(identityKey) || {
      lane, kind, clientId, generation, source, maxEdge,
      nativeRequests: 0, ok: 0, missingResponses: 0, errorStatuses: 0, decodedBytes: 0, durationsMs: [],
    }
    identity.nativeRequests += 1
    if (record.status === 200) identity.ok += 1
    else if (record.status !== null) identity.errorStatuses += 1
    // A confirmed-absence verdict serializes to `null` (a few bytes); a published
    // reference is a ~200-400 B object. Used only to split absence from failure.
    if (record.status === 200 && record.decodedBytes > 0 && record.decodedBytes <= 8) identity.missingResponses += 1
    identity.decodedBytes += record.decodedBytes
    if (record.finishedAtMs !== null) identity.durationsMs.push(record.finishedAtMs - record.startedAtMs)
    identities.set(identityKey, identity)

    const sourceKey = [kind, generation, source, maxEdge].join('|')
    const bucket = sources.get(sourceKey) || {
      kind, generation, source, maxEdge, lanes: { path: 0, pixels: 0 },
      pathOk: 0, pathMissing: 0, pathFailures: 0, pixelsOk: 0, pixelsFailures: 0,
    }
    bucket.lanes[lane] += 1
    if (lane === 'path') {
      if (record.status === 200 && record.decodedBytes > 0 && record.decodedBytes <= 8) bucket.pathMissing += 1
      else if (record.status === 200) bucket.pathOk += 1
      else bucket.pathFailures += 1
    } else if (record.status === 200) bucket.pixelsOk += 1
    else bucket.pixelsFailures += 1
    sources.set(sourceKey, bucket)
  }
  const sourceRows = [...sources.values()]
  const fallbackRows = sourceRows.filter(row => row.lanes.path > 0 && row.lanes.pixels > 0)
  return {
    distinctIdentities: identities.size,
    distinctSources: sourceRows.length,
    byLane: countBy([...identities.values()].map(row => row.lane)),
    byKind: countBy([...identities.values()].map(row => row.kind)),
    /** Directly counted fallbacks: one workload answered through both lanes. */
    fallbackCount: fallbackRows.length,
    fallbackDetails: fallbackRows.map(row => ({
      kind: row.kind, generation: row.generation, maxEdge: row.maxEdge,
      pathAttempts: row.lanes.path, pixelAttempts: row.lanes.pixels,
      pathOk: row.pathOk, pathMissing: row.pathMissing, pathFailures: row.pathFailures,
      sourceAnonymous: sha256(row.source).slice(0, 32),
    })),
    pixelOnlySources: sourceRows.filter(row => row.lanes.pixels > 0 && row.lanes.path === 0).length,
    pathOnlySources: sourceRows.filter(row => row.lanes.path > 0 && row.lanes.pixels === 0).length,
    missingVerdicts: sourceRows.reduce((a, row) => a + row.pathMissing, 0),
    identities: [...identities.values()].map(row => ({
      lane: row.lane, kind: row.kind, clientId: row.clientId, generation: row.generation,
      maxEdge: row.maxEdge, nativeRequests: row.nativeRequests, ok: row.ok,
      missingResponses: row.missingResponses, errorStatuses: row.errorStatuses,
      decodedBytes: row.decodedBytes, durationP50Ms: percentile(row.durationsMs, 0.5),
      sourceAnonymous: sha256(row.source).slice(0, 32),
    })),
  }
}

// ---------------------------------------------------------------------------
// Application process
// ---------------------------------------------------------------------------

/**
 * Launch one arm in its own cache root and WebView2 profile.
 *
 * `fresh` uses a virgin root. `warm` reuses the same root so thumbnails written
 * by a previous process are already on disk, while still using a NEW process and
 * a NEW WebView2 profile. That is disk reuse, not an in-process cache, and it is
 * the only difference between the two modes.
 */
export async function launchArm({ executable, cacheRoot, playlistPath, port, extraEnv = {} }) {
  const { cacheRoot: checkedRoot } = assertCacheScope(cacheRoot, `arm cache root (${executable})`)
  mkdir(checkedRoot)
  mkdir(join(checkedRoot, 'webview'))
  const env = {
    ...process.env,
    THUMB_UI_ROOT: checkedRoot,
    THUMB_UI_PLAYLIST: resolve(playlistPath),
    WEBVIEW2_USER_DATA_FOLDER: join(checkedRoot, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    RUST_LOG: process.env.COVERLANE_RUST_LOG || 'off',
    ...extraEnv,
  }
  const child = spawn(resolve(executable), [], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', d => { logs += d })
  child.stderr.on('data', d => { logs += d })
  const exit = new Promise(r => child.once('exit', r))
  return {
    child,
    pid: child.pid,
    cacheRoot: checkedRoot,
    get logs() { return logs },
    async connect() {
      return CdpClient.connect(port)
    },
    async shutdown() {
      await Promise.race([exit, sleep(5000)])
      if (child.exitCode === null) child.kill()
      await Promise.race([exit, sleep(5000)])
      return { exitCode: child.exitCode, logs }
    },
  }
}

export async function closeViaApp(cdp) {
  try {
    await cdp.evaluate(`setTimeout(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}).catch(()=>null),20);true`)
  } catch { /* window may already be gone */ }
}

/**
 * Lock the renderer to a fixed viewport before any measurement.
 *
 * Plan section 6 requires the same window, DPR and layout for both arms, so the
 * override is set before the first action and reported in the manifest.
 */
export async function pinViewport(cdp, { width, height, deviceScaleFactor }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false })
  const observed = await cdp.evaluate(`({ innerWidth, innerHeight, dpr: devicePixelRatio })`)
  return { requested: { width, height, deviceScaleFactor }, observed }
}

export async function waitForOpenControl(cdp, { timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await cdp.evaluate(OPEN_CONTROL_PRESENT)
    if (found) return true
    await sleep(100)
  }
  return false
}

const OPEN_CONTROL_PRESENT = `Boolean(
  document.querySelector('button.empty-open-audio-button:not(:disabled)')
  || [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim() === '打开音频' && !b.disabled)
)`

/**
 * Bring the list panel up for a prerequisite or a re-open.
 *
 * This is deliberately NOT a measured action: it retries because the list control
 * can appear before the library has finished hydrating, and a click issued at that
 * moment is swallowed. Retrying here keeps that flakiness out of the timing path
 * instead of silently producing "no grid" mid-batch.
 *
 * Candidate order matters. When the media library is the active surface (which is
 * where the list's own close control returns to), the entry point is the library
 * row labelled `打开播放列表 <name>`, not the dock's `播放列表` button.
 */
export async function ensureListPanel(cdp, { settleMs = 1500, attempts = 6, timeoutMs = 40000 } = {}) {
  const present = `Boolean(document.querySelector('.playlist-grid [data-playlist-track-id]'))`
  if (await cdp.evaluate(present)) return { alreadyOpen: true }
  const attemptsLog = []
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const clicked = await cdp.evaluate(`(() => {
      if (document.querySelector('.playlist-grid [data-playlist-track-id]')) return { result: 'already' }
      const buttons = [...document.querySelectorAll('button')]
      const finders = [
        { how: 'dock-label', match: b => ['播放列表', '打开播放列表', '显示播放列表'].includes(b.getAttribute('aria-label')) },
        { how: 'library-row', match: b => /^打开播放列表\\s/.test(b.getAttribute('aria-label') || '') },
        { how: 'library-empty', match: b => (b.textContent || '').trim() === '打开播放列表' },
        { how: 'manage-return', match: b => b.getAttribute('aria-label') === '返回播放列表管理' },
      ]
      for (const finder of finders) {
        const button = buttons.find(candidate => finder.match(candidate) && !candidate.disabled)
        if (!button) continue
        button.click()
        return { result: 'clicked', how: finder.how, label: button.getAttribute('aria-label') }
      }
      const absent = buttons.find(candidate => finders.some(f => f.match(candidate)))
      return {
        result: absent ? 'disabled' : 'absent',
        labels: buttons.map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0, 40),
      }
    })()`)
    attemptsLog.push({ attempt, ...clicked })
    if (clicked.result === 'absent') {
      await sleep(400)
      continue
    }
    if (clicked.result === 'disabled') {
      await sleep(600)
      continue
    }
    await sleep(settleMs)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await cdp.evaluate(present)) return { alreadyOpen: false, attemptsLog, attempt, how: clicked.how }
      await sleep(100)
    }
  }
  return { alreadyOpen: false, attemptsLog, failed: true }
}

/** Wait until the open-audio control is enabled and the app is interactive. */
export async function ensureReadyForSourceLoad(cdp) {
  if (!await waitForOpenControl(cdp)) return false
  // The control can be enabled a tick before the handler is wired; a short settle
  // avoids a swallowed click without entering any measured window.
  await sleep(300)
  return true
}
