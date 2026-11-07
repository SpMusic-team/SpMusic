# Poweramp playlist persistence layer — RE findings

Target: `D:\SpMusic\.rea-analysis\Poweramp-v3.apk`
Package `com.maxmpz.audioplayer`, versionName `build-1025-uni`, versionCode `1025009`, minSdk 21, targetSdk 35.
APK SHA-256 `4467fdac3e89b98485866e454bc3b7dc2d73d788d7a1aa9c73ea1028d36b82e0`. Provider: JADX 0.7.1 (headless), Apktool 3.0.3 for manifest.

Labels: **[observed]** = literal string / decompiled code I read. **[inferred]** = my reasoning from observed code.

---

## Summary

- **The playlist DB is plain Java SQLite.** `com.maxmpz.audioplayer.data.C0633` extends `SQLiteOpenHelper`; the file is **`folders.db`**, schema version **244**, opened with `setWriteAheadLoggingEnabled(true)` and `setMaxSqlCacheSize(55)`. No JNI/SQLite involvement for the playlist schema — it is all `execSQL`/`rawQuery`/`rawQueryWithFactory`. **[observed]**
- **Only two playlist tables exist**: `playlists` and `playlist_entries`. There is no `tracks`/`files` table — audio rows live in **`folder_files`**, and playlists join to it. **[observed]**
- **`playlist_entries.sort` is the intra-playlist track order.** The entity sets `i1Var.B = "sort"` (the default ORDER BY) and the URI translates to `WHERE playlist_id=?`. **[observed]**
- **`playlist_entries` is a soft reference by path/name, not a hard FK.** `folder_file_id` can be `NULL`; entries keep `folder_path`, `file_name`, `cue_offset_ms` and are re-resolved to `folder_files._id` by a dedicated reconciler `j3.c1(db)` that runs multi-pass temp-table matching. **[observed]**
- **Playlists are NOT modelled as folders.** They were once `folder_playlists` / `folder_playlist_entries` and were renamed/migrated into standalone `playlists` tables at schema step **`B.E` (M83_beta)**. `folders` is the filesystem tree only. **[observed]**
- **The ContentProvider authority is `com.maxmpz.audioplayer.data`, served by `com.maxmpz.audioplayer.rest.RestProvider`.** **[observed]**
- **`data.aa.AAContentProvider` (authority `com.maxmpz.audioplayer.aa`) is a secondary provider, not the playlist path** — its `query()` and `getType()` are literal `return null` stubs. See the dedicated section. **[observed]**
- **URI segments are matched by a hand-rolled matcher, not `UriMatcher`**: `z5.B(library, uri.getPathSegments())` returns an entity interface; the entity's `X0(...)` then sets the SQL table name and appends WHERE terms. **[observed]**
- **There is an explicit LIMIT injection guard** — a `Pattern` `\\s*[\\d?]+\\s*(,\\s*[\\d?]+\\s*)?` applied to the `lim` query parameter, throwing `IllegalArgumentException("invalid LIMIT clauses:…")` on mismatch. `selection`/`selectionArgs` are **not** sanitised (passed straight to `rawQueryWithFactory`). **[observed]**
- **No `UriMatcher`/allow-list of columns** was found; projections come from caller-supplied `String[]` merged with an entity default column list. **[observed]**

---

## RestProvider vs AAContentProvider — which one serves playlists

| | `rest.RestProvider` | `data.aa.AAContentProvider` |
|---|---|---|
| Manifest authority | `com.maxmpz.audioplayer.data` | `com.maxmpz.audioplayer.aa` |
| `exported` | `true` | `true` |
| `query()` body | delegates to `A(uri, …, false)` → real SQL engine | **`return null`** (literal stub) **[observed]** |
| `getType()` | delegated | **`return null`** (literal stub) **[observed]** |
| Fields | `rest.library.g1 A`, `data.A B`, `MilkRestProvider X`, `boolean x`, `Pattern y` | `rest.library.g1 A`, `bitmaps.А B`, `ThreadLocal X`, `int x` |
| Role | **primary library/playlist provider** | secondary; effectively inert for queries |

**`RestProvider` is the one that serves playlists.** Confirmed independently: `player.b0` (queue manager) holds `rest.RestProvider mContentProvider` + `rest.library.g1 mRestLibrary` + raw `SQLiteDatabase mDb`, and `RestProvider.A(...)` is the only method in either provider that touches `getWritableDatabase()` and builds SQL. **[observed]**

`AAContentProvider` also holds a `g1` field, so it was likely a parallel/legacy entry point (audio-effect presets per its authority name suggest), but in this build its query path is dead code. **[inferred]**

`RestProvider` also falls back to `com.maxmpz.milk.data.MilkRestProvider` (authority `com.maxmpz.milk.data`) when the URI matches no library entity — that is the Milkdrop preset provider, unrelated to playlists. **[observed]**

---

## Tables & Columns

### `playlists`

Created in `migrations.B.E` (`M83_beta`), later columns added by `onUpgrade` and `migrations.B.D`:

```sql
-- as created (migrations.B.E)
CREATE TABLE playlists (
  _id            INTEGER PRIMARY KEY,
  playlist       TEXT,
  mtime          INTEGER DEFAULT 0,
  created_at     INTEGER DEFAULT 0,
  updated_at     INTEGER,
  playlist_path  TEXT,
  played_at      INTEGER NOT NULL DEFAULT 0,
  aa_status      INTEGER NOT NULL DEFAULT 0,
  num_files      INTEGER DEFAULT 0,
  shuffle_order  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS playlists_shuffle_order ON playlists(shuffle_order);
CREATE TRIGGER IF NOT EXISTS playlists_trigger DELETE ON playlists BEGIN
  DELETE FROM playlist_entries WHERE playlist_id = old._id;
END;
```

Columns added later — **[observed]** literals, schema steps in brackets:

```sql
ALTER TABLE playlists ADD COLUMN num_all_files    INTEGER NOT NULL DEFAULT 0;  -- migrations.B.D case 4  (M85)
ALTER TABLE playlists ADD COLUMN keep_list_pos    INTEGER NOT NULL DEFAULT 0;  -- onUpgrade i<118
ALTER TABLE playlists ADD COLUMN keep_track_pos   INTEGER NOT NULL DEFAULT 0;  -- onUpgrade i<118
ALTER TABLE playlists ADD COLUMN duration         INTEGER NOT NULL DEFAULT 0;  -- onUpgrade i<125
```

Net effective `playlists` schema **[inferred, union of the above + query usage]**:

```
_id, playlist, playlist_path, mtime, created_at, updated_at, played_at,
aa_status, num_files, num_all_files, shuffle_order, keep_list_pos,
keep_track_pos, duration
```

Confirmed column usage from other observed SQL: `playlists.num_files` (no_empty filter), `playlists.played_at` (recomputed), `playlists.playlist` (default name column), `playlists.playlist_path` (path reconciliation).

**No `name` column.** The display-name column is **`playlist`**. **[observed]** — `j3.<clinit>`: `const-string "playlists.playlist"`.

### `playlist_entries`

Created in `C0633.onUpgrade` at the `i <= 0` / fresh-install branch:

```sql
-- fresh install (C0633.onUpgrade, i <= 0)
CREATE TABLE IF NOT EXISTS playlist_entries (
  _id            INTEGER PRIMARY KEY,
  folder_file_id INTEGER,
  playlist_id    INTEGER
);
CREATE INDEX IF NOT EXISTS playlist_entries_index1 ON playlist_entries(playlist_id);
CREATE INDEX IF NOT EXISTS playlist_entries_index2 ON playlist_entries(folder_file_id);
```

Columns added later — **[observed]**:

```sql
ALTER TABLE playlist_entries ADD COLUMN sort          INTEGER;                      -- i<30, then UPDATE ... SET sort=_id
ALTER TABLE playlist_entries ADD COLUMN shuffle_order  INTEGER DEFAULT 0;           -- migrations.B.E
ALTER TABLE playlist_entries ADD COLUMN folder_path    TEXT;                        -- migrations.B.F  (M90_playlists)
ALTER TABLE playlist_entries ADD COLUMN file_name      TEXT;                        -- migrations.B.F
ALTER TABLE playlist_entries ADD COLUMN cue_offset_ms  INTEGER;                     -- migrations.B.F
ALTER TABLE playlist_entries ADD COLUMN played_at      INTEGER NOT NULL DEFAULT 0;  -- i<118
```
```sql
CREATE INDEX IF NOT EXISTS folder_playlists_sort_index ON playlist_entries(sort);   -- i<30
CREATE INDEX IF NOT EXISTS playlist_entries_played_at  ON playlist_entries(played_at); -- i<118
```

Net effective `playlist_entries` schema **[inferred]**:

```
_id, playlist_id, folder_file_id (nullable), sort, shuffle_order,
folder_path, file_name, cue_offset_ms, played_at
```

### `folder_files` (the audio row table — joined, not playlist-specific)

Established from migration ALTERs and the join clauses (never fully re-created in the reachable code, so this is a **lower bound**) **[observed]**:

```
_id, name, track_number, name_without_number, tag_status, track_tag, folder_id,
artist_tag, album_tag, title_tag, duration, updated_at, file_type, file_created_at,
offset_ms, cue_folder_id, rating, played_times, total_played_times, album_id,
artist_id, composer_id, album_artist_id, aa_status, year, played_at, path,
thumb_status, thumb, created_at, shuffle_order, meta, wave BLOB,
last_pos, url, in_playlist
```

### Supporting tables touched by playlist SQL

`folders`, `albums`, `artists`, `album_artists`, `folders` (tree: `parent_id`), `queue`.
`queue` is the now-playing list (separate from playlists):
```sql
CREATE TABLE queue (_id INTEGER PRIMARY KEY, folder_file_id INTEGER,
                    created_at INTEGER NOT NULL DEFAULT 0, sort INTEGER);
```

---

## Query path

### Authority and URI shape

```
content://com.maxmpz.audioplayer.data/<segment>[/<id>][?no_empty=1][?lim=N[,M]][?shs=0|1]
```

### Method chain (observed)

1. **`RestProvider.query(uri, proj, sel, selArgs, sort)`**
   → `return A(uri, proj, sel, selArgs, sort, false);` — one line, nothing else.

2. **`RestProvider.A(uri, proj, sel, selArgs, sort, z)`** — the dispatcher:
   - `InterfaceC0837 e = z5.B(B(), uri.getPathSegments());` — resolve path segments to a **URIMatch** descriptor. `B()` returns the `rest.library.g1` library singleton.
   - `h0 h = h1.d(e);` — map the URIMatch to an **entity** (`AbstractC0743` / `AbstractC0735` / `n2` subtype).
   - If neither resolves → delegate to `MilkRestProvider X`.
   - `SQLiteDatabase db = getWritableDatabase();` — **read queries go through the writable handle.** If null → log `"query=… no db"`, return null.
   - Two branches:
     - `n2` subtype (`AbstractC0838`) → `n2Var.c0(...)` builds the query object itself (cursor-window/paged path).
     - everything else → entity hook selects one of three builders:
       - `w0` → `((x0)((y2)h)).b1(uri, r, null, null, args, i1, false)`
       - `com.maxmpz.rest.B` → `((AbstractC0743)h).Q0(uri, r, args, i1)`
       - `AbstractC0735` → `((AbstractC0735)h).N0(uri, r, args, i1)`
   - Those hooks return the **default projection** `String[]`; if caller passed `proj == null` it is replaced by that default.
   - Query parameters handled here:
     - **`no_empty`** — handled inside the entity (see below).
     - **`shs`** — shuffle: if present and not `"0"`/`"false"`, `sortOrder` is replaced by `((AbstractC0743)h).V0()`.
     - **`lim`** — limit. If it contains a comma **or** at all, it is passed through a regex guard:
       ```java
       Pattern.compile("\\s*[\\d?]+\\s*(,\\s*[\\d?]+\\s*)?")
       if (!p.matcher(lim).matches())
           throw new IllegalArgumentException("invalid LIMIT clauses:" + lim);
       ```
       On success the limit is appended as `"<groupBy-or-1> LIMIT " + lim`. **This is the only allow-list/injection guard in the whole path.** **[observed]**
   - Final: `return r.K(rq, db, proj, sel, selArgs_merged, groupBy, sortOrder, limitPart);`

3. **`player.r.K(rq, db, proj, sel, selArgs, groupBy, sortOrder, limit)`** — the executor:
   ```java
   if (rq.A == null) return null;              // rq.A = table/join string, must be set by the entity
   return db.rawQueryWithFactory(
       (C0629) rq.x,                           // cursor factory (C0629)
       rq.X(proj, sel, groupBy, sortOrder, limit),  // <-- SQL string assembly
       selArgs,
       SQLiteDatabase.findEditTable((String) rq.A),
       null);
   ```

4. **`player.r.X(proj, sel, groupBy, sortOrder, limit)`** — the SQL builder. Builds, in order:
   ```
   SELECT <comma-joined proj | "*">
   FROM   <rq.A>                    // table OR join expression
   [WHERE (rq.<StringBuilder X>) AND (<sel>)]
   [GROUP BY <groupBy>]
   [ORDER BY <sortOrder>]
   [LIMIT <limit>]
   ```
   The WHERE is `(entityBuilder) AND (callerSelection)` — both parenthesised and ANDed. Caller `sel` goes in raw. **[observed]**

### Playlist-specific entity map

| URI-ish | entity | SQL table / join |
|---|---|---|
| playlists | `rest.library.j3` | `playlists` |
| playlist entries | `rest.library.k3` | `playlist_entries LEFT JOIN folder_files …` |

Reached via `g1.getPlaylists()` → lazily `f3322` → `j3`; `j3.Z0()` → `k3`.
`k3.t1()` returns `this.f3406.getPlaylists()` (back-reference to `j3`), confirming parent/child.

**`j3.Q0` / `j3.X0` (playlist list) — verbatim observed:**
```java
rVar.A = "playlists";
if (uri.getBooleanQueryParameter("no_empty", false)) {
    rVar.B("playlists.num_files");
    rVar.B("!=0 ");
}
androidx.appcompat.widget.n.m313(str, f3342, sb, arrayList);   // append caller selection
i1Var.B = C0915.m3148(C0742.U.f3810);                          // default ORDER BY
return x;                                                       // {"playlists._id"}
```
So `no_empty=1` → `WHERE (playlists.num_files != 0) AND (…)`.

**`k3.X0` (entries of one playlist) — verbatim observed:**
```java
rVar.A = "playlist_entries LEFT JOIN folder_files ON folder_files._id=folder_file_id "
       + "LEFT JOIN folders ON folders._id=folder_id "
       + "LEFT JOIN albums ON albums._id=folder_files.album_id "
       + "LEFT JOIN artists ON artists._id=folder_files.artist_id"
       + (albumArtistsEnabled ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id" : "");

rVar.B("playlist_id=?");
arrayList.add(androidx.appcompat.widget.f.d(uri));   // <-- playlist id from the LAST path segment
if (!cueFoldersEnabled) rVar.B(" AND ") ; rVar.B("folder_files.cue_folder_id IS NULL");
n.m313(str, strArr, sb, arrayList);                  // caller selection
i1Var.B = "sort";                                     // <-- DEFAULT ORDER BY = sort
return j3.y;                                          // {"folder_files._id", "playlist_entries._id"}
```

**Net SQL for playlist tracks** **[inferred from the above]**:
```sql
SELECT <proj or *>
FROM playlist_entries
LEFT JOIN folder_files ON folder_files._id = folder_file_id
LEFT JOIN folders      ON folders._id      = folder_id
LEFT JOIN albums       ON albums._id       = folder_files.album_id
LEFT JOIN artists      ON artists._id      = folder_files.artist_id
[LEFT JOIN album_artists ON album_artists._id = folder_files.album_artist_id]
WHERE (playlist_id=? [AND folder_files.cue_folder_id IS NULL]) AND (<selection>)
ORDER BY sort          -- unless ?shs overrides or caller sortOrder given
```

### Static column constants (from `<clinit>` smali, verbatim)

`j3` (playlists):
```
x = {"playlists._id"}
y = {"folder_files._id", "playlist_entries._id"}
у = {"playlists.playlist"}
```

`k3` (entries) — title/album/artist COALESCE projections:
```
р  = {"COALESCE(title_tag,file_name)", "COALESCE(album,'')", "COALESCE(artist,'')"}
p  = {"COALESCE(folder_files.name,file_name)", "COALESCE(album,'')", "COALESCE(artist,'')"}
О  = {"COALESCE(title_tag,file_name)", "COALESCE(album,'')",
      "COALESCE(CASE folder_files.album_artist_id WHEN 1000 THEN artist ELSE album_artist END,'')"}
O  = {"COALESCE(folder_files.name,file_name)", "COALESCE(album,'')",
      "COALESCE(CASE folder_files.album_artist_id WHEN 1000 THEN artist ELSE album_artist END,'')"}
```
(`1000` is a sentinel "unknown album artist" id — consistent with `DELETE FROM artists WHERE _id!=1000` in migrations.)

### selection / selectionArgs / sortOrder translation — summary

| provider arg | becomes | sanitised? |
|---|---|---|
| `projection` (`String[]`) | `SELECT a, b, c` (null → entity default, then `*`) | no |
| `selection` | `(entityPredicate) AND (selection)` appended into WHERE | **no** |
| `selectionArgs` | passed verbatim to `rawQueryWithFactory` (entity args prepended) | no |
| `sortOrder` | `ORDER BY …` (entity default `sort` / `_id`, overridden by `shs` query param) | **no** |
| `?lim` | `LIMIT <lim>` | **YES — regex guard** |
| `?no_empty` | `playlists.num_files != 0` | boolean, safe |
| `?shs` | shuffle-order substitution | boolean-ish, safe |

---

## Ordering — how track order inside a playlist works

- **`playlist_entries.sort` (INTEGER) is the authoritative order.** Set as the default `ORDER BY` by `k3.X0` (`i1Var.B = "sort"`). **[observed]**
- Introduced at schema step `i < 30`, backfilled:
  ```sql
  ALTER TABLE playlist_entries ADD COLUMN sort INTEGER;
  CREATE INDEX IF NOT EXISTS folder_playlists_sort_index ON playlist_entries(sort);
  UPDATE playlist_entries SET sort=_id;
  ```
  So on legacy DBs order == insertion id until reordered. **[observed]**
- **Shuffle is separate and non-destructive**: `playlist_entries.shuffle_order` (added in `B.E`) plus `playlists.shuffle_order`. Selecting `?shs` swaps the ORDER BY to the entity's `V0()` (shuffle ordering) rather than mutating `sort`. **[observed]** for the column + code, **[inferred]** for "non-destructive" intent.
- A parallel `queue` table uses the same idiom (`queue.sort`, `queue.shuffle_order`), so **`sort` is a project-wide ordering convention**, not playlist-specific.

---

## Migrations

**Version constant: `244`.** `C0633` ctor: `super(app, "folders.db", null, 244)` → `onCreate` calls `onUpgrade(db, 0, 244)`.

Playlist-relevant steps, in order **[all observed literals]**:

| Step (`i <`) | Where | What |
|---|---|---|
| fresh (`i <= 0`) | `C0633.onUpgrade` | `CREATE TABLE playlist_entries(_id, folder_file_id, playlist_id)` + `_index1`(playlist_id) + `_index2`(folder_file_id) |
| `i < 30` | `C0633.onUpgrade` | `playlist_entries.sort` + `folder_playlists_sort_index` + `UPDATE … SET sort=_id` |
| `i < 40` | `migrations.B(0).D` | folders/folder_files indexes, `queue` rebuild, albums/artists/genres/composers/artist_albums, triggers, `eq_preset_songs` |
| `i < 83` | `migrations.B(3).D` → `B.E` (`M83_beta`) | **the big playlist migration** (below) |
| `i < 90` | `migrations.B(5).D` → `B.F` (`M90_playlists`) | `playlist_entries.folder_path`, `file_name`, `cue_offset_ms` + backfill from `folder_files`/`folders` |
| `i < 106` | `B(27)` then `B(3)` | milk_presets; also re-runs `B.E` |
| `i < 112` | `migrations.B(4).D` case 4 (`M85`) | `playlists.num_all_files`, `folders.sort_path` |
| `i < 118` | `C0633.onUpgrade` | `playlist_entries.played_at` + index; `playlists.keep_list_pos`, `keep_track_pos`; same two on `folders` |
| `i < 125` | `C0633.onUpgrade` | `playlists.duration` |
| `i < 126` | `migrations.B(6).D` (`M92_folders_short_name`) | `folders.short_name` + index |
| `i < 242` | `C0633.onUpgrade` | `folder_files.in_playlist` + backfill `UPDATE folder_files SET in_playlist=EXISTS(SELECT 1 FROM playlist_entries WHERE folder_file_id=folder_files._id)` |
| `i < 244` | `C0633.onUpgrade` | `C0621(app, db)` — AutoEQ preset rebuild (audio, not playlists) |

### The playlist migration proper — `migrations.B.E` (level index 3, guard `i < 83`, log tag `M83_beta`)

Verbatim observed sequence:
```sql
-- 1. new denormalised table
CREATE TABLE playlists(_id INTEGER PRIMARY KEY, playlist TEXT,
  mtime INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0, updated_at INTEGER,
  playlist_path TEXT, played_at INTEGER NOT NULL DEFAULT 0,
  aa_status INTEGER NOT NULL DEFAULT 0, num_files INTEGER DEFAULT 0,
  shuffle_order INTEGER DEFAULT 0);

-- 2. copy from the old folder-coupled table
INSERT INTO playlists(_id, playlist, mtime, created_at, updated_at, playlist_path, played_at)
  SELECT _id, name, mtime, created_at, updated_at, path, played_at FROM folder_playlists;

-- 3. drop old parent
DROP TABLE IF EXIST folder_playlists;          -- sic: "EXIST" typo in the original literal

-- 4. rename old child
ALTER TABLE folder_playlist_entries RENAME TO playlist_entries;

-- 5. shuffle columns + indexes + cascade trigger
ALTER TABLE playlist_entries ADD COLUMN shuffle_order INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS playlist_entries_shuffle_order ON playlist_entries(shuffle_order);
CREATE INDEX IF NOT EXISTS playlists_shuffle_order       ON playlists(shuffle_order);
CREATE TRIGGER IF NOT EXISTS playlists_trigger DELETE ON playlists BEGIN
  DELETE FROM playlist_entries WHERE playlist_id = old._id;
END;
```
**This is the key architectural fact**: old Poweramp modelled playlists as folders (`folder_playlists`, `folder_playlist_entries`); the modern build detaches them into standalone `playlists`/`playlist_entries`. Note the `DROP TABLE IF EXIST` typo — it is inside a `try/catch(Throwable){}` that swallows it, so the drop silently no-ops on upgrade. **[observed]**

### Path-based re-linking — `j3.c1(SQLiteDatabase)` (returns count of repaired entries)

Runs in a transaction, `beginTransactionNonExclusive()`. Purpose: **re-resolve `playlist_entries.folder_file_id` when files were rescanned and got new `_id`s.**

1. **Invalidate stale links**:
   ```sql
   UPDATE playlist_entries SET folder_file_id=NULL
   WHERE _id NOT IN (
     SELECT playlist_entries._id FROM playlist_entries, folder_files, folders
     WHERE folder_file_id=folder_files._id
       AND folder_files.name=playlist_entries.file_name COLLATE NOCASE
       AND folders.path=folder_path COLLATE NOCASE
       AND folder_files.folder_id=folders._id
       AND (folders.is_cue=0 OR folder_files.offset_ms=cue_offset_ms))
   AND folder_file_id IS NOT NULL AND folder_path IS NOT NULL AND file_name IS NOT NULL
   ```
2. If `SELECT COUNT(_id) FROM playlist_entries WHERE folder_file_id IS NULL` > 0, run **four escalating match strategies**, each: `CREATE TEMP TABLE _unresolved_playlist_entries AS …` → `UPDATE playlist_entries SET folder_file_id=(SELECT file_id …), folder_path=COALESCE(NULLIF((SELECT path …),''), folder_path)` → `DROP TABLE`:
   - (a) parent_name/short_name `LIKE '%'||'/'||folders.parent_name||'/'||folders.short_name||'/'` (or folder_path empty)
   - (b) short_name-only `LIKE` variant
   - (c) `folders.parent_name||'/'` with `folders.is_cue!=0` and `offset_ms=cue_offset_ms` (CUE sheet case)
   - (d) `INNER JOIN playlists … SUBSTR(playlist_path,1,LENGTH(playlist_path)-LENGTH(playlist))=folders.path` (playlist-file-relative)
   - (e) last resort: match name + folder only
3. If anything was repaired → `C0915.m3147(db, 0L)` (invalidate library caches).

**Design consequence for a re-implementation**: playlist membership is *path-derived and re-derivable*, not a hard FK. `folder_file_id` is a cache; `folder_path` + `file_name` (+ `cue_offset_ms`) is the durable identity.

### Playlist aggregate refresh — `j3.Y0(db)`
```sql
UPDATE playlists SET played_at=
IFNULL((SELECT MAX(folder_files.played_at) FROM folder_files
        INNER JOIN playlist_entries ON playlist_entries.folder_file_id=folder_files._id
        WHERE playlist_entries.playlist_id=playlists._id), 0)
```

---

## Where the raw SQL actually executes

**Java, not JNI.** Evidence:

- `C0633 extends android.database.sqlite.SQLiteOpenHelper`; every schema statement is `SQLiteDatabase.execSQL(String)`. **[observed]**
- Queries: `SQLiteDatabase.rawQueryWithFactory(factory, sql, args, editTable, cancellationSignal)` in `player.r.K`, plus `rawQuery`/`compileStatement` in migrations. **[observed]**
- `RestProvider.getWritableDatabase()` / `mo1939()` return `android.database.sqlite.SQLiteDatabase` directly. **[observed]**
- `C0633.setWriteAheadLoggingEnabled(true)`, `setMaxSqlCacheSize(55)` — framework APIs. **[observed]**
- There *is* a SQLiteStatement cache: `rest.library.c3` held by `player.b0` as `mStatementCache` (`j3.h0(...)`, `k3` take a `c3`), i.e. prepared-statement reuse on the Java side. **[observed]**
- `lib/arm64-v8a/libpowerampcore.so` and `libyayicn.so` exist in the APK, but **no playlist table/column literal was found leading into JNI**. The schema is 100% Dex. **[observed for "no JNI SQL found"; "native does something else" is inferred]**

**Caveats / limits of this claim**: I did not audit all 6218 classes for `native` declarations, so I cannot prove no native SQLite exists anywhere. For the *playlist schema and playlist query path specifically*, every literal I found is in Java.

---

## Evidence

| Claim | Class#method | What was observed |
|---|---|---|
| DB file name / version / WAL | `data.C0633#<init>` | `super(app, "folders.db", (CursorFactory)null, 244); setWriteAheadLoggingEnabled(true);` |
| Current schema version = 244 | `data.C0633#onCreate` | `onUpgrade(sQLiteDatabase, 0, 244);` |
| Fresh install creates `playlist_entries` | `data.C0633#onUpgrade` (`i<=0`) | `CREATE TABLE IF NOT EXISTS playlist_entries (_id INTEGER PRIMARY KEY, folder_file_id INTEGER, playlist_id INTEGER)` + 2 indexes |
| `sort` column + backfill | `data.C0633#onUpgrade` (`i<30`) | `ALTER TABLE playlist_entries ADD COLUMN sort INTEGER` ; `UPDATE playlist_entries SET sort=_id` ; `… folder_playlists_sort_index on playlist_entries(sort)` |
| `playlist_entries.played_at`, `playlists.keep_*` | `data.C0633#onUpgrade` (`i<118`) | 6 `ALTER TABLE` calls via `f.u(...)` |
| `playlists.duration` | `data.C0633#onUpgrade` (`i<125`) | `ALTER TABLE playlists ADD COLUMN duration INTEGER NOT NULL DEFAULT 0` |
| `folders.db` is the only SQLite helper | `data.C0633` (class) | methods: `onCreate/onUpgrade/onDowngrade/onOpen/onConfigure/close/mo1939`; `extends SQLiteOpenHelper` |
| `playlists` CREATE TABLE (full) | `data.migrations.B#E` | `CREATE TABLE playlists(_id…, playlist TEXT, mtime…, playlist_path TEXT, played_at…, aa_status…, num_files…, shuffle_order…)` |
| Old→new table rename | `data.migrations.B#E` | `INSERT INTO playlists(…) SELECT _id, name, mtime, created_at, updated_at, path, played_at FROM folder_playlists` ; `ALTER TABLE folder_playlist_entries RENAME TO playlist_entries` ; `DROP TABLE IF EXIST folder_playlists` |
| Playlist cascade trigger | `data.migrations.B#E` | `CREATE TRIGGER … playlists_trigger DELETE ON playlists BEGIN DELETE FROM playlist_entries WHERE playlist_id = old._id; END;` |
| entries are path-identified | `data.migrations.B#F` | `ALTER TABLE playlist_entries ADD COLUMN folder_path TEXT / file_name TEXT / cue_offset_ms INTEGER` + backfill `SET file_name=(SELECT name FROM folder_files WHERE _id=folder_file_id)` |
| `playlists.num_all_files` | `data.migrations.B#D` (case 4) | `ALTER TABLE playlists ADD COLUMN num_all_files INTEGER NOT NULL DEFAULT 0` (log tag `M85`) |
| `playlists` name column is `playlist` | `rest.library.j3#<clinit>` | smali: `const-string "playlists.playlist"` |
| default playlist projection | `rest.library.j3#<clinit>` | smali: `{"playlists._id"}` |
| entries projection | `rest.library.j3#<clinit>` | smali: `{"folder_files._id", "playlist_entries._id"}` |
| playlist table assignment + no_empty | `rest.library.j3#X0` | `rVar.A = "playlists";` ; `if (uri.getBooleanQueryParameter("no_empty", false)) { rVar.B("playlists.num_files"); rVar.B("!=0 "); }` ; `i1Var.B = C0915.m3148(C0742.U.f3810)` |
| entries JOIN + `playlist_id=?` + **`sort` order** | `rest.library.k3#X0` | `rVar.A = "playlist_entries LEFT JOIN folder_files ON folder_files._id=folder_file_id LEFT JOIN folders … LEFT JOIN albums … LEFT JOIN artists …"` ; `rVar.B("playlist_id=?")` ; `arrayList.add(androidx.appcompat.widget.f.d(uri))` ; `i1Var.B = "sort"` |
| CUE exclusion on entries | `rest.library.k3#X0` | `rVar.B(" AND "); rVar.B("folder_files.cue_folder_id IS NULL");` (guarded by `C0742.f3414`) |
| entries title/album/artist COALESCE lists | `rest.library.k3#<clinit>` | `"COALESCE(title_tag,file_name)"`, `"COALESCE(folder_files.name,file_name)"`, `"COALESCE(CASE folder_files.album_artist_id WHEN 1000 THEN artist ELSE album_artist END,'')"` |
| playlist played_at recompute | `rest.library.j3#Y0` | `UPDATE playlists SET played_at=IFNULL((SELECT MAX(folder_files.played_at) … INNER JOIN playlist_entries ON playlist_entries.folder_file_id=folder_files._id WHERE playlist_entries.playlist_id=playlists._id),0)` |
| path re-link reconciler | `rest.library.j3#c1` | 4-pass `CREATE TEMP TABLE _unresolved_playlist_entries …` / `UPDATE playlist_entries SET folder_file_id=(…)` / `DROP TABLE` ; invalidate step `UPDATE playlist_entries SET folder_file_id=NULL WHERE _id NOT IN (…)` |
| provider `query()` is a one-line delegate | `rest.RestProvider#query` | `return A(uri, strArr, str, strArr2, str2, false);` |
| provider dispatcher + `getWritableDatabase` | `rest.RestProvider#A` | `z5.B(B(), uri.getPathSegments())` ; `h1.d(…)` ; `SQLiteDatabase writableDatabase = getWritableDatabase()` ; `r.K(rVar, writableDatabase, …)` |
| **LIMIT injection guard** | `rest.RestProvider#A` | `patternCompile = Pattern.compile("\\s*[\\d?]+\\s*(,\\s*[\\d?]+\\s*)?")` ; `if (!patternCompile.matcher(queryParameter).matches()) throw new IllegalArgumentException("invalid LIMIT clauses:" + queryParameter);` |
| `no db` failure path | `rest.RestProvider#A` | `z5.m1551("RestProvider", "query=" + uri + " no db")` ; `return null` |
| Milk drop-through | `rest.RestProvider#A` | `return milkRestProvider.query(uri, strArrL0, str, strArr2, str2);` when entity resolves to null |
| SQL executor | `player.r#K` | `sQLiteDatabase.rawQueryWithFactory((C0629) rVar.x, rVar.X(strArr, str, str2, str3, str4), strArr2, SQLiteDatabase.findEditTable((String) rVar.A), null)` |
| SQL assembler | `player.r#X` | appends `"SELECT "` → cols or `"* "` → `"FROM "`+`rVar.A` → `" WHERE "` → `" GROUP BY "` → `" ORDER BY "` → `" LIMIT "`; WHERE = `(sb) AND (sel)` |
| `selection` ANDing semantics | `player.r#X` | `sb2.append('('); sb2.append(sb); sb2.append(')'); sb2.append(" AND "); sb2.append('('); sb2.append(str); sb2.append(')')` |
| `AAContentProvider.query` is a stub | `data.aa.AAContentProvider#query` | `return null;` (literal, nothing else) |
| `AAContentProvider.getType` is a stub | `data.aa.AAContentProvider#getType` | `return null;` (literal) |
| authority for playlists | `AndroidManifest.xml` | `<provider android:authorities="com.maxmpz.audioplayer.data" android:exported="true" android:grantUriPermissions="true" android:multiprocess="false" android:name="com.maxmpz.audioplayer.rest.RestProvider"/>` |
| authority for the stub provider | `AndroidManifest.xml` | `<provider android:authorities="com.maxmpz.audioplayer.aa" android:exported="true" android:multiprocess="false" android:name="com.maxmpz.audioplayer.data.aa.AAContentProvider"…/>` |
| playlist entity resolution | `rest.library.g1#getPlaylists` | `return (j3) this.f3322.getValue();` (Kotlin `Lazy`) |
| entry entity back-ref | `rest.library.k3#t1` | `return this.f3406.getPlaylists();` |
| URI→entity matcher call site | `rest.library.g1#m2442` | `h0 h0VarD = h1.d(z5.B(this, uri.getPathSegments()));` |
| projections come from caller | `rest.RestProvider#A` | `if (strArrL0 == null) strArrL0 = strArrN0;` (entity default only when caller passes null) |
| `shs` overrides ORDER BY | `rest.RestProvider#A` | `strV0 = (shs null/""/"0"/"false") ? str2 : ((AbstractC0743)h0VarD).V0()` |
| statement cache exists | `rest.RestProvider` field `B` / `player.b0` | field type `com.maxmpz.audioplayer.rest.library.c3` (per Lead's `player.b0` observation), threaded into `j3.h0(...)`/`k3` |
| no native SQL for schema | negative result across `data.C0633`, `data.migrations.B`, `rest.library.j3`, `rest.library.k3` | every statement is a Java `String` passed to `execSQL`/`rawQuery*`; no `native` declaration encountered |

---

## Unknowns

1. **`z5.B(...)` body not decompiled.** The URI path-segment→entity matcher lives in `com.maxmpz.rest` (interface `InterfaceC0837`, abstract `AbstractC0838`) and `z5` itself did not resolve under any name I tried. So the **exact accepted path segment strings** for playlists (e.g. is it `/playlists`, `/playlist`, `/playlists/<id>/entries`?) are **unresolved**. I inferred `playlists` from `rVar.A = "playlists"` and the entity name, but the literal URI token is not observed.

2. **`h1.d(...)` and `C0915.m3148(...)` bodies not read.** These map URIMatch→entity and resource-id→string. The default ORDER BY for the *playlist list* is `C0915.m3148(C0742.U.f3810)` — a resource-id lookup, value not resolved. For the entries it *is* literally `"sort"`, which is solid.

3. **`C0742` constants class not enumerated.** Feature flags observed by usage — `C0742.O` (album-artists join enabled), `C0742.f3414` (CUE folders enabled), `C0742.f3418` (title source: tag vs filename), `C0742.U.f3810` (playlist list order), `C0742.h`, `C0742.H`, `C0742.g` — but their initialisation/values were not decompiled.

4. **`AbstractC0743.V0()` (shuffle ORDER BY) body not read** — the actual shuffle ORDER BY expression is unknown.

5. **`C0629` cursor factory** — a custom `CursorFactory` is passed to `rawQueryWithFactory`; its window/column behaviour (it likely builds the `CursorWindow28` variant noted in the task) was not decompiled.

6. **`n2`/`AbstractC0838` paged branch.** The `query` path has a second branch for `n2` entities using `c0(rq, uri, args, proj, i1)`; I did not confirm whether playlists ever take that branch (playlists appear to take the `com.maxmpz.rest.B` branch via `AbstractC0743.Q0`). Could matter for `LIMIT`/windowed playlist loading.

7. **Playlist create/rename/delete write paths** (`j3.k`, `j3.b1`, `k3.k`, `k3.l`, `k3.p`, `j3.a1`) were not decompiled — only read paths were required. Column sets for insert/update are therefore unverified.

8. **No `folders`-as-playlists path remains**, but `onUpgrade` still adds `keep_list_pos`/`keep_track_pos` to *both* `playlists` and `folders`, hinting folders also carry playback-position state. Not investigated.

9. **WAL + `folders.db-wal`/`-shm` sidecar handling** on export/import (`PlaylistsExportActivity`) not investigated.

10. **`Drop TABLE IF EXIST folder_playlists` typo** (missing final `S`) — observed literally. Because it is wrapped in `catch (Throwable unused2)`, the legacy table is **never dropped** on upgrade. Whether that leaves a stale `folder_playlists` table in real user DBs is unverified (would need a real DB).

---

# Appendix A — follow-up pass (`j3` internals, projections, exact literals)

Added after the Lead supplied `j3.f0(...)`. All items below are **[observed]** unless marked.

## A.1 Correction to the Lead's hypothesis on `Y0` / `c1`

The Lead suggested `j3.Y0` and `j3.c1` were "likely CREATE TABLE / schema init or count". **They are neither — both were already decompiled in the first pass and are NOT DDL:**

- **`j3.Y0(SQLiteDatabase)`** is a one-statement **aggregate refresh**:
  ```sql
  UPDATE playlists SET played_at=
  IFNULL((SELECT MAX(folder_files.played_at) FROM folder_files
          INNER JOIN playlist_entries ON playlist_entries.folder_file_id=folder_files._id
          WHERE playlist_entries.playlist_id=playlists._id), 0)
  ```
- **`j3.c1(SQLiteDatabase)`** returns `int` and is the **path re-link reconciler** described in §Migrations (4-pass temp-table matching, `beginTransactionNonExclusive()`, `setTransactionSuccessful()`).

The real DDL lives in **`com.maxmpz.audioplayer.data.C0633#onUpgrade`** (`playlist_entries`, fresh install) and **`com.maxmpz.audioplayer.data.migrations.B#E`** (`playlists`). Both are quoted verbatim in §Tables & Columns above — those are the authoritative DDL sources, not `j3`.

## A.2 `j3.f0` — CONFIRMED verbatim (dead-code path)

Lead's literal is **byte-exact**. Full observed body:

```java
@Override // com.maxmpz.audioplayer.rest.library.l1
public final Cursor f0(SQLiteDatabase db, String[] strArr, String[] strArr2, int i) {
    StringBuilder sb = new StringBuilder("SELECT ");
    for (int i2 = 0; i2 < strArr.length; i2++) {
        String str = strArr[i2];
        if (str != null) { if (i2 > 0) sb.append(", "); sb.append(str); }
    }
    sb.append("  FROM playlists LEFT JOIN playlist_entries ON playlists._id=playlist_id"
            + " LEFT JOIN folder_files ON folder_files._id=folder_file_id"
            + " LEFT JOIN folders ON folders._id=folder_id"
            + " LEFT JOIN albums ON albums._id=folder_files.album_id"
            + " LEFT JOIN artists ON artists._id=folder_files.artist_id"
            + " WHERE playlists._id=? AND (folder_files.aa_status IS NULL OR folder_files.aa_status!=2)"
            + " ORDER BY folder_files.aa_status DESC ,sort LIMIT 1");
    return db.rawQueryWithFactory(null, sb.toString(), strArr2, "", null);
}
```

Note the projection is **concatenated with no null-array guard** (`strArr.length` dereferenced) and `rawQueryWithFactory` is called with a **null** CursorFactory and **empty-string** edit-table (`""`), unlike the generic `player.r.K` path which passes `C0629` and `findEditTable(...)`. **[observed]**

**`f0` is a single-playlist "now playing / next track" resolver, not a general list query**: hard-coded `LIMIT 1`, `playlists._id=?`, and `ORDER BY folder_files.aa_status DESC, sort` — i.e. *pick the first still-art-backed track of a playlist by playlist order*. It is the `l1` interface impl. **[inferred role; literal SQL is observed]**

### `aa_status` semantics
`folder_files.aa_status` (`INTEGER`, added in `migrations.B#E` for `folders`/`albums`/`artists`/`album_artists`/`composers`/`genres` and in `migrations.B#D` for `folder_files`) is **album-art status**. `f0` filters `aa_status IS NULL OR aa_status != 2`, and the WHERE/JOIN user of the flag is `j3.f0` only. The literal value `2` is used **only** for this exclusion; the enum defining `2` was **not located** (see Unknowns). **[observed: filter + column; unknown: enum meaning]**

## A.3 Projection constants — `j3.j0()` and `j3.j()` (the column-name constants requested)

Both are literal `new String[]{...}` returns, so these are the **canonical column lists**:

**`j3.j0()`** — playlist-list projection (`interface n1`):
```java
return new String[]{"playlists._id"};
```

**`j3.j()`** — playlist-track/entry projection (`interface i2`):
```java
return new String[]{
  "folder_files._id",
  "COALESCE(folder_files.file_path,path||folder_files.name,folder_files.name)",
  "folders.is_cue",
  "cue_folder_id",
  "folders._id",
  "folder_files._id",
  "file_type"
};
```

Findings from `j()` **[observed]**:
- **`folder_files.file_path` exists** (a new column name not present in the migration ALTERs I collected) — the path resolution is `COALESCE(folder_files.file_path, path||folder_files.name, folder_files.name)`, i.e. prefer an absolute `file_path`, else concatenate `folders.path` + filename, else bare filename. This is the **only place** `folder_files.file_path` appears.
- `path` is unqualified → resolves to `folders.path` from the JOIN.
- `folder_files._id` appears **twice** (positions 0 and 5) — deliberate duplicate so two different cursor consumers can both read index 0/5 without a shared index convention. **[inferred]**
- `cue_folder_id` unqualified (present on both `folders` and `folder_files`; SQLite resolves to whichever the plan picks — in the join chain both are visible, so this is ambiguous but presumably resolves to `folder_files.cue_folder_id`). **[observed literal; resolution inferred]**

**`k3.V()`** returns `"playlist_entries._id"` — the stable row identity for an entry (`interface p0, x2`). **[observed]**

## A.4 `j3.x0(...)` — the search/breadcrumb path (NEW: reveals GROUP BY + ORDER BY constants)

Not in the original request but it is the most informative remaining method. Observed verbatim:

```java
@Override // com.maxmpz.audioplayer.rest.library.n1
public final boolean x0(com.maxmpz.audioplayer.player.r rVar, d1 d1Var,
                        StringBuilder sb, ArrayList arrayList, i1 i1Var) {
    if ((d1Var.m2436() & 22) == 0) return false;                  // feature mask gate
    androidx.appcompat.widget.n.B(d1Var.X, new String[]{"playlists.playlist"},
                                  sb, arrayList, false, false);    // LIKE search on playlist name
    rVar.A = "playlists";                                          // table
    rVar.B("playlists.num_files"); rVar.B("!=0 ");                 // non-empty only
    i1Var.f3335 = "playlists._id";                                 // <-- GROUP BY
    i1Var.B     = "playlists.playlist COLLATE NOCASE";             // <-- ORDER BY
    return true;
}
```

This resolves the `i1` field roles used in `RestProvider.A`:
- **`i1.f3335` = GROUP BY**
- **`i1.B` = ORDER BY (sortOrder)**
- **`i1.f3334` = LIMIT**

So `RestProvider.A`'s call `r.K(rVar, db, proj, sel, selArgs, i1Var.f3335, sortStr, limitStr)` maps to **(groupBy, orderBy, limit)**. **[now observed, previously inferred]**

Playlist **list** defaults therefore are:
```sql
-- search path
SELECT playlists._id FROM playlists
WHERE (playlists.num_files != 0) AND (playlists.playlist LIKE ?)
GROUP BY playlists._id
ORDER BY playlists.playlist COLLATE NOCASE
-- plain list path (j3.X0)
SELECT playlists._id FROM playlists ORDER BY <C0915.m3148(C0742.U.f3810)>
```
**Two distinct default orderings**: plain playlist list uses a resource-derived string (`C0915.m3148(C0742.U.f3810)`), search uses literal `playlists.playlist COLLATE NOCASE`. **[observed]**

## A.5 Cursor builders `j3.B` / `j3.E0` — both are thin forwarders

Neither builds SQL itself; **both delegate to `h1.C(...)`**, which is the shared paged/windowed cursor assembler:

```java
// j3.B  (interface i2)
public final Cursor B(RestProvider rp, Uri uri, String[] proj, long[] ids,
                      int i, int i2, int i3, int i4, boolean z) {
    return h1.C(rp, uri, proj, ids, i, i2, i3, i4, z, this);
}

// j3.E0  (interface h2)
public final Cursor E0(RestProvider rp, UriAndIds uai, String[] proj, int i) {
    if (uai.A.length == 0) return null;              // no ids -> null cursor
    int i2 = uai.x.getInt("num_cats", 0);            // "num_cats" from the URI match extras
    return h1.C(rp, uai.B, proj, uai.A, 0, uai.A.length, i2, i, false, this);
}
```

So the `long[] ids` + `int` offsets/dimension params are **paging coordinates** (id array + `offset`/`limit`/`num_cats`), forwarded to `h1.C`. `h1.C` itself was **not decompiled** — this is the remaining gap for windowed/paged playlist loading. **[observed: forwarders + `num_cats` key; unknown: `h1.C` internals]**

## A.6 `j3.i0(SQLiteDatabase, Uri)` → `j2` (list meta) — CONFIRMED

Observed verbatim; it runs **two sequential `rawQuery`s**, so the "meta" is assembled from constants, not a single round-trip:

```java
long id = androidx.appcompat.widget.f.e(1, uri);       // playlist id = path segment index 1
if (id == 0) return null;
String[] sel = {String.valueOf(id)};

// (1) playback-position retention flags
Cursor c1 = db.rawQuery("SELECT keep_list_pos, keep_track_pos FROM playlists WHERE _id=?", sel);

// (2) last-played entry, only if keep_list_pos was set
Cursor c2 = db.rawQuery("SELECT MAX(played_at), _id, sort FROM playlist_entries WHERE playlist_id=?", sel);
...
return new j2(storedEntryId, storedSort, keepListPos, keepTrackPos);
```

Confirms **[observed]**:
- `playlists.keep_list_pos`, `playlists.keep_track_pos` really exist and are read as booleans (`getInt(...) != 0`).
- **playlist id extraction**: `androidx.appcompat.widget.f.e(1, uri)` = **path segment index 1**. Compare `k3.X0` which used `androidx.appcompat.widget.f.d(uri)` (last segment). So the URI is `content://com.maxmpz.audioplayer.data/<segment>/<playlistId>` and `f.d()` == last segment while `f.e(1, …)` == index 1 — consistent for a 2-segment path. **This pins the URI arity: 2 path segments for a playlist detail URI.**
- `playlist_entries` supports `MAX(played_at)`, `_id`, `sort` — the "resume position" trio.
- `j2` ctor signature: `j2(long entryId, int sort, boolean keepListPos, boolean keepTrackPos)`.

## A.7 Playlist folders — ANSWER: playlists are NOT foldered any more

The Lead asked whether playlist folders use a separate table or a `folder_id` on `playlists`.

**Answer: neither. There is no playlist-folder concept in this build.** Evidence **[observed]**:
1. The `playlists` DDL (`migrations.B#E`) has **no `folder_id` and no `parent_id`** column.
2. `migrations.B#E` explicitly **drops the folder-coupled model**: `DROP TABLE IF EXIST folder_playlists`, `ALTER TABLE folder_playlist_entries RENAME TO playlist_entries`. The old "playlist as a folder" model was removed.
3. `onUpgrade i<118` adds `keep_list_pos`/`keep_track_pos` to **both** `playlists` **and** `folders` — this is the only overlap, and it is playback-position state, **not** parentage.
4. `g1.getFolders()` → `t0` is **only a 4-method forwarder**:
   ```java
   t0 { <init>(g1); G0(String): В; d0(): х; mo2427(): x2 }
   ```
   It holds `P X` and `Lazy x` and delegates — no SQL of its own, no playlist reference.
5. `g1.getFoldersHier()` → `x0` likewise has no playlist linkage; `folders` hierarchy is `folders.parent_id` (self-referential, `num_subfolders`, `hier_duration`, `hier_num_files` — see `g1.m2440`), purely filesystem.
6. `k3.X0`'s join `LEFT JOIN folders ON folders._id=folder_id` uses `folders` **only to resolve a track's containing directory** for path/title purposes — it does not model playlist grouping.
7. The only playlist↔path relation is `playlists.playlist_path` (the `.m3u`/`.pls` file location) used for re-linking in `j3.c1` pass (d).

Playlists are therefore a **flat list** (ordered by `playlists.playlist COLLATE NOCASE` for search, or the resource default for the plain list). Any front-end "playlist folders" grouping is **UI-side only, not persisted**. **[observed for schema; "UI-side only" inferred]**

## A.8 Consolidated column inventory (verified by ≥2 independent literals)

| Table | Columns proven by literal | Source(s) |
|---|---|---|
| `playlists` | `_id` | `j3.j0`, `j3.f0`, `j3.i0`, `j3.x0`, DDL |
| | `playlist` | DDL, `j3.<clinit>`, `j3.x0` |
| | `playlist_path` | DDL, `j3.c1` |
| | `num_files` | `j3.X0`, `j3.x0`, DDL |
| | `num_all_files` | `migrations.B#D` case 4 |
| | `played_at` | DDL, `j3.Y0` |
| | `keep_list_pos`, `keep_track_pos` | `j3.i0`, `onUpgrade i<118` |
| | `duration` | `onUpgrade i<125` |
| | `mtime`, `created_at`, `updated_at`, `aa_status`, `shuffle_order` | DDL |
| `playlist_entries` | `_id` | `k3.V()`, DDL, `j3.c1` |
| | `playlist_id` | `k3.X0`, `j3.i0`, `j3.c1`, DDL, trigger |
| | `folder_file_id` | `k3.X0`, `j3.c1`, DDL |
| | `sort` | `k3.X0` (ORDER BY), `j3.f0`, `j3.i0`, `onUpgrade i<30` |
| | `played_at` | `j3.i0` (`MAX(played_at)`), `onUpgrade i<118` |
| | `folder_path`, `file_name`, `cue_offset_ms` | `migrations.B#F`, `j3.c1` |
| | `shuffle_order` | `migrations.B#E` |
| `folder_files` | `_id`, `album_id`, `artist_id`, `album_artist_id`, `folder_id`, `name`, `offset_ms`, `cue_folder_id`, `duration`, `played_at`, `title_tag`, `album`, `artist`, `album_artist`, `is_cue`(via folders), `year`, `file_type` | joins in `k3.X0`/`j3.f0`/`j3.j()`/`j3.c1`, migrations |
| | **`file_path`** (NEW) | `j3.j()` only |
| | `path` | `j3.j()` (resolves via `folders`), migrations |
| `folders` | `_id`, `path`, `name`, `parent_id`, `parent_name`, `short_name`, `is_cue`, `num_files`, `num_all_files`, `num_subfolders`, `duration`, `hier_duration`, `hier_num_files`, `keep_list_pos`, `keep_track_pos`, `sort_path`, `parent_label` | `migrations.B#E/#F/#D`, `g1.m2440`, `onUpgrade` |

## A.9 Newly opened unknowns from this pass

11. **`h1.C(...)`** — the shared paged cursor assembler behind `j3.B` and `j3.E0`. Not decompiled; this is where `LIMIT`/`OFFSET`/`num_cats` windowing for playlists is actually applied.
12. **`aa_status == 2` enumeration** — the value is used as an exclusion sentinel only in `j3.f0`; no constant/`switch` mapping `2` to a name was found in the classes I inspected (`C0742` not enumerated).
13. **`C0742.U.f3810`** — the plain playlist-list ORDER BY string, still a resource-id lookup; value unresolved. Search path's `playlists.playlist COLLATE NOCASE` is known.
14. **`folder_files.file_path`** — appears only in `j3.j()`'s COALESCE; no `ALTER TABLE … ADD COLUMN file_path` was found in the migration code I read, so its creation point is unverified (possibly in an unreached `i<…` branch or the initial `folder_files` DDL that predates the reachable `onCreate`).
15. **`cue_folder_id` ambiguity** in `j3.j()` — unqualified column resolves against the join; whether it binds to `folders.cue_folder_id` (a column I never saw) or `folder_files.cue_folder_id` is unverified.

---

# Appendix B — the paging engine (`h1.C`) and the queue entity

Answers to the two follow-ups. All **[observed]** unless marked. This closes A.9 unknown #11.

## B.1 `h1.C(...)` — VERDICT: **no SQL paging, no sub-windowing. It is an `IN(...)` re-query.**

Full observed body:

```java
public static Cursor C(RestProvider restProvider, Uri uri, String[] strArr, long[] jArr,
                       int i, int i2, int i3, int i4, boolean z, i2 i2Var) {
    if (jArr.length != 0 && i < jArr.length && i + i2 <= jArr.length) {
        StringBuilder sb  = new StringBuilder();   // -> selection
        StringBuilder sb2 = new StringBuilder();   // -> sortOrder
        if (i2Var.e0(uri, jArr, i, i2, i3, sb, sb2, z)) {
            String[] strArrJ = strArr == null ? i2Var.j() : strArr;
            if (i4 > 0) { sb2.append(" LIMIT "); sb2.append(i4); }
            try {
                Cursor cursorA = restProvider.A(uri, strArrJ, sb.toString(), null, sb2.toString(), false);
                if (cursorA != null) {
                    if (cursorA.getCount() != 0) return cursorA;
                    cursorA.close();
                    return null;                       // empty result -> null, not an empty cursor
                }
            } catch (SQLiteException e) { Log.e("RestMassOps", "", e); }
        }
    }
    return null;
}
```

### Answers to the four questions

**(a) LIMIT/OFFSET in SQL, or `CursorWindow` sub-windowing?**
**Neither offset-based paging nor `CursorWindow` sub-windowing.** `h1.C` performs **id-set selection**: it builds `column IN (id1,id2,…)` from `long[] jArr` and re-queries. There is **no `OFFSET`** anywhere in the method and **no `CursorWindow`** constructed here. The only SQL row-count limit is the optional trailing `LIMIT i4`.

Critically: **it re-enters `restProvider.A(...)` — the public provider entry point — i.e. it recurses back through the whole URI→entity→SQL chain.** This is a *second* full round-trip, not a post-filter on an existing cursor.

**(b) The 4 ints**

| param | meaning | evidence |
|---|---|---|
| `i` | **start index** into `ids` (inclusive) | guard `i < jArr.length`; forwarded to `m312(sb, col, jArr, i, i2)` which begins at `jArr[i]` |
| `i2` | **count** of ids to take | guard `i + i2 <= jArr.length`; `m312` computes `i3 = (i2+i)-1` as the inclusive end |
| `i3` | **`num_cats`** (category count) — the id-filter enable gate | `E0` passes `uai.x.getInt("num_cats",0)`; `j3.e0` tests `i3 > 0 && i3 == i2` before emitting the IN-clause |
| `i4` | **`LIMIT` value** (applied only if `> 0`) | `if (i4 > 0) sb2.append(" LIMIT ").append(i4)` |
| `z` | **sort override** (shuffle / browse mode) | forwarded to `e0`; in `j3.e0`, `z==true` → `ORDER BY playlists.playlist COLLATE NOCASE`, else the resource default |

So `E0` → `h1.C(..., 0, uai.A.length, num_cats, i, false, this)` means: "take the **whole** id array from index 0, with `num_cats` as the cat count, and `i` as the SQL LIMIT." `j3.B`'s `(i, i2, i3, i4)` are a genuine sub-range plus limit.

**`num_cats` specifically** — its only observable use is the equality gate in `j3.e0`:
```java
if (i3 > 0 && i3 == i2) { n.m312(sb, "playlists._id", jArr, i, i2); }
```
i.e. **emit the `playlists._id IN (...)` filter only when `num_cats` is positive AND equals the requested count.** That reads as "the caller asked for exactly N category rows, so restrict by id". Where `num_cats` is *set* (`UriAndIds.x`, a `Bundle`) is not decompiled — see Unknowns #16.

**(c) Does it build SQL itself?**
**No SQL string building beyond the `LIMIT` suffix.** Both fragments are produced by the entity: `entity.e0(...)` fills the selection `StringBuilder sb` and the sortOrder `StringBuilder sb2`; `h1.C` only appends `" LIMIT " + i4` to `sb2`. Everything else is forwarded. It also never passes `selectionArgs` — it passes **`null`** (ids are inlined into the SQL literal by `m312`).

**(d) Net effect on memory / the live-cursor queue**
Since there is **no `OFFSET` and no windowing**, and the caller supplies a full id array, the result is **one materialised `SQLiteCursor` over the requested id set, with an optional row cap**. For a huge playlist: the `long[]` id array is caller-held, the SQL carries an `IN(...)` list of those ids, and SQLite materialises the cursor. **The "live cursor" is paged by id-set membership, not by scroll offset** — so per-frame memory is bounded by the id array plus whatever `CursorWindow` pages naturally, not by an explicit app-level window. **[observed for mechanism; the memory-bounding statement is inferred]**

### `CursorWindow28` — empty marker class
`com.maxmpz.audioplayer.data.CursorWindow28` has **0 methods and 0 fields** — a bare marker/type token, not a custom window implementation. No windowing logic lives there. **[observed]**

### The cursor factory `C0629`
`RestProvider.x` is the `CursorFactory` passed to `rawQueryWithFactory` in `player.r.K`:
```java
C0629 { java.lang.reflect.Field f2736;  Cursor newCursor(SQLiteDatabase, SQLiteCursorDriver, String, SQLiteQuery); }
```
It has exactly **one method** (`newCursor`) plus **one reflective `Field`** — a framework-compat shim, most plausibly reflectively setting a cursor-window/row-limit on the produced cursor rather than creating a custom window type. The `Field` target was not resolved. **[observed: shape; reflective purpose inferred]**

## B.2 `j3.e0(...)` — the id→`IN(...)` builder

```java
@Override // i2
public final boolean e0(Uri uri, long[] jArr, int i, int i2, int i3,
                        StringBuilder sb, StringBuilder sb2, boolean z) {
    int length = sb.length();
    if (i3 > 0 && i3 == i2) {
        androidx.appcompat.widget.n.m312(sb, "playlists._id", jArr, i, i2);
    }
    if (z) sb2.append("playlists.playlist COLLATE NOCASE");
    else   sb2.append(C0915.m3148(C0742.U.f3810));
    return sb.length() > length;      // "did I emit a filter?"
}
```
Note the return value is **"a filter was appended"**, and `h1.C` proceeds only when it is `true`. So when the `num_cats` gate fails, `h1.C` returns `null` rather than running an unbounded query. **[observed]**

## B.3 `n.m312(...)` — the `IN` list generator

```java
public static boolean m312(StringBuilder sb, String str, long[] jArr, int i, int i2) {
    int i3 = (i2 + i) - 1;                        // inclusive end
    int length = jArr.length - 1;
    if (i3 > length) i3 = length;                  // clamp
    if (i3 < i || i >= jArr.length || jArr[i] == 0) return false;   // 0 = sentinel, abort
    sb.append(str).append(" IN(").append(jArr[i]);
    for (int i4 = i + 1; i4 <= i3; i4++) {
        if (jArr[i4] != 0) sb.append(',').append(jArr[i4]);         // skip zeros
    }
    sb.append(')');
    return true;
}
```
Two behaviours worth flagging:
- **`jArr[i] == 0` aborts entirely** (returns `false`, emits nothing) — `0` is a "no id" sentinel.
- **Subsequent zeros are silently skipped**, so `{5,0,7,0,9}` → `IN(5,7,9)` — sparse arrays compress.
- The predicate is built as a **Java string literal**, not bound parameters — consistent with this read path passing `null` `selectionArgs`. **[observed]**

## B.4 PRIORITY 2 — queue (`m3`) vs playlist (`k3`) : **they differ**

`m3` is the queue entity (`g1.getQueue(): m3`), 56 methods, fields `String H`, `String[] f3357`, `e f3358`.

### `m3.X0` — queue list (verbatim)
```java
rVar.A = "queue INNER JOIN folder_files ON queue.folder_file_id = folder_files._id"
       + " LEFT JOIN folders ON folders._id=folder_files.folder_id"
       + " LEFT JOIN albums ON albums._id=folder_files.album_id"
       + " LEFT JOIN artists ON artists._id=folder_files.artist_id"
       + (C0742.O.f3789 ? " LEFT JOIN album_artists ON album_artists._id=folder_files.album_artist_id" : "");
String[] cols = C0742.f1.f3789 ? (C0742.f3418.f3789 ? p0.y : p0.f3368)
                               : (C0742.f3418.f3789 ? p0.x : p0.X);
n.m313(str, cols, sb, arrayList);
i1Var.B = "queue.sort";          // <-- ORDER BY
return f3357;                    // <-- default projection
```

**Differences from `k3.X0` (playlist entries):**

| | `k3.X0` (playlist) | `m3.X0` (queue) |
|---|---|---|
| Base table | `playlist_entries LEFT JOIN folder_files …` | **`queue INNER JOIN folder_files`** (`INNER`, not `LEFT`) |
| Playlist predicate | **`playlist_id=?`** + arg | **none** (queue is global) |
| CUE filter | `AND folder_files.cue_folder_id IS NULL` (when enabled) | **absent** |
| ORDER BY | **`"sort"`** (bare, unqualified) | **`"queue.sort"`** (qualified) |
| Projection | `j3.y` = `{folder_files._id, playlist_entries._id}` | `f3357` |
| Title/COALESCE lists | owned by `k3` (`O`, `f3346`, `p`, `f3347`) | **delegated to `p0`** (`p0.x/X/y/f3368`) |
| Extra flag | — | `C0742.f1` selects an entirely different column set |

So: **both order by a `sort` column, but on different tables, and the queue is `INNER`-joined with no playlist scoping and no CUE exclusion.** `m3` also delegates its projection/COALESCE lists to `p0` rather than owning them.

### `m3.f0` — queue single-row resolver (verbatim)
```sql
SELECT <proj>  FROM queue
INNER JOIN folder_files ON queue.folder_file_id = folder_files._id
LEFT JOIN folders  ON folders._id = folder_files.folder_id
LEFT JOIN albums   ON albums._id  = folder_files.album_id
LEFT JOIN artists  ON artists._id = folder_files.artist_id
WHERE queue._id=? AND (folder_files.aa_status IS NULL OR folder_files.aa_status!=2)
ORDER BY folder_files.aa_status DESC LIMIT 1
```
Structurally identical to `j3.f0` except **`queue._id=?`** replaces `playlists._id=?`, and **`ORDER BY` has no `,sort` tail** (single-row lookup by queue row id, so ordering is moot). Same `rawQueryWithFactory(null, sql, args, "", null)` call shape. **[observed]**

### Consequence for the queue-as-live-cursor design
Because `m3.f0` resolves **one queue row by `queue._id`**, and `m3.X0` returns the whole queue ordered by `queue.sort`, the runtime "next/prev moves the cursor" model is consistent: the cursor sits over `queue` rows in `queue.sort` order, and `f0` is the cheap single-row re-resolve used when a specific queue position must be re-materialised (e.g. after a reorder). The `queue` table is **separate from `playlist_entries`** — pushing a playlist to the queue is a table-to-table copy, not a view. **[observed for structure; the "after a reorder" usage is inferred]**

## B.5 New unknowns from Appendix B

16. **`UriAndIds.x` (`Bundle`) contents** — holds `"num_cats"`; its other keys and the code that populates it (`player.b0` / `toUriCore`?) are unresolved. This gates whether `h1.C` emits its id filter at all.
17. **`C0629.f2736` reflective `Field` target** — the single field in the cursor factory; presumably a `CursorWindow`/row-limit field, not resolved.
18. **`m3.f3357` default projection** and **`p0.x/X/y/f3368`** column arrays — the queue's COALESCE column lists were not decompiled (the playlist equivalents `j3.y` / `k3.j()` were).
19. **`C0742.f1`** — the feature flag that switches `m3.X0`'s entire column set; semantics unknown.
20. **Trailing `int i` on `f0`** (`j3.f0` / `m3.f0`, `interface l1`) — both ignore it because they hard-code `LIMIT 1`; the parameter's intended meaning is unverified.
