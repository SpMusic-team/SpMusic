// OPT-0017 §4 原生输入驱动：真实拖动切歌 + 页内探针 + 产品飞行记录器。
//
// 只做三件事：发真实鼠标事件、读只读探针、开关产品自带的拖拽诊断记录器。
// 不发 Tauri 命令、不改产品状态、不写 DOM 属性（reload 除外，见下）。
//
// 前置：spm-launch.ps1 已启动隔离实例并输出 launch.json；spm-sample.ps1 可同时运行。
//
// 用法：
//   node spm-drive.mjs --cdp http://127.0.0.1:9401 --out runs\A\evidence --protocol window
//   node spm-drive.mjs --cdp ... --protocol smoke --hold 80 --after 110
//
// 退出码：0 = 全部断言通过；1 = 断言失败（证据仍写出）。

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf('--' + name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const cdp = arg('cdp', process.env.SPMUSIC_NATIVE_CDP)
const outDir = resolve(arg('out', 'runs/evidence'))
const protocol = arg('protocol', 'smoke')
const holdMs = Number(arg('hold', process.env.SPMUSIC_MOUSE_FIRST_HOLD_MS || 80))
const afterMs = Number(arg('after', process.env.SPMUSIC_MOUSE_AFTER_MS || 110))
const playwrightPath = process.env.SPMUSIC_PLAYWRIGHT || 'playwright'
assert(cdp, '--cdp or SPMUSIC_NATIVE_CDP is required')
assert(['smoke', 'window', 'regression'].includes(protocol), 'protocol must be smoke|window|regression')

const { chromium } = createRequire(import.meta.url)(playwrightPath)
const probeSource = readFileSync(new URL('./spm-probe.page.js', import.meta.url), 'utf8')

// ---- 协议：每个阶段做什么。时间单位 ms。 -----------------------------------
// window  = §4 的 B0/B1/拖动/恢复四窗口
// smoke   = 只验证链路（3 次拖动）
// regression = §4 T4 反向与回访 + T2 正常切歌
const protocols = {
  smoke: { phases: [{ name: 'warm', kind: 'idle', ms: 3000 }, { name: 'drag', kind: 'drag', rounds: 3, intervalMs: 500 }, { name: 'settle', kind: 'idle', ms: 3000 }] },
  window: {
    phases: [
      { name: 'B0', kind: 'idle', ms: 30000 },
      { name: 'warm', kind: 'drag', rounds: 12, intervalMs: 500 },
      { name: 'B1', kind: 'idle', ms: 30000 },
      { name: 'sweep', kind: 'drag', rounds: 30, intervalMs: Number(arg('sweep-interval', 120)) },
      { name: 'recovery', kind: 'idle', ms: 120000 },
    ],
  },
  regression: {
    phases: [
      { name: 'normal', kind: 'drag', rounds: 20, intervalMs: 500 },
      { name: 'round-trip', kind: 'drag', rounds: 20, intervalMs: 400, pattern: 'round-trip' },
      { name: 'reverse', kind: 'drag', rounds: 10, intervalMs: 300, pattern: 'reverse-mid' },
      { name: 'settle', kind: 'idle', ms: 30000 },
    ],
  },
}

mkdirSync(outDir, { recursive: true })
const gesturesPath = join(outDir, 'gestures.jsonl')
const probePath = join(outDir, 'probe.jsonl')
writeFileSync(gesturesPath, '')
writeFileSync(probePath, '')

const browser = await chromium.connectOverCDP(cdp)
const pages = browser.contexts().flatMap(context => context.pages()).filter(page => page.url().startsWith('http://tauri.localhost/'))
assert.equal(pages.length, 1, 'exactly one native app target')
const page = pages[0]
page.setDefaultTimeout(20000)

const result = {
  protocol, cdp, startedAtUtc: new Date().toISOString(), holdMs, afterMs,
  engine: browser.version(), origin: new URL(page.url()).origin, phases: [], rounds: [], errors: [],
}
page.on('pageerror', error => result.errors.push(error.name))

const probe = async () => page.evaluate(() => window.__spm0017Probe.snapshot())
const currentTrack = async () => page.evaluate(() => {
  const node = document.querySelector('.player-shell')
  let fiber = node ? node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))] : null
  while (fiber?.return) fiber = fiber.return
  const stack = [fiber?.stateNode?.current || fiber]
  while (stack.length) {
    const candidate = stack.pop()
    if (!candidate) continue
    if (candidate.memoizedProps?.viewModel?.playback) return candidate.memoizedProps.viewModel.playback.track?.id ?? null
    if (candidate.sibling) stack.push(candidate.sibling)
    if (candidate.child) stack.push(candidate.child)
  }
  return null
})

let sampleTimer = null
let probeTicks = 0
const startProbeSampling = (phaseName, intervalMs = 250) => {
  stopProbeSampling()
  sampleTimer = setInterval(async () => {
    try {
      const value = await probe()
      appendFileSync(probePath, JSON.stringify({ phase: phaseName, tick: probeTicks++, ...value }) + '\n')
    } catch { /* page busy or reloading; a missed tick is recorded by absence, not faked */ }
  }, intervalMs)
}
const stopProbeSampling = () => { if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null } }

// ---- 一次真实拖动（真实 native 鼠标事件，走 OS 输入栈） --------------------
async function drag({ direction = 1, steady = false, rollback = false, label = '' } = {}) {
  const before = await probe()
  assert(before, 'probe must be installed')
  const box = await page.locator('.cover-input-region').boundingBox()
  assert(box, 'stable native cover input region')
  const x = box.x + box.width * (direction > 0 ? 0.85 : 0.15)
  const y = box.y + box.height * 0.35
  const gestureStarted = Date.now()
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - direction * 32, y)
  await page.waitForTimeout(steady ? 200 : holdMs)
  await page.mouse.move(x - direction * box.width * (rollback ? 0.10 : 0.72), y, { steps: 4 })
  if (rollback) await page.waitForTimeout(180)
  await page.mouse.up()
  const releasedAt = Date.now()
  // 体验门槛（§5.3）：手势结束到正确封面真正呈现的时间
  let readyMs = null
  const deadline = Date.now() + (steady || rollback ? 600 : afterMs + 1500)
  while (Date.now() < deadline) {
    const state = await probe()
    if (state?.layers?.some(layer => layer.phase === 'active' && layer.painted)) { readyMs = Date.now() - releasedAt; break }
    await page.waitForTimeout(15)
  }
  if (steady || rollback) await page.waitForTimeout(600)
  else await page.waitForTimeout(afterMs)
  const after = await probe()
  const track = await currentTrack()
  const round = {
    phase: label, index: result.rounds.length, direction, steady, rollback,
    startedAtUtc: new Date(gestureStarted).toISOString(),
    commitMs: releasedAt - gestureStarted, readyMs,
    changed: before.layers?.[0]?.track !== after?.layers?.[0]?.track,
    activeLayerCount: after?.layers?.length ?? null,
    canvasArea: after?.canvases?.canvasArea ?? null,
    track: track ? 'track-' + String(track).length : null,
  }
  result.rounds.push(round)
  appendFileSync(gesturesPath, JSON.stringify(round) + '\n')
  return round
}

async function dragPhase(phase) {
  const pattern = phase.pattern || 'forward'
  const rounds = []
  for (let index = 0; index < phase.rounds; index += 1) {
    let options = {}
    if (pattern === 'forward') options = { direction: 1 }
    else if (pattern === 'round-trip') options = { direction: index % 2 === 0 ? 1 : -1 }
    else if (pattern === 'reverse-mid') options = index % 4 === 3 ? { direction: -1, rollback: true } : { direction: index % 2 === 0 ? 1 : -1 }
    const round = await drag({ ...options, label: phase.name })
    rounds.push(round)
    await page.waitForTimeout(phase.intervalMs)
  }
  return rounds
}

try {
  // ---- 安装探针（reload 会在页面加载前执行 addInitScript） ------------------
  await page.addInitScript({ content: probeSource })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.cover-input-region').waitFor()
  await page.waitForFunction(() => Boolean(window.__spm0017Probe), null, { timeout: 30000 })
  result.probeInstalled = true

  // ---- 打开产品自带飞行记录器（§4「作业/资源/取消」的事件来源） -------------
  await page.keyboard.press('Control+Shift+Alt+D')
  await page.getByRole('button', { name: '开始记录', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '正在记录' }).waitFor()
  result.recorderStarted = true

  for (const phase of protocols[protocol].phases) {
    const phaseStarted = Date.now()
    startProbeSampling(phase.name, 250)
    const rounds = phase.kind === 'drag' ? await dragPhase(phase) : []
    if (phase.kind === 'idle') await page.waitForTimeout(phase.ms)
    stopProbeSampling()
    result.phases.push({
      name: phase.name, kind: phase.kind, plannedMs: phase.ms ?? null,
      actualMs: Date.now() - phaseStarted, rounds: rounds.length,
      commits: rounds.filter(round => round.changed).length,
      readyMsMedian: rounds.length ? median(rounds.map(round => round.readyMs).filter(value => value != null)) : null,
    })
    console.log('SPM_PHASE', JSON.stringify(result.phases[result.phases.length - 1]))
  }

  // ---- 冻结并保存飞行记录器（走产品自身 IO 路径，不伪造） -------------------
  await page.getByRole('button', { name: '记录故障并保存', exact: true }).click()
  const saved = page.getByLabel('日志已保存，可复制路径')
  await saved.waitFor()
  result.recorderFile = await saved.inputValue()
  await page.getByRole('button', { name: '隐藏拖拽诊断', exact: true }).click().catch(() => {})

  result.commits = result.rounds.filter(round => round.changed).length
  result.possiblePersistentFailure = result.commits === 0
  console.log('SPM_DRIVE_RESULT', JSON.stringify({ protocol, rounds: result.rounds.length, commits: result.commits, probeTicks, errors: result.errors.length }))
} catch (error) {
  result.error = String(error && error.message ? error.message : error)
  console.error('SPM_DRIVE_FAILED', result.error)
  process.exitCode = 1
} finally {
  stopProbeSampling()
  await page.evaluate(() => window.__spm0017Probe?.dispose()).catch(() => {})
  result.finishedAtUtc = new Date().toISOString()
  result.probeTicks = probeTicks
  const target = join(outDir, 'drive.json')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(result, null, 2))
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

// 只断开本诊断客户端，不关闭原生宿主。
process.exit(process.exitCode ?? 0)
