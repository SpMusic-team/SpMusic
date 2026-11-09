// Mutation harness: prove the counting tests actually catch the three defects.
//
// For each defect the original implementation is restored in a temporary copy and
// the test file is run against it. A test suite that still passes against the
// broken code would be worthless, so this script fails if any mutation survives.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRATCH = join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? '.', 'spmusic-coverlane', 'mutation')

const good = readFileSync(join(HERE, 'coverlane-counting.mjs'), 'utf8')
const tests = readFileSync(join(HERE, 'coverlane-counting.test.mjs'), 'utf8')

/** Each mutation restores one original defect. */
const MUTATIONS = [
  {
    id: 'A-attempt-identity-drops-clientId',
    defect: 'different clients using independent lanes collapse into one attempt',
    apply: source => source.replace(
      "  return [lane, kind, clientId ?? '-', generation ?? '-', sourceKey ?? '-', edge ?? '-'].join('\\u0001')",
      "  return [lane, kind, generation ?? '-', sourceKey ?? '-', edge ?? '-'].join('\\u0001')",
    ),
    expectFailures: ['case 2: different clients on independent lanes produce 0 recoveries'],
  },
  {
    id: 'B-folder-source-ignores-root-and-directory',
    defect: 'folder requests produce no source key and are skipped',
    apply: source => source.replace(
      `  if (kind === 'folder') {
    const root = normalizeSource(input.rootPath ?? null)
    const directory = normalizeSource(input.directoryPath ?? null)
    // A folder request without both halves cannot be identified; report it.
    if (!root || !directory) return { kind, sourceKey: null, missing: !root ? 'rootPath' : 'directoryPath' }`,
      `  if (kind === 'folder') {
    const root = null
    const directory = null
    if (!root || !directory) return { kind, sourceKey: null, missing: !root ? 'rootPath' : 'directoryPath' }`,
    ),
    expectFailures: ['defect B: folder identity uses rootPath + directoryPath'],
  },
  {
    id: 'C-fallback-inferred-from-both-lanes',
    defect: 'fallback exposed from "both lanes appeared" instead of explicit recovery events',
    // This restores the shape of the original defect: the CDP cross-check block
    // publishes a `fallbackCount` derived from both-lane coincidence, which is what
    // every report then quoted as "did it fall back".
    apply: source => source.replace(
      `  return {
    crossCheckOnly: true,`,
      `  return {
    crossCheckOnly: false,
    fallbackCount: bothLane.length,`,
    ),
    expectFailures: ['defect C: both lanes on one key is flagged as cross-check only, not as fallback'],
  },
  {
    id: 'C2-ledger-counts-cancellations-as-fallbacks',
    defect: 'a cancelled attempt is treated as a channel failure and counted as a fallback',
    // Inserted after `recoveries` is captured, so it must change the reported count
    // directly: that is exactly what the original defect did.
    apply: source => source.replace(
      '        count: recoveries.length,',
      "        count: recoveries.length + attempts.filter(attempt => attempt.terminal === 'dropped').length,",
    ),
    expectFailures: ['case 7: stale and abort are cancellations, never failures or recoveries'],
  },
]

function runTests(dir) {
  const result = spawnSync(process.execPath, ['--test', join(dir, 'coverlane-counting.test.mjs')], {
    encoding: 'utf8',
    cwd: dir,
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

mkdirSync(SCRATCH, { recursive: true })
writeFileSync(join(SCRATCH, 'coverlane-counting.test.mjs'), tests)

let survived = 0
const rows = []
for (const mutation of MUTATIONS) {
  const mutated = mutation.apply(good)
  if (mutated === good) {
    rows.push({ id: mutation.id, applied: false, killed: false, note: 'mutation did not apply; the anchor changed' })
    survived += 1
    continue
  }
  writeFileSync(join(SCRATCH, 'coverlane-counting.mjs'), mutated)
  const run = runTests(SCRATCH)
  const killed = run.status !== 0
  if (!killed) survived += 1
  const failedNames = [...run.output.matchAll(/^✖ (.+?) \(/gm)].map(match => match[1])
  rows.push({
    id: mutation.id,
    defect: mutation.defect,
    applied: true,
    killed,
    failedTests: [...new Set(failedNames)],
  })
}

// Restore the good implementation so the scratch copy is never left mutated.
writeFileSync(join(SCRATCH, 'coverlane-counting.mjs'), good)
const baselineRun = runTests(SCRATCH)

const report = {
  mutationScore: `${MUTATIONS.length - survived}/${MUTATIONS.length}`,
  allDefectsDetected: survived === 0,
  baselinePasses: baselineRun.status === 0,
  mutations: rows,
  scratch: SCRATCH,
}
console.log(JSON.stringify(report, null, 2))
if (report.baselinePasses && report.allDefectsDetected) {
  rmSync(SCRATCH, { recursive: true, force: true })
}
process.exitCode = report.allDefectsDetected && report.baselinePasses ? 0 : 1
