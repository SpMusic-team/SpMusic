// Build-only isolation patches are applied to a disposable Git snapshot.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const [revision, output, assets] = process.argv.slice(2)
if (!assets) throw new Error('Usage: node prepare-ui.mjs <revision> <new-root> <matching-dist>')
const root = resolve(output)
if (existsSync(root)) throw new Error('Output must not exist')
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}
const sha = run('git', ['rev-parse', `${revision}^{commit}`])
mkdirSync(root, { recursive: true })
run('git', ['archive', '--format=tar', `--output=${join(root, 'source.tar')}`, sha, 'src-tauri'])
run('tar', ['-xf', join(root, 'source.tar'), '-C', root])
cpSync(resolve(assets), join(root, 'dist'), { recursive: true })
// A dedicated binary name avoids touching a user's already-running app.exe.
const cargoFile = join(root, 'src-tauri/Cargo.toml')
writeFileSync(cargoFile, readFileSync(cargoFile, 'utf8') + '\n[[bin]]\nname = "thumbnail_benchmark_ui"\npath = "src/main.rs"\n')
const pathsFile = join(root, 'src-tauri/src/app_paths.rs')
const original = readFileSync(pathsFile, 'utf8')
const start = original.indexOf('        let project_dirs =')
const end = original.indexOf('\n\n        paths.ensure_created()', start)
if (start < 0 || end < 0) throw new Error('AppPaths isolation anchor changed')
const replacement = `        let isolated_root = std::path::PathBuf::from(std::env::var_os("THUMB_UI_ROOT").expect("isolated UI root required"));
        let paths = Self {
            config_dir: isolated_root.join("config"),
            data_dir: isolated_root.join("data"),
            cache_dir: isolated_root.join("cache"),
        };`
const patched = (original.slice(0, start) + replacement + original.slice(end)).replace('use directories::ProjectDirs;\n', '')
writeFileSync(pathsFile, patched)
const libFile = join(root, 'src-tauri/src/lib.rs')
const originalLib = readFileSync(libFile, 'utf8')
const isolatedLib = originalLib.replace(/fn audio_open_source\([\s\S]+?\n\}/, `fn audio_open_source(
    state: State<'_, AudioController>,
) -> Result<AudioOpenSourceResult, AudioCommandError> {
    let selected_path = std::env::var("THUMB_UI_PLAYLIST").expect("explicit test playlist required; native picker disabled");
    state.list_folder_tracks(AudioFolderPlaylistInput { selected_path })
        .map(|playlist| AudioOpenSourceResult::Playlist { playlist })
}`)
if (isolatedLib === originalLib) throw new Error('Native picker isolation anchor changed')
writeFileSync(libFile, isolatedLib)
// WebView2's documented environment override is set separately for every run.
// No profiling hooks or UI changes are injected; only storage and picker fixtures differ.
const digest = data => createHash('sha256').update(data).digest('hex')
writeFileSync(join(root, 'ui-identity.json'), JSON.stringify({ revision: sha,
  originalAppPathsSha256: digest(original), isolatedAppPathsSha256: digest(patched),
  originalLibSha256: digest(originalLib), isolatedLibSha256: digest(isolatedLib),
  frontendIndexSha256: digest(readFileSync(join(root, 'dist/index.html'))),
  isolation: 'AppPaths -> required THUMB_UI_ROOT; native picker disabled in snapshot, required THUMB_UI_PLAYLIST -> real list_folder_tracks; WebView2 -> WEBVIEW2_USER_DATA_FOLDER; CDP loopback only',
}, null, 2))
console.log(root)
