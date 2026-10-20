import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const [baselineExe, candidateExe, corpusArg, outputArg] = process.argv.slice(2)
if (!outputArg) throw new Error('Usage: node run-pairs.mjs <baseline-test.exe> <candidate-test.exe> <frozen-corpus> <new-output-root>')
const corpus = resolve(corpusArg)
const output = resolve(outputArg)
if (existsSync(output)) throw new Error('Output root must not exist')
mkdirSync(output, { recursive: true })
const manifest = JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8'))
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
writeFileSync(join(output, 'identity.json'), JSON.stringify({
  baselineExeSha256: sha(baselineExe), candidateExeSha256: sha(candidateExe),
  corpusDigest: manifest.digest, count: manifest.count, pairs: 5,
  cache: 'new app cache per arm/process; OS cache uncontrolled',
}, null, 2))

async function run(exe, pair, arm) {
  const name = `${pair}-${arm}`
  let stdout = '', stderr = ''
  const result = await new Promise((accept, reject) => {
    const child = spawn(exe, ['audio::cover_pixels::thumbnail_comparison::measure_corpus', '--ignored', '--exact', '--nocapture', '--test-threads=1'], {
      env: { ...process.env, RUST_LOG: 'off', THUMB_BENCH_CORPUS: corpus, THUMB_BENCH_DIGEST: manifest.digest, THUMB_BENCH_ROOT: join(output, `${name}-cache`) },
      windowsHide: true,
    })
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('exit', code => accept(code))
  })
  writeFileSync(join(output, `${name}.log`), stdout + stderr)
  if (result !== 0) throw new Error(`${name} exited ${result}; see its log`)
  const rows = [...stdout.matchAll(/THUMBJSON (\{[^\r\n]+\})/g)].map(match => ({ pair, arm, ...JSON.parse(match[1]) }))
  if (rows.length !== 9) throw new Error(`${name} expected 9 phase rows, got ${rows.length}`)
  console.log(JSON.stringify({ pair, arm, phases: rows.filter(row => row.elapsed_ms).map(row => ({ phase: row.phase, ms: row.elapsed_ms })) }))
  return rows
}
const results = []
for (let pair = 1; pair <= 5; pair++) {
  for (const arm of pair % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) {
    results.push(...await run(arm === 'baseline' ? baselineExe : candidateExe, pair, arm))
    writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2))
  }
}
const phases = [...new Set(results.filter(row => row.elapsed_ms).map(row => row.phase))]
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const summary = phases.map(phase => {
  const a = results.filter(row => row.phase === phase && row.arm === 'baseline')
  const b = results.filter(row => row.phase === phase && row.arm === 'candidate')
  const pairs = a.map(row => ({ pair: row.pair, baseline_ms: row.elapsed_ms, candidate_ms: b.find(other => other.pair === row.pair).elapsed_ms }))
  return { phase, baselineMedianMs: median(a.map(row => row.elapsed_ms)), candidateMedianMs: median(b.map(row => row.elapsed_ms)),
    pairedReductionMedianPercent: median(pairs.map(row => 100 * (1 - row.candidate_ms / row.baseline_ms))),
    candidateFasterPairs: pairs.filter(row => row.candidate_ms < row.baseline_ms).length, pairs }
})
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary))
