# Version worktrees for the perf-regression harness

Prepared by `version-infra` (shared task `task-3`). Owned paths only:
`tools/perf-regression/versions/**` and
`.codex-tmp-folder-ui-dist/perf-versions/**`.

The main worktree is never modified: only `git worktree add --detach`, one
directory junction per worktree, and files under
`.codex-tmp-folder-ui-dist/perf-versions/` are created. No commits, stashes,
reverts, branch changes, or `npm install`.

## Commands

Prepare (idempotent; re-run any time):

```powershell
node tools/perf-regression/versions/prepare-versions.mjs
```

Useful options: `--only V1,V3` (subset), `--root <dir>` (alternate root),
`--no-node-modules` (skip the junction). The JSON manifest is printed to stdout
and written to `.codex-tmp-folder-ui-dist/perf-versions/manifest.json`.

Start one version and stop it cleanly:

```powershell
node tools/perf-regression/versions/run-version.mjs --path .codex-tmp-folder-ui-dist/perf-versions/V4 --port 5314
```

`--serve-ms <ms>` keeps serving before stopping, `--browser` adds a headless
render check, `--ready-timeout <ms>` raises the readiness budget, `--log` prints
the full server log. From the harness, import instead of spawning:

```js
import { startVersion } from '../versions/run-version.mjs'
const server = await startVersion({ path, port, hold: true })   // hold keeps it up
try { /* measure against server.origin */ } finally { await server.stop() }
```

`hold: true` returns `{ origin, port, pid, mainTsx, optimizer, stop }`. Without
`hold` the server is stopped before the promise resolves. `stop()` kills the
process tree, then re-enumerates every `node.exe` whose command line names that
exact worktree; any survivor is an orphan, gets killed, and is reported in
`stopped.remainingOrphans` with `cleaned: false`. Self and all ancestors are
excluded from the kill set, so a runner can never terminate its own caller.

Verification probes used to build the table below:

```powershell
$env:SPMUSIC_PLAYWRIGHT = "C:\Users\winkeses\.dsh\tools\node_repl\node_modules\playwright"
node tools/perf-regression/versions/probe-versions.mjs        # DOM: search page present?
node tools/perf-regression/versions/probe-add-affordance.mjs  # DOM: add affordance present?
```

Playwright is loaded from that external directory and is never added to
`package.json`.

## Versions

All five worktrees are created, detached, and verified to start Vite 8.1.3.

| id | commit | worktree | Vite starts | search page | add-to-playlist |
|----|--------|----------|-------------|-------------|-----------------|
| V1 | `8f45750` 2026-10-25 | `.codex-tmp-folder-ui-dist/perf-versions/V1` | yes | **no** | **no** |
| V2 | `6a7da1b` 2026-10-28 | `.../perf-versions/V2` | yes | **no** | yes |
| V3 | `9e8d41c` 2026-10-30 | `.../perf-versions/V3` | yes | yes | yes |
| V4 | `ce65f67` 2026-10-30 | `.../perf-versions/V4` | yes | yes | yes |
| V5 | `e662653` 2026-11-02 | `.../perf-versions/V5` | yes | yes | yes |

V5 is the local working tree archived as tag `archive/local-working-tree-2026-11-02`.
That tag points at merge commit `e662653`, whose tree is ordinary and therefore
**does** check out as a normal worktree; "main worktree only" was not needed. Its
snapshot also contains `.codex-tmp-folder-ui-dist` build output, which is harmless
because nothing in the prepare or run path reads it.

`git show --stat archive/local-working-tree-2026-11-02 | head` reports
`Merge: ce65f67 fdd4549` — that is why the ref resolves to `e662653` rather than
to a `ce65f67`-based simple commit.

## Start-up evidence (measured, not assumed)

For every version `startVersion` confirmed, in order:

1. `GET /` returns 200 (the dev-server HTML document).
2. `GET /src/main.tsx` returns 200 and its body contains `createRoot`, so the
   Vite transform pipeline is live rather than just the static index.
3. One real pre-bundled dependency URL taken from that `main.tsx` response
   resolves to 200. This is required because Vite answers the index and entry
   before its dependency optimizer finishes, and during that window a rewritten
   `deps/*` URL returns **504**. Starting measurements on index-200 alone records
   a broken first load; with step 3 the readiness signal is accurate.

Then the server was stopped and zero orphan `node.exe` processes remained.

Dev-server HTML is the stock Vite document (`<div id="root">` +
`<script type="module" src="/src/main.tsx">`); it is byte-identical in shape
across all five versions, so no version-specific startup error exists at the
document level.

Runtime page load in a headless browser: `.player-shell` mounts, `pageErrors` is
empty for all five, and the only console errors are the expected absence of the
Tauri IPC host when the frontend is opened in a plain browser — for V1–V5 the
same single pair:

```
Failed to listen for audio track details
  TypeError: Cannot read properties of undefined (reading 'transformCallback')
```

That is `@tauri-apps/api`'s event bridge with no `window.__TAURI_INTERNALS__`.
It is identical in every version, so it does not differentiate them and is not a
version-specific startup error. Command replies from the native side are absent
under a browser, so any measurement must supply its own `invoke` fixtures (as the
repo's existing `*.browser.test.mjs` files do).

## node_modules: shared by junction

Worktrees have no `node_modules`. `vite` and `@tailwindcss/vite` are installed in
`D:\SpMusic\node_modules`, so a worktree needs to see them. Tested both ways:

- `git worktree add` gives a worktree with no `node_modules`; `vite` is
  unresolvable there.
- A directory junction `<worktree>\node_modules` → `D:\SpMusic\node_modules`
  makes Vite start and serve correctly. Implemented in `prepare-versions.mjs`
  via `fs.symlinkSync(target, link, 'junction')` (`mklink /J` is not needed; the
  Node API produces the same junction and needs no elevation).

The prepare script is careful with that link: it reuses an existing correct
junction, unlinks a junction pointing somewhere else, and **never deletes** a
real directory (that would mean someone ran a real `npm install` there — it
reports `state: existing-directory` and leaves it alone).

Concurrency was verified: two version servers sharing the one junction ran at the
same time on separate ports, both served their index, `main.tsx`, and dep URL as
200, and both stopped with `cleaned: true`. Three consecutive rounds showed no
cache interference between a running V1 and a newly started V4.

Caveat worth carrying into the harness: the shared `node_modules/.vite` dep cache
is keyed by config hash, so the first start of each version re-optimizes
(`Re-optimizing dependencies because vite config has changed`). That is why
readiness must include the optimizer check above; it also means the *first* load
per version does extra work — warm the version once before measuring it.

## package.json: identical across all five

`package.json` blob is `dbcc742c…` at V1, V2, V3, V4, and the V5 tag tree, and it
equals the main worktree's. `prepare-versions.mjs` re-checks this per run and
reports `packageJson.differences` (dependencies, devDependencies, scripts).

Implication: **no version needs its own dependency set**, so one junction to the
main `node_modules` is correct for all five, and no `npm install` is needed
anywhere. If a future version's `package.json` differs, `matchesMain` becomes
false and that version needs a real install in its worktree instead of the
junction.

## UI evidence per version

### Search page

V1 and V2 have **no search page at all** — definitively:

- `src/features/player/components/SearchPanel.tsx` does not exist at `8f45750` or
  `6a7da1b` (first appears at `9e8d41c`).
- `git log --oneline -- src/features/player/components/SearchPanel.tsx` returns
  only `ce65f67` and `9e8d41c`.
- `git log --oneline -- src/features/player/styles/player/search-page.css`
  returns only those same two commits.
- No `search-page.css`, no `useLibrarySearch.ts`, no `librarySearch.ts` at V1/V2.
- Runtime: `.search-page` element count is `0`, and no
  `input[aria-label="聚合搜索"]`.

What V1/V2 *do* have is a **local playlist filter**, not a search page:
`Input.playlist-filter-input` inside `PlaylistPanel.tsx` (V1 line 952), reached
by Ctrl+F. This is the affordance the V1 `localSearchShortcut.browser.test.mjs`
tests. It filters the currently open playlist only. Do not confuse it with V3+'s
search page.

V3, V4, V5: `.search-page` exists (`SearchPanel.tsx`), is present in the DOM but
`inert` while closed (count 1, `searchPageInert: true`), and contains
`input[aria-label="聚合搜索"]` (role `searchbox`, name `聚合搜索`).

Search-page selectors (V3/V4/V5):

| purpose | selector |
|---------|----------|
| page section | `.search-page` (also `aria-label="聚合搜索页面"`) |
| query input | `input[aria-label="聚合搜索"]` / `getByRole('searchbox', { name: '聚合搜索' })` |
| clear query | `button[aria-label="清空搜索"]` |
| category filters | `button[aria-label^="筛选"]`, plus `button[aria-label="全选搜索分类"]` |
| result sections | `[data-search-category]` |
| result rows | `[data-search-key]`, songs also `[data-song-key]` |
| view menu | `button[aria-label="搜索视图选项"]` |
| dock nav button that opens it | `button[aria-label="搜索"]` |

Runtime note: `[data-search-category]` counts 0 in an empty library, because the
search page renders no sections without data. That is data-absence, not
capability-absence; the section exists as soon as the library has rows.

### Add-to-playlist

V1 has **no add-to-playlist affordance**. There is no add-to-*existing*-playlist
path and no add IPC:

- `onAddToPlaylist`, `onPrepareAddToPlaylist`, `onCreateAddPlaylist`,
  `canAddToPlaylist` — 0 occurrences anywhere in V1 `src`.
- `library_add_playlist_tracks` — 0 occurrences in V1 `src` and 0 in V1
  `src-tauri/src/lib.rs`.
- No `src/assets/selection-panel/**` assets (0 files; V2+ have 29).
- No `[aria-label="歌曲选择操作"]` selection dock (runtime: `false`).

V1's closest feature is **"新建播放列表"** (create a playlist *from* selected
songs), which is not the same thing: `player.createPlaylist` builds an in-memory
`sourceKind: 'custom'` playlist from selected `all-songs` keys and never writes to
a persisted playlist. It is session-only (`仅在本次会话中保留`) and cannot add a
track to an existing playlist.

V2 introduced the real thing (matching its commit message "完善歌曲多选与播放列表管理"):

- `src-tauri/src/library_playlist_addition.rs` (286 lines) and a
  `library_add_playlist_tracks` command in `lib.rs`.
- 29 `selection-panel` assets, including the 17 under `playlist-add/`.
- `[aria-label="歌曲选择操作"]` dock, `.playlist-selection-action` buttons
  labelled `播放列表` / `队列` / `下一首播放` / `删除`.
- `[aria-label="可添加的播放列表"]` picker, `button[aria-label="新增播放列表"]`,
  `button[aria-label="播放列表排序"]`, `button[aria-label="插入位置"]`,
  `button[aria-label="添加模式"]`.
- `playlistSelectionAdd.browser.test.mjs`.
- 36 add-API references in `src`; V5 has 43.

V3/V4 are the same as V2 here. V5 differs structurally: the picker moved out of
`PlaylistPlaybackDock.tsx` into `PlaylistSongDialogs.tsx`, while the dock keeps
`[aria-label="歌曲选择操作"]` and the `.playlist-selection-action` row. So the
selectors in the table hold for all of V2–V5, but the picker's owning component
changed at V5 — target the ARIA labels, not the file.

Runtime caveat on the add flow: with no native backend the lists are empty, so
the `选择` button is present but `disabled` (V1–V5 alike, `allSongsCards: 0`). The
selection dock and picker therefore only mount once a version has real playlist
data. The table's yes/no comes from source evidence (API + assets + IPC + labels),
which is unambiguous; the runtime probe confirms the entry point exists and is
gated on data, not on version.

## Required localStorage keys

Set these before load to make a version open on a given page and render a
deterministic list shape. All keys below exist in every version V1–V5 unless
marked.

Start-up page and containers:

| key | value | effect |
|-----|-------|--------|
| `spmusic.player.startup-page.v1` | `media-library` | opens the media library instead of the player; `readStartupPage()` is present in all five and is consumed by `PlayerShell.tsx` |
| `spmusic.player.session.v1` | *(remove)* | drop it so a restored session does not override the start-up page |
| `spmusic.playlist.layout-level.v1` | `1` | pins the playlist grid layout (the repo's own tests use `1`) |
| `spmusic.all-songs.layout-level.v1` | `1` | pins the all-songs grid |
| `spmusic.playlist-management.layout-level.v1` | `1` | pins the management grid (V1/V2/V3/V4/V5 all read it) |
| `spmusic.playlist-management.layout-level.v2` | — | V3+ only |
| `spmusic.search.layout-level.v1` | `1` | V3+ only, search page layout |
| `spmusic.player.playlist-controller-mode.v1` | `fixed` \| `movable` | controller mode; the repo's tests default to `fixed` |
| `spmusic.appearance.v2` | *(default)* | theme; leave unset for the stock appearance |

Version-specific layout keys — **do not set what a version does not read**, and
note that V1/V2 read strictly fewer than V3+ (this list is runtime source only;
`spmusic.artist-tracks.layout-level.v1` appears solely inside
`artistLibrary.browser.test.mjs` at V3–V5 and is not read by app code):

- V1, V2 read only: `spmusic.playlist.layout-level.v1`,
  `spmusic.all-songs.layout-level.v1`, `spmusic.playlist-management.layout-level.v1`.
- V3, V4, V5 add: `spmusic.albums.layout-level.v1`,
  `spmusic.album-tracks.layout-level.v1`,
  `spmusic.flat-folders.layout-level.v1`,
  `spmusic.folder-hierarchy.layout-level.v1`,
  `spmusic.search.layout-level.v1`,
  `spmusic.playlist-management.layout-level.v2`.

Also stable across the five, useful if a measurement needs them:
`spmusic.player.shuffle-mode.v1`, `spmusic.player.repeat-mode.v1`,
`spmusic.song-manual-order.v1`. Present at V3+ only (0 occurrences at V1/V2):
`spmusic.recently-played.v1`, `spmusic.library.sidebar.folders-pinned.v1`.

A ready-made init script that is valid for every version:

```js
localStorage.setItem('spmusic.player.startup-page.v1', 'media-library')
localStorage.setItem('spmusic.playlist.layout-level.v1', '1')
localStorage.setItem('spmusic.all-songs.layout-level.v1', '1')
localStorage.setItem('spmusic.playlist-management.layout-level.v1', '1')
localStorage.setItem('spmusic.player.playlist-controller-mode.v1', 'fixed')
localStorage.removeItem('spmusic.player.session.v1')
```

## Things a cross-version A/B must account for

1. **V1 cannot be measured on the search page or the add flow** — neither exists.
   V1 vs V2 can only compare the local `playlist-filter-input` filter and playlist
   playback; V2 vs V3 can compare search-page introduction (9e8d41c). Comparing
   "search page performance" is V3/V4/V5 only.
2. `vite.config.ts` pins `server.strictPort: true`, so a busy port is a hard
   failure, not a silent reassignment. `startVersion` checks the port first and
   throws with the observed status instead of letting Vite fail obscurely.
3. First load per version re-optimizes dependencies (config hash changed). Warm
   each version once before measuring, or accept a cold-start outlier.
4. Under a browser the Tauri IPC host is missing, identically in every version.
   Measurements must inject their own `invoke` fixtures; nothing version-specific
   is hidden by this.
5. Shared `node_modules` means one lockfile resolution for all versions. That is
   correct today only because all five `package.json` files are identical; the
   prepare script re-verifies and reports any drift.

## Files

- `prepare-versions.mjs` — worktrees + junctions + manifest (idempotent).
- `run-version.mjs` — `startVersion()` + CLI; readiness, clean stop, orphan proof.
- `probe-versions.mjs` — runtime DOM check: search page present?
- `probe-add-affordance.mjs` — runtime DOM check: add affordance present?

Manifest: `.codex-tmp-folder-ui-dist/perf-versions/manifest.json`.
