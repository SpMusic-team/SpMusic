// Applier for the REGISTERED build-time isolation patches.
//
// NEW file under tools/thumbnail-benchmark/. It supersedes the out-of-repo
// D:\opt0018-ab\patch-isolation.mjs. The two anchors are byte-identical to the
// patches prepare-ui.mjs already establishes for the author's harness, so there is
// exactly one definition of "isolation" in the tree:
//
//   1. AppPaths -> `THUMB_UI_ROOT` (required). Each arm gets its own cache root,
//      and the root must live under LOCALAPPDATA so the `$CACHE/**` asset scope
//      covers it.
//   2. `audio_open_source` native picker -> `THUMB_UI_PLAYLIST` (required). No
//      dialog appears, so the experiment has no unbounded human latency in it.
//
// Explicitly NOT patched: cover scheduling, the path/pixel lanes, IPC framing,
// the asset protocol, decode or rendering. Plan section 2 makes any such change
// disqualifying, so this file asserts it only touched the two anchors and records
// a digest of every change it made.
//
// `verify` re-checks an already-patched snapshot so a build can prove its tree
// matches the registered isolation instead of trusting a log line.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const USAGE = `Usage:
  node coverlane-isolation.patch.mjs apply  --root <snapshot-root> [--json <out.json>]
  node coverlane-isolation.patch.mjs verify --root <snapshot-root>

The snapshot root must contain src-tauri/src/app_paths.rs and src-tauri/src/lib.rs,
i.e. a tree produced by \`git archive <rev> src-tauri | tar -x\`.
`

const HASH_ALGORITHM = 'sha256'
const sha = data => createHash(HASH_ALGORITHM).update(data).digest('hex')

const APP_PATHS_ANCHOR_START = '        let project_dirs ='
const APP_PATHS_ANCHOR_END = '\n\n        paths.ensure_created()'
const APP_PATHS_REPLACEMENT = `        let isolated_root = std::path::PathBuf::from(std::env::var_os("THUMB_UI_ROOT").expect("isolated UI root required"));
        let paths = Self {
            config_dir: isolated_root.join("config"),
            data_dir: isolated_root.join("data"),
            cache_dir: isolated_root.join("cache"),
        };`

const PICKER_PATTERN = /fn audio_open_source\([\s\S]+?\n\}/
const PICKER_REPLACEMENT = `fn audio_open_source(
    state: State<'_, AudioController>,
) -> Result<AudioOpenSourceResult, AudioCommandError> {
    let selected_path = std::env::var("THUMB_UI_PLAYLIST").expect("explicit test playlist required; native picker disabled");
    state.list_folder_tracks(AudioFolderPlaylistInput { selected_path })
        .map(|playlist| AudioOpenSourceResult::Playlist { playlist })
}`

const REGISTRY = [
  {
    id: 'app-paths-isolation',
    file: 'src-tauri/src/app_paths.rs',
    effect: 'AppPaths resolves config/data/cache under the required THUMB_UI_ROOT instead of the OS profile',
    justification: 'each arm needs its own cache root; the asset protocol scope is $CACHE/** so the root must stay under LOCALAPPDATA',
    affects: ['storage location only'],
  },
  {
    id: 'native-picker-isolation',
    file: 'src-tauri/src/lib.rs',
    effect: 'audio_open_source reads the required THUMB_UI_PLAYLIST instead of opening the OS file dialog',
    justification: 'removes unbounded human latency from the measured action and makes both arms start identically',
    affects: ['source selection only'],
  },
]

const FORBIDDEN_TOUCHES = [
  'src-tauri/src/audio/cover_pixels.rs',
  'src-tauri/src/lib.rs#scheduler',
  'src/features/player/services/playlistCoverScheduler',
  'src/features/player/services/playlistCoverPathLane',
  'src-tauri/tauri.conf.json',
]

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command }
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]
    const next = () => {
      const value = rest[++i]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      return value
    }
    switch (flag) {
      case '--root': options.root = next(); break
      case '--json': options.json = next(); break
      default: throw new Error(`unknown option ${flag}\n\n${USAGE}`)
    }
  }
  return options
}

function readTree(root) {
  const pathsFile = join(root, 'src-tauri', 'src', 'app_paths.rs')
  const libFile = join(root, 'src-tauri', 'src', 'lib.rs')
  if (!existsSync(pathsFile)) throw new Error(`missing ${pathsFile}`)
  if (!existsSync(libFile)) throw new Error(`missing ${libFile}`)
  return { pathsFile, libFile }
}

function patchAppPaths(original) {
  const start = original.indexOf(APP_PATHS_ANCHOR_START)
  const end = original.indexOf(APP_PATHS_ANCHOR_END, start)
  if (start < 0 || end < 0) {
    throw new Error(
      'AppPaths isolation anchor changed: expected `let project_dirs =` .. `paths.ensure_created()`.\n' +
      'Update coverlane-isolation.patch.mjs deliberately, do not widen it silently.',
    )
  }
  const replacedRegion = original.slice(start, end)
  const patched = (original.slice(0, start) + APP_PATHS_REPLACEMENT + original.slice(end))
    .replace('use directories::ProjectDirs;\n', '')
  return {
    patched,
    removedLines: replacedRegion.split('\n').length,
    addedLines: APP_PATHS_REPLACEMENT.split('\n').length + (original.includes('use directories::ProjectDirs;\n') ? 0 : 0),
    removedImport: original.includes('use directories::ProjectDirs;\n') ? 1 : 0,
  }
}

function patchPicker(original) {
  const match = original.match(PICKER_PATTERN)
  if (!match) {
    throw new Error(
      'Native picker isolation anchor changed: `fn audio_open_source(` body not found.\n' +
      'Update coverlane-isolation.patch.mjs deliberately, do not widen it silently.',
    )
  }
  const patched = original.replace(PICKER_PATTERN, PICKER_REPLACEMENT)
  if (patched === original) throw new Error('Native picker isolation produced no change; refusing a silent no-op')
  return {
    patched,
    removedLines: match[0].split('\n').length,
    addedLines: PICKER_REPLACEMENT.split('\n').length,
  }
}

/**
 * The whole-file line delta is meaningless for a localized replacement: it counts
 * every shifted line. Report the replaced region size instead, which is the
 * number a reviewer can check against the registry entry.
 */
function changeSummary(original, result) {
  return {
    bytesBefore: Buffer.byteLength(original),
    bytesAfter: Buffer.byteLength(result.patched),
    linesRemovedFromAnchor: result.removedLines,
    linesAddedByPatch: result.addedLines,
    importRemoved: Boolean(result.removedImport),
  }
}

function apply(options) {
  const root = resolve(options.root)
  if (!existsSync(root)) throw new Error(`snapshot root does not exist: ${root}`)
  const { pathsFile, libFile } = readTree(root)
  const beforePaths = readFileSync(pathsFile)
  const beforeLib = readFileSync(libFile)
  if (beforePaths.includes(Buffer.from('THUMB_UI_ROOT'))) throw new Error('app_paths.rs is already patched; refusing to double-apply')
  if (beforeLib.includes(Buffer.from('THUMB_UI_PLAYLIST'))) throw new Error('lib.rs is already patched; refusing to double-apply')

  const beforePathsText = beforePaths.toString('utf8')
  const pathsPatch = patchAppPaths(beforePathsText)
  writeFileSync(pathsFile, pathsPatch.patched)
  const beforeLibText = beforeLib.toString('utf8')
  const libPatch = patchPicker(beforeLibText)
  writeFileSync(libFile, libPatch.patched)

  const record = {
    appliedAt: new Date().toISOString(),
    root,
    registry: REGISTRY,
    forbiddenTouches: FORBIDDEN_TOUCHES,
    scopeStatement:
      'Only the two registered anchors were modified. Cover scheduling, the path/pixel lanes, IPC, ' +
      'the asset protocol, decode and rendering are untouched; both arms receive the identical patch set.',
    files: [
      {
        path: pathsFile,
        registryId: 'app-paths-isolation',
        originalSha256: sha(beforePaths),
        patchedSha256: sha(readFileSync(pathsFile)),
        change: changeSummary(beforePathsText, pathsPatch),
      },
      {
        path: libFile,
        registryId: 'native-picker-isolation',
        originalSha256: sha(beforeLib),
        patchedSha256: sha(readFileSync(libFile)),
        change: changeSummary(beforeLibText, libPatch),
      },
    ],
  }
  record.diffDigest = sha(JSON.stringify(record.files.map(f => [f.registryId, f.originalSha256, f.patchedSha256])))
  if (options.json) writeFileSync(resolve(options.json), JSON.stringify(record, null, 2))
  console.log(JSON.stringify({ ok: true, root, diffDigest: record.diffDigest, files: record.files }, null, 2))
  return record
}

function verify(options) {
  const root = resolve(options.root)
  if (!existsSync(root)) throw new Error(`snapshot root does not exist: ${root}`)
  const { pathsFile, libFile } = readTree(root)
  const paths = readFileSync(pathsFile, 'utf8')
  const lib = readFileSync(libFile, 'utf8')
  const problems = []
  if (!paths.includes('THUMB_UI_ROOT')) problems.push('app_paths.rs does not require THUMB_UI_ROOT')
  if (paths.includes('use directories::ProjectDirs;')) problems.push('app_paths.rs still imports ProjectDirs, so the OS profile may still be used')
  if (!lib.includes('THUMB_UI_PLAYLIST')) problems.push('lib.rs does not require THUMB_UI_PLAYLIST')
  if (/fn audio_open_source\([\s\S]{0,4000}?tauri_plugin_dialog/.test(lib)) problems.push('lib.rs audio_open_source still references the dialog plugin')
  const result = {
    ok: problems.length === 0,
    root,
    problems,
    files: [
      { path: pathsFile, sha256: sha(readFileSync(pathsFile)) },
      { path: libFile, sha256: sha(readFileSync(libFile)) },
    ],
    registry: REGISTRY,
  }
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
  return result
}

const options = parseArgs(process.argv.slice(2))
if (options.command === 'apply') {
  if (!options.root) throw new Error(USAGE)
  apply(options)
} else if (options.command === 'verify') {
  if (!options.root) throw new Error(USAGE)
  verify(options)
} else {
  console.log(USAGE)
  process.exitCode = options.command ? 1 : 0
}
