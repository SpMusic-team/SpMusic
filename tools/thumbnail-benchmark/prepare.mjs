import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const [revision, destination, adapter = 'hydrate', buildMode] = process.argv.slice(2)
if (!revision || !destination) throw new Error('Usage: node prepare.mjs <git-revision> <new-absolute-temp-root>')
const root = resolve(destination)
if (existsSync(root)) throw new Error('Destination must not exist')
const run = (exe, args, options = {}) => {
  const result = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.status !== 0) throw new Error(`${exe} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}
const sha = run('git', ['rev-parse', `${revision}^{commit}`]).trim()
mkdirSync(root, { recursive: true })
const archive = join(root, 'source.tar')
run('git', ['archive', '--format=tar', `--output=${archive}`, sha, 'src-tauri'])
run('tar', ['-xf', archive, '-C', root])
const here = dirname(fileURLToPath(import.meta.url))
const sourceFile = join(root, 'src-tauri/src/audio/cover_pixels.rs')
const source = readFileSync(sourceFile)
let probe = readFileSync(join(here, 'probe.rs'), 'utf8')
if (adapter === 'cover-only') {
  probe = probe.replace(/\/\/ BEGIN SOURCE ADAPTER[\s\S]+?\/\/ END SOURCE ADAPTER/, `// BEGIN SOURCE ADAPTER
        super::super::playlist_cover::probe_playlist_cover(root,
            super::super::types::AudioLoadFileInput { path: source.to_string_lossy().into_owned() })
            .await.expect("cover-only source").cover_art.and_then(|cover| cover.file_path)
        // END SOURCE ADAPTER`)
} else if (adapter !== 'hydrate') throw new Error('adapter must be hydrate or cover-only')
probe = Buffer.from(probe)
writeFileSync(sourceFile, Buffer.concat([source, Buffer.from('\n'), probe]))
writeFileSync(join(root, 'probe.rs'), probe)
const hash = data => createHash('sha256').update(data).digest('hex')
let frozenBuild
if (buildMode === 'build') {
  const compilation = spawnSync('cargo', ['test', '--manifest-path', join(root, 'src-tauri/Cargo.toml'), '--release', '--lib', '--no-run', '--message-format=json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  writeFileSync(join(root, 'build.jsonl'), compilation.stdout || '')
  writeFileSync(join(root, 'build.stderr.log'), compilation.stderr || '')
  if (compilation.status !== 0) throw new Error(compilation.stderr || 'Cargo compilation failed')
  const artifacts = compilation.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)).filter(row => row.reason === 'compiler-artifact' && row.profile.test && row.executable)
  if (artifacts.length !== 1) throw new Error('Expected exactly one test executable')
  const destinationExe = join(root, 'test.exe')
  // Freeze immediately, before another cargo invocation can replace shared target outputs.
  copyFileSync(artifacts[0].executable, destinationExe)
  const testList = run(destinationExe, ['--list'])
  writeFileSync(join(root, 'test-list.txt'), testList)
  if (!testList.includes('thumbnail_comparison::diagnose_reads:') || !testList.includes('thumbnail_comparison::measure_corpus:')) throw new Error('Frozen executable does not contain the snapshot harness')
  if (testList.includes('audio::playlist_cover::tests::') !== existsSync(join(root, 'src-tauri/src/audio/playlist_cover.rs'))) throw new Error('Frozen executable does not match source modules')
  frozenBuild = { executableSha256: hash(readFileSync(destinationExe)), testListSha256: hash(testList) }
} else if (buildMode) throw new Error('Fourth argument must be build when present')
writeFileSync(join(root, 'identity.json'), JSON.stringify({
  revision: sha, adapter, originalCoverSha256: hash(source), harnessSha256: hash(probe),
  injectedCoverSha256: hash(readFileSync(sourceFile)),
  ...frozenBuild,
  isolation: 'AppPaths never invoked; every measured call receives a new explicit cache root',
}, null, 2))
console.log(JSON.stringify({ root, revision: sha, manifest: join(root, 'src-tauri/Cargo.toml') }))
