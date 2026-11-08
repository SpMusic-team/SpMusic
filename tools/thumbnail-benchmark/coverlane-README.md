# coverlane measurement harness

A rebuilt measurement tool for the OPT-0018 list-cover asset path lane, following
[`docs/test/opt-0018-v2-closeout-and-performance-plan.md`](../../docs/test/opt-0018-v2-closeout-and-performance-plan.md)
§2–§4.

These are **new files**. They do not modify or replace the existing scripts in this
directory (`prepare.mjs`, `prepare-ui.mjs`, `ui-pairs.mjs`, `visible-pairs.mjs`,
`visible-measurement.mjs`, `run-pairs.mjs`, `sample-ui.ps1`, `summarize-*.mjs`,
`probe.rs`), which remain the author's own harness with their own conventions.

## Why this exists

The previous scripts lived outside the repository in `D:\opt0018-ab\` and had five
measurement defects that the plan names explicitly:

| Defect | Consequence | Fixed by |
| --- | --- | --- |
| Clock started after the action (`sleep(150)` then wait for grid) | `settleMs` was a local completion figure, ~28–32 % short of the real action | `t0` taken in the same `Runtime.evaluate` call, immediately before `click()` |
| Target set reverse-engineered from "cards that already own an `<img>`" | the run defined its own denominator; a missing cover left the set | frozen fixture with a digest, plus a has-cover / no-cover split |
| No direct counting (`.jpg` / `.spxr` file listings) | "0 `.spxr`" was read as "0 fallbacks" | CDP `Network` facts + per-attempt identity counting |
| Scroll only measured after stopping | during-scroll blank exposure was invisible | per-frame area-integrated blank exposure, with `tStop` |
| No manifest archive | runs were not reproducible or comparable | full manifest per batch |

## Files

| File | Role |
| --- | --- |
| `coverlane-common.mjs` | shared plumbing: `$CACHE` scope guard, CDP client, `LaneRecorder` (direct counts), process launch, host/WebView2/git facts, manifest writers, `ensureListPanel` |
| `coverlane-page.mjs` | in-page measurement code: pre-input instrumentation, the `t0` wrapper, action bodies (`open`, `leave`, `scroll`), final-state snapshot |
| `coverlane-fixtures.mjs` | builds and verifies the **frozen** fixture: stable cohort + universe, has-cover labels, privacy-preserving corpus manifest |
| `coverlane-ab.mjs` | paired A/B over two release binaries, per action, fresh and warm disk modes |
| `coverlane-stress.mjs` | scroll blank-exposure pass: slow / fast / reverse / revisit, per-frame sampling, optional memory window |
| `coverlane-isolation.patch.mjs` | applies and verifies the two **registered** build-time isolation patches |
| `coverlane-memory.ps1` | per-process-role memory sampler (main / renderer / GPU / utility), working set and private bytes |

## Hard requirements these scripts enforce

* **The cache root must be inside `$CACHE`** (`LOCALAPPDATA`). `assertCacheScope`
  refuses to run otherwise. A root outside the asset-protocol scope answers 403 on
  every `convertFileSrc` request and makes the path lane look broken for reasons
  that have nothing to do with the code under test; widening the scope is not an
  acceptable fix.
* **Release binaries must be built with `npx tauri build --no-bundle`** (or
  `npm run tauri build`). A bare `cargo build --release` omits the
  `custom-protocol` feature and falls back to `localhost:5173`, which is not a
  comparable application. `artifactFacts()` records the `custom-protocol` and
  `dev-server` markers plus the binary digest in every manifest.
* **Only the two registered isolation patches are applied**, identically to both
  arms: `AppPaths -> THUMB_UI_ROOT` and the native picker -> `THUMB_UI_PLAYLIST`.
  `coverlane-isolation.patch.mjs` prints the exact anchor replacements and a diff
  digest, and `verify` re-checks an already-patched tree.
* **No new dependencies.** Node built-ins only (`node:fs`, `node:child_process`,
  `node:crypto`, `node:path`, `node:url`, `node:os`) plus the built-in `WebSocket`.

## Measurement rules implemented

### Action-preceded clock (plan §3.1)

Each measured action is one `Runtime.evaluate` call that does all of this in a
single execution context:

1. clears the per-action counters and windows (bookkeeping only — it touches no
   application state and starts no request);
2. `action.t0 = performance.now()`, immediately followed by `control.click()` or
   the first `scrollTop` assignment inside `api.input(...)`;
3. samples until the deadline, keeping `panelVisibleMs`, `gridVisibleMs` and
   `firstCardMs` as **separately reported marks** and never subtracting them from
   the total;
4. tears down the rAF sampler at the end. Targets still unready, or gone from the
   screen, stay in the record as `not-ready` or `censored-offscreen`.

Output field `t0RecordedBeforeInput` is `true` only when both the clock and the
input timestamp exist, so a broken wrapper cannot silently pass.

### Legal target set (plan §3.2)

`coverlane-fixtures.mjs build` captures, once:

* `universe.ids` — every card id the list mounted (scroll denominator);
* `cohort.ids` — first-screen cards in DOM order with clipped area > 0 (open
  denominator);
* `labels[id].hasCover` — from the app's own `audio_probe_playlist_cover`;
* `fixtureDigest` — over ids, labels, thresholds and viewport.

Every arm and every pair reuse the same fixture file; nothing is derived from the
run. Per target the record carries first exposure, first `<img>`, first decoded,
visible-proxy-ready, clipped area, opacity, `data-cover-state`, and the image URL
scheme. The has-cover and no-cover classes are summarised separately, and
"all covers complete" is computed over the has-cover class only — a no-cover
placeholder cannot complete it early, and a missing cover cannot leave the
denominator.

Visibility is "decoded image + computed opacity ≥ threshold + clipped area > 0 for
N consecutive animation frames", plus a key-moment screenshot. It is reported as
**visible proxy ready** throughout: DOM state, `requestAnimationFrame` and
screenshots cannot show GPU compositing or when a frame reaches the panel, and no
output claims they do.

### Scroll blank exposure (plan §3.3)

`coverlane-stress.mjs` runs four fixed programmes (slow / fast continuous /
reverse / leave-then-revisit) with the same input method. `t0` precedes the first
input; `marks.tStopMs` is the last input. Each frame records clipped area and
readiness per visible target, producing:

* per-card blank exposure seconds and **area × time** (px²·ms, also as
  pixel-seconds);
* per-card first-exposure → proxy-ready delay, longest single blank, and
  stop → settled;
* frame interval p50/p95/max and >50 ms long tasks;
* residual `loading` / `error` card counts at the end of the run;
* a rAF sampler cost figure, because the sampler itself occupies main-thread time.

A card that scrolls off before it is ready keeps its accrued blank exposure and is
marked `censored-offscreen`; it is never counted as ready.

### Direct counting (plan §4)

Fallback is **counted**, not inferred from `.spxr` files. `LaneRecorder` installs
`Network` handlers and derives:

| Observation | Recorded as |
| --- | --- |
| Path outcome | per-command lane (`path` / `pixels`), `ok`, `nonOkStatus`, `failed`, `canceled`, `inFlightAtSnapshot` |
| Fallback | `laneAttempts.fallbackCount` — the same `(kind, generation, source, maxEdge)` seen through **both** lanes |
| Missing verdict | an IPC 200 whose decoded body is ≤ 8 B (`null`), counted as `missingVerdicts` |
| IPC bytes | `ipcTotals.decodedBytes` (Σ `Network.dataReceived`), `encodedBytes` (Σ `loadingFinished.encodedDataLength`), `requestBytes` (serialized JSON body) |
| Asset bytes | `asset.decodedBytes` / `encodedBytes`, plus status, MIME and `fromDiskCache` |
| Asset scope | `asset.allUrlsInsideCacheRoot` — every asset URL must decode under `LOCALAPPDATA` |
| Production build | `serving.servingMode` from the URL the WebView actually loaded; a non-`tauri.localhost` load aborts the run |
| Main thread | long tasks (>50 ms count, max), frame intervals, and JS BMP work (`bmpCreateObjectUrl`, `bmpBytes`) counted by wrapping `URL.createObjectURL`, `Image`, `putImageData`, `drawImage`, `decode` at measurement time only |
| Identity | a card served for a target id must still carry that id; an unready card that is *unmounted* is recorded separately as `unmountedWhileUnready` and censored |
| Memory | `coverlane-memory.ps1`, per role, working set and private bytes, 1 s interval |

Native request count is the number of distinct CDP `requestId`s, so shared or
deduped work counts once. Attempt identity is the IPC body tuple
`(clientId, windowGeneration, sourcePath|filePath, maxEdge)`, which is the
frontend scheduler's own dedupe key. No fixed 100 B size estimate is used
anywhere; every byte figure is measured, and `snapshot().basis` states the
counting basis in the artefact itself.

Note on `inFlightAtSnapshot`: some IPC requests have no response yet when the
window closes. They are reported as in-flight rather than being folded into `ok`
or `failed`, because a request still running at teardown is not evidence of either
outcome.

## Usage

All commands are PowerShell from the repository root. `<exe>` paths are absolute.

### 1. Build a frozen fixture (once per corpus + viewport)

```powershell
node tools/thumbnail-benchmark/coverlane-fixtures.mjs build `
  --exe "D:\opt0018-ab\final2\src-tauri\target\release\app.exe" `
  --corpus "D:\opt0018-ab\corpus-paths.txt" `
  --playlist "D:\opt0018-ab\playlist.m3u8" `
  --out "$env:LOCALAPPDATA\spmusic-coverlane\fixtures\corpus120-v1.json" `
  --scratch "$env:LOCALAPPDATA\spmusic-coverlane\fixtures\scratch1" `
  --cohort 8
```

Verify it (privacy, digest, label coverage):

```powershell
node tools/thumbnail-benchmark/coverlane-fixtures.mjs verify `
  --fixture "$env:LOCALAPPDATA\spmusic-coverlane\fixtures\corpus120-v1.json"
```

### 2. Paired A/B

```powershell
node tools/thumbnail-benchmark/coverlane-ab.mjs `
  --baseline  "D:\opt0018-ab\baseline\src-tauri\target\release\app.exe" `
  --candidate "D:\opt0018-ab\final2\src-tauri\target\release\app.exe" `
  --fixture   "$env:LOCALAPPDATA\spmusic-coverlane\fixtures\corpus120-v1.json" `
  --playlist  "D:\opt0018-ab\playlist.m3u8" `
  --out       "$env:LOCALAPPDATA\spmusic-coverlane\runs\ab-001" `
  --pairs 10 --modes fresh,warm --actions open,leave,scroll:slow,scroll:fast
```

Output: `manifest.json`, `results.json` (per action), `summary.json`,
`arms/<pair>-<arm>-<mode>.json` (full per-target detail), `logs/`, `screenshots/`.

### 3. Scroll blank-exposure pass

```powershell
node tools/thumbnail-benchmark/coverlane-stress.mjs `
  --exe      "D:\opt0018-ab\final2\src-tauri\target\release\app.exe" `
  --fixture  "$env:LOCALAPPDATA\spmusic-coverlane\fixtures\corpus120-v1.json" `
  --playlist "D:\opt0018-ab\playlist.m3u8" `
  --out      "$env:LOCALAPPDATA\spmusic-coverlane\runs\stress-001" `
  --programs slow,fast,reverse,revisit --cycles 3
```

Add `--memory-seconds 620` for the plan's ≥10 minute memory window; results land
in `memory-stress.csv` and are summarised per role in `summary.json`.

### 4. Isolation patch on a snapshot

```powershell
git archive --format=tar --output=snapshot.tar 7022367 src-tauri
tar -xf snapshot.tar -C snapshot
node tools/thumbnail-benchmark/coverlane-isolation.patch.mjs apply  --root snapshot --json snapshot\isolation.json
node tools/thumbnail-benchmark/coverlane-isolation.patch.mjs verify --root snapshot
```

Then build that snapshot with `npx tauri build --no-bundle`, which requires the
snapshot's `dist/` to be present (copy the matching `dist` in, as
`prepare-ui.mjs` does).

## Environment switches

| Variable | Effect |
| --- | --- |
| `COVERLANE_SETTLE_MS` | unmeasured settle after the prerequisite music scan (default 2000) |
| `COVERLANE_RUST_LOG` | value of `RUST_LOG` for the arms (default `off`; must match across arms) |

## What this harness does not do

* No 10 minute memory curve is produced by default; `--memory-seconds` exists but
  the long run is not part of the short validation batches.
* No 1000-cover corpus exists yet: only the existing 120-track library is used,
  and the fixture records the independent cover hash count (116) rather than
  treating track count as cover diversity.
* No no-cover fixture is available without editing the user's music library, which
  the plan forbids; the fixture emits an explicit caveat and the placeholder path
  is **not** covered.
* OS file cache is uncontrolled, so `fresh` means a virgin app cache root, not a
  cold OS cache.
* Backend-internal segments (admission wait, decode, JPEG encode, writer queue)
  are not instrumented; only frontend and protocol-level facts are measured. No
  cross-process time subtraction is performed.
