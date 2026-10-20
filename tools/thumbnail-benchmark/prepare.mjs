import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const [revision, destination] = process.argv.slice(2)
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
const probe = readFileSync(join(here, 'probe.rs'))
writeFileSync(sourceFile, Buffer.concat([source, Buffer.from('\n'), probe]))
copyFileSync(join(here, 'probe.rs'), join(root, 'probe.rs'))
const hash = data => createHash('sha256').update(data).digest('hex')
writeFileSync(join(root, 'identity.json'), JSON.stringify({
  revision: sha, originalCoverSha256: hash(source), harnessSha256: hash(probe),
  injectedCoverSha256: hash(readFileSync(sourceFile)),
  isolation: 'AppPaths never invoked; every measured call receives a new explicit cache root',
}, null, 2))
console.log(JSON.stringify({ root, revision: sha, manifest: join(root, 'src-tauri/Cargo.toml') }))
