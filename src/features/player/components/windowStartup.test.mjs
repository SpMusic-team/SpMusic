// Run with node --test src/features/player/components/windowStartup.test.mjs.
// Execute the production readiness effect, without installing a browser or
// duplicating its retry/cancellation implementation in this test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('./PlayerSurface.tsx', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('PlayerSurface.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const effects = []
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect'
    && node.arguments[0]?.getText(parsed).includes("'window_show_when_ready'")) {
    effects.push(node.arguments[0].getText(parsed))
  }
  ts.forEachChild(node, visit)
}
visit(parsed)
assert.equal(effects.length, 1, 'one production effect owns the startup readiness command')
const effectScript = ts.transpileModule(`globalThis.effect = ${effects[0]}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

function harness({ ready = true, tauri = true, failure = false, invoke: customInvoke } = {}) {
  const calls = [], timers = [], errors = []
  const context = vm.createContext({
    firstSurfaceReady: ready,
    startupWindowShownRef: { current: false },
    isTauri: () => tauri,
    invoke: (...args) => {
      calls.push(args)
      return customInvoke ? customInvoke(...args)
        : failure ? Promise.reject(new Error('native reveal failed')) : Promise.resolve()
    },
    window: { setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length } },
    console: { error: (...args) => errors.push(args) },
  })
  vm.runInContext(effectScript, context)
  return { context, calls, timers, errors, run: () => context.effect() }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('pending surface and ordinary browser never reveal a native window', async () => {
  for (const options of [{ ready: false }, { tauri: false }]) {
    const h = harness(options)
    h.run()
    await settle()
    assert.equal(h.calls.length, 0)
    assert.equal(h.timers.length, 0)
    assert.equal(h.context.startupWindowShownRef.current, false)
  }
})

test('ready surface uses the registered no-argument handshake once per active effect', async () => {
  const h = harness()
  const cleanup = h.run()
  await settle()
  h.run()
  assert.deepEqual(h.calls, [['window_show_when_ready']])
  assert.equal(h.timers.length, 0, 'success does not add arbitrary startup delays')
  cleanup()
  assert.equal(h.context.startupWindowShownRef.current, false)
})

test('cleanup prevents a failed in-flight command from retrying after unmount', async () => {
  let reject
  const h = harness({ invoke: () => new Promise((_, fail) => { reject = fail }) })
  const cleanup = h.run()
  cleanup()
  reject(new Error('native failure after unmount'))
  await settle()
  // An already-scheduled retry delay may settle, but must not invoke again.
  for (const timer of h.timers) timer.callback()
  await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.errors.length, 0)
})

test('native failures exhaust the existing bounded retry and remain observable', async () => {
  const h = harness({ failure: true })
  h.run()
  await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.timers.length, 1)
  h.timers[0].callback()
  await settle()
  assert.equal(h.calls.length, 2)
  assert.equal(h.timers.length, 2)
  h.timers[1].callback()
  await settle()
  assert.equal(h.calls.length, 3)
  assert.equal(h.timers.length, 2)
  assert.equal(h.errors.length, 1, 'final native error must not be swallowed')
})

test('startup error surface also reaches the readiness gate', () => {
  const readyDeclaration = []
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'firstSurfaceReady') {
      readyDeclaration.push(node.initializer.getText(parsed))
    }
    ts.forEachChild(node, find)
  }
  find(parsed)
  assert.equal(readyDeclaration.length, 1)
  const ready = vm.runInNewContext(readyDeclaration[0], {
    startupSurfaceSettled: false, startupReady: true, startupError: true,
    currentArtworkReady: false, startupArtworkTimedOut: false,
  })
  assert.equal(ready, true, 'error UI can be shown without waiting for unavailable artwork')
})

test('native setup remains hidden and registers the readiness command', () => {
  const backend = readFileSync(new URL('../../../../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  const windowState = readFileSync(new URL('../../../../src-tauri/src/window_state.rs', import.meta.url), 'utf8')
  const config = JSON.parse(readFileSync(new URL('../../../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
  assert.equal(config.app.windows[0].visible, false)
  assert.match(backend, /fn window_show_when_ready\([\s\S]*?\) -> Result<\(\), String>/)
  assert.match(backend, /generate_handler!\[[\s\S]*?window_show_when_ready,/)
  const setup = backend.slice(backend.indexOf('.setup(|app|'), backend.indexOf('.build(tauri::generate_context!())'))
  assert(setup.length > 0)
  assert.doesNotMatch(setup, /\.maximize\(|\.set_fullscreen\(|\.show\(/, 'no visibility-changing operation before frontend readiness')
  assert.match(setup, /StartupWindowReveal::new\(restore_mode\)/)
  assert.match(windowState, /window\.label\(\) != "main"/, 'other windows cannot reveal main')
  assert.doesNotMatch(source, /getCurrentWindow\(\)\.show\(/, 'frontend cannot bypass pending restored modes')
})
