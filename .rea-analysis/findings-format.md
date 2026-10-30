# Poweramp playlist FILE-FORMAT slice — parse & serialise (M3U / M3U8 / PLS / WPL / CUE)

Target: `D:\SpMusic\.rea-analysis\Poweramp-v3.apk` (sha256 `4467fdac…b82e0`), build 1025-uni / 1025009.
Provider: JADX headless 0.7.1 via REA. All claims below are from **decompiled bytecode actually read** unless
explicitly marked *(inferred)*.

---

## Summary

- **Import dispatcher is `com.maxmpz.audioplayer.scanner.X#m2473`** — one method switching on
  `lowercase(extension)` of the playlist filename. Handled extensions observed in the switch:
  `"m3u"`, `"m3u8"`, `"pls"`, `"wpl"`. **`"cue"` is NOT in this dispatcher** — CUE is a completely
  separate path (`data.cue.*` driven by the folder scanner, producing virtual `folder_files` rows).
- Extension is taken by `AbstractC0582.m1900` = text after the last `'.'`, then
  `.toLowerCase(Locale.ROOT)` → **dispatch is case-insensitive** (`.M3U` == `.m3u`).
- **Unknown/absent extension falls through to the M3U parser** (the `switch` has no `default:` abort;
  the tail of the method unconditionally calls `m2475(..., true, ...)`).
- M3U/M3U8 parser = `X#m2475`. Reads 65536-char buffered **line-oriented** input; skips lines with
  `length() <= 4`; treats `#`-prefixed lines as directives; every other line is one playlist entry.
- **Charset**: `new C0630(stream, charset)` where `charset = (isM3u8 || C0732.a1.f3789) ? UTF_8 : Charset.defaultCharset()`
  i.e. **`.m3u8` ⇒ UTF-8, `.m3u` ⇒ platform default (Latin-1-ish on Android)** — but `C0630` is a
  **BOM sniffing reader that overrides both**: UTF-8 / UTF-16BE / UTF-16LE / UTF-32BE / UTF-32LE.
- **Relative path resolution** = playlist's own directory + raw line, no `./`/`../` normalisation:
  `X#x` does `line = playlistDirPrefix.concat(line)` where `playlistDirPrefix = AbstractC0582.m1898(path)`
  (substring up to and including the last `'/'`). Absolute `/…` and `X:\`/`X:/` and `http(s)://`,
  `data:` and `.m3u` are special-cased instead.
- **PLS parser only honours `FileN=`.** `[playlist]`, `TitleN=`, `LengthN=`, `NumberOfEntries=`,
  `Version=` are read-and-ignored (they simply fail the `startsWith("File",true)` test).
- **CUE** is parsed by a JFlex-generated lexer (`data.cue.C0606`) + recursive-descent parser
  (`data.cue.A#B`). Directives honoured: `TITLE`, `PERFORMER`, `FILE`, `TRACK`, `INDEX` (numeric
  `min:sec:frames`), plus two numeric directives that land in float gap fields. `REM` is **not**
  handled (no branch for it). Virtual tracks are emitted only for files with **> 1** track and a
  resolvable audio image; boundaries = `INDEX 01` of track N → `INDEX 01` of track N+1, last track
  ends at whole-file duration; unit is **ms** (`frames*1000/75 + sec*1000 + min*60000`).
- **Export** writes M3U/M3U8/PLS/WPL from the SQLite tables, **absolute → relative**: the DB query
  composes an absolute `_path`, and the writers strip the playlist's own directory prefix
  (`regionMatches(…, true)` = case-insensitive) before writing.
- Export default/primary format is **`.m3u8`**: `PlaylistsExportActivity` appends `".m3u8"` to the
  playlist name if it does not already end with it.
- **Destructive error handling on import**: if a playlist file cannot be stat'ed/opened,
  `X#m2470` logs and runs `DELETE FROM playlists WHERE _id=?` — the playlist row is **removed**.

---

## Supported formats & dispatch

### Import (playlist file → DB)

`com.maxmpz.audioplayer.scanner.X` — the whole playlist importer. Trigger:
`scanner.library.K#m2502(SQLiteDatabase, saf.X, C0107)` iterates

```
SELECT _id, mtime, playlist_path, created_at, updated_at FROM playlists
WHERE playlist_path IS NOT NULL [AND playlist_path LIKE ? ESCAPE '\' COLLATE NOCASE]
```

and calls `X#m2470(id, mtime, playlistPath, forceFull, forceRescan)`.

`X#m2470` resolves the file (SAF or `new File(path)`), then calls
`X#m2473(path, resolvedName, playlistId, mtime, sync, ?, full)`.

`X#m2473` (observed, complete switch):

```java
String lowerCase = AbstractC0582.m1900(str2).toLowerCase(Locale.ROOT); // ext after last '.'
String prefix    = AbstractC0582.m1898(str);                          // dir incl trailing '/'
switch (lowerCase.hashCode()) {
  case 106447:  /* "m3u"  */ m2475(prefix, str, id, false, mtime, …); return;   // false ⇒ NOT utf8
  case 111095:  /* "pls"  */ <PLS line loop>;  /* then falls through if it did not return */
  case 117939:  /* "wpl"  */ <WPL XmlPullParser loop>;
  case 3299913: /* "m3u8" */ m2475(prefix, str, id, true,  mtime, …); return;    // true ⇒ utf8
}
m2475(prefix, str, id, true, mtime, …);   // <-- default: anything else parsed as M3U (UTF-8)
```

| Extension | Handler | Notes |
|---|---|---|
| `.m3u` | `X#m2475(..., isUtf8=false, ...)` | charset = `Charset.defaultCharset()` unless BOM |
| `.m3u8` | `X#m2475(..., isUtf8=true, ...)` | charset = UTF-8 unless BOM |
| `.pls` | inline loop in `X#m2473` | own reader, always `UTF_8` base charset |
| `.wpl` | inline `XmlPullParser` loop in `X#m2473` | reads `<media src="…">` at depth 4 |
| `.cue` | **not here** — see CUE section | separate `data.cue.*` + `scanner.library.C0760` |
| anything else / none | `X#m2475(..., isUtf8=true, ...)` | silent M3U fallback |

Case-insensitivity: `m1900` is a plain `lastIndexOf('.')` substring; the `.toLowerCase(Locale.ROOT)`
is applied before the switch, and every directive comparison inside the parsers uses
`startsWith(..., ignoreCase = true)`. So the *file* extension and the *directive* keywords are both
case-insensitive.

**Note on `.cue` and playlists:** the CUE parser emits **tracks inside an audio file**, not playlist
entries. A `.cue` file listed as a `playlist_path` would hit the M3U fallback (inferred from the
absent case + unconditional tail call), which is almost certainly meaningless input.

### Export (DB → file)

`dialogs.PlaylistsExportActivity#onClick` (button1) → `new Thread(new dialogs.B(this, this, path, checkboxChecked, 1))`.

`dialogs.B#run`, `default:` branch:
1. `new File(path).mkdirs()` when the destination is a plain directory path.
2. `SELECT playlists._id, playlists.playlist FROM <g1.getPlaylists().B0()>` — plus
   `"playlists.playlist_path IS NULL"` filter when the "only playlists without a path" checkbox is *un*ticked.
3. `sb.append(playlistName); if (!playlistName.endsWith(".m3u8")) sb.append(".m3u8");`
   → then `AbstractC0582.l(sb, 0, sb.length())` = **strip characters illegal in filenames**
   → **the exported default name/extension is always `.m3u8`**.
4. `rest.library.H#B(context, saf, db, playlistId, fileName, file, pfdOpener)`.

`rest.library.H#B` — export directory dispatcher (observed, complete switch):

```java
String ext = AbstractC0582.m1900(str /*fileName*/).toLowerCase(Locale.ROOT);
Cursor c = db.rawQuery(ENTRY_QUERY, new String[]{String.valueOf(playlistId)});
String prefix = AbstractC0582.m1898(str);              // target file's directory
switch (ext.hashCode()) {
  case 106447:  "m3u"  -> i.m3120(ctx, saf, file, pfd, c, prefix, this.f3277);
  case 111095:  "pls"  -> i.B(file, pfd, c, prefix);
  case 117939:  "wpl"  -> i.m3119(file, pfd, c, prefix);
  case 3299913: "m3u8" -> i.m3120(ctx, saf, file, pfd, c, prefix, true);
  default:      Log.e("PlaylistSavingHelper", "invalid playlist ext=" + ext + " for=" + file); return false;
}
```

The writers live in **`com.pixplicity.htmlcompat.i`** (obfuscation-merged package name; the class is
really the playlist serializer):

| Method | Format |
|---|---|
| `i#m3120(Context, saf.X, File, H pfdOpener, Cursor, String prefix, boolean isM3u8)` | M3U / M3U8 |
| `i#B(File, H, Cursor, String prefix)` | PLS |
| `i#m3119(File, H, Cursor, String prefix)` | WPL (XML) |
| `i#A(String)` | helper: decode `data:…;base64,` sub-playlist |

**Entry SQL used by all three writers (observed literal):**

```sql
SELECT COALESCE(COALESCE(folder_files.file_path, path||folder_files.name, folder_files.name),
                folder_path||file_name, file_name) AS _path,
       COALESCE(folder_files.title_tag, folder_files.name, file_name) AS _title,
       folder_files.duration, folder_files.rating, folder_files.file_type,
       folder_files.name_without_number
FROM playlist_entries
LEFT JOIN folder_files ON folder_files._id = folder_file_id
LEFT JOIN folders      ON folders._id = folder_files.folder_id
WHERE playlist_id = ? ORDER BY sort
```

Column indices used by the writers: `0=_path (absolute)`, `1=_title`, `2=duration (ms)`,
`3=rating`, `4=file_type`, `5=name_without_number`.

---

## M3U / M3U8 parsing

`com.maxmpz.audioplayer.scanner.X#m2475(String dirPrefix, String path, String playlistId,
boolean isUtf8, int mtime, boolean sync, boolean a, boolean ratingsEnabled)`

### Reader / charset

```java
BufferedReader r = new BufferedReader(
    new C0630(saf.m2006(ctx, path),
              (isUtf8 || C0732.a1.f3789 /* global "assume utf8" pref */)
                  ? com.maxmpz.audioplayer.data.B.B        // = Charset "UTF-8"
                  : com.maxmpz.audioplayer.data.B.f2590),  // = Charset.defaultCharset()
    65536);
r.mark(65536);   // used later for the HLS re-read path
```

`com.maxmpz.audioplayer.data.B#<clinit>` (smali):
`f2590 = Charset.defaultCharset()`, `B = StandardCharsets.UTF_8`.

### BOM sniffing — `com.maxmpz.audioplayer.data.C0630#<init>(InputStream, Charset)`

Observed, complete:

| First bytes | Chosen charset |
|---|---|
| `EF BB BF` | `B.B` = UTF-8 |
| `FE FF` | UTF-16BE |
| `FF FE` | UTF-16LE |
| `00 00 FE FF` | `Charset.forName("UTF-32BE")` |
| `FF FE 00 00` | `Charset.forName("UTF-32LE")` |
| anything else | the caller-supplied charset (may be `null` ⇒ platform default) |

It reads 4 bytes through a `PushbackInputStream(4)`, then `unread`s the bytes *after* the BOM (and
`unread(bArr, 0, 0)` in the degenerate negative-length case) before wrapping an `InputStreamReader`.
`C0630#read(char[],int,int)` and `#close()` delegate to that reader.

⇒ **BOM always wins over the extension-derived charset.** A `.m3u8` with a UTF-16LE BOM is decoded
as UTF-16LE. A `.m3u` with a UTF-8 BOM is decoded as UTF-8.

### Line loop (observed behaviour)

```
for each readLine():
    line = StringsKt.trim(line).toString()          // Kotlin trim(): strips Unicode whitespace
    if (line.length() <= 4)                 -> skip (blank / too-short lines)
    if (line.charAt(0) != '#')              -> EMIT entry
    else if (startsWith(line, "EXT", 1, ignoreCase=true)):
        if (line.charAt(4) != '-')          // "#EXT..." (e.g. #EXTINF)
            if (startsWith(line, "EXTINF:", 1, true))            -> clear pending title
            else idx = indexOf(line, ',', 8)
                 if (idx == -1 || idx >= line.length()-1)        -> clear pending title
                 else pendingTitle = trim(line.substring(idx+1)) // <-- the visible title
        else if (line.charAt(5) != 'X' && line.charAt(5) != 'x')
            -> clear pending title
        else if (line.charAt(6) != '-')
            -> clear pending title
        else                                 // "#EXT-X-" (HLS family)
            if (sawAtLeastOneEntry &&
                (startsWith(line,"STREAM-INF:",7,true) || startsWith(line,"VERSION:",7,true) ||
                 startsWith(line,"MEDIA-SEQUENCE:",7,true) || startsWith(line,"PLAYLIST-TYPE:",7,true)))
                 -> HLS: call m2471(path, r, playlistId, count, mtime, sync, a) and RETURN
            else if (ratingsEnabled && startsWith(line,"RATING:",7,true))
                 -> rating = ParseUtils.parseInt(line, 14, -1, 10, -1)   // pending rating for next entry
    // any '#' line that matched nothing simply falls through and is skipped
```

`#EXT-X-RATING:` — the tag Poweramp itself emits — is handled in the `#EXT-X-…` branch (prefix
`"RATING:"` at offset 7, i.e. `#EXT-X-RATING:`), gated on the `ratingsEnabled` flag.

Directives actually meaning-bearing on read: **`#EXTINF:<secs>,<Title>`** (only the `,<Title>` part;
the duration is discarded) and **`#EXT-X-RATING:<int>`**. Everything else (`#EXTM3U`, `#EXT-X-VERSION`,
`#EXT-X-PLAYLIST-TYPE`, arbitrary comments) is skipped. Blank lines and lines ≤ 4 chars are skipped.

HLS handling — `X#m2471`: if `isHlsAsUrl` is set, it emits one entry whose path is the .m3u8 URL
itself (reason extracted via `AbstractC0582.p(AbstractC0582.m1901(path))`); otherwise it
`reset()`s the mark, re-reads the whole file, joins with `'\n'`, base64-encodes and emits
`"data:application/x-mpegurl;base64," + Base64.encodeToString(text.getBytes(UTF_8), 2)`
as a single opaque entry.

### Emission — `X#x(String dirPrefix, String rawLine, String pendingTitle, String playlistId,
int sortIndex, int mtime, int rating, long offsetMs, long endMs, boolean a, boolean z2)`

Path normalisation (observed, ordered):

1. `rawLine.charAt(0) != '/'`:
   1. `len > 3 && isLetter(c0) && c1==':' && (c2=='\\' || c2=='/')` (Windows drive) →
      `"/" + rawLine.substring(3)` — **drive letter and its separator are replaced with a leading `/`**
      (i.e. `C:\Music\x.mp3` → `/Music/x.mp3`, matched against the Android mount prefix).
   2. `okhttp3…y.m3556(rawLine)` (literal `http://` / `https://`, length ≥ 8)
      **or** (`z2 && (startsWith "data:" || isM3u8Name(rawLine))`) →
      `m2474(streamPath, AbstractC0582.p(AbstractC0582.m1901(rawLine)), …)` — **stream / URL entry**.
   3. else, if not `'@'`-prefixed (`AbstractC0625.P`) and not `content:`-scheme (`AbstractC0625.m2011`)
      and `dirPrefix != null` → `path = dirPrefix.concat(rawLine)`  ← **relative resolution**
2. Absolute/`content:`/`@` paths are used verbatim.

`AbstractC0582.m1898(path)` = `path.substring(0, lastIndexOf('/')+1)` when `lastIndexOf('/') >= 1`,
else the whole string → **the playlist's own directory, with a trailing separator**.

There is **no `./` or `../` folding and no URL-decoding**. The concatenated string goes straight into
`X#m2472(path, out[2])`, which resolves it by SQL lookup against `folders` / `folder_files`
(path split at the last `/`, then the second-last and third-last components), so `dir/../x.mp3`
would only resolve if a folder literally named `..` existed (inferred from the query shapes).

`X#m2472` also writes `out[0] = directory part incl '/'`, `out[1] = file name`, and for
`content:`/`@` URIs returns `out[0] = ""`, `out[1] = <whole uri>`. On a hit it returns the
`folder_files._id`; on a miss it inserts a placeholder row and returns `-<newRowId>` (negative ⇒
"missing file"). Then `X#x` inserts/updates the `playlist_entries` row (sort index, title, rating,
`offset_ms`, `end_ms`) — negative ids always take the "missing" insert path.

Because the `x()` call from the M3U loop passes `offsetMs = -1L, endMs = -1L`, M3U entries never get
CUE-style offsets.

---

## PLS parsing

Inline in `X#m2473`, `case 111095: /* "pls" */`. Observed, complete:

```java
BufferedReader br = new BufferedReader(
        new C0630(saf.m2006(ctx, path), com.maxmpz.audioplayer.data.B.B /* UTF-8 */), 16384);
int n = 0;
while ((line = br.readLine()) != null) {
    int eq;
    if (!startsWith(line, "File", /*start*/0, /*ignoreCase*/true) || (eq = indexOf(line, '=')) <= 0) continue;
    String value = StringsKt.trim(line.substring(eq + 1)).toString();
    if (value.length() > 4) {
        if (x(dirPrefix, value, /*title*/null, playlistId, n, mtime, -1, -1L, -1L, a, false) != 0) n++;
    }
}
```

- `[playlist]` section header — no branch; ignored.
- `FileN=<path>` — **the only honoured key**. `startsWith("File", true)` also matches a lowercase
  `file1=`, and it would also match a hypothetical `Filename=` (inferred from the prefix-only test).
- `TitleN=`, `LengthN=`, `NumberOfEntries=`, `Version=` — **never matched, ignored** (titles are
  passed as `null`, so PLS imports get no title from the file).
- `Index` is the **loop counter** `n`, not the `N` in `FileN`. So out-of-order or gapped `FileN`
  numbering is not preserved; order of appearance wins.
- No blank/comment (`;`) skipping — such lines simply fail the `File` test.
- Relative path resolution uses the **same `X#x`** code path as M3U (same rules).
- Charset: base is hard-coded **UTF-8** (no `.m3u`-style default-charset option), but the shared
  `C0630` BOM override still applies.
- If the loop throws, execution falls through to the shared tail `m2475(prefix, path, id, true, …)`
  i.e. it retries the same file **as M3U** (observed control flow in the decompilation).

---

## CUE parsing

This is a different subsystem from M3U/PLS. It never touches `playlist_entries`; it materialises
**virtual `folder_files` rows** for a single audio file.

### Classes

| Class | Role | Evidence |
|---|---|---|
| `data.cue.C0606` | Lexer (JFlex-generated scanner) | `#<clinit>` builds the DFA tables; string literals `"Error: could not match input"`, `"Error: pushback value was too large"`, `"Unkown internal scanner error"`; `Log.e("CueLexer", "Unterminated string")` |
| `data.cue.A` | Parser + charset plumbing | `#B(C0606)` is the recursive-descent loop; `Log.e/w("CueParser", …)` |
| `data.cue.C0608` | Parse result for the whole sheet | fields `X` (ArrayList of files), `y` (album/artist-ish String), `x` (int), `H`/`P` (float), `K` (boolean), `f2691` (the .cue path); `toString()` prints `mCuePath` / `#mFiles` |
| `data.cue.C0607` | One `FILE` directive | fields `B` (ArrayList of `X` tracks), `f2688` = image path as written, `A` = resolved full image path, `f2689` = resolved file name, `f2687` = isOk, `f2690` = resolved id (folder id); `toString()` prints `mImagePath`, `#tracks`, `mIsOk`, `mResolvedImagePath`, `mResolvedImageFileName` |
| `data.cue.X` | One `TRACK` | fields `X` = track number, `x` = ArrayList of `B` (indexes), `y` = "has gap" flag, `K` = float gap, `H` = float gap |
| `data.cue.B` | One `INDEX` / time position | fields `B` = index number, `A` = minutes, `X` = seconds, `x` = frames; `toString()` = `"%d %02d:%02d:%02d"` |
| `scanner.library.C0760` | Scanner batch that drives CUE | `#B(RestProvider, saf.X)` = `SELECT … FROM folders WHERE is_cue=1 AND (num_files=0 OR updated_at=-1)`; `#A(...)` per folder; `#m2514` verifies image; `#m2515` writes virtual tracks |
| `scanner.library.CueFileBatch` | Writer batch object for one virtual track | 17 fields; populated in `C0760#m2515` |

### Entry point

`com.maxmpz.audioplayer.scanner.library.C0760#A(long folderId, String folderPath, String fileName,
int dirModifiedAt, long parentId, String thumb, saf.X x)`:

```java
sb.setLength(0); sb.append(folderPath); int nameStart = sb.length(); sb.append(fileName);
String cuePath = sb.toString();
// open: SAF ParcelFileDescriptor when AbstractC0625.m2017(cuePath), else new FileInputStream(cuePath)
C0608 r = ((data.cue.A) this.f3572.getValue()).m1984(fis, com.maxmpz.audioplayer.data.B.f2590);
                                                    //          ^^^^^^ Charset.defaultCharset()
if (r != null) r.f2691 = cuePath;
if (r != null && m2514(false, r, nameStart, cuePath, sb, parentId))
        written = m2515(false, dirModifiedAt, r, str /*folderIdStr*/, batch);
if (written <= 0 && this.x) this.o.bindLong(1, folderId).executeUpdateDelete();  // drop stale rows
```

`data.cue.A#m1984(FileInputStream, Charset)`:

```java
C0630 reader = new C0630(fis, StandardCharsets.ISO_8859_1);       // BOM-sniffing reader, ISO-8859-1 base
this.A = reader.B.getEncoding().startsWith("UTF");                 // "is UTF" flag for later decoding
this.f2676 = (charset == ISO_8859_1) ? null : charset;             // null ⇒ treat text as Latin-1 bytes
return B(new C0606(reader));                                      // parse
// catch (Exception e) { Log.e("CueParser", "", e); return null; }
```

⇒ A `.cue` file's **base charset is ISO-8859-1**, overridden only by a BOM. Any explicit charset
passed in is remembered in `f2676` and used by `A#m1985` to re-decode strings that the lexer
returned as raw bytes (`f2676 == null` ⇒ keep the Latin-1 byte-for-byte interpretation, additionally
run through a custom **UTF-8 validator/decoder** in `com.maxmpz.utils.w` that sets
`w.f3864 = true` on malformed input and falls back to the byte-preserving result).

### Lexer token codes (`C0606#m1987` returns these; `-1` = EOF)

Observed mapping from the parser's `switch`, cross-referenced with directive semantics:

| Code | Meaning |
|---|---|
| `1` | a **directive keyword** was scanned; the *next* `m1987()` call yields the specific sub-token (2…17) |
| `2`, `3` | keyword → string argument (album-level `PERFORMER` / `TITLE`) |
| `4` | keyword `FILE` → string argument |
| `5` | keyword `TRACK` → int argument |
| `6` | keyword `INDEX` → *numeric tuple* `n:mm:ss:ff` |
| `7` | string continuation fragment appended to the token buffer |
| `8` | "string was not terminated" (lexer already logged) |
| `9` | **integer**; value left in `C0606.K` |
| `10` | (unused by this parser) |
| `11` | **end of line** |
| `12`–`17` | keyword ids: `12`=string directive, `13`=int directive, `14`/`15`=float directives (album level), `16`/`17`=float directives (track level) |
| `18` | **float**; value left in `C0606.f2683` (parsed with `Float.parseFloat`, `NumberFormatException` ⇒ `0.0f`) |

`C0606#B()` returns the raw lexeme as `new String(this.A, this.X, this.f2686 - this.X)`.
The static state table is 4 states (`H = {0,0,1,1}`) — a plain keyword/argument/comment/newline DFA.

### Parser `data.cue.A#B(C0606)` — directive handling (observed)

```java
C0608 out = new C0608();
while ((tok = lex.m1987()) != -1) {
  switch (tok) {
    case 1: switch (lex.m1987()) {                       // keyword
      case 12: out.y = m1985(lex); break;                              // string directive → C0608.y
      case 13: if (lex.m1987()==9) out.x = lex.K; break;               // int directive  → C0608.x
      case 14: if (lex.m1987()==18) { out.H = lex.f2683; out.K = true; } break;
      case 15: if (lex.m1987()==18) { out.P = lex.f2683; out.K = true; } break;
      case 16: if (lex.m1987()==18 && currentTrack != null) {
                 currentTrack.K = lex.f2683; currentTrack.y = true; } break;
      case 17: if (lex.m1987()==18 && currentTrack != null) {
                 currentTrack.H = lex.f2683; currentTrack.y = true; } break;
      default: break;                                                  // REM and everything else
    } break;
    case 2: out.B = m1985(lex); break;                                 // album PERFORMER
    case 3: out.A = m1985(lex); break;                                 // album TITLE (see note)
    case 4: {                                                          // FILE
      String p = m1985(lex);
      if (p == null) { Log.w("CueParser","Invalid FILE"); break; }
      C0607 f = new C0607(p);
      curFile = f; out.X.add(f); currentTrack = null; break;
    }
    case 5: {                                                          // TRACK
      int n = lex.m1987();
      if (n != 9) { Log.e("CueParser","Unexpected token=" + n); break; }
      int trackNo = lex.K;
      if (curFile == null) { Log.e("CueParser","No valid file for track"); break; }
      data.cue.X t = new data.cue.X();
      t.X = trackNo; t.x = new ArrayList(2);
      currentTrack = t; curFile.B.add(t); break;
    }
    case 6: {                                                          // INDEX
      if (lex.m1987()==9) { int idx = lex.K;
        if (lex.m1987()==9) { int mm = lex.K; lex.m1987();
          if (lex.m1987()==9) { int ss = lex.K; lex.m1987();
            if (lex.m1987()==9) { int ff = lex.K;
              if (idx != 0 && currentTrack != null)   // INDEX 00 is DISCARDED
                  currentTrack.x.add(new data.cue.B(idx, mm, ss, ff)); } } } }
      break;
    }
  }
  // then: skip tokens until EOL(11) or EOF  ->  do { t = lex.m1987(); } while (t != -1 && t != 11);
}
```

Directive → field mapping (semantics inferred from how `C0760#m2515` consumes the fields):

| CUE directive | Lands in | Consumed as |
|---|---|---|
| `TITLE` (album) | `C0608.y` | album title for every virtual track (`cueFileBatch.y` / `K` fallback) |
| `PERFORMER` (album) | `C0608.B` | artist fallback (`cueFileBatch.f3520`) |
| `TITLE`/`PERFORMER` (track) | `data.cue.X.A` / `.B` | `cueFileBatch.f3518` (track title, default `"Track <n>"`) / `.y` (artist) |
| `FILE "…"` | `C0607.f2688` | resolved against DB → `C0607.A` full path, `.f2689` file name, `.f2690` id |
| `TRACK nn AUDIO` | `data.cue.X.X` | used as the track number (must be `1..999`) |
| `INDEX nn mm:ss:ff` | `new data.cue.B(idx, mm, ss, ff)` | time boundary |
| numeric directive → `C0608.H` / `C0608.P` (has-gap flag `C0608.K`) | gap/`PREGAP`-style value, album level | serialised into `cueFileBatch.f3519` |
| numeric directive → `data.cue.X.K` / `.H` (has-gap flag `.y`) | gap value, track level | same string |

`REM` has **no** branch (it falls into `default: break` after lexing), so `REM` lines are consumed
and discarded — including `REM GENRE`, `REM DATE`, `REM REPLAYGAIN_*`.

The `INDEX 00` guard (`if (idx != 0)`) means **only `INDEX 01`+ are stored**; a `PREGAP`/`INDEX 00`
gap is therefore not preserved as a separate boundary in this structure (inferred from `idx != 0`
plus the `m1986()` boundary maths).

### Offset maths (`data.cue.B`)

```java
B(int indexNo, int mm, int ss, int ff) {
    this.B = indexNo;                 // index number
    this.x = ff % 75;                 // frames  (75 CD frames per second)
    int s  = (ff / 75) + ss;
    this.X = s % 60;                  // seconds
    this.A = (s / 60) + mm;           // minutes
}
int m1986() { return ((x * 1000) / 75) + (X * 1000) + (A * 60000); }   // -> MILLISECONDS
```

`toString()` = `String.format(Locale.ROOT, "%d %02d:%02d:%02d", B, A, X, x)`.

### One file → N tracks (`C0760#m2515`)

For each `C0607 file` in `C0608.X`:

1. **Skip** the whole FILE unless `file.f2687` (image resolved OK) **and** `file.B.size() > 1`
   (`size == 0 || size == 1` → no virtual tracks at all).
2. Resolve the audio `folder_files._id` for `file.f2689` (image file name) via the `f3573`/`a`
   statements, and `duration` via statement `e` (whole-file duration, in ms).
3. For track `i` with `data.cue.X t = file.B.get(i)`:
   - **startMs** = `t.X()` = `t.x.get(t.x.size()==1 ? 0 : 1).m1986()`
     → i.e. the **`INDEX 01`** entry (the 2nd index), or the only index.
   - **endMs** = `X()` of the *next* track in the same FILE that has a non-empty index list
     (skipping tracks with none). If there is no such later track, endMs = the FILE's whole
     `duration` from `folder_files`.
   - `duration = endMs - startMs`; **only emitted when `endMs != -1 && duration > 0`.**
   - track number gate: `if (trackNo <= 0 || trackNo > 999) { Log.e("CueBatchProcessor",
     "addTrackToBatch SKIP bad CUE track number=" + …); skip; }`
   - Index-entry gate: `t.x.size() == 0` ⇒
     `Log.e("CueBatchProcessor","addTrackToBatch SKIP as no CIE indicies …")` (sic — typo in the APK).
4. `CueFileBatch` fields populated: folder id, parent, image file name + id, **track number**,
   `f3518` title (or `"Track " + n`), sort index, `x` = startMs-precision, `y`/`f3520` artist,
   `f3515` = album, `K` album fallback, **`f3516` = duration**, `H` = gap/step
   (`C0608.x > 0 ? C0608.x : parent.x > 0 ? parent.x : 10000`), `P` = whole-file duration,
   `f3517` = pseudo-path built by `p0.a1(sb, cuePath, folderPrefix, offsetMs)`, and
   `f3519` = `"<flags>,<albumH>,<albumP>,<trackK>,<trackH>"` where
   `flags = (C0608.K ? 1 : 0) | (track.y ? 2 : 0)`; `f3519 = null` when `flags == 0`.
5. **This is the mechanism that turns one physical file into N playable tracks**: `f3516`
   (duration) and the offset captured in `f3517` — which is what the Lead's `offset_ms` /
   `cue_offset_ms` columns persist. *(The exact column binding happens in
   `scanner.library.C0753`/`А` batch flush code, which I did not decompile — see Unknowns.)*

### Which audio files a CUE applies to

Not extension-driven in the parser: `C0607.f2688` is the literal `FILE` string and it is *resolved*
against the library by file name (`m2514` → statement `C`, with a `LIKE '<dir>.%'` fallback), so the
referenced audio must already be a scanned `folder_files` row in the same parent folder.
`m2514` sets `f2687 = true` only when the resolved entry id is a valid index into
`EnumC0632.P` (`iP >= 0 && iP < P.length`), i.e. a known audio type.

---

## Export format

Writer module: `com.pixplicity.htmlcompat.i` (package name is from the obfuscator's name-map reuse).

### M3U / M3U8 — `i#m3120(ctx, saf, file, pfdOpener, cursor, prefix, isM3u8)`

- Charset: `isM3u8 ? data.B.B (UTF-8) : data.B.f2590 (defaultCharset)`. **No BOM is written.**
- Sink: `new FileOutputStream(file)` or `new FileOutputStream(pfd.getFileDescriptor())` for SAF.
- Body (observed, in order):
  ```
  #EXTM3U\r\n
  per row:
      #EXT-X-RATING:<rating>\r\n
      if (file_type == 23) {                                  // 23 == sub-playlist file type
          if (isNonEmpty(A(path)) && firstRow && cursor.getCount()==1) write(A(path));  // see below
          if (name_without_number non-empty) { "#EXTINF:-1," + name_without_number } \r\n
          if (path is a .m3u/.m3u8 AND NOT http(s) AND firstRow AND count==1)
              write( whole sub-playlist, either inlined or base64-embedded )   // see below
          else write(<path>) \r\n
      } else {
          if (prefix non-blank && path.regionMatches(0, prefix, 0, prefix.length(), true))
              path = path.substring(prefix.length());          // <-- ABSOLUTE -> RELATIVE
          write(path) \r\n
      }
  ```
  then `flush()`, `fileOutputStream.getFD().sync()`, `close()`.
- Sub-playlist handling for `file_type == 23` with a single entry:
  `i#A(String)` looks for the literal `"base64"`; if found at index `i`, it returns
  `new String(Base64.decode(s.substring(i+7), 0), UTF_8)`. So an entry that is already a
  `data:…;base64,<blob>` is **decoded and inlined**. For a plain nested `.m3u`/`.m3u8` the writer
  reads the whole nested file (`BufferedReader(new C0630(stream, UTF_8), 65536)`) and re-embeds it as
  `"data:application/x-mpegurl;base64," + Base64.encodeToString(text.getBytes(UTF_8), 2)`.
- Path text **written is relative to the playlist file's own directory** whenever it starts with it
  (`regionMatches(…, ignoreCase = true)`). Otherwise (e.g. a track on a different volume / stream /
  SAF tree) the absolute path or URL is written verbatim.

### PLS — `i#B(file, pfdOpener, cursor, prefix)`

Charset **hard-coded UTF-8** (`data.B.B`), no BOM. Observed body:

```
[playlist]\r\n
per non-empty-path row (n = 1,2,3,…):
    File<n>=<path>\r\n          (same relative-stripping rule as M3U)
    Title<n>=<cursor.getString(1)>\r\n          (the DB _title, never empty-checked)
    Length<n>=<cursor.getLong(2) / 1000>\r\n    (duration ms -> whole seconds)
NumberOfEntries=<n>\r\n
Version=2\r\n
```

Note: `LengthN` is written **before** `NumberOfEntries`, and `TitleN` is always emitted even when the
title column is null/empty (a literal `null` would be written by `OutputStreamWriter.write(String)`
as `"null"` — the only guard is on the *path* column). *(Behaviour of `write((String)null)` is the
JDK's `"null"`; the decompiled code does not null-guard `getString(1)`.)*

### WPL — `i#m3119(file, pfdOpener, cursor, prefix)`

PHP `XmlSerializer`, UTF-8, `indent-output` feature on:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<smil>
  <head><meta IsNetworkFeed="FALSE"/></head>
  <body>
    <seq>
      <media src="<path>"/>     <!-- exact literal attribute name is "src" -->
      …
    </seq>
  </body>
</smil>
```

Same relative-stripping rule (`regionMatches(…, true)` against `prefix`). Empty paths skipped.

### What is exported, format-wise

- **Format is chosen by the extension of the destination**, and the GUI only ever offers/creates
  **`.m3u8`** (`PlaylistsExportActivity` appends it). `.m3u`, `.pls`, `.wpl` are reachable only if the
  user/naming flow supplies that extension.
- **Content is always `#EXTM3U` + `#EXT-X-RATING:` + optional `#EXTINF:-1,<title>` + path** — the
  `#EXT-X-RATING:` line is Poweramp's own extension and precedes **every** entry.
- **Paths are relative when they live under the playlist's directory, absolute otherwise.**

---

## Error handling

### Import — playlist file missing / unreadable (destructive)

`X#m2470` (observed):

```java
if (!AbstractC0625.m2017(playlistPath)) {              // plain filesystem path
    int lm = (int)(new File(playlistPath).lastModified() / 1000);
    if (lm != 0) ok = playlistPath; else ok = null;
} else {                                                // SAF / content: URI
    ok = saf.y(ctx, playlistPath);                      // resolve
    if (ok != null) lm = (int)(saf.K(ctx, playlistPath) / 1000);
}
if (ok == null) {
    Log.e("PlaylistProcessor", "parseIfNeeded REMOVING as no file=" + playlistPath);
    db.execSQL("DELETE FROM playlists WHERE _id=?", new String[]{ id });
    return false;
}
```

⇒ a **deleted or unmounted playlist file silently deletes the playlist row** (and, by FK cascade,
presumably its `playlist_entries` — inferred, not observed).

Other import guards:
- `m2473` wraps everything in `try { … } catch (Exception e) { Log.e("PlaylistProcessor","",e); }`;
  an exception aborts the parse and leaves whatever rows were already inserted.
- Per-entry failures are swallowed inside `X#x`: `catch (Exception e) { Log.e("PlaylistProcessor",
  "FAIL path=" + path, e); return 0; }` — one bad line never aborts the playlist; it just is not
  counted.
- A missing referenced file is **not** an error: `m2472` inserts a placeholder and returns a
  **negative** row id; `X#x` then stores the entry with that negative id (`bindLong(2, jM2472)`), so
  the entry is kept as "missing/unresolved" and is counted in the sort index.

### Import — CUE specifics

| Condition | Behaviour | Log |
|---|---|---|
| any exception during parse | `m1984` catches, returns `null` | `Log.e("CueParser", "", e)` |
| `null` result from `m1984` | `C0760#A` skips `m2514`/`m2515` entirely; no virtual tracks; if nothing written and `this.x` is set the folder's stale cue rows are deleted | `Log.e("CueProcessor", "Failed to parse cue=" + cuePath, th)` |
| `FILE` argument unparsable | `C0607` not created; subsequent `TRACK`s orphaned | `Log.w("CueParser", "Invalid FILE")` |
| `TRACK` before any `FILE` | track dropped | `Log.e("CueParser", "No valid file for track")` |
| non-integer after a keyword | directive dropped | `Log.e("CueParser", "Unexpected token=" + n)` |
| unterminated quoted string | lexer returns code `8`; caller returns `11` (EOL) and resets | `Log.e("CueLexer", "Unterminated string")` |
| `FILE` points to a non-audio / unknown file | `m2514` leaves `f2687 = false` ⇒ whole FILE skipped | (query miss, no log) |
| `TRACK` number `<= 0` or `> 999` | that virtual track skipped | `Log.e("CueBatchProcessor", "addTrackToBatch SKIP bad CUE track number=…")` |
| `TRACK` with no usable INDEX | that virtual track skipped | `Log.e("CueBatchProcessor", "addTrackToBatch SKIP as no CIE indicies …")` |
| file has 0 or 1 tracks | no virtual tracks at all (not an error) | — |
| image resolved ok but `#tracks == 1` | same as above | — |
| embedded CUE vs. standalone `.cue` conflict | embedded cue **ignored** when a real `.cue` exists | `Log.w("CueProcessor", "saveCueTracks ignoring embed cue for file … as valid .cue file exists")` |
| embedded cue expected but absent | tracks still produced with id 0 | `Log.e("CueProcessor", "saveCueTracks no embed cue found for=…")` |

### Export

| Condition | Behaviour |
|---|---|
| DB unavailable | `z5.m1551("PlaylistsExportActivity", "no db")`; posts result count 0 |
| unknown extension | `Log.e("PlaylistSavingHelper", "invalid playlist ext=" + ext + " for=" + file)` → returns `false` |
| empty extension (no `'.'` in name) | same "invalid playlist ext" path (`lowerCase.length() != 0` guard) → `false` |
| any `IOException`/`Exception` in a writer | `Log.e("PlaylistSavingHelper", "", e)` → returns `false`; the partially-written file is left on disk (no rollback) |
| `pfdOpener == null && file == null` | `throw new IllegalArgumentException()` |
| `getFD().sync()` fails | `Log.e("PlaylistSavingHelper", "pfdOpener=… file=…", th)` but **the export still counts as success** |
| referenced entry deleted after export query | nothing; a `null`/empty path simply skips that row |

---

## Evidence

| Claim | Class#method | What was observed |
|---|---|---|
| Import dispatch keyed on lowercased extension; set = m3u, m3u8, pls, wpl; unknown ⇒ M3U | `scanner.X#m2473` | `switch (lowerCase.hashCode())` with cases `106447 / 111095 / 117939 / 3299913` and `lowerCase.equals("m3u" / "pls" / "wpl" / "m3u8")`; trailing unconditional `m2475(…)` |
| Extension = text after last `'.'` | `audio.core.AbstractC0582#m1900` | `int i = str.lastIndexOf(46); return i >= 0 ? str.substring(i+1) : "";` |
| Playlist directory prefix = up to and incl. last `'/'` | `audio.core.AbstractC0582#m1898` | `int i = str.lastIndexOf(47); return i >= 1 ? str.substring(0, i+1) : str;` |
| M3U reader charset switch | `scanner.X#m2475` | `(z \|\| C0732.a1.f3789) ? data.B.B : data.B.f2590` |
| `B` = UTF-8, `f2590` = default charset | `data.B#<clinit>` | smali: `Charset.defaultCharset()` → `f2590`; `StandardCharsets.UTF_8` → `B` |
| BOM sniffing for UTF-8/16BE/16LE/32BE/32LE, BOM wins over caller charset | `data.C0630#<init>` | `-17,-69,-65`→`A`; `-2,-1`→`X`; `-1,-2`→`x`; `0,0,-2,-1`→`y`; `-1,-2,0,0`→`K`; else caller charset; `PushbackInputStream(4)` + `unread` |
| `C0630` charset constants | `data.C0630#<clinit>` | `A = data.B.B`; `X = UTF_16BE`; `x = UTF_16LE`; `y = "UTF-32BE"`; `K = "UTF-32LE"` |
| M3U per-line handling: trim, skip `len<=4`, `#` = directive, else entry | `scanner.X#m2475` | `StringsKt.trim(line)`; `if (string.length() > 4)`; `if (string.charAt(0) == '#')` … else `x(str, string, string2, …)` |
| `#EXTINF:` title capture; duration discarded | `scanner.X#m2475` | `string2 = StringsKt.trim(string.substring(idx + 1)).toString();` with `idx = indexOf(string, ',', 8)` |
| `#EXT-X-RATING:` parsed when ratings enabled | `scanner.X#m2475` | `startsWith(string, "RATING:", 7, true)` → `i6 = ParseUtils.parseInt(string, i2, -1, 10, -1)` starting at index 14 |
| HLS detection aborts normal parsing | `scanner.X#m2475` | `z5 && (STREAM-INF: \|\| VERSION: \|\| MEDIA-SEQUENCE: \|\| PLAYLIST-TYPE:)` → `m2471(…)` + `return` |
| HLS-as-URL / base64 data-URI emission | `scanner.X#m2471` | `"data:application/x-mpegurl;base64," + Base64.encodeToString(sb.toString().getBytes(UTF_8), 2)`; `bufferedReader.reset()` + `readLine()` join with `'\n'` |
| Relative path resolution | `scanner.X#x` | `if (!AbstractC0625.P(strConcat) && !AbstractC0625.m2011(strConcat) && str != null) strConcat = str.concat(str2);` |
| Windows drive path rewritten to `/…` | `scanner.X#x` | `strConcat.length()>3 && isLetter(c0) && c1==':' && (c2=='\\' \|\| c2=='/')` → `"/".concat(strConcat.substring(3))` |
| URL detection | `okhttp3…y#m3556` | literal `http://` / `https://` char compares |
| `data:` detection | `okhttp3…y#o` | `charAt(0..4) == 'd','a','t','a',':'` |
| `.m3u`/`.m3u8` filename detection | `okhttp3…y#C` | suffix compare `m3u8` / `m3u` |
| `@`-prefix detection | `data.saf.AbstractC0625#P` | `str.charAt(0) == '@'` |
| `content:` detection | `data.saf.AbstractC0625#m2011` | `"content:".charAt(0..7)` compares |
| SAF-vs-file routing | `data.saf.AbstractC0625#m2017` | `!(null \|\| len<=0 \|\| starts with '/' \|\| m2011 \|\| m2014)` → treat as SAF/document path |
| Path resolution / id assignment incl. negative id for missing | `scanner.X#m2472` | `sQLiteStatement.simpleQueryForLong()` on several lookups; `return -sQLiteStatement.executeInsert();` |
| PLS only honours `FileN=` | `scanner.X#m2473` case `111095` | `startsWith(line, "File", 0, true)` + `indexOf('=') > 0`; nothing else tested |
| PLS base charset UTF-8 | `scanner.X#m2473` case `111095` | `new C0630(x.m2006(context, str4), data.B.B)` |
| Export format dispatch | `rest.library.H#B` | same 4-case switch, `Log.e("PlaylistSavingHelper","invalid playlist ext=…")` on default |
| Export default extension `.m3u8` | `dialogs.B#run` default branch | `if (!string.endsWith(".m3u8")) sb.append(".m3u8");` + `DocumentsContract.createDocument(…, "text/m3u8", …)` |
| Export entry SQL (absolute path) | `rest.library.H#B` | literal `SELECT COALESCE(COALESCE(folder_files.file_path, path\|\|folder_files.name,…) … ORDER BY sort` |
| M3U writer body + relative stripping | `com.pixplicity.htmlcompat.i#m3120` | `write("#EXTM3U")`; `write("#EXT-X-RATING:")`; `write("#EXTINF:-1,")`; `regionMatches(string,0,str,0,str.length(),true)` → `substring(str.length())` |
| M3U writer charset | `i#m3120` | `Charset charset = z ? data.B.B : data.B.f2590;` |
| Sub-playlist base64 inline/decode | `i#m3120`, `i#A` | `"data:application/x-mpegurl;base64," + Base64.encodeToString(…)`; `A()` finds `"base64"` then `Base64.decode(s.substring(i+7),0)` |
| PLS writer body | `i#B` | `write("[playlist]\r\n")`, `"File"`, `"Title"`, `"Length"` + `getLong(2)/1000`, `"NumberOfEntries="`, `"Version=2\r\n"`, charset `data.B.B` |
| WPL writer body | `i#m3119` | `startTag("","smil"/"head"/"meta"/"body"/"seq"/"media")`, `attribute("","IsNetworkFeed","FALSE")`, `attribute("","src",string)` |
| CUE parse entry + ISO-8859-1 base charset | `data.cue.A#m1984` | `new C0630(fileInputStream, StandardCharsets.ISO_8859_1)`; `this.A = reader.getEncoding().startsWith("UTF")`; `catch { Log.e("CueParser","",e); return null; }` |
| CUE directive loop | `data.cue.A#B` | cases 1–6 with sub-switch 12/13/14/15/16/17; `Log.w("CueParser","Invalid FILE")`, `Log.e("CueParser","No valid file for track")`, `Log.e("CueParser","Unexpected token=" + n)` |
| CUE lexer is JFlex-generated, 4 DFA states, states `{0,0,1,1}` | `data.cue.C0606#<clinit>` | `filled-new-array {0,0,1,1}, [I` → `H`; strings `"Error: could not match input"`, `"Unkown internal scanner error"`, `"Error: pushback value was too large"` |
| CUE lexer token constants (int in `K`, float in `f2683`, EOL = 11, EOF = -1) | `data.cue.C0606#m1987` | `this.K = ParseUtils.parseInt(B(),0,-1,10,0)` on token 1; `Float.parseFloat(B())` on token 10; `return 11` / `return -1` |
| Lexeme extraction | `data.cue.C0606#B` | `new String(this.A, this.X, this.f2686 - this.X)` |
| `INDEX nn mm:ss:ff` parsing, `INDEX 00` dropped | `data.cue.A#B` case 6 | `if (i2 != 0) { x4.x.add(new B(i2, i3, i4, i5)); }` |
| CUE time base 75 fps → ms | `data.cue.B#<init>` + `#m1986` | `this.x = i4 % 75; int s = (i4/75)+i3; this.X = s % 60; this.A = (s/60)+i2;` and `return ((x*1000)/75) + (X*1000) + (A*60000);` |
| Track start = `INDEX 01`, end = next track's `INDEX 01` or file duration | `data.cue.X#X` + `C0760#m2515` | `get(size==1 ? 0 : 1).m1986()`; `int iX = x4.X(); … if (x3 == null) iX = i6 /*file duration*/; if (iX != -1 && (i8 = iX - i7) > 0)` |
| Only files with >1 track yield virtual tracks | `C0760#m2515` | `if (!c0607.f2687 \|\| (size = arrayList.size()) == 0 \|\| size == 1) { skip }` |
| Track number gate 1..999 | `C0760#m2515` | `if (i17 <= 0 \|\| i17 > 999) { Log.e("CueBatchProcessor", "addTrackToBatch SKIP bad CUE track number=" + …) }` |
| CUE gap/flags string | `C0760#m2515` | `int i21 = (c0608.K ? 1 : 0) \| (x2.y ? 2 : 0); str4 = i21 + "," + f + "," + f2 + "," + f3 + "," + f4;` → `f3519` |
| CUE driver query | `C0760#B` | `"SELECT _id, path, name, dir_modified_at, parent_id, (select thumb from folders as folders2 where folders2._id=folders.parent_id) FROM folders WHERE is_cue=1 AND (num_files=0 OR updated_at=-1)"` |
| CUE standalone path assembly + SAF/file open | `C0760#A` | `this.H.append(str); int length = this.H.length(); this.H.append(str2);` then `x.P(...)`/`new FileInputStream(string)` → `((data.cue.A) this.f3572.getValue()).m1984(fileInputStream, data.B.f2590)` |
| Embedded-vs-standalone CUE precedence | `C0760#m2515` | `Log.w("CueProcessor","saveCueTracks ignoring embed cue for file "+lowerCase+" as valid .cue file exists")`; `Log.e("CueProcessor","saveCueTracks no embed cue found for="+lowerCase)` |
| Missing playlist file ⇒ row deleted | `scanner.X#m2470` | `Log.e("PlaylistProcessor","parseIfNeeded REMOVING as no file=" + str2)` then `this.B.execSQL("DELETE FROM playlists WHERE _id=?", new String[]{str})` |
| Playlist import driven from `playlists.playlist_path` | `scanner.library.K#m2502` | `"SELECT _id, mtime, playlist_path, created_at, updated_at FROM playlists WHERE playlist_path IS NOT NULL"` (+ `LIKE ? ESCAPE '\' COLLATE NOCASE`) → `x2.m2470(...)` |
| Export driver + "only playlists w/o path" checkbox | `dialogs.B#run` | `"playlists.playlist_path IS NULL"` when `r5 == 0`; `Cursor cursorA = restProvider.A(uriB0, {"playlists._id","playlists.playlist"}, str2, …)` |
| Export per-entry writer | `dialogs.B#run` | `r10.B(playlistsExportActivity2, x, r13, j, string2, null, new androidx.appcompat.app.H(…))` → `rest.library.H#B` |
| `C0608` result shape | `data.cue.C0608#toString` | `" mCuePath=" + f2691 + " #mFiles=" + X.size()` |
| `C0607` per-file shape | `data.cue.C0607#toString` | `" mImagePath=" + f2688 + " #tracks=" + B.size() + " mIsOk=" + f2687 + " mResolvedImagePath=" + A + " mResolvedImageFileName=" + f2689` |
| `B` (index) shape | `data.cue.B#toString` | `String.format(Locale.ROOT, "%d %02d:%02d:%02d", B, A, X, x)` |

---

## Unknowns

1. **`REM` handling in CUE** — no branch exists in `data.cue.A#B`, so I claim it is lexed and
   discarded. I did **not** decode the JFlex token table (`C0606`'s packed `String` state tables) to
   prove which keyword ids map to which literal keyword text. The directive *identities* above are
   inferred from argument types + how `C0760#m2515` consumes the fields, not from literal keyword
   strings. Label: **inferred**.
2. **Exact CUE keyword → token id mapping** (which of 12…17 is `TITLE` vs `PERFORMER` vs `PREGAP`
   vs `POSTGAP` vs something `REM`-adjacent) is unresolved: the keyword text lives in the packed
   lexer tables, not in a readable literal. I observed *slot* `C0608.y` = "album string used as
   title fallback", `C0608.B` = "album string used as artist fallback", `C0608.x` = "album int used
   as offset/step default (10000 fallback)", `C0608.H/P` + `C0608.K` and `X.K/H` + `X.y` = "gaps".
3. **Where `offset_ms` / `cue_offset_ms` / `cue_folder_id` columns are actually bound** — happens in
   `scanner.library.C0753` / `А` / `EnumC0754.m2504` batch-flush code, which I did not decompile.
   `CueFileBatch` clearly carries the values (`f3516` duration, `f3517` pseudo-path with offset,
   `f3514` folder id, `f3513` image name) but the SQL binding is outside this slice.
4. **`C0732.a1.f3789`** — a global boolean gating "always UTF-8 for M3U" and used in several other
   places. Its preference name was not resolved.
5. **`rest.library.H#<clinit>` / field `f3277`** — the boolean passed as the M3U writer's `z`
   (UTF-8 flag) for the `.m3u` (non-m3u8) branch. Not decompiled; it is either a pref or a constant.
6. **`file_type == 23`** meaning. It gates the `#EXTINF` emission and the sub-playlist inlining.
   Most plausibly "playlist" as a library file type, but the enum was not resolved.
7. **`.cue` as a playlist extension** — I found no case for `"cue"` in either dispatcher. Whether a
   `.cue` file placed in a playlist is silently mis-parsed as M3U (predicted by the unconditional
   tail call) or rejected earlier by the "is this a playlist file" pre-check is **not verified**.
8. **PLS re-try as M3U** — the control flow shows `m2475(...)` reachable after the PLS block on
   exception. Whether a *successfully parsed* PLS also triggers it depends on `readLine()` returning
   `null` (which returns from the method). Decompiler output at that join point is ambiguous
   (`returns` inside the `while(true)`), so the double-parse case is **inferred, low confidence**.
9. **`p0.a1(StringBuilder, String, String, int)`** — the CUE pseudo-path builder used for
   `CueFileBatch.f3517`. Signature known (`(StringBuilder, String, String, int)`), body not read;
   the "offset captured in the path" reading is inferred from the `int` argument being
   `cueFileBatch.f3516` (the computed duration) and from `f3517` being stored alongside the offset
   columns.
10. **Absolute-path/relative-path policy for export when the playlist sits on a SAF tree** — the
    writers use `prefix = AbstractC0582.m1898(fileName)` of the *destination document name*, and
    `regionMatches` against the composed `_path`. For SAF trees the document name may not be a real
    path prefix, in which case nothing is stripped and absolute paths are written. Not verified.
11. **No BOM is written on export** — observed by absence of any BOM write in all three writers, but
    `XmlSerializer.startDocument("UTF-8", true)` in the WPL writer *may* emit one depending on the
    platform implementation (not observable statically).
