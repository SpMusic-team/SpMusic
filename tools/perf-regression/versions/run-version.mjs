// Starts one prepared version worktree's own Vite dev server through its own
// `npm run dev`, waits until the origin answers HTTP 200, and can stop cleanly.
// Importable (startVersion) for the measurement harness, or run directly:
//   node run-version.mjs --path <worktree> --port 5301 [--serve-ms 60000] [--browser]
// Nothing outside the worktree is written; no dependency is installed.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'

const sleep = milliseconds => new Promise(accept => setTimeout(accept, milliseconds))

function option(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index < 0 ? fallback : argv[index + 1]
}
const has = name => argv.includes(`--${name}`)

async function waitForHttp(origin, path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = 'no attempt'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin + path, { redirect: 'manual' })
      if (response.status === 200) return { status: response.status, body: await response.text() }
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error.message
    }
    await sleep(150)
  }
  throw new Error(`${origin}${path} never returned 200 within ${timeoutMs}ms (last: ${last})`)
}

// Vite answers the index and main.tsx before its dependency optimizer has
// finished, and during that window a rewritten dep URL returns 504. A harness
// that starts measuring on index-200 alone would record a broken first load, so
// readiness includes one real pre-bundled dep resolving to 200.
async function waitForOptimizer(origin, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = 'no dep url observed'
  while (Date.now() < deadline) {
    try {
      const entry = await (await fetch(origin + '/src/main.tsx')).text()
      const match = entry.match(/["'](\/node_modules\/\.vite\/deps\/[^"'\s]+)["']/)
      if (!match) { last = 'main.tsx referenced no pre-bundled dep yet'; await sleep(200); continue }
      const response = await fetch(origin + match[1])
      if (response.status === 200) return { dep: match[1], attempts: 1 }
      last = `${match[1]} -> HTTP ${response.status}`
    } catch (error) {
      last = error.message
    }
    await sleep(200)
  }
  throw new Error(`Vite dependency optimizer did not settle within ${timeoutMs}ms (last: ${last})`)
}

const NODE_QUERY = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`

function listNodeProcesses() {
  if (process.platform !== 'win32') {
    const result = spawnSync('pgrep', ['-af', 'vite'], { encoding: 'utf8' })
    return (result.stdout || '').trim().split(/\r?\n/).filter(Boolean).map(line => {
      const [pid, ...rest] = line.trim().split(/\s+/)
      return { ProcessId: Number(pid), CommandLine: rest.join(' ') }
    })
  }
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', NODE_QUERY], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`enumerating node processes failed: ${(result.stderr || '').trim()}`)
  const parsed = JSON.parse((result.stdout || '').trim() || '[]')
  return Array.isArray(parsed) ? parsed : [parsed]
}

// A version server is only correct when no process from its worktree survives;
// taskkill alone does not prove that. Matching is by the absolute worktree path
// in the child's command line and never by `--port`, because the caller's own
// argv also carries the port. Self and every ancestor are excluded as well, so a
// runner can never terminate the shell that started it.
function orphansFor(worktree) {
  const marker = resolve(worktree).replace(/\\/g, '/').toLowerCase()
  const safe = ancestorsOf(process.pid)
  return listNodeProcesses().filter(process => {
    if (safe.has(process.ProcessId)) return false
    return (process.CommandLine || '').replace(/\\/g, '/').toLowerCase().includes(marker)
  })
}

function ancestorsOf(pid) {
  const seen = new Set([pid])
  if (process.platform !== 'win32') return seen
  const parents = readProcessParents()
  let current = pid
  while (parents.has(current)) {
    const parent = parents.get(current)
    if (!parent || seen.has(parent)) break
    seen.add(parent)
    current = parent
  }
  return seen
}

function readProcessParents() {
  const query = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return new Map()
  const parsed = JSON.parse((result.stdout || '').trim() || '[]')
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return new Map(rows.map(row => [row.ProcessId, row.ParentProcessId]))
}

function killTree(pid) {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
    return { status: result.status, output: ((result.stdout || '') + (result.stderr || '')).trim() }
  }
  try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
  return { status: 0, output: 'SIGTERM to process group' }
}

export async function startVersion({
  path: worktree,
  port,
  readyTimeoutMs = 120_000,
  serveMs = 0,
  browser = false,
  playwrightModule = null,
  quiet = false,
  // hold: keep the server running and hand the caller `stop()`, which is what a
  // measurement harness needs. Without it the server is stopped before return.
  hold = false,
} = {}) {
  if (!worktree) throw new Error('startVersion requires { path }')
  if (!port) throw new Error('startVersion requires { port }')
  // Relative paths resolve against the caller's cwd once, so the same absolute
  // path is used for spawning and for the orphan check.
  worktree = resolve(worktree)

  const packageJson = JSON.parse(readFileSync(join(worktree, 'package.json'), 'utf8'))
  if (!packageJson.scripts?.dev) throw new Error(`${worktree}/package.json has no dev script`)
  // The repo's vite.config.ts pins server.strictPort, so a busy port is fatal
  // rather than silently reassigned; fail early with the actual reason.
  const listening = await fetch(`http://127.0.0.1:${port}/`).then(response => response.status, () => null)
  if (listening !== null) throw new Error(`port ${port} is already serving HTTP ${listening}; pick a free port`)

  let log = ''
  // cmd /d /s /c keeps the literal `npm run dev -- --host 127.0.0.1 --port N`
  // invocation while still giving one root process to kill with /T.
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm'
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run dev -- --host 127.0.0.1 --port ${port}`]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)]
  const child = spawn(command, commandArgs, {
    cwd: worktree,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none' },
  })
  child.stdout.on('data', chunk => { log += chunk })
  child.stderr.on('data', chunk => { log += chunk })
  const exited = new Promise(accept => child.once('exit', code => accept(code)))

  const origin = `http://127.0.0.1:${port}`
  const result = { path: worktree, port, origin, pid: child.pid, started: false, html: null, mainTsx: null, optimizer: null, browser: null, log: '', stopped: null, orphans: [] }
  let stopRequested = false
  const stop = async () => {
    if (stopRequested) return result
    stopRequested = true
    if (child.exitCode === null) killTree(child.pid)
    await Promise.race([exited, sleep(10_000)])
    if (child.exitCode === null) killTree(child.pid)
    await sleep(400)
    // Anything still running out of this worktree is an orphan, not progress.
    result.orphans = orphansFor(worktree)
    for (const orphan of result.orphans) killTree(orphan.ProcessId)
    if (result.orphans.length) { await sleep(300); result.orphans = orphansFor(worktree) }
    result.stopped = { exitCode: child.exitCode, remainingOrphans: result.orphans, cleaned: result.orphans.length === 0 }
    result.log = log
    return result
  }

  try {
    if (!quiet) process.stderr.write(`[run-version] ${worktree} -> ${origin}\n`)
    const index = await waitForHttp(origin, '/', readyTimeoutMs)
    result.started = true
    result.html = index.body
    // /src/main.tsx proves the Vite transform pipeline is live, not just the
    // static index; a version whose entry fails to transform answers non-200.
    const main = await waitForHttp(origin, '/src/main.tsx', 60_000)
    result.mainTsx = { status: main.status, bytes: main.body.length, hasCreateRoot: main.body.includes('createRoot') }
    result.optimizer = await waitForOptimizer(origin, 120_000)

    if (browser) {
      // Playwright is not a repo dependency, so it is resolved from an external
      // package directory (its own node_modules) rather than added to package.json.
      const moduleName = playwrightModule || process.env.SPMUSIC_PLAYWRIGHT || 'playwright'
      let chromium
      if (moduleName !== 'playwright' && !/\.[cm]?js$/.test(moduleName)) {
        const { createRequire } = await import('node:module')
        const requireFrom = createRequire(join(resolve(moduleName), 'index.cjs'))
        ;({ chromium } = requireFrom('playwright'))
      } else {
        ;({ chromium } = await import(pathToFileURL(moduleName).href).catch(() => import(moduleName)))
      }
      const launched = await chromium.launch({ headless: true, channel: process.env.SPMUSIC_BROWSER_CHANNEL || 'msedge' })
      const page = await launched.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
      const pageErrors = []
      const consoleErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      await page.goto(origin + '/', { waitUntil: 'load' })
      // One animation frame plus a short settle covers module-eval failures that
      // only surface after the first render commits.
      await page.waitForTimeout(1500)
      result.browser = await page.evaluate(() => ({
        rootChildren: document.getElementById('root')?.children.length ?? 0,
        playerShell: Boolean(document.querySelector('.player-shell')),
        title: document.title,
        bodyBytes: document.body.innerHTML.length,
      }))
      result.browser.pageErrors = pageErrors
      result.browser.consoleErrors = consoleErrors
      await launched.close()
    }

    if (serveMs > 0) {
      if (!quiet) process.stderr.write(`[run-version] serving ${origin} for ${serveMs}ms\n`)
      await sleep(serveMs)
    }
  } catch (error) {
    // A failed start must never leave a half-ready server behind.
    await stop()
    throw error
  }
  if (hold) return { ...result, stop }
  await stop()
  return result
}

if (import.meta.url === pathToFileURL(argv[1]).href) {
  const path = option('path', argv[2] && !argv[2].startsWith('--') ? argv[2] : null)
  const port = Number(option('port', argv[3] && !argv[3].startsWith('--') ? argv[3] : 0))
  if (!path || !port) {
    process.stderr.write('Usage: node tools/perf-regression/versions/run-version.mjs --path <worktree> --port <port> [--serve-ms <ms>] [--browser]\n')
    process.exit(2)
  }
  const result = await startVersion({
    path,
    port,
    serveMs: Number(option('serve-ms', 0)),
    readyTimeoutMs: Number(option('ready-timeout', 120_000)),
    browser: has('browser'),
    quiet: false,
  })
  const report = {
    ...result,
    // The full server log is noisy; a caller that needs it can ask for it.
    log: has('log') ? result.log : result.log.split(/\r?\n/).filter(line => line.trim()).slice(-12),
  }
  console.log(JSON.stringify(report, null, 2))
  if (!result.browser?.playerShell && result.browser) process.exitCode = 1
}
