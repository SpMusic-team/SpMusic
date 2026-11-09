# Poweramp — playlist LOADING core path (Lead slice)

Target: `D:\SpMusic\.rea-analysis\Poweramp-v3.apk`
`com.maxmpz.audioplayer` v build-1025-uni (1025009), minSdk 21, targetSdk 35, 6218 top-level classes, single `classes.dex`.
SHA-256 `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0`.
Native libs present: `lib/arm64-v8a/libpowerampcore.so` (3.59 MB), `libffmpeg_neon.so`, `libyayicn.so`.

This slice = **runtime resolution of "play this playlist" into a playable queue**.
Labels: **[observed]** literal/decompiled code read; **[inferred]** reasoning.

---

## 1. Entry point chain

```
PlayerService.E(Uri, boolean, int, int, int, Intent, String) : int        [observed]
  └─ b0.toUri(Uri, boolean, int, boolean, Intent) : int                    [observed]
       └─ b0.toUriCore(Uri, boolean, int, boolean) : int                   [observed]
            ├─ g1.m2442(Uri) : x2          // path segments -> entity descriptor
            ├─ b0.prepareFilesUri(o0, Uri, int) : Uri
            ├─ b0.getParentCategoryListUriMatch(o0, Uri, int) : f4
            ├─ o0.mo2425(Uri) : long        // target item id from URI
            ├─ b0.loadFilesCursorAndSetState(...) : int   // <-- THE LOAD
            ├─ b0.moveCatCursorToId(...) / b0.moveFilesCursorToId(Uri)
            └─ b0.commitShuffle(int)
  └─ PlayerService.L(int i, int i2, int i3, int i4, int i5, String) : int   [observed]
       └─ PlayerService.J(g0 track, int, int, int, int, boolean, String) : int
```

`E()` is a thin wrapper **[observed]**:
```java
public final int E(Uri uri, boolean z, int i, int i2, int i3, Intent intent, String str) {
    this.a = 0;
    if (this.f2900 == null) { z5.m1551("PlayerService", "no pipeline"); return 0; }
    b0 b0Var = this.y;                       // this.y is the queue manager
    if (b0Var == null) { Log.e("PlayerService", "no RNP"); return 0; }
    int shuffleMode = b0Var.getShuffleMode();
    int iL = L(this.y.toUri(uri, z, -1, false, intent), i, i2,
                (i3 == 1 || i3 == 2) ? 5 : 0, i3, "play ".concat(str));
    if (this.y.getShuffleMode() != shuffleMode) { c0(false, true); }
    return iL;
}
```
Note the **mode encoding** `i3`: `1` or `2` maps to player mode `5`; anything else → `0`.

`L()` is the "play what's in now-playing" step **[observed]**: it validates the pipeline, fetches
`g0 track = this.y.getTrack()`, folds `i4` flags (e.g. `i == 3` → `i4 | 16384`; `i == 2` → forces the
low 3 bits to `3` or `4` depending on whether they were `2`/`4`), compares current vs requested
shuffle position, then delegates to `J(track, pos, catPos, flags, mode, false, "playWhatInNp "+str)`.
Failure codes are mapped to UI toasts **[observed]**:
- `i == -1` → `too_many_failed` / `no_files_in_the_db`
- `i == -3` → `end_reached`
- `i == -4` → `shuffle_history_start_reached` (if `getShuffleMode() != 0`) else `start_reached`

---

## 2. The queue manager `com.maxmpz.audioplayer.player.b0`

91 methods, 45 fields. This is Poweramp's "RestNowPlaying" engine (log tag `RestNowPlaying`).

Key fields **[observed]**:
| field | type | role |
|---|---|---|
| `mContentProvider` | `rest.RestProvider` | the DB provider used to fetch cursors |
| `mRestLibrary` | `rest.library.g1` | library/entity accessor |
| `mDb` | `android.database.sqlite.SQLiteDatabase` | direct DB handle (shuffle writes) |
| `mStatementCache` | `rest.library.c3` | prepared-statement cache |
| `mFilesCursor` | `Cursor` | **the live queue** — a result-set cursor, not a materialised list |
| `mCatCursor` | `Cursor` | parent category cursor (e.g. the playlist list) |
| `mFilesEntity` / `mCatUriMatch` | `rest.library.o0` / `f4` | entity + URI match descriptors |
| `mCurrentTrack` | `player.g0` | current track model |
| `mShuffle` / `mRepeat` | `int` | shuffle / repeat mode |
| `mNPSerialId`, `mNextTrackSerial` | `int`, `AtomicInteger` | now-playing invalidation counters |
| `mRawFileMode` | `boolean` | "playing a raw file not in the library" mode |
| `mHasPendingQueue` | `boolean` | deferred queue start |

**Architectural point [observed + inferred]:** Poweramp does *not* copy a playlist into an array.
The queue **is a `Cursor`** (`mFilesCursor`). "Next"/"prev" move the cursor. This is why
`playlist_entries.sort` is the ordering authority and why shuffle can be applied by swapping the
SQL `ORDER BY` instead of reordering data.

Navigation API **[observed]**: `next(boolean,boolean)`, `prev()`, `nextCategory(boolean)`,
`prevCategory(boolean)`, `firstCategory()`, `lastCategory()`, `moveFilesCursorToId(Uri)`,
`moveCatCursorToId(...)`, `moveToFirstNotPlayedQueueEntryOrLast()`, `toPos(int)`,
`getQueueStats()`, `getQueueUnplayedSongs()`, `exitQueueImpl()`, `startQueueImpl(int)`.

---

## 3. `toUriCore` — the resolution algorithm (the heart)

Signature: `private int toUriCore(Uri uri, boolean reshuffle, int shuffleModeOverride, boolean noCur)`.

Ordered steps **[observed]**:

1. **Shuffle resolution.** `int s = extractShuffle(uri); if (s == -1) s = mShuffle; if (i != -1) s = i;`
   `boolean shuffleChanged = (mShuffle != s);`
   If `s != 0`: `reshuffle = uri.getBooleanQueryParameter("reshf", false);` else `reshuffle = false`.
   → **query param `reshf`** = "re-shuffle this entity".
2. **Entity resolution.** `x2 e = mRestLibrary.m2442(uri);`
   If not an `o0`, unwrap via `((w1)e).mo2427()`; if still not `o0` →
   log `"toUriCore failed to match filesUri=..."` and **return -6**.
3. **Shuffle downgrade.** `if (s == 1 && !noCur && (e instanceof t2)) s = 2;`
4. **Files URI.** `Uri filesUri = prepareFilesUri(e, uri, s);`
5. **Parent category.** `f4 cat = getParentCategoryListUriMatch(e, filesUri, s);`
   → `cat.f3309` = parent entity, `cat.B` = category list URI.
6. **Target id.** `long targetId = e.mo2425(filesUri);`
7. **CUE/queue id remap.** `if (cat.f3309 instanceof w1) { long n = ((w1)cat.f3309).N(mDb, targetId, s == 2 && C0732.U.f3789); remapped = (n != targetId); targetId = n; }`
8. **Raw-file mode.** If `mRawFileMode`: if entity is `p3` (getRawFiles) return based on current
   track validity; otherwise exit raw mode.
9. **Reuse decision.** Reload the cursor unless the previous `mFilesUri` has the same path **and**
   the same query (`TUtils.y(...)`) — i.e. **an identical playlist URI reuses the loaded cursor**.
10. **Load.** `loadFilesCursorAndSetState(filesUri, e, catCursor, cat, s, ..., remapped, 0, reshf, noCur)`
    On success (>0) the new cursors are installed: `mCatCursor = cursor; mCatUriMatch = cat;`
11. **Position.** `moveFilesCursorToId(uri)`; if it fails and `isQueueMode()` →
    `moveToFirstNotPlayedQueueEntryOrLast()`; else fall back to `moveToFirst()`.
12. **Commit.** `if (result > 0) commitShuffle(s);`

Return codes: `>0` success; `-6` = failure (unmatched entity, null/empty cursor).

**Query parameters consumed [observed]**: `reshf` (re-shuffle), `shf_no_cur` (shuffle excluding
current track), plus `shs` / `lim` / `no_empty` handled lower down in the provider (see DB slice).

---

## 4. `getParentCategoryListUriMatch` — how a playlist becomes playable

Given the files entity and URI, it derives the **parent category list** (e.g. the playlists list) and
the **parent entity**. This is what enables Poweramp's "next/previous category" navigation
(`nextCategory`/`prevCategory`) while playing a playlist — the queue remembers it is *inside*
the "Playlists" category and which playlist it came from.

`loadListMeta(f4 cat, Uri)` → `rest.library.j2` supplies the list header/aggregate metadata.
`getPrevNextCategoryName(cursor, cat, boolean)` supplies the neighbouring category labels.

---

## 5. How this ties to the DB (cross-check with findings-db.md)

`loadFilesCursorAndSetState` obtains its cursor from the ContentProvider **[observed]**:
```java
cursorA = this.mContentProvider.A(uriToLoad, null, null, null, null, false);
```
So the queue cursor for a playlist is produced by the SQL described in `findings-db.md`:
```sql
SELECT ...
FROM playlist_entries
LEFT JOIN folder_files ON folder_files._id = folder_file_id
LEFT JOIN folders      ON folders._id      = folder_id
LEFT JOIN albums       ON albums._id       = folder_files.album_id
LEFT JOIN artists      ON artists._id      = folder_files.artist_id
WHERE playlist_id = ? AND (folder_files.cue_folder_id IS NULL)
ORDER BY sort
```
therefore **`mFilesCursor` iterates playlist tracks in `sort` order** — the ordering is decided in SQL,
not in Java.

There is a **self-call guard** **[observed]**: `if (i2 < 3) return loadFilesCursorFromCatCursor(..., i2+1, ...);`
else `Log.e("RestNowPlaying", "loadFilesCursorAndSetState too much self calls ..."); return -6;`
— i.e. at most 3 levels of recursive category descent.

Random-playlist handling **[observed]**: when `i == 1` (shuffle) the loader rebuilds the URI from
`mRestLibrary.getFiles().B0().buildUpon()` and appends `?shs=1`, internally calling
`reshuffleEntity(targetId, entity, uri, ..., ...)` — so **shuffled playback of a playlist is realised by
reading from the global FILES entity with a shuffle order, not from the playlist table itself**.
This is an important behavioural subtlety: shuffle+playlist ⇒ queue is a shuffle-ordered view over files.

---

## 6. Provider / URI facts confirmed at the source

```java
// rest.library.g1.<init>
Uri uriBuild = new Uri.Builder()
        .scheme("content")
        .authority("com.maxmpz.audioplayer.data")
        .build();
this.B  = uriBuild;
this.f3314 = new f4(this, uriBuild);
```
→ **base URI = `content://com.maxmpz.audioplayer.data`** **[observed]**

Playlist entity constants from `rest.library.j3.<clinit>` (**smali**, exact) **[observed]**:
```
playlists.__id__  : {"playlists._id"}
entries          : {"folder_files._id", "playlist_entries._id"}
playlist name col: {"playlists.playlist"}
```

---

## 7. Entity taxonomy (`rest.library.g1` accessors) — what "a playlist" is next to

`g1` is the single library façade. Playlist-relevant entries **[observed]**:
| accessor | entity class |
|---|---|
| `getPlaylists()` | `j3` (playlist list) |
| `j3.Z0()` | `k3` (playlist entries) |
| `getQueue()` | `m3` (now-playing queue) |
| `getQueueFilesForced()` | `n3` |
| `getFiles()` | `n0` (all audio files) |
| `getRawFiles()` | `p3` (files not in library) |
| `getFolders()` / `getFoldersHier()` | `t0` / `x0` |
| `getAllTracks()` / `getAlbums()` / `getArtists()` / `getGenres()` | `r` / `j` / `t` / `z0` |
| `getSearch()` | `v3` |
| `getRecentlyAdded()` / `getRecentlyPlayed()` / `getMostPlayed()` | `q3` / `r3` / `h3` |

Each entity exposes `X0(...)` (URI → SQL fragment) — the same hook pattern as `j3`/`k3` in the DB slice.

---

## 8. Evidence table

| Claim | Class#method | Observation |
|---|---|---|
| Playback entry point | `player.PlayerService#E` | `b0Var.getShuffleMode(); ... L(this.y.toUri(uri, z, -1, false, intent), i, i2, (i3==1||i3==2)?5:0, i3, "play ".concat(str))` |
| Queue manager is `player.b0` | `PlayerService` field `y` : `com.maxmpz.audioplayer.player.b0` | class summary field list |
| `L()` is "play in now-playing" | `PlayerService#L` | `g0 track = this.y.getTrack(); ... return J(track, i7, i3, i6, i8, false, "playWhatInNp "+str)` |
| Resolution algorithm | `player.b0#toUriCore` | full method read (see §3) |
| Failure code -6 | `b0#toUriCore` | `return -6` with `Log.e("RestNowPlaying", "toUriCore got null catCursor ...")` |
| Query param `reshf` | `b0#toUriCore` | `uri.getBooleanQueryParameter("reshf", false)` |
| Query param `shf_no_cur` | `b0#toUriCore` | `uri.getBooleanQueryParameter("shf_no_cur", false)` |
| Cursor-based queue | `b0` fields | `android.database.Cursor mFilesCursor`, `mCatCursor` |
| Shuffle via files entity | `b0#loadFilesCursorAndSetState` | `mRestLibrary.getFiles().B0().buildUpon() ... appendQueryParameter("shs","1")` |
| Recursion guard = 3 | `b0#loadFilesCursorAndSetState` | `if (i2 < 3) return loadFilesCursorFromCatCursor(..., i2+1, ...)` else `"too much self calls"` |
| Provider used for cursors | `b0#loadFilesCursorAndSetState` | `this.mContentProvider.A(uri2, null, null, null, null, false)` |
| Base content URI | `rest.library.g1#<init>` | `new Uri.Builder().scheme("content").authority("com.maxmpz.audioplayer.data").build()` |
| Playlist projections | `rest.library.j3#<clinit>` | `{"playlists._id"}`, `{"folder_files._id","playlist_entries._id"}`, `{"playlists.playlist"}` |
| Provider is RestProvider | `AndroidManifest.xml` | `<provider android:authorities="com.maxmpz.audioplayer.data" ... android:name="com.maxmpz.audioplayer.rest.RestProvider"/>` |
| PlayerService is exported service | `AndroidManifest.xml` | `<service android:name="com.maxmpz.audioplayer.player.PlayerService" android:foregroundServiceType="mediaPlayback">` with `API_COMMAND` filters incl. `content` scheme + `vnd.android.cursor.item/vnd.maxmpz.row` |
| Playlist UI activities | `AndroidManifest.xml` | `PlaylistSelectActivity`, `PlaylistSortActivity`, `PlaylistsExportActivity`, `PlaylistShortcutActivity` (all `@style/Dialog`) |

---

## 9. Unknowns / not pursued

1. `PlayerService.J(...)` body (actual track start / pipeline handoff) not decompiled.
2. `prepareFilesUri` and `getParentCategoryListUriMatch` bodies not decompiled — the exact
   URI rewrite rules (how a playlist URI becomes a files URI) remain unread.
3. `b0#loadFilesCursorAndSetState` was returned with heavy JADX control-flow damage
   ("Code duplicated", "Type inference failed"); the *structure* is reliable but per-branch
   exactness is not. Confirmed facts only: provider call, `shs=1` rebuild, 3-level guard, -6 codes.
4. Shuffle ORDER BY expression (`AbstractC0743.V0()`) unresolved (also noted in DB slice).
5. The URI path token for the playlists entity (e.g. `/playlists`) was not read out of the
   segment matcher (`z5.B` / `com.maxmpz.rest.*`); the *base* URI is confirmed but the
   per-entity segment string is not. The table name `playlists` is confirmed independently.
6. Whether `libpowerampcore.so` participates in queue assembly — no JNI signature for playlist
   loading was observed; the Java path fully explains the observed behaviour.
