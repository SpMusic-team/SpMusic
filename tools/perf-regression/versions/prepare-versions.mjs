// Prepares throwaway git worktrees for the historical frontend versions so the
// same measurement harness can run against each version's own Vite dev server.
// The main worktree is never modified: only `git worktree add`, one junction per
// worktree, and files under the worktree root are touched.
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
// Version worktrees MUST live OUTSIDE the repository. A nested checkout brings
// its own tsconfig.json, and the repo-wide `eslint .` then fails with
// "multiple candidate TSConfigRootDirs: ...". This was hit for real: worktrees
// under .codex-tmp-folder-ui-dist/perf-versions made `npm run lint` fail with
// 1157 parsing errors. Default to a sibling directory of the repo instead.
const defaultWorktreeRoot = join(dirname(repoRoot), `${basename(repoRoot)}-perf-versions`)

// V5 is the archived local working tree. It was committed as a merge commit, so
// it still has an ordinary worktree-able tree; git checks it out like any other
// commit. Its snapshot also contains build output under .codex-tmp-folder-ui-dist.
export const VERSIONS = [
  { id: 'V1', ref: '8f45750', note: '2026-10-25 feat(player): add audio visualization modes' },
  { id: 'V2', ref: '6a7da1b', note: '2026-10-28 feat(player): 完善歌曲多选与播放列表管理' },
  { id: 'V3', ref: '9e8d41c', note: '2026-10-30 feat(player): 添加媒体库搜索与最近记录' },
  { id: 'V4', ref: 'ce65f67', note: '2026-10-30 feat(player): 完善长音轨分类与媒体库交互 (clean HEAD)' },
  { id: 'V5', ref: 'archive/local-working-tree-2026-11-02', note: '2026-11-02 archive: local working tree snapshot (merge commit, worktree-able)' },
]

const args = process.argv.slice(2)
const flag = name => args.includes(`--${name}`)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? fallback : args[index + 1]
}
const only = option('only', null)
const worktreeRoot = resolve(option('root', defaultWorktreeRoot))
const linkNodeModules = !flag('no-node-modules')
const sharedNodeModules = resolve(repoRoot, 'node_modules')
const selected = only ? VERSIONS.filter(version => only.split(',').map(value => value.trim()).includes(version.id)) : VERSIONS
if (!selected.length) throw new Error(`--only ${only} matched no version; known ids: ${VERSIONS.map(version => version.id).join(', ')}`)

const git = (gitArgs, options = {}) => {
  const result = spawnSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
  return result.stdout.trim()
}
// Windows paths are case-insensitive and git prints forward slashes.
const normalize = path => resolve(path).replace(/\\/g, '/').replace(/^\/\?\//, '').toLowerCase()

function registeredWorktrees() {
  const blocks = git(['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/)
  const entries = new Map()
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean)
    const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
    if (!path) continue
    entries.set(normalize(path), { path: resolve(path), head: lines.find(line => line.startsWith('HEAD '))?.slice(5) ?? null })
  }
  return entries
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

// A version only needs its own dependency set when its package.json differs from
// the main worktree's; sharing one node_modules would then silently mis-resolve.
function packageDiff(worktree) {
  const main = readJson(join(repoRoot, 'package.json'))
  const other = readJson(join(worktree, 'package.json'))
  if (!main || !other) return { readable: false, matchesMain: false, differences: [] }
  const differences = []
  for (const field of ['dependencies', 'devDependencies', 'scripts']) {
    const left = main[field] ?? {}
    const right = other[field] ?? {}
    for (const name of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      if (left[name] === right[name]) continue
      differences.push({ field, name, main: left[name] ?? null, version: right[name] ?? null })
    }
  }
  return { readable: true, matchesMain: differences.every(entry => entry.field === 'scripts'), differences }
}

function ensureNodeModules(worktree) {
  const link = join(worktree, 'node_modules')
  if (!linkNodeModules) return { state: 'skipped' }
  const target = sharedNodeModules
  let existing = null
  try { existing = lstatSync(link) } catch { existing = null }
  if (existing) {
    if (existing.isSymbolicLink()) {
      const current = resolve(readlinkSync(link).replace(/^\/\?\/|^\\\\\?\\/, ''))
      if (normalize(current) === normalize(target)) return { state: 'junction-reused', target }
      unlinkSync(link)
    } else {
      // A real directory means someone ran npm install here; never delete it.
      return { state: 'existing-directory', target: null }
    }
  }
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  return { state: 'junction-created', target }
}

mkdirSync(worktreeRoot, { recursive: true })
const registry = registeredWorktrees()
const manifest = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  worktreeRoot,
  sharedNodeModules: linkNodeModules ? sharedNodeModules : null,
  mainHead: git(['rev-parse', 'HEAD']),
  mainBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  mainStatusDirtyFiles: git(['status', '--porcelain']).split(/\r?\n/).filter(Boolean).length,
  versions: [],
}

for (const version of selected) {
  const commit = git(['rev-parse', `${version.ref}^{commit}`])
  const path = join(worktreeRoot, version.id)
  const entry = { id: version.id, ref: version.ref, commit, note: version.note, path }
  const registered = registry.get(normalize(path))
  if (existsSync(path)) {
    if (!registered) throw new Error(`${path} exists but is not a registered git worktree; remove it or pick another --root`)
    const current = git(['-C', path, 'rev-parse', 'HEAD'])
    if (current === commit) entry.action = 'reused'
    else {
      // Re-pointing only ever moves this detached worktree, never the main one.
      git(['-C', path, 'checkout', '--detach', commit])
      entry.action = 'repinned'
      entry.previousCommit = current
    }
  } else {
    if (registered) git(['worktree', 'prune'])
    // --detach keeps every version off a branch, so no ref can be moved.
    const added = spawnSync('git', ['worktree', 'add', '--detach', path, commit], { cwd: repoRoot, encoding: 'utf8' })
    if (added.status !== 0) throw new Error(`git worktree add ${path} failed: ${(added.stderr || added.stdout || '').trim()}`)
    entry.action = 'created'
  }
  const resolvedHead = git(['-C', path, 'rev-parse', 'HEAD'])
  if (resolvedHead !== commit) throw new Error(`${path} HEAD ${resolvedHead} != ${commit}`)
  entry.head = resolvedHead
  entry.nodeModules = ensureNodeModules(path)
  entry.nodeModules.viteResolved = existsSync(join(path, 'node_modules', 'vite', 'bin', 'vite.js'))
  entry.nodeModules.viteVersion = readJson(join(path, 'node_modules', 'vite', 'package.json'))?.version ?? null
  entry.packageJson = packageDiff(path)
  manifest.versions.push(entry)
}

const manifestPath = join(worktreeRoot, 'manifest.json')
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
manifest.manifestPath = manifestPath
console.log(JSON.stringify(manifest, null, 2))
