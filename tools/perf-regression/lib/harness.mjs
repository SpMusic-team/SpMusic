// Shared harness primitives: dev-server lifecycle, browser launch, origin
// verification, and the two measurements the task asks for.
//
// Design notes that matter for correctness:
//
// * Every worktree gets its OWN dev server on its OWN free port. Nothing is
//   shared between versions, so a stale module graph from one revision can
//   never leak into another's numbers.
//
// * Origin is verified, not assumed. Vite emits `var _jsxFileName = "<abs>"` in
//   JSX modules, so the served module itself states which filesystem tree it
//   came from. We require that to match the intended worktree, and we also
//   report git HEAD. This is what stops a `--config` mistake from silently
//   measuring the wrong revision.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------
export function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

export async function pickFreePort(start = 47011) {
  for (let port = start; port < start + 200; port += 1) {
    if (await isPortFree(port)) return port
  }
  throw new Error('no free port in range starting at ' + start)
}

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------
export function gitHead(worktreePath) {
  try {
    return execFileSync('git', ['-C', worktreePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

export function gitSubject(worktreePath) {
  try {
    return execFileSync('git', ['-C', worktreePath, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

export function gitIsDirty(worktreePath) {
  try {
    const out = execFileSync('git', ['-C', worktreePath, 'status', '--porcelain'], { encoding: 'utf8' })
    return out.trim().length > 0
  } catch {
    return null
  }
}

/**
 * Start a Vite dev server for one worktree.
 *
 * `perfConfigPath` (the main worktree's tools/perf-regression/vite.perf.config.mts)
 * is used ONLY when the worktree has no usable config of its own. It exists to
 * add watch exclusions, and its `root` is `process.cwd()`, which we set to the
 * worktree via `cwd`. `--configLoader runner` avoids the config-bundling temp
 * dir whose watcher throws EBUSY and kills the server.
 */
export async function startDevServer({ worktreePath, perfConfigPath, log }) {
  const port = await pickFreePort()
  const origin = `http://127.0.0.1:${port}`
  const ownConfig = existsSync(path.join(worktreePath, 'vite.config.ts'))
  // Run Vite from the worktree's own node_modules (the build dependency is
  // shared via junction), invoking the JS entry directly rather than through
  // `npx`: no shell, no argument re-quoting, and no npm deprecation noise on
  // stderr that would otherwise be confused with a real failure.
  const viteBin = ['node_modules', 'vite', 'bin', 'vite.js']
  const viteEntry = path.join(worktreePath, ...viteBin)
  if (!existsSync(viteEntry)) throw new Error('vite not installed in ' + worktreePath)
  const args = ownConfig
    ? [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    : [viteEntry, '--configLoader', 'runner', '--config', perfConfigPath, '--port', String(port), '--strictPort']

  const child = spawn(process.execPath, args, {
    cwd: worktreePath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none', NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  const output = []
  let exited = null
  child.stdout.on('data', chunk => output.push(String(chunk)))
  child.stderr.on('data', chunk => output.push(String(chunk)))
  child.on('exit', code => { exited = code })

  const stop = () => new Promise(resolve => {
    if (exited !== null) return resolve()
    try {
      // Kill the whole process tree: Vite spawns workers for optimization.
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
          .on('exit', () => resolve())
      } else {
        child.kill('SIGTERM')
        setTimeout(() => { try { child.kill('SIGKILL') } catch {} resolve() }, 2000)
      }
    } catch { resolve() }
  })

  // Wait for readiness, then require it to STAY up: the EBUSY watcher crash
  // happens ~0.5s after "ready", so a single successful probe is not enough.
  //
  // Readiness is proven by a first SUCCESSFUL TRANSFORM of /src/main.tsx, not by
  // "/" returning 200. "/" is a static file and answers instantly, while Vite
  // may still be scanning and bundling dependencies; a transform requested
  // during that window blocks for many seconds and looks like a hang. Retrying
  // the transform with a generous per-attempt timeout removes that race.
  const deadline = Date.now() + 180_000
  let transformed = false
  let lastError = null
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`dev server exited (code ${exited}) for ${worktreePath}\n${output.join('').slice(-4000)}`)
    }
    try {
      const response = await fetch(origin + '/src/main.tsx', { signal: AbortSignal.timeout(45_000) })
      if (response.ok) {
        const body = await response.text()
        if (body.includes('createRoot') || body.length > 200) { transformed = true; break }
      }
      lastError = `main.tsx responded ${response.status}`
    } catch (error) {
      lastError = String(error && error.message ? error.message : error)
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!transformed) {
    await stop()
    throw new Error(`dev server never transformed /src/main.tsx for ${worktreePath} (last: ${lastError})\n${output.join('').slice(-4000)}`)
  }
  // Confirm the process survived dependency optimization.
  await new Promise(resolve => setTimeout(resolve, 3000))
  if (exited !== null) {
    throw new Error(`dev server died after readiness for ${worktreePath}\n${output.join('').slice(-4000)}`)
  }
  log?.(`dev server ready ${origin} (ownConfig=${ownConfig})`)
  return { origin, port, stop, output, config: ownConfig ? 'worktree' : 'perf-override' }
}

/**
 * Verify the served module graph really comes from `worktreePath`.
 * Vite stamps `var _jsxFileName = "<abs path>"` into JSX modules, so the served
 * bytes name their own source tree.
 */
export async function verifyOrigin({ origin, worktreePath, log }) {
  const response = await fetch(origin + '/src/features/player/components/PlayerShell.tsx', { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error('cannot fetch PlayerShell.tsx from ' + origin)
  const served = await response.text()
  const match = served.match(/_jsxFileName\s*=\s*"([^"]+)"/)
  if (!match) throw new Error('served PlayerShell.tsx has no _jsxFileName stamp; cannot verify origin')
  const servedFile = match[1].replace(/\\/g, '/')
  const expected = path.join(worktreePath, 'src/features/player/components/PlayerShell.tsx').replace(/\\/g, '/')
  const ok = servedFile.toLowerCase() === expected.toLowerCase()
  log?.(`origin check ${ok ? 'OK' : 'MISMATCH'}: served=${servedFile}`)
  return { ok, servedFile, expectedFile: expected, servedLength: served.length }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
/**
 * Launch Edge.
 *
 * `channel: 'msedge'` is deliberately NOT used: Playwright resolves the channel
 * to `%ProgramFiles%\Microsoft\Edge\...`, but on this machine Edge is installed
 * under `Program Files (x86)`, so the channel launch fails with
 *   "Chromium distribution 'msedge' is not found at undefined\Program Files\..."
 * Passing `executablePath` explicitly is the only reliable route here.
 */
export const DEFAULT_BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

export function resolveBrowserExecutable(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error('SPMUSIC_BROWSER_EXECUTABLE not found: ' + explicit)
    return explicit
  }
  for (const candidate of DEFAULT_BROWSER_CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error('no Edge binary found; set SPMUSIC_BROWSER_EXECUTABLE')
}

/**
 * Load the externally-installed Playwright package.
 *
 * The project has no Playwright dependency and must not gain one, so the
 * package is supplied out of band via SPMUSIC_PLAYWRIGHT (an absolute
 * directory). `createRequire` anchored inside that directory lets a plain ESM
 * file load that CommonJS package without touching the project's module graph.
 */
export function loadPlaywright() {
  const packagePath = process.env.SPMUSIC_PLAYWRIGHT
  if (!packagePath) throw new Error('set SPMUSIC_PLAYWRIGHT to an installed Playwright package directory')
  if (!existsSync(packagePath)) throw new Error('SPMUSIC_PLAYWRIGHT does not exist: ' + packagePath)
  const require = createRequire(path.join(packagePath, 'harness-anchor.cjs'))
  return require(packagePath)
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
export function summarize(values) {
  const present = values.filter(value => typeof value === 'number' && Number.isFinite(value))
  if (!present.length) return { n: 0, min: null, median: null, mean: null, max: null }
  const sorted = [...present].sort((a, b) => a - b)
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  return {
    n: sorted.length,
    min: sorted[0],
    median,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    max: sorted[sorted.length - 1],
  }
}

/** Stable hash of a set of strings, so two scenarios can be proven comparable. */
export function hashSet(values) {
  const unique = [...new Set(values)].sort()
  let hash = 0x811c9dc5
  const text = unique.join('\n')
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return { size: unique.length, fnv1a32: hash.toString(16).padStart(8, '0') }
}

/** Read the appended JSON written by --out for cross-process use. */
export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}
