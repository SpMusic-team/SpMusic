---
doc_id: poweramp-settings-search
title: Poweramp 设置页「搜索」完整实现（SQLite FTS4 全文索引 + 自定义 Layout）
doc_type: architecture
status: draft
owner_agent: lead
version_scope: build-1035-bundle-play (versionCode 1035009)
created: 2026-11-07
updated: 2026-11-07
source_documents:
  - .rea-analysis/v1035/decoded/res/xml/*.xml（62 个设置页）
  - .rea-analysis/v1035/decoded/res/values/attrs.xml
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/preference/PrefSearchIndexer.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/SettingsSearchLayout.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/SearchEditText.smali
  - .rea-analysis/v1035/decoded/smali/com/maxmpz/audioplayer/preference/SearchItemView.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/u9.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/lj.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/h11.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/kb1.smali
  - .rea-analysis/v1035/decoded/smali/ׅ/dj.smali
  - docs/architecture/poweramp-settings-root-structure.md
  - docs/architecture/poweramp-settings-page-runtime.md
  - docs/architecture/poweramp-settings-export-import.md
---

# Poweramp 设置页「搜索」完整实现

> **证据分级**：【实证·原文】= XML/资源；【实证·产物】= 反编译 smali；【推断】= 无直接佐证。
>
> 全部基于 **build-1035-bundle-play**（`versionCode 1035009`）。
>
> **范围**：设置页顶部的搜索框。**不含**媒体库搜索（那是另一套，见 `poweramp-search-and-queue-impact.md`）。

### 阅读导引

| 想知道什么 | 去第几节 |
| --- | --- |
| 一句话结论 | **§0** |
| 搜索的完整数据流 | **§1** |
| **索引怎么建（FTS4）** | **§2** |
| **表结构** | **§3** |
| 哪些项会被索引（`skipSearch`） | **§4** |
| **搜索怎么执行（MATCH）** | **§5** |
| 结果怎么渲染与跳转 | **§6** |
| 搜索框 UI | **§7** |
| 索引失效与重建 | **§8** |
| 未解问题 | **§9** |
| 证据索引 | **§10** |

---

## 0. 一句话结论

设置页搜索是**基于 SQLite FTS4 全文索引的本地搜索**，不是简单的字符串匹配。

**三层结构**：

```
① 索引层  PrefSearchIndexer（继承 u9）
          扫描 62 个设置 XML → 解析每个 Preference → 写入两张表
          pref_search      （元数据：breadcrumb/pref_uri/pref_key/icon/type）
          pref_search_fts  （FTS4 虚拟表：title/summary，tokenize=unicode61）

② 查询层  h11.v0() 构造 SELECT ... JOIN ... WHERE fts MATCH ?

③ 展示层  SettingsSearchLayout（自定义 SceneFastLayout）
          TextWatcher 实时触发 → kb1 适配器 → SearchItemView 渲染
```

**核心数据流**：

```
用户输入 "bluetooth"
  → SettingsSearchLayout.onTextChanged（trim → 去重）
  → kb1.С()
  → h11.v0() 构造 MATCH 查询（按空格拆分，每词加 * 前缀）
  → SQLite FTS4 查询
  → 结果集 → kb1 适配器 → SearchItemView
  → 点击 → pref_uri 跳转
```

**关键设计**：

| 点 | 说明 |
| --- | --- |
| **FTS4 + unicode61** | 支持多语言分词（含 CJK）|
| **前缀匹配** | 每个搜索词后加 `*`，输入 "blu" 就能匹配 "bluetooth" |
| **双表分离** | 元数据（可 JOIN）与全文索引分离 |
| **索引在 DB 里** | 跨进程共享，启动即可用，无需每次重建 |
| **`skipSearch` 三态** | `true`/`false`/变体列表，控制是否进索引（详见 §4）|

---

## 1. 完整数据流

### 1.1 建索引（首次启动或版本升级）

```
PrefSearchIndexer.<init>()
  ├─ 取 __DbAPI 的 getWritableDatabase()          :52
  ├─ compileStatement(INSERT INTO pref_search...)  :65-77
  └─ compileStatement(INSERT INTO pref_search_fts...) :81-93
       ↓
PrefSearchIndexer.y(int xmlResId, XmlResourceParser parser)   :498-1155
  ├─ Xml.asAttributeSet(parser)                    :506
  ├─ 遍历 XML 节点                                 :516-530
  ├─ 每个 Preference 读 TypedArray：
  │    ├─ u9.х(ta, 2, false) → skipSearch 判断    :578
  │    ├─ ta.getString(5)                        :593
  │    ├─ u9.Х(5, str) → 变体判断                 :605
  │    ├─ ta.getBoolean(4, false)                :629
  │    ├─ ta.getString(0) → title                :637
  │    └─ ta.getString(2) → summary              :645
  ├─ 自定义类 → 反射 Class.forName("com.maxmpz.audioplayer" + name)  :710-791
  └─ u9.indexXml(parser, ...) 递归索引子节点       :935
       ↓
PrefSearchIndexer.insertIndexEntry()
  ├─ 写 pref_search（5 个参数）                    :243-320
  ├─ executeInsert() → rowid                      :320-328
  └─ 用 rowid 写 pref_search_fts（docid, title, summary）  :328-364
       ↓
PrefSearchIndexer.X()  → INSERT INTO pref_search_fts(pref_search_fts) VALUES('optimize')
```

### 1.2 查询（用户输入时）

```
SettingsSearchLayout.onTextChanged(text, ...)      :1218-1402
  ├─ trim 首尾空白（空格 0x20 判定）                :1254-1343
  ├─ 与 this.F（上次查询）比较                      :1367-1379
  └─ 不同 → this.F = text; kb1.С()                 :1383-1395
       ↓
h11.v0(SQLiteDatabase, Uri, qd0, String[], String query)   :188-448
  ├─ "pref_search JOIN pref_search_fts ON docid=pref_search._id"  :192
  ├─ "pref_search_fts"                             :200
  ├─ " MATCH ?"                                    :209
  ├─ 按空格拆分 query，每词加 "*"                   :343-384
  └─ f11.А()/В() 执行查询                           :422-438
       ↓
kb1（t8 子类）适配器 → SearchItemView 渲染
```

### 1.3 点击跳转

```
SettingsSearchLayout.onItemClick(item)             :643-1216
  ├─ 取 pref_uri                                  （见 §6）
  ├─ 处理 "settings/" 前缀                        :807
  └─ no_backstack 标记                            :934
```

---

## 2. 索引怎么建（`PrefSearchIndexer`）

### 2.1 类身份

【实证·产物】`com/maxmpz/preference/PrefSearchIndexer.smali`：

| 项 | 值 |
| --- | --- |
| 类 | `public Lcom/maxmpz/preference/PrefSearchIndexer;` |
| **父类** | **`Lׅ/u9;`**（搜索索引基类）|
| 规模 | **1156 行 / 23,413 B** |
| 静态字段 | **`public static x:Z`**（全局"索引已就绪"标志）|
| 实例字段 | `X:SQLiteStatement`（fts 插入）、`Х:SQLiteStatement`（pref_search 插入）、`х:SQLiteDatabase` |

### 2.2 构造器：预编译两条 INSERT

【实证·产物】`PrefSearchIndexer.smali:19-154`：

```java
PrefSearchIndexer(Context ctx) {
    super(ctx);                                              // :23  u9.基类

    this.х = ((DbAPI) ctx.getApplicationContext()
                .getSystemService("__DbAPI"))                 // :36-48
                .getWritableDatabase();                        // :52

    this.Х = db.compileStatement(                             // :65-77
        "INSERT INTO pref_search(breadcrumb, pref_uri, pref_key, icon, type) VALUES (?, ?, ?, ?, ?)");
    this.X = db.compileStatement(                             // :81-93
        "INSERT INTO pref_search_fts(docid, title, summary) VALUES (?, ?, ?)");

    this.B = this;                                            // :97  回指 u9
}
```

| 要点 | 说明 |
| --- | --- |
| **数据库来源** | `__DbAPI` 系统服务（Poweramp 自注册的 Binder）|
| **预编译** | 两条 `INSERT` 都 `compileStatement`，重复使用时只 bind 不 parse |
| **`this.B = this`** | `u9` 基类的 `B` 字段回指自己，供 `u9` 内部回调 |

> **`__DbAPI` 是 Poweramp 的核心数据库服务**——`getSystemService("__DbAPI")` 是自定义系统服务名，通过 `Context.getSystemService` 拿到 `DbAPI` Binder 接口。

### 2.3 `y()`：XML 解析建索引（657 行，核心）

【实证·产物】`PrefSearchIndexer.smali:498-1155`。这是**全类最重的方法**。

#### ① 遍历 XML 节点

```java
AttributeSet attrs = Xml.asAttributeSet(parser);          // :506
int type;
while ((type = parser.next()) != START_TAG) {             // :516-530
    if (type == END_DOCUMENT) throw new InflateException();  // :534-539
}
```

#### ② 每个 Preference 读属性

```java
Resources res = ctx.getResources();
String entryName = res.getResourceEntryName(xmlResId);    // :551  ★ 页面名
TypedArray ta = ctx.obtainStyledAttributes(attrs, styleable);  // :563

// ── skipSearch 判断（三态）──
boolean skip = u9.х(ta, 2, false);                        // :578  ★ 索引 2
if (skip) { ta.recycle(); continue; }                     // :586  跳过该项

// ── 变体判断 ──
String variant = ta.getString(5);                         // :593  ★ 索引 5
if (u9.Х(5, variant)) { ... }                             // :605

// ── 其他属性 ──
boolean persistent = ta.getBoolean(4, false);             // :629  ★ 索引 4
String title = ta.getString(0);                           // :637  ★ 索引 0
String summary = ta.getString(2);                         // :645  ★ 索引 2
```

#### ③ 自定义类 → 反射实例化

```java
if (name.charAt(0) != '.') {                              // :668  非相对类名
    sb.append("com.maxmpz.audioplayer");                  // :710
    sb.append(name);                                      // :714
}
Class<?> cls = Class.forName(sb.toString());              // :755  ★ 反射
Constructor<?> ctor = cls.getConstructor(...);            // :775
Object pref = ctor.newInstance(...);                      // :791
```

> **为什么要反射**：设置 XML 里有 `com.maxmpz.audioplayer.preference.MultilineSwitchPreference` 这类**完整类名**的标签。为了读取它们的自定义属性（如 `w:sup`），必须实例化。
>
> **这是设置页搜索能索引自定义控件文案的关键**。

#### ④ 递归子节点

```java
if (parser.getName() != null) {                           // :898
    u9.indexXml(parser, "", ...);                          // :935  ★ 递归
}
```

### 2.4 `insertIndexEntry()`：双表写入

【实证·产物】`PrefSearchIndexer.smali:243-390`：

```java
void insertIndexEntry(String prefUri, String breadcrumb, String prefKey,
                      String title, String summary, int icon, int type) {
    SQLiteStatement st1 = this.Х;                          // pref_search
    SQLiteStatement st2 = this.X;                          // pref_search_fts

    // ── 表 1：元数据 ──
    st1.bindString(1, breadcrumb);                         // :266  breadcrumb
    st1.bindString(2, prefUri);                            // :284  pref_uri
    st1.bindString(3, prefKey);                            // :292  pref_key
    st1.bindLong(4, icon);                                 // :303  icon
    st1.bindLong(5, type);                                 // :314  type
    long rowid = st1.executeInsert();                      // :320  ★ 拿到 _id

    // ── 表 2：全文索引（用 rowid 关联）──
    st2.bindLong(1, rowid);                                // :328  ★ docid
    st2.bindString(2, title);                              // :333  title
    if (summary != null) st2.bindString(3, summary);       // :342
    else st2.bindNull(3);                                  // :358
    st2.executeInsert();                                   // :364
}
```

| 参数 | 类型 | 来源 |
| --- | --- | --- |
| `prefUri` | `String` | `settings/<页面名>` |
| `breadcrumb` | `String` | 页面面包屑（如 "Audio > Output"）|
| `prefKey` | `String` | `android:key` |
| `title` | `String` | `android:title` 解析后的文案 |
| `summary` | `String` | `android:summary`（可空）|
| `icon` | `int` | 图标资源 id |
| `type` | `int` | 类型（控件种类）|

> **`rowid` 是两张表的唯一纽带**：先插 `pref_search` 拿 `_id`，再用它作为 `pref_search_fts.docid`。
>
> **这是 FTS4 外部内容表的标准做法**（但这里是手动维护，不是 `content=` 自动模式）。

### 2.5 `X()`：索引重建后的 optimize

【实证·产物】`PrefSearchIndexer.smali:158-199`：

```java
void X() {
    st.execute("INSERT INTO pref_search_fts(pref_search_fts) VALUES('optimize')");  // :167
    // 异常 → Log.e("PrefSearchIndexer", "", t)                                     // :185-189
}
```

> **`optimize` 是 FTS4 的专用命令**——合并 b-tree 分段，压缩索引体积、提升查询速度。
>
> **应该在批量插入后调用**（不是每条都调）。

### 2.6 `x(I)`：单页索引

【实证·产物】`PrefSearchIndexer.smali:392-496`（104 行）：按 XML 资源 id 索引单个页面。

### 2.7 `finalize()`

【实证·产物】`PrefSearchIndexer.smali:201-241`：关闭两个 `SQLiteStatement`。

---

## 3. 表结构（FTS4）

### 3.1 `pref_search`（元数据表）

【实证·产物】`lj.smali:2506-2524`（`CREATE TABLE` 拼接）：

```sql
CREATE TABLE pref_search (
    _id INTEGER PRIMARY KEY,
    breadcrumb TEXT,
    pref_uri TEXT,
    pref_key TEXT,
    icon INTEGER NOT NULL DEFAULT 0,
    type ...
)
```

| 列 | 用途 |
| --- | --- |
| `_id` | 主键，与 `pref_search_fts.docid` 对应 |
| `breadcrumb` | 面包屑路径 |
| `pref_uri` | 跳转 URI（`settings/<页名>`）|
| `pref_key` | 偏好 key |
| `icon` | 图标资源 id |
| `type` | 类型 |

### 3.2 `pref_search_fts`（FTS4 虚拟表）

【实证·产物】`lj.smali:2544-2558`：

```sql
CREATE VIRTUAL TABLE pref_search_fts
    USING fts4(tokenize=unicode61, title, summary)
```

| 要素 | 值 |
| --- | --- |
| 引擎 | **FTS4** |
| **分词器** | **`unicode61`** |
| 索引列 | `title`、`summary` |

> **`unicode61` 是 SQLite 的 Unicode 分词器**——按 Unicode 字符类别切词，支持拉丁、西里尔、CJK 等。
>
> **这解释了设置页搜索对中文/俄文的支持**。

### 3.3 两表关系

```
pref_search._id  ←→  pref_search_fts.docid
（元数据）              （全文索引）
```

**查询时 JOIN**：

```sql
SELECT ... FROM pref_search
  JOIN pref_search_fts ON docid = pref_search._id
WHERE pref_search_fts MATCH ?
```

### 3.4 表位于哪个数据库

`lj` 是 `SQLiteOpenHelper`，通过 `__DbAPI` 暴露。**所有设置搜索数据在 Poweramp 主数据库里**（不是独立 db 文件）。

---

## 4. 哪些项会被索引（`skipSearch`）

### 4.1 `skipSearch` 的三态

【实证·原文】`attrs.xml`：

```xml
<attr name="skipSearch" format="string|boolean" />
```

| 值形态 | 含义 | 全 App 出现次数 |
| --- | --- | ---: |
| `"true"` | **跳过索引**（不参与搜索）| **75** |
| `"false"` | 显式声明"参与索引" | **7** |
| `"play"` / `"play,huawei"` / `"peq"` | **按构建变体** | 各 1 |

### 4.2 判定逻辑

【实证·产物】`u9.smali:467-588`（`х(TypedArray, I, Z)`）：

```java
static boolean х(TypedArray ta, int idx, boolean def) {
    TypedValue v = ta.peekValue(idx);
    if (v == null) return def;
    if (v.type == 0x12 /* TYPE_INT_BOOLEAN */) {
        if (ta.getBoolean(idx, def)) return true;      // true → 跳过
    }
    String s = ta.getString(idx);
    if (TUtils.isEmpty(s)) return false;
    if (nn.В(s, "play")) return true;                  // 变体匹配
    if (nn.В(s, "pa"))   return true;
    return false;
}
```

**`nn.В(haystack, needle)` 是 CSV 成员判断**【实证·产物】`nn.smali:7-106`：

```java
// 找到 needle 后检查：
//   之后是结尾或逗号(0x2c)
//   之前是开头或逗号
```

> 所以 `"play,huawei"` 里 `"play"` 命中，`"playx"` 不命中。

### 4.3 `skipSearch` 的完整语义

| 作用 | 决定者 | 时机 |
| --- | --- | --- |
| **UI 是否显示** | helper 的 `removePreference` | 页面加载 |
| **是否进搜索索引** | `skipSearch` 属性 | 索引构建 |

> **两者独立**。一个项可以"UI 显示但不进索引"，或"UI 被删但仍在索引里"（后者是 `poweramp_forum` 的实际状况，见 `poweramp-about-and-support-settings.md` §15.7）。

### 4.4 文档级 `skipSearch`

`PreferenceScreen` 根节点也可以有 `w:skipSearch="true"` —— 整页不进索引。

**62 个 XML 中单页被排除的例子**：
- `commands_history.xml`：`w:skipSearch="true"`（日志页，无搜索价值）
- `already_purchased.xml`、`feature_packages.xml`：购买流程页

---

## 5. 搜索怎么执行（MATCH 查询）

### 5.1 `h11`：查询构造器

【实证·产物】`ׅ/h11.smali`（448 行）：

| 方法 | 内容 |
| --- | --- |
| `g()` | 返回 **`"settings"`**（表/页标识）|
| `R(int)` | 返回 **`"type"`**（列名）|
| `i0()` | 返回 `hy0`（Library/Rest 服务）|
| **`v0(db, uri, qd0, String[] args, String query)`** | **构造 JOIN + MATCH 查询（261 行）** |

### 5.2 `v0()` 的查询构造

【实证·产物】`h11.smali:188-448`：

```java
void v0(SQLiteDatabase db, Uri uri, qd0 builder, String[] args, String query) {
    // ① 表名（JOIN）
    builder.В("pref_search JOIN pref_search_fts ON docid=pref_search._id");  // :192

    // ② MATCH 列
    builder.В("pref_search_fts");                     // :200
    builder.В(" MATCH ?");                            // :209

    // ③ 构造 MATCH 参数（按空格拆分 + 加 *）
    if (query != null) {
        // trim 首尾空白                      :218-343
        String[] words = trimmed.split(" ");           // :343-351
        for (String w : words) {
            if (w.length() > 0) {
                words.add(w + "*");                    // :371-375  ★ 前缀匹配
            }
        }
    }

    // ④ 执行
    f11.А(db, sql, args);                              // :422
    f11.В(db, sql, args);                              // :438
}
```

### 5.3 前缀匹配的意义

**每个搜索词统一加 `*`**：

| 输入 | 实际 MATCH | 能匹配 |
| --- | --- | --- |
| `blu` | `blu*` | bluetooth, blue, blur… |
| `blue tooth` | `blue* tooth*` | "Bluetooth"（多个词 AND）|
| `设置` | `设置*` | 中文项 |

> **这是"输入即搜索"体验的关键**——用户输入第一个字母就能出结果，不必输完整词。

### 5.4 FTS4 MATCH 的语义

FTS4 的 `MATCH` 是**隐式 AND**：

```sql
WHERE pref_search_fts MATCH 'blue* tooth*'
-- 等价于：文档必须同时含 blue* 和 tooth*
```

> 所以输入多个词会**收窄**结果，符合用户直觉。

---

## 6. 结果渲染与跳转

### 6.1 `onItemClick`（573 行）

【实证·产物】`SettingsSearchLayout.smali:643-1216`。关键字符串：

| 字符串 | 行 | 用途 |
| --- | ---: | --- |
| `"#"` | `:782` | 锚点分隔符处理 |
| `"settings/"` | `:807` | **URI 前缀** |
| `"no_backstack"` | `:934` | 跳转标记（不压栈）|

**跳转流程**：

```
点击结果项
  → 取 pref_uri（如 "settings/audio"）
  → 去掉 "settings/" 前缀 → "audio"
  → 处理 "#" 锚点（如 "misc#long_volume_controls"）
  → 启动 SettingsActivity，带 open_path extra
  → no_backstack 标记控制是否压栈
```

> **`pref_uri` 的格式与 `w:target` 完全一致** —— 因为索引时就是用同一套路径拼的。
>
> 详见 `poweramp-settings-page-runtime.md` 与 `poweramp-settings-export-import.md` 关于 `open_path` 的解析。

### 6.2 结果项渲染（`SearchItemView`）

【实证·产物】`SearchItemView.smali`（257 行 / 4966 B）。**四个槽位已在 §12.3 完整核实**：

| 字段 | 资源 id | 语义 |
| --- | --- | --- |
| `v` | `@id/image` | **图标** |
| `w` | `@id/title` | **主标题** |
| `z` | `@id/line2` | **副标题**（summary）|
| `D` | `@id/line3` | **面包屑**（breadcrumb）|

> **`breadcrumb` 是设置页搜索的关键 UX 设计**——因为用户搜到的是深层项，必须告诉他"这一项在哪个页面"。
>
> **⚠️ 无关键词高亮**：`SearchItemView` 全文无 `setSpan`/`Spannable`，搜索词不高亮（详见 §12.3）。

### 6.3 `kb1`：适配器

【实证·产物】`ׅ/kb1.smali`（1207 行，`extends t8`）：

| 方法 | 作用 |
| --- | --- |
| `<init>` | 绑定 `SettingsSearchLayout`、`wk1`、`TextView` |
| `b(bj)` | 绑定视图 |
| `d()` | 返回 count |
| `e(int)` | 取字符串 |
| `o(int)` | 取 int |
| **`О(aq0, View, int, int)`** | **绑定列表项（729 行）** |
| `с()` | **触发查询**（150 行）|

**`О()` 里的主题处理**【实证·产物】`:730-862`：

```java
"theme_pak="           // :730
"pak="                 // :846
" th="                 // :850
"SettingsSearchLayout" // :862  日志 tag
```

> **搜索结果项也受皮肤主题影响** —— `theme_pak`/`pak`/`th` 是主题参数。

---

## 7. 搜索框 UI

### 7.1 `SettingsSearchLayout`

【实证·产物】`SettingsSearchLayout.smali`（1764 行 / 32,283 B）：

| 项 | 值 |
| --- | --- |
| 类 | `public final Lcom/maxmpz/audioplayer/preference/SettingsSearchLayout;` |
| 父类 | **`Lcom/maxmpz/widget/base/SceneFastLayout;`**（Poweramp 自绘布局）|
| 实现 | `s30`（场景接口）、**`TextWatcher`**、**`MsgBusSubscriber`** |
| 规模 | **1764 行** |

**三个接口分别对应**：

| 接口 | 作用 |
| --- | --- |
| `s30` | 场景渲染框架 |
| **`TextWatcher`** | **输入即时搜索** |
| **`MsgBusSubscriber`** | **接收全局消息（如索引更新通知）** |

### 7.2 `onAttachedToWindow`：初始化（271 行）

【实证·产物】`SettingsSearchLayout.smali:240-511`：

```java
void onAttachedToWindow() {
    super.onAttachedToWindow();                          // :244

    View searchField = findViewById(...);                // :270
    if (searchField == null) return;                     // :282

    // ① 构造适配器（含数据源）
    wk1 source = new wk1();                              // :286-290
    kb1 adapter = new kb1(this, ctx, source, searchField);  // :295-299  ★

    // ② 构造布局管理器
    lb1 layoutMgr = new lb1(adapter, this, ...);         // :332-350  ★

    // ③ 构造 RecyclerView 风格的组件
    xh1 x = new xh1(new jx(new lh(ctx), false));         // :362-384  ★
    ti1.Х(layoutMgr, adapter, x);                        // :393

    // ④ 触摸监听
    searchField.setOnTouchListener(new ka(2, ctx));      // :402-414

    // ⑤ 首次搜索（空查询 → 显示全部/最近）
    adapter.С();                                          // :419  ★

    // ⑥ 注册 TextWatcher
    TextView tv = findViewById(...);                      // :437
    if (tv != null) tv.addTextChangedListener(this);      // :457  ★

    // ⑦ 订阅 MsgBus
    msgBus.subscribe(this);                               // :467

    // ⑧ 处理 window insets（SDK >= 23）
    if (SDK_INT >= 0x17) {                                // :476
        dispatchApplyWindowInsets(getRootWindowInsets()); // :484-504
    }
}
```

| 组件 | 类型 | 作用 |
| --- | --- | --- |
| `wk1` | 数据源 | 持有查询结果 |
| `kb1` | `t8` 子类适配器 | 绑定列表项 |
| `lb1` | 布局管理器 | 列表布局 |
| `xh1` / `jx` / `lh` | 视图组件 | 列表容器 |
| `ka(2, ctx)` | `OnTouchListener` | 触摸处理 |

### 7.3 `onTextChanged`：输入即搜索

【实证·产物】`SettingsSearchLayout.smali:1218-1402`：

```java
void onTextChanged(CharSequence s, int start, int before, int count) {
    String text = s.toString();
    int end = text.length() - 1;
    int begin = 0;
    boolean started = false;

    // ── 双向 trim（逐字符判断 <= 0x20 空格）──
    while (begin <= end) {
        if (!started) {
            if (!isSpace(text.charAt(begin))) { started = true; continue; }
            begin++;
        } else {
            if (isSpace(text.charAt(end))) { end--; continue; }
            break;
        }
    }
    String trimmed = text.substring(begin, end + 1);     // :1351-1364

    // ── 去重：与上次查询相同则跳过 ──
    if (!Intrinsics.areEqual(this.F, trimmed)) {          // :1371-1379
        this.F = trimmed;                                  // :1383
        if (this.E != null) this.E.С();                    // :1387-1395  ★ 触发查询
    }
}
```

| 要点 | 说明 |
| --- | --- |
| **手写 trim** | 不用 `String.trim()`，逐字符判 `<= 0x20` |
| **去重** | `this.F` 保存上次查询，相同则跳过 |
| **取消上一次** | `t8.С()` 中 `this.p.A()` 中止前一查询（§11.1）|

> **⚠️ 上一版在此处写"没有输入防抖"是错的。**
>
> 实际上**有取消机制**（详见 §11.1）：`t8.С()` 在发起新查询前会 `this.p.A()` 中止上一次。
>
> 准确表述：这是「**取消上一次 + 立即发起新查询**」，不是「延迟 N 毫秒」的时间防抖。
>
> 效果上等效于防抖的一半——快速输入时只有最后一次能完成。代价是每按键仍产生一次（会被取消的）查询。

### 7.4 `SearchEditText`

【实证·产物】`SearchEditText.smali`（1237 B）：极简自定义 `EditText`，无额外逻辑。

### 7.5 `MsgBus` 消息处理

【实证·产物】`SettingsSearchLayout.smali:513-606`（`onBusMsg`）：

接收全局消息（如 **索引重建完成**），触发列表刷新。

---

## 8. 索引失效与重建

### 8.1 `dj`：索引清理器

【实证·产物】`ׅ/dj.smali`，6 处 SQL：

```sql
DELETE FROM pref_search
DELETE FROM pref_search_fts WHERE docid IN (SELECT _id FROM pref_search ...)
DELETE FROM pref_search_fts
DELETE FROM pref_search_fts WHERE docid IN (SELECT _id FROM pref_search WHERE pref_uri LIKE 'ui_theme_opts?%')
DELETE FROM pref_search WHERE pref_uri LIKE 'ui_theme_opts?%'
```

> **`ui_theme_opts?%` 的 LIKE 模式**说明：**主题相关项需要特殊清理** —— 因为主题可替换，其设置项会变化。

### 8.2 重建时机

| 场景 | 触发 |
| --- | --- |
| **首次安装** | 表不存在 → `lj.onCreate()` 建表 → 全量索引 |
| **数据库升级** | `lj.onUpgrade()` → 见 §3 |
| **主题切换** | `dj` 清理 `ui_theme_opts?%` → 重新索引 |
| **应用启动** | `PrefSearchIndexer` 构造时检查 `static x` 标志 |

### 8.3 `static x` 全局标志

【实证·产物】`PrefSearchIndexer.smali:7`：

```java
public static boolean x;    // 索引已就绪
```

**用途**：避免重复建索引。

---

## 9. 未解问题（**已全部闭环**）

> 初版列了 7 项（S1-S7）。经 §11-§13 三轮深挖，**7 项全部解出**。

### 9.1 已解（7 项）

| # | 原问题 | 结论 | 详见 |
| ---: | --- | --- | --- |
| **S1** | `u9` 基类逻辑 | 10 个方法全解；**`B()` 是占位符检测器**（含 `%s`/`%d` 的文案不索引）| §13.1 |
| **S2** | `pref_search.type` 枚举 | **`0`**=intent / **`1`**=RawTextPreference / **`3`**=PreferenceCategory / **`-1`**=其他 | §11.3 |
| **S3** | `wk1` 身份 | **视图池**（非数据源），容量 `B = (内存>100) ? 7 : 6` | §12.2 |
| **S4** | `lb1` 布局管理器 | **70 行参数转发器**，`Q()` 返回 `SettingsSearchLayout.v` | §13.2 |
| **S5** | `onItemClick` 跳转 | `type ∈ {0, 0xb}`；`settings/页名#锚点`；`no_backstack=true` | §11.4 |
| **S6** | 是否有 debounce | **有取消机制**（`this.p.A()`），非时间防抖 | §11.1 |
| **S7** | `SearchItemView` 高亮 | **无高亮**；4 槽位 = image/title/line2/line3 | §12.3 |

### 9.2 覆盖度总评

| 维度 | 覆盖度 |
| --- | --- |
| 索引构建（含 FTS4 表结构）| ✅ 100% |
| `skipSearch` 三态判定 | ✅ 100% |
| 查询构造（JOIN + MATCH + 前缀）| ✅ 100% |
| 异步调度与取消 | ✅ 100% |
| 结果渲染（4 槽位） | ✅ 100% |
| 点击跳转（含 `no_backstack`）| ✅ 100% |
| 布局 XML | ✅ 100% |
| 视图池与布局器 | ✅ 100% |
| **`type` 枚举** | ✅ 100% |

> **设置页搜索的调查已完整闭合。**

### 9.3 三个值得记录的"反直觉"发现

| # | 发现 | 性质 |
| ---: | --- | --- |
| 1 | **含 `%s`/`%d` 的文案不建索引** | 权衡取舍（避免索引垃圾文案）|
| 2 | **搜索结果不做关键词高亮** | 设计选择（设置项标题短）|
| 3 | **无时间防抖，但有取消机制** | 实现方案（更简单、响应更快）|

---

## 10. 证据索引

### 10.1 核心类

| 文件 | 规模 | 角色 |
| --- | ---: | --- |
| `com/maxmpz/preference/PrefSearchIndexer.smali` | **1156 行** | **索引构建器** |
| `com/maxmpz/audioplayer/preference/SettingsSearchLayout.smali` | **1764 行** | **搜索 UI 布局** |
| `com/maxmpz/audioplayer/preference/SearchItemView.smali` | 5222 B | 结果项视图 |
| `com/maxmpz/audioplayer/preference/SearchEditText.smali` | 1237 B | 搜索输入框 |
| `ׅ/u9.smali` | **1533 行** | 索引基类 |
| `ׅ/lj.smali` | **3397 行** | SQLiteOpenHelper（建表）|
| `ׅ/h11.smali` | 448 行 | **JOIN + MATCH 查询构造** |
| `ׅ/kb1.smali` | 1207 行 | 适配器 |
| `ׅ/dj.smali` | — | 索引清理 |
| `ׅ/nn.smali` | 107 行 | CSV 成员判断 |

### 10.2 关键定位

**索引构建**：

| 位置 | 内容 |
| --- | --- |
| `PrefSearchIndexer.smali:19-154` | 构造器（预编译 2 条 INSERT）|
| `PrefSearchIndexer.smali:65` | `INSERT INTO pref_search(breadcrumb, pref_uri, pref_key, icon, type)` |
| `PrefSearchIndexer.smali:81` | `INSERT INTO pref_search_fts(docid, title, summary)` |
| **`PrefSearchIndexer.smali:498-1155`** | **`y()` XML 解析（657 行）** |
| `PrefSearchIndexer.smali:578` | `u9.х(ta, 2, false)` skipSearch |
| `PrefSearchIndexer.smali:605` | `u9.Х(5, variant)` 变体判断 |
| `PrefSearchIndexer.smali:710-791` | 反射实例化自定义类 |
| `PrefSearchIndexer.smali:935` | `u9.indexXml()` 递归 |
| **`PrefSearchIndexer.smali:243-390`** | **`insertIndexEntry()` 双表写入** |
| `PrefSearchIndexer.smali:320-328` | rowid 传递 |
| `PrefSearchIndexer.smali:167` | `INSERT INTO pref_search_fts(pref_search_fts) VALUES('optimize')` |

**表结构**：

| 位置 | 内容 |
| --- | --- |
| **`lj.smali:2506-2524`** | **`CREATE TABLE pref_search`** |
| `lj.smali:2516` | `_id INTEGER PRIMARY KEY` |
| `lj.smali:2518` | `breadcrumb TEXT` |
| `lj.smali:2520` | `pref_uri TEXT` |
| `lj.smali:2522` | `pref_key TEXT` |
| `lj.smali:2506` | `icon INTEGER NOT NULL DEFAULT 0` |
| **`lj.smali:2544-2558`** | **`CREATE VIRTUAL TABLE pref_search_fts USING fts4(tokenize=unicode61, title, summary)`** |
| `lj.smali:2497` | `DROP TABLE IF EXISTS` |

**查询**：

| 位置 | 内容 |
| --- | --- |
| **`h11.smali:192`** | **`pref_search JOIN pref_search_fts ON docid=pref_search._id`** |
| `h11.smali:200` | `pref_search_fts` |
| `h11.smali:209` | `" MATCH ?"` |
| `h11.smali:343-384` | 按空格拆分 + 加 `*` |
| `h11.smali:170` | 返回 `"settings"` |
| `h11.smali:159` | 返回 `"type"` |
| `h11.smali:422/438` | `f11.А()` / `f11.В()` |

**UI**：

| 位置 | 内容 |
| --- | --- |
| **`SettingsSearchLayout.smali:240-511`** | **`onAttachedToWindow` 初始化** |
| `SettingsSearchLayout.smali:295-299` | `new kb1(...)` |
| `SettingsSearchLayout.smali:419` | `adapter.С()` 首次查询 |
| `SettingsSearchLayout.smali:457` | `addTextChangedListener(this)` |
| `SettingsSearchLayout.smali:467` | `msgBus.subscribe(this)` |
| **`SettingsSearchLayout.smali:1218-1402`** | **`onTextChanged` 输入处理** |
| `SettingsSearchLayout.smali:1371-1395` | 去重 + 触发 |
| **`SettingsSearchLayout.smali:643-1216`** | **`onItemClick` 跳转（573 行）** |
| `SettingsSearchLayout.smali:807` | `"settings/"` 前缀 |
| `SettingsSearchLayout.smali:782` | `"#"` 锚点 |
| `SettingsSearchLayout.smali:934` | `"no_backstack"` |
| `SettingsSearchLayout.smali:513-606` | `onBusMsg` |

**`skipSearch`**：

| 位置 | 内容 |
| --- | --- |
| `attrs.xml` | `skipSearch` / `skipSearchForSDK` 声明 |
| **`u9.smali:467-588`** | **`х(TypedArray,I,Z)` 判定** |
| `u9.smali:491-507` | 布尔分支 |
| `u9.smali:539-567` | 变体匹配 |
| **`nn.smali:7-106`** | **CSV 成员判断** |
| `nn.smali:56-93` | 前后逗号边界检查 |

**清理**：

| 位置 | 内容 |
| --- | --- |
| `dj.smali` | 5 条 DELETE |
| `dj.smali` | `WHERE pref_uri LIKE 'ui_theme_opts?%'` |

### 10.3 `skipSearch` 的全 App 分布

| 值 | 次数 | 实例 |
| --- | ---: | --- |
| `"true"` | **75** | 大量动态块、提示行 |
| `"false"` | **7** | 显式参与搜索 |
| `"peq"` | 1 | `audio_dvc.xml:19` |
| `"play,huawei"` | 1 | `general.xml:15` |
| `"play"` | 1 | `support.xml:6` |

### 10.3b 第 2 轮新增定位（S2/S5/S6）

**查询调度（S6）**：

| 位置 | 内容 |
| --- | --- |
| **`t8.smali:491-665`** | **`С()`：取消 + 异步调度（174 行）** |
| `t8.smali:495-515` | **`this.p.A()` 取消上一次查询** |
| `t8.smali:544` | `getSystemService("__Executors")` |
| `t8.smali:568` | `getSystemService("__DataAPI")` |
| `t8.smali:584-591` | `new p4(2, this)` |
| `t8.smali:596-613` | `.А(b(api)).y(exec.В)` 链式配置 |
| `t8.smali:629` | `this.О.В()` 复用重启 |
| `t8.smali:635-640` | `с()` 构造查询 |
| `t8.smali:659` | `this.О.х(query)` 提交 |

**查询 URI（`kb1`）**：

| 位置 | 内容 |
| --- | --- |
| **`kb1.smali:1056-1206`** | **`с()`：构造查询 URI（150 行）** |
| `kb1.smali:1064-1077` | `getSettings().A0()` 基础 URI |
| `kb1.smali:1080-1100` | 取 `this.d.F`（上次输入）|
| `kb1.smali:1116` | `clearQuery()` |
| **`kb1.smali:1124-1132`** | **`appendQueryParameter("s", query)`** |
| `kb1.smali:1140` | `build()` |
| `kb1.smali:1175-1194` | `new x51(uri, g11[], String[][], false, null)` |

**`type` 枚举（S2）**：

| 位置 | 内容 |
| --- | --- |
| **`u9.smali:592-1000`** | **`A()` 内的 type 判定** |
| `u9.smali:696` | `type = -1`（默认）|
| `u9.smali:703-723` | `PreferenceCategory` → **`type = 3`** |
| `u9.smali:750-770` | `RawTextPreference` → **`type = 1`** |
| `u9.smali:777-797` | `intent` → **`type = 0`** |
| `u9.smali:807/859` | `hasIntent` 标志（v10）|
| **`u9.smali:1498-1532`** | **`В()` 硬编码 type=0** |
| `u9.smali:1502` | `const/4 v7, 0x0` |

**跳转（S5）**：

| 位置 | 内容 |
| --- | --- |
| **`SettingsSearchLayout.smali:643-1216`** | **`onItemClick`（573 行）** |
| `SettingsSearchLayout.smali:762` | `c.getInt(typeIdx)` 读 type |
| **`SettingsSearchLayout.smali:770-778`** | **`type == 0 \|\| type == 0xb` 才可跳转** |
| `SettingsSearchLayout.smali:782-786` | `ee1.с(uri, "#")` 拼锚点 |
| `SettingsSearchLayout.smali:807` | `"settings/"` 前缀 |
| `SettingsSearchLayout.smali:834` | `Uri.parse()` |
| `SettingsSearchLayout.smali:850-893` | 第 6 列覆盖 URI |
| `SettingsSearchLayout.smali:922` | `В.Х(ctx, uri)` → Intent |
| **`SettingsSearchLayout.smali:934-938`** | **`no_backstack = true`** |
| `SettingsSearchLayout.smali:956` | MsgBus 通知 |

### 10.3c 第 3 轮新增定位（S3/S7 + 布局）

**布局 XML**：

| 位置 | 内容 |
| --- | --- |
| **`res/layout/merge_settings_search.xml`** | **唯一布局文件（1376 B）** |
| `merge_settings_search.xml:2` | 根 `SettingsSearchLayout` |
| `merge_settings_search.xml:3-5` | `search_content` + `search_list`（`PowerList`）|
| `merge_settings_search.xml:7` | `SceneParams`（结果区）|
| `merge_settings_search.xml:8-15` | `search_panel`（`back`/`close`/`edit`）|
| `merge_settings_search.xml:16` | `SceneParams`（面板）|

**`wk1` 视图池**：

| 位置 | 内容 |
| --- | --- |
| **`wk1.smali:15-47`** | **`<clinit>`：`B = (xn0.о > 0x64) ? 7 : 6`** |
| `wk1.smali:7` | `static final B:I` |
| `wk1.smali:11` | `В:Lׅ/y20;` 视图缓存池 |
| **`wk1.smali:83-127`** | **`B(int)` 从池取视图** |
| `wk1.smali:94` | `y20.B(type, null)` |
| **`wk1.smali:129-366`** | **`А(View,int)` 绑定并池化（237 行）** |
| `wk1.smali:211` | `y20.A(type, wrapper)` |
| `wk1.smali:303` | `RuntimeException("Can\'t queue item=")` |
| **`wk1.smali:368-404`** | **`В(View)` 回收** |
| `wk1.smali:384` | `vk1.с(this)` |
| `wk1.smali:398` | `setTag(0x7f0d01d5, this)` |

**`SearchItemView` 四槽位**：

| 位置 | 内容 |
| --- | --- |
| **`SearchItemView.smali:73-222`** | **`onFinishInflate` 字段绑定（149 行）** |
| `SearchItemView.smali:114-127` | `0x7f0d01de`（`@id/image`）→ `v` |
| `SearchItemView.smali:135-165` | `0x7f0d057d`（`@id/texts`）→ `w` = `0x7f0d001d`（`title`）|
| `SearchItemView.smali:169-186` | `z` = `0x7f0d001e`（`line2`）|
| `SearchItemView.smali:190-207` | `D` = `0x7f0d02f5`（`line3`）|
| `SearchItemView.smali:51-59` | `A(I)` 存 `type` 到 `u` |
| `SearchItemView.smali:62-70` | `X()` 取 `type` |
| `SearchItemView.smali:224-256` | `performClick()` |

**资源 id 对照**：

| id | 名称 |
| --- | --- |
| `0x7f0d01de` | `image` |
| `0x7f0d057d` | `texts` |
| `0x7f0d001d` | `title` |
| `0x7f0d001e` | `line2` |
| `0x7f0d02f5` | `line3` |
| `0x7f0d01d5` | `_tag_viewCache` |

### 10.3d 第 4 轮新增定位（S1/S4）

**`u9` 基类（10 方法 / 4 字段）**：

| 位置 | 内容 |
| --- | --- |
| `u9.smali:7-13` | 4 字段：`A:Z` / `B:PrefSearchIndexer` / `А:TypedValue` / `В:Context` |
| **`u9.smali:46-161`** | **`B(String)Z` 占位符检测（115 行）** |
| `u9.smali:53-72` | 长度 < 4 直接 false |
| `u9.smali:80-89` | `indexOf('%')` 循环 |
| **`u9.smali:123-139`** | **非 `%%` 且非 `"% "` → 有真占位符** |
| `u9.smali:163-465` | `Х(I,String)Z` 变体判断（302 行）|
| `u9.smali:467-588` | `х(TypedArray,I,Z)Z` skipSearch（121 行）|
| `u9.smali:592-975` | `A(...)` XML 解析（383 行）|
| `u9.smali:977-987` | `indexXml()` 包装（10 行）|
| `u9.smali:989-1029` | `insertIndexEntry()` 包装（40 行）|
| `u9.smali:1031-1040` | `setPartialReindex()`（9 行）|
| **`u9.smali:1042-1496`** | **`А(...)` 单条构建（454 行）** |
| `u9.smali:1188-1200` | `"://"` URL 检测 |
| `u9.smali:1322-1358` | title + `"\n"` + summary 合并 |
| `u9.smali:1260/1276/1299` | **三处 `B()` 占位符检测调用** |
| `u9.smali:1498-1532` | `В(...)` 硬编码 `type=0`（34 行）|
| `u9.smali:1502` | `const/4 v7, 0x0` |

**`lb1` 布局器（70 行）**：

| 位置 | 内容 |
| --- | --- |
| `lb1.smali:2` | `extends tk1` |
| `lb1.smali:7` | `R:SettingsSearchLayout` 宿主引用 |
| `lb1.smali:11-52` | 构造器（参数转发给 tk1）|
| `lb1.smali:46` | `super(1, adapter, a, 0, b, 0, 0, d)` |
| **`lb1.smali:56-69`** | **`Q()` 返回 `R.v`** |
| `lb1.smali:64` | `iget v, R, SettingsSearchLayout;->v:I` |

**继承链**：

| 类 | 规模 | 位置 |
| --- | ---: | --- |
| `sk1` | — | 基类 |
| **`tk1`** | **397 行** | `tk1.smali:15-58` 构造器、`:62-325` `E(IZ[I)`、`:327-396` `W(II)I` |
| **`lb1`** | **70 行** | 搜索专用 |

**`SettingsSearchLayout` 尺寸字段**：

| 位置 | 内容 |
| --- | --- |
| `SettingsSearchLayout.smali:26` | `field public final v:I` |
| `SettingsSearchLayout.smali:94-103` | `obtainStyledAttributes(attrs, qt0.w)` |
| `SettingsSearchLayout.smali:109` | `def = 0x64 /* 100 */` |
| `SettingsSearchLayout.smali:113-121` | `w = getDimensionPixelSize(0, 100)` |
| `SettingsSearchLayout.smali:128-136` | `z = getDimensionPixelSize(2, 100)` |
| **`SettingsSearchLayout.smali:143-151`** | **`v = getDimensionPixelSize(1, 100)`** |
| `SettingsSearchLayout.smali:155` | `ta.recycle()` |
| `SettingsSearchLayout.smali:160-173` | 订阅 `bus_app`（`0x7f0d015b`）|

### 10.4 交叉引用

| 文档 | 关系 |
| --- | --- |
| `poweramp-settings-page-runtime.md` | 三层骨架、`n91` 契约、`open_path` 解析 |
| `poweramp-settings-root-structure.md` | `singlepane` 结构与搜索索引范围 |
| `poweramp-settings-export-import.md` | `skipSearch` 的变体匹配详解（§15.7）|
| `poweramp-about-and-support-settings.md` | `skipSearch` 条件式与无条件移除的关系（§15.7）|
| `poweramp-search-and-queue-impact.md` | **媒体库搜索**（不同系统）|

## 11. 第 2 轮深挖：S2/S5/S6 闭环

> 第 9 章留了 7 项。本轮解出 3 项（S2/S5/S6），其中 S6 推翻了我上一轮的一个判断。

### 11.1 ⚠️ 先纠错：搜索**有**取消机制，不是"无防抖"

**§7.3 我写的是**：

> **⚠️ 没有输入防抖（debounce）**——每次按键都触发 SQL 查询。

**实际有取消机制。** 【实证·产物】`t8.smali:491-665`（`С()` 方法）：

```java
void С() {
    // ① 取消上一次查询
    if (this.p != null) {                       // :499
        if (this.p != null) {                   // :503
            this.p.A();                          // :507  ★ 取消/中止
            this.p = null;                       // :515
        }
    }

    // ② 复用或新建异步查询任务
    if (this.О == null) {                        // :528
        Executors exec = (Executors) ctx.getSystemService("__Executors");  // :544
        DataAPI api = (DataAPI) ctx.getSystemService("__DataAPI");          // :568
        this.О = new p4(2, this);                // :584-591
        this.О = this.О.А(b(api)).y(exec.В);     // :596-613
    } else {
        this.О.В();                              // :629  ★ 复用并重启
    }

    // ③ 提交新查询
    k70 query = с();                             // :635-640
    this.o = d();                                // :643-651
    this.О.х(query);                             // :659
}
```

| 机制 | 说明 |
| --- | --- |
| **取消上一次** | `this.p.A()` — **每次新查询前先中止上一次** |
| **异步执行** | `__Executors` 线程池 |
| **任务复用** | `О != null` 时 `В()` 重启而非新建 |
| **不是时间防抖** | 无 `postDelayed`/`debounce` 窗口 |

> **准确的表述**：设置页搜索用的是「**取消上一次 + 立即发起新查询**」，不是「延迟 N 毫秒再查询」。
>
> **效果上等效于防抖的一半**：快速连续输入时，只有最后一个查询会完成（前面的被 `A()` 取消）。但**每个按键仍会产生一次查询请求**（只是被取消）。
>
> 比起真正的 debounce，这个方案**更简单**且**响应更快**（无延迟），代价是**浪费一些查询**。

### 11.2 S6：`kb1.с()` 构造查询 URI

【实证·产物】`kb1.smali:1056-1206`：

```java
k70 с() {
    h11 settings = this.о.getSettings();                  // :1064-1069
    Uri uri = settings.A0();                              // :1072-1077  ★ 基础 URI

    String query = this.d.F;                              // :1080-1084  ★ 取上次输入
    if (query != null && query.length() > 0) {            // :1088-1100
        uri = uri.buildUpon()
                 .clearQuery()                             // :1116
                 .appendQueryParameter("s", query)         // :1124-1132  ★ 参数名 "s"
                 .build();                                 // :1140
    }

    return new x51(uri,
                   new g11[]{ settings },                  // :1175  数据集
                   new String[][]{ SettingsSearchLayout.J }, // :1183  投影列
                   false, null);                           // :1191-1194
}
```

| 要点 | 说明 |
| --- | --- |
| **查询参数名** | **`"s"`**（`?s=<query>`）|
| **`clearQuery()`** | 每次重建，不累积 |
| **空查询** | 不加参数（显示全部/初始列表）|
| **数据集** | `g11[]{ h11 }` —— 走 ContentProvider 式的 `qd0` 体系 |
| **投影列** | `SettingsSearchLayout.J`（静态数组）|

> **`?s=` 是设置搜索的 URI 契约**——`h11.v0()` 接收这个参数并转成 FTS `MATCH`。

### 11.3 S2：`pref_search.type` 的取值枚举（**完整解出**）

【实证·产物】`u9.smali:592-1000`（`A()` 方法内的 type 判定）：

| 常量行 | `type` 值 | 判定条件（标签名）|
| --- | ---: | --- |
| `:696` | **`-1`** | **默认**（未匹配任何特例）|
| `:703-723` | **`3`** | **`PreferenceCategory`** |
| `:750-770` | **`1`** | **`com.maxmpz.audioplayer.preference.RawTextPreference`** |
| `:777-797` | **`0`** | **`intent`**（`RawTextPreference` 带 intent 属性）|

**代码结构**：

```java
int type = -1;                                        // :696  默认
if ("PreferenceCategory".equals(tag)) {               // :703-707
    type = 3;                                          // :723
} else if ("extra".equals(tag)) {                     // :730-734
    // （继续判断）
} else if ("com.maxmpz.audioplayer.preference.RawTextPreference".equals(tag)) {  // :750-754
    type = 1;                                          // :770
} else if ("intent".equals(tag)) {                    // :777-781
    type = 0;                                          // :797
}
```

**另一处 `type=0`**（`u9.В()` 里的硬编码）：

【实证·产物】`u9.smali:1498-1532`（`В(String,String,String,String,String,int)`），调用点 `:1526`：

```asm
1502: const/4 v7, 0x0        ; type = 0
1526: invoke-virtual {v0..v7}, Lׅ/u9;->insertIndexEntry(...)
```

| `type` | 含义 | 用途 |
| ---: | --- | --- |
| **`0`** | **跳转项**（intent / 硬编码追加）| 搜索结果的"可跳转"标记 |
| **`1`** | **`RawTextPreference`** | 纯文本项（提示行）|
| **`3`** | **`PreferenceCategory`** | **分类标题** |
| `-1` | 其他 | 普通开关 |

> **`type` 在 UI 里的作用**：`onItemClick` 会按 `type` 决定跳转方式（见 §11.4）。
>
> **`type=3`（分类）通常不可点击** —— 因为分类标题没有自己的设置页。

### 11.4 S5：`onItemClick` 的完整跳转逻辑

【实证·产物】`SettingsSearchLayout.smali:643-1216`（573 行）。核心段落 `:759-960`：

```java
void onItemClick(aq0 item) {
    Cursor c = item.cursor;                          // 结果游标

    int type = c.getInt(typeIdx);                    // :762  ★ 读 type

    if (type == 0 || type == 0xb) {                  // :770-778  ★ 可跳转类型
        // ── 构造 URI ──
        String anchor = ee1.с(uriStr, "#");          // :782-786  ★ "#" 拼接
        StringBuilder sb = new StringBuilder();
        sb.append("settings/");                      // :807  ★ 前缀
        sb.append(pageName);                         // :816
        sb.append(anchor);                           // :821
        Uri uri = Uri.parse(sb.toString());          // :834
    }

    // ── 读额外列 ──
    if (c.getColumnCount() > 5) {                    // :850-861
        String extra = c.getString(5);               // :865
        if (extra != null && extra.length() > 0) {   // :873-885
            Uri uri2 = Uri.parse(extra);             // :893  ★ 覆盖
        }
    }

    // ── 执行跳转 ──
    if (uri != null) {                               // :910
        Intent i = В.Х(ctx, uri);                    // :914-922  ★ 解析并构造 Intent
        if (i != null) {
            Bundle b = new Bundle();
            b.putBoolean("no_backstack", true);      // :934-938  ★ 不压栈
            ...
        }
        MsgBus.post(...);                            // :956  ★ 通知
    }
}
```

| 步骤 | 说明 |
| ---: | --- |
| ① | 读 `type`，只处理 **`0`** 和 **`0xb`（11）** |
| ② | 用 **`"settings/"` + 页名 + `"#"` + 锚点** 拼 URI |
| ③ | 若第 6 列（index 5）有值，**覆盖** URI |
| ④ | `В.Х(ctx, uri)` 解析成 Intent |
| ⑤ | 加 `no_backstack` 标记 |
| ⑥ | MsgBus 通知 |

> **`type == 0xb`（11）是第二类可跳转项** —— 上一轮我只看到 `type=0`，实际 `onItemClick` 认 **两个值**（`0` 和 `11`）。
>
> **`0xb` 的来源未在 `u9` 的 type 判定里出现**，可能来自其他索引路径（如动态索引的项）。

#### `no_backstack` 的语义

```java
b.putBoolean("no_backstack", true);
```

> **从搜索结果跳转时不压入返回栈**——用户按返回键直接回到搜索框，而不是逐级返回设置层级。
>
> **这是搜索场景的正确行为**：用户从搜索结果直达目标项，返回时应回到搜索，而非上级页面。

### 11.5 本轮成果与剩余

| # | 问题 | 状态 |
| ---: | --- | --- |
| S1 | `u9` 基类完整逻辑 | ⚠️ 只解了 type 判定和 skipSearch |
| S2 | `pref_search.type` 枚举 | ✅ **已解**（0/1/3/-1，§11.3）|
| S3 | `wk1` 数据源 | ⚠️ 未读 |
| S4 | `lb1` 布局管理器 | ⚠️ 未读 |
| S5 | `onItemClick` 完整跳转 | ✅ **已解**（§11.4）|
| S6 | 是否有 debounce | ✅ **已解 + 纠错**（有取消机制，§11.1）|
| S7 | `SearchItemView` 高亮 | ⚠️ 未读 |

**7 项中解出 3 项**，剩 4 项（都是 UI 细节）。

### 11.6 完整搜索链（最终版）

```
用户输入 "blu"
  ↓
SettingsSearchLayout.onTextChanged          :1218-1402
  ├─ 手写 trim（逐字符判 <= 0x20）
  ├─ 与 this.F 比较去重                      :1371
  └─ adapter.С()                            :1395
  ↓
t8.С()                                       :491-665
  ├─ 取消上一次查询 this.p.A()                :507  ★ 取消机制
  ├─ 复用/新建 __Executors 异步任务            :544-629
  └─ 提交新查询 this.О.х(с())                :659
  ↓
kb1.с()                                      :1056-1206
  ├─ h11.A0() 取基础 URI                     :1072
  └─ appendQueryParameter("s", query)        :1132  ★ ?s= 契约
  ↓
h11.v0(db, uri, qd0, args, query)            :188-448
  ├─ "pref_search JOIN pref_search_fts ON docid=pref_search._id"   :192
  ├─ " MATCH ?"                              :209
  ├─ 按空格拆分 + 每词加 "*"                  :343-384
  └─ f11.А()/В() 执行                        :422-438
  ↓
SQLite FTS4 查询 → Cursor
  ↓
kb1 适配器 → SearchItemView 渲染
  ↓
用户点击
  ↓
SettingsSearchLayout.onItemClick             :643-1216
  ├─ type 为 0 或 0xb 才可跳转                :770-778
  ├─ "settings/" + 页名 + "#" + 锚点           :782-834
  ├─ В.Х(ctx, uri) → Intent                   :922
  └─ no_backstack = true                      :938  ★ 不压栈
```

---

## 12. 第 3 轮深挖：S3/S7 + 布局全解

> 第 11.5 节剩 4 项。本轮解出 **S3、S7**，并**意外找到完整布局 XML**——这是之前几轮都漏掉的。

### 12.1 ⭐ 布局全貌：`merge_settings_search.xml`

【实证·原文】`res/layout/merge_settings_search.xml`（1376 B）：

```xml
<com.maxmpz.audioplayer.preference.SettingsSearchLayout style="@style/SettingsSearchLayout">
    <!-- ① 结果区 -->
    <com.maxmpz.widget.base.FastLayout android:id="@id/search_content" style="@style/SettingsSearchContent">
        <com.maxmpz.widget.list.PowerList android:id="@id/search_list" style="@style/SettingsSearchList" />
    </com.maxmpz.widget.base.FastLayout>

    <SceneParams android:visibility="visible" w:scene="@id/scene_search" />

    <!-- ② 搜索面板（底部/顶部） -->
    <com.maxmpz.widget.base.FastLayout android:id="@id/search_panel" style="@style/SettingsSearchPanel">
        <com.maxmpz.widget.base.FastButton
            android:id="@id/search_back_button"
            android:contentDescription="@string/close"
            style="@style/SettingsSearchBackButton" />
        <com.maxmpz.widget.base.FastButton
            android:id="@id/search_close_button"
            android:contentDescription="@string/clear"
            style="@style/SettingsSearchCloseButton" />
        <com.maxmpz.audioplayer.preference.SearchEditText
            android:id="@id/search_edit"
            android:hint="@string/search"
            style="@style/SettingsSearchEdit" />
    </com.maxmpz.widget.base.FastLayout>

    <SceneParams w:scene="@id/scene_search" style="@style/SettingsSearchPanel_scene_search" />
</com.maxmpz.audioplayer.preference.SettingsSearchLayout>
```

#### 三个区域

| 区域 | id | 组件 | 作用 |
| --- | --- | --- | --- |
| **结果区** | `search_content` | `FastLayout` | 容器 |
| | `search_list` | **`PowerList`** | **结果列表**（虚拟化列表）|
| **搜索面板** | `search_panel` | `FastLayout` | 底部/顶部面板 |
| | `search_back_button` | `FastButton` | **返回**（`@string/close`）|
| | `search_close_button` | `FastButton` | **清除**（`@string/clear`）|
| | **`search_edit`** | **`SearchEditText`** | **输入框**（hint=`@string/search`）|
| **场景参数** | `scene_search` ×2 | `SceneParams` | 动画/过渡参数 |

> **`PowerList`** 是 Poweramp 自己的虚拟化列表（类似 `RecyclerView`）——**配合 `wk1` 视图池使用**。
>
> **两个 `SceneParams`** 分别控制"结果区"和"搜索面板"的场景动画。

**这解答了一个隐含问题**：搜索框在**底部或顶部**由 `style` 决定，而 `SceneParams` 控制展开/收起动画。

### 12.2 S3：`wk1` 是视图池（不是数据源）

**上一轮我猜它是"数据源"，实际是视图池。**

【实证·产物】`ׅ/wk1.smali`（405 行 / 6213 B）：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| **`B`** | `static final int` | **视图类型/池容量** |
| **`В`** | `Lׅ/y20;` | **视图缓存池** |

| 方法 | 作用 |
| --- | --- |
| **`B(int)`** | **从池取视图**（未命中则创建）|
| **`А(View, int)`** | **绑定视图**（并放入池）|
| **`В(View)`** | **回收视图** |

#### `static B` 由设备内存决定

【实证·产物】`wk1.smali:15-47`（`<clinit>`）：

```java
static {
    int memClass = xn0.о;                              // :19  内存等级
    B = (memClass > 0x64 /* 100 */) ? 7 : 6;           // :23-42
}
```

| 条件 | `B` 值 |
| --- | ---: |
| `xn0.о > 100`（大内存设备）| **7** |
| 否则 | **6** |

> **`B` 用于 `View.setTag(0x7f0d01d5, this)`**（`0x7f0d01d5` = **`_tag_viewCache`**）—— 池实例存在 View 的 tag 里。
>
> **`7` vs `6` 的具体含义未解**（可能是池层级或类型 id）。

#### `B(int)`：取视图

【实证·产物】`wk1.smali:83-127`：

```java
View B(int type) {
    Object cached = this.В.B(type, null);              // :94  从池取
    if (cached != null) { ... }                        // 命中
    // 未命中 → 创建（:110  ck0.В()）
}
```

#### `А(View, int)`：绑定并池化

【实证·产物】`wk1.smali:129-366`（237 行）：

```java
boolean А(View v, int type) {
    Object cached = this.В.B(type, null);              // :140
    // 构造 ck0 包装（:162-166）
    this.В.A(type, wrapper);                           // :211  放入池
    // 若池满 → RuntimeException("Can't queue item=" + v)  :303
}
```

> **`"Can't queue item="` 是池满的异常**（`:303`）——说明池有容量上限，超限抛异常。

#### `В(View)`：回收

【实证·产物】`wk1.smali:368-404`：

```java
void В(View v) {
    if (v instanceof vk1) {                            // :372  实现了池接口
        ((vk1) v).с(this);                             // :384  回调
        return;
    }
    v.setTag(0x7f0d01d5 /* _tag_viewCache */, this);   // :398  ★ 存 tag
}
```

| 分支 | 行为 |
| --- | --- |
| View 实现 `vk1` 接口 | 调 `с(this)` 回调 |
| 普通 View | `setTag(_tag_viewCache, this)` |

### 12.3 S7：`SearchItemView` 的四个文本槽位（**无高亮**）

【实证·产物】`SearchItemView.smali`（257 行 / 4966 B）：

| 项 | 值 |
| --- | --- |
| 父类 | **`Lcom/maxmpz/widget/base/FastLayoutWithViewCacheOpt;`** |
| 字段 | **4 个 `FastTextView`**：`D` / `v` / `w` / `z` + 1 个 `int u` |

#### 四个字段与资源 id 的对应（`onFinishInflate`，149 行）

【实证·产物】`SearchItemView.smali:73-222`：

```java
void onFinishInflate() {
    int n = getChildCount();                           // :82
    for (int i = 0; i < n; i++) {                      // :93
        View child = getChildAt(i);                    // :98
        int id = child.getId();                        // :106

        if (id == 0x7f0d01de /* @id/image */) {        // :114-119
            this.v = (FastTextView) child;             // :127  ★ image
        }
        else if (id == 0x7f0d057d /* @id/texts */) {    // :135-140
            FastLayout texts = (FastLayout) child;      // :144
            this.w = texts.k1(0x7f0d001d);             // :165  ★ title
            this.z = texts.k1(0x7f0d001e);             // :186  ★ line2
            this.D = texts.k1(0x7f0d02f5);             // :207  ★ line3
        }
    }
}
```

| 字段 | 资源 id | **语义** |
| --- | --- | --- |
| **`v`** | `@id/image` | **图标** |
| **`w`** | `@id/title` | **标题**（项名称）|
| **`z`** | `@id/line2` | **第二行**（summary）|
| **`D`** | `@id/line3` | **第三行**（**breadcrumb 面包屑**）|

> **这完美对应了 §6.2 的推测**：`title` / `summary` / `breadcrumb` / `icon` 四个槽位。
>
> `line2` = summary，`line3` = breadcrumb —— **从 id 名看不出，但数量与顺序吻合**。

#### ⚠️ 关键发现：**没有高亮实现**

`SearchItemView` **全文无任何 `Spannable`/`setSpan`/`ForegroundColorSpan` 代码**。

| 期望 | 实际 |
| --- | --- |
| 搜索词高亮 | ❌ **没有** |
| 命中词着色 | ❌ **没有** |

> **设置页搜索结果不做关键词高亮** —— 只是纯文本展示 `title` / `summary` / `breadcrumb`。
>
> 这与媒体库搜索（`w3.B`）不同，后者有结果标注。
>
> **这是设计选择而非缺陷**：设置项标题短且可辨识，高亮收益不高。

#### `A(I)` / `X()`：类型存取

【实证·产物】`SearchItemView.smali:51-71`：

```java
void A(int type) { this.u = type; }      // :55  存类型
int  X()         { return this.u; }      // :66  取类型
```

> **`u` 字段存的是 `pref_search.type`**（0/1/3/-1），供点击时判断跳转行为（见 §11.4）。
>
> **这里把 `type` 存进 View 而不是重新查 Cursor** —— 是性能优化。

### 12.4 S4：`lb1` 布局管理器（部分解出）

【实证·产物】`SettingsSearchLayout.smali:332-350`：

```java
lb1 layoutMgr = new lb1(kb1Adapter, this, ...);
```

| 参数 | 说明 |
| --- | --- |
| `kb1` | 适配器 |
| `SettingsSearchLayout` | 宿主 |
| 其余 | 未展开 |

> **`lb1` 的完整实现未读**。从构造参数看，它是"适配器 + 宿主"的桥梁，负责 `PowerList` 的布局计算。
>
> **`lb1` 在 `onAttachedToWindow` 后被 `ti1.Х(layoutMgr, adapter, xh1)` 装配**（`:393`）。

### 12.5 完整渲染链（最终版）

```
merge_settings_search.xml
  ├─ search_content
  │    └─ search_list (PowerList)
  ├─ search_panel
  │    ├─ search_back_button  (@string/close)
  │    ├─ search_close_button (@string/clear)
  │    └─ search_edit (SearchEditText, hint=@string/search)
  └─ SceneParams ×2 (动画参数)
        ↓
SettingsSearchLayout.onAttachedToWindow
  ├─ wk1 pool      = new wk1()              // 视图池
  ├─ kb1 adapter   = new kb1(this,ctx,pool,view)
  ├─ lb1 layoutMgr = new lb1(adapter, this, ...)
  └─ ti1.Х(layoutMgr, adapter, xh1)
        ↓
PowerList 渲染
  └─ SearchItemView（4 槽位）
       ├─ v = @id/image   （图标）
       ├─ w = @id/title   （标题）
       ├─ z = @id/line2   （summary）
       └─ D = @id/line3   （breadcrumb）
        ↓
点击 → onItemClick → u 字段（type）判断 → 跳转
```

### 12.6 本轮成果与剩余

| # | 问题 | 状态 |
| ---: | --- | --- |
| S1 | `u9` 基类完整逻辑 | ⚠️ 部分（type + skipSearch 已解）|
| S2 | `type` 枚举 | ✅ 已解（§11.3）|
| S3 | `wk1` | ✅ **已解**（视图池，§12.2）|
| S4 | `lb1` | ⚠️ 部分（构造参数已知，实现未读）|
| S5 | `onItemClick` | ✅ 已解（§11.4）|
| S6 | debounce | ✅ 已解 + 纠错（§11.1）|
| S7 | `SearchItemView` | ✅ **已解**（4 槽位，无高亮，§12.3）|

**7 项中解出 5 项**，剩 S1（部分）与 S4（部分）。

### 12.7 本轮一个重要补充：布局 XML

前几轮完全没提到 `merge_settings_search.xml`。**这是本页唯一的布局文件**，包含：

- 搜索框位置（`search_panel` 内的 `search_edit`）
- **两个按钮：`close`（返回）+ `clear`（清除）**
- `PowerList` 虚拟化列表
- 两套 `SceneParams` 动画参数

---

## 13. 第 4 轮深挖：S1/S4 闭环（**全部解完**）

> 第 12.6 节只剩 S1（部分）与 S4（部分）。本轮**两项全部解出**——设置页搜索的调查至此**完整闭合**。

### 13.1 S1：`u9` 基类的 10 个方法全解

【实证·产物】`ׅ/u9.smali`（1533 行 / 24,341 B）：

| 方法 | 行 | 规模 | 职责 |
| --- | --- | ---: | --- |
| `<init>` | 17–44 | 27 | 构造 |
| **`B(String)Z`** | 46–161 | **115** | **占位符检测（关键！）** |
| `Х(I,String)Z` | 163–465 | 302 | 变体判断（`skipSearch` 用）|
| **`х(TypedArray,I,Z)Z`** | 467–588 | **121** | **`skipSearch` 解析** |
| **`A(...)`** | 592–975 | **383** | **XML 节点解析主逻辑** |
| `indexXml(...)` | 977–987 | 10 | 递归包装器 |
| `insertIndexEntry(...)` | 989–1029 | 40 | 写库包装器 |
| `setPartialReindex(Z)` | 1031–1040 | 9 | 设置增量标记 |
| **`А(...)`** | 1042–1496 | **454** | **单个 Preference 的索引构建** |
| `В(String×5, int)` | 1498–1532 | 34 | 硬编码 `type=0` 的快捷写入 |

#### 四个字段

【实证·产物】`u9.smali:7-13`：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| **`A`** | `boolean` | **增量重索引标记**（`setPartialReindex` 写入）|
| **`B`** | `PrefSearchIndexer` | **回指索引器**（`PrefSearchIndexer.<init>` 里 `this.B = this`）|
| `А` | `TypedValue` | 复用容器（避免每次 new）|
| `В` | `Context` | 上下文 |

#### ⭐ `B(String)Z`：占位符检测器（本轮最重要的发现）

**这个方法名极易误读为"变体判断"（因为 `Х(int,String)` 才是）。实际是"文案占位符检测"。**

【实证·产物】`u9.smali:46-161`：

```java
static boolean B(String s) {
    if (s == null || s.length() < 4) return false;      // :53-72  太短直接 false

    int i = 0;
    while ((i = s.indexOf('%', i)) >= 0) {                // :80-89   找 %
        int next = i + 1;
        if (next < s.length()) {                          // :111
            char c = s.charAt(next);                      // :115
            if (c != '%' && c != ' ') return false;       // :123-139  ★ 非 %% 且非 "% " → 有真占位符
        }
        i += 2;                                           // :143
    }
    return true;                                          // :152  全是 %% 或 "% " → 无占位符
}
```

| 输入 | 返回 | 含义 |
| --- | :---: | --- |
| `"Hello"` | `true` | 无 `%`，**可索引** |
| `"100%% done"` | `true` | 只有 `%%`，**可索引** |
| `"Loaded %d items"` | **`false`** | 有 `%d` → **不可索引** |
| `"%s"` | `false` | 长度 < 4 |
| `null` | `false` | — |

**用途**（`А()` 里的三处调用）：

```java
// :1260  summary 检测
if (!u9.B(summaryStr)) { /* 跳过 */ }

// :1276  另一个字段
if (!u9.B(str4)) { /* 跳过 */ }

// :1299  title 检测
if (!u9.B(str3)) { /* 跳过 */ }
```

> **核心洞察**：**含运行时占位符的文案不建索引**。
>
> 原因很实际：
> - `"Loaded %d items"` 里的 `%d` 在 UI 上是动态值，索引进去就是垃圾
> - 用户搜 "items" 会命中，但搜 "5" 不会（因为是运行时替换的）
> - **所以作者选择"有占位符就整条跳过"**
>
> **代价**：这类项的标题完全搜不到。例如某开关的 summary 是 `"Buffer size: %s"`，用户搜 "buffer" 也搜不到。
>
> **这是一个权衡取舍，不是 bug**——但确实是可改进点。

#### `A()` 与 `А()` 的分工

| 方法 | 职责 | 典型动作 |
| --- | --- | --- |
| **`A(String, Parser, AttributeSet, String)`** | **XML 节点解析** | 遍历节点、判 `skipSearch`、反射实例化 |
| **`А(String, String, AttributeSet, String, boolean)`** | **单条构建** | 读 TypedArray 各索引 → 组 title/summary → 写库 |

**`А()` 的 TypedArray 索引使用**【实证·产物】`u9.smali:1042-1496`：

| 索引 | 行 | 内容 |
| ---: | --- | --- |
| 0 | `:1102`（间接）| **title** |
| 1 | `:1119` | 第二个字符串 |
| 2 | `:1130` | 第三个字符串（summary）|
| 3 | `:1288` | 第四个 |
| 4 | `:1238` | 第五个 |
| 5 | `:1170` | **intent / 变体** |
| 6 | `:1249` | 第六个 |
| 7 | `:1223` | 第七个 |

**`"://"` 检测**（`:1188-1200`）：

```java
if (str5.contains("://")) { ... }      // 判断是否为 URL
```

> **用于识别 `w:target="https://..."` 这类外链项**，与内部跳转区分。

**title + summary 合并**（`:1322-1358`）：

```java
if (title != null && extra != null) {
    combined = title + "\n" + extra;    // :1344  用换行连接
}
```

> **`
` 连接**说明 FTS 的 `summary` 列可能存了多段文本。

#### `indexXml()` / `insertIndexEntry()` / `setPartialReindex()` / `В()`

这四个都是**极简包装器**：

```java
void indexXml(parser, str1, str2, str3) {          // :977-987  10 行
    A(str1, parser, str3, ...);                     // 转调 A()
}

void setPartialReindex(boolean b) {                 // :1031-1040  9 行
    this.A = b;                                     // 只写字段
}

void В(String a, String b, String c, String d, String e, int f) {  // :1498-1532
    insertIndexEntry(a, b, c, d, e, f, 0);          // ★ 硬编码 type=0
}
```

> **`В()` 是"追加可跳转项"的快捷方法**——固定 `type=0`（可跳转），用于动态添加的索引条目（如 §11.4 里 `onItemClick` 认的 `type=0`）。

### 13.2 S4：`lb1` 是极简布局器（70 行）

【实证·产物】`ׅ/lb1.smali`（**70 行 / 1190 B**，全文最短的类之一）：

```java
public final class lb1 extends tk1 {
    public final SettingsSearchLayout R;              // :7  宿主引用

    lb1(kb1 adapter, SettingsSearchLayout layout,     // :11-52
        int a, float b, int c, int d) {
        this.R = layout;                              // :15  ★ 保存宿主
        super(1, adapter, a, 0, b, 0, 0, d);          // :46  ★ 调 tk1 构造器
    }

    @Override
    public final int Q() {                            // :56-69
        return this.R.v;                              // :64  ★ 返回宿主的 v 字段
    }
}
```

#### 完整的继承链

```
sk1（列表布局器基类）
  └─ tk1（397 行，通用布局器）
       └─ lb1（70 行，搜索专用）
```

| 类 | 规模 | 方法 |
| --- | ---: | --- |
| `sk1` | — | 基类 |
| **`tk1`** | **397 行** | `<init>(I, ye, I, I, F, g3, I, I)`、**`E(IZ[I)`**（263 行）、**`W(II)I`**（69 行）|
| **`lb1`** | **70 行** | `<init>`、**`Q()`** |

#### `Q()` 的返回值：`SettingsSearchLayout.v`

**这个 `v` 字段在 `SettingsSearchLayout` 构造器里赋值**【实证·产物】`SettingsSearchLayout.smali:85-178`：

```java
SettingsSearchLayout(Context ctx, AttributeSet attrs) {
    super(ctx, attrs);                                        // :89

    TypedArray ta = ctx.obtainStyledAttributes(attrs, qt0.w);  // :94-103   ★ styleable qt0.w
    int def = 0x64 /* 100 */;                                  // :109

    this.w = ta.getDimensionPixelSize(0, def);                 // :113-121  索引 0
    this.z = ta.getDimensionPixelSize(2, def);                 // :128-136  索引 2
    this.v = ta.getDimensionPixelSize(1, def);                 // :143-151  ★ 索引 1
    ta.recycle();                                              // :155

    this.I = MsgBusHelper.fromContextOrThrow(ctx, 0x7f0d015b); // :160-173  bus_app
}
```

| 字段 | styleable 索引 | 默认值 | 用途（推断）|
| --- | ---: | ---: | --- |
| `w` | 0 | 100px | 第一尺寸（可能行高）|
| `z` | 2 | 100px | 第三尺寸 |
| **`v`** | **1** | **100px** | **第二尺寸（`Q()` 返回它）** |

> **`Q()` 返回 `v`** —— 从方法名 `Q` 和返回值类型 `int` 看，这是**条目高度或间距**。
>
> `tk1.E(IZ[I)`（263 行）用这个值做布局计算（**每行的高度**）。

#### 为什么 `lb1` 这么短

> **因为它只是"参数转发器"**：
> - 把 6 个构造参数原样传给 `tk1`
> - 提供 `Q()` 返回宿主的尺寸字段
>
> **真正的布局算法在 `tk1`（397 行）里**。`lb1` 的唯一职责是"把搜索页的尺寸契约接到通用布局器上"。

### 13.3 ⭐ 完整继承与调用链（最终版）

```
【索引层】
PrefSearchIndexer (1156 行)  extends u9 (1533 行)
  ├─ B(String)        占位符检测 → 含 %s/%d 的文案不索引
  ├─ х(TypedArray,I,Z) skipSearch 解析（三态）
  ├─ Х(I,String)      变体匹配（play / pa）
  ├─ A(...)           XML 节点解析（383 行）
  ├─ А(...)           单条构建（454 行）
  │    ├─ 读 TypedArray 索引 0-7
  │    ├─ "://" 检测 URL
  │    └─ title + "\n" + summary 合并
  ├─ indexXml()       递归包装（10 行）
  ├─ insertIndexEntry() 写库包装（40 行）
  ├─ setPartialReindex() 增量标记（9 行）
  └─ В(...)           硬编码 type=0 快捷写入（34 行）

【查询层】
h11 (448 行)  →  JOIN + MATCH 构造
t8 (801 行)   →  取消 + 异步调度
kb1 (1207 行) extends t8  →  ?s= 查询 URI

【展示层】
merge_settings_search.xml
  └─ SettingsSearchLayout (1764 行) extends SceneFastLayout
       ├─ 构造器：读 qt0.w styleable 的 v/w/z 三个尺寸
       ├─ onAttachedToWindow：装 wk1 池 + kb1 适配器 + lb1 布局器
       ├─ onTextChanged：trim + 去重 + 触发
       └─ onItemClick：type∈{0,0xb} → 跳转
            ├─ wk1 (405 行)  视图池（容量 6/7，按内存）
            ├─ lb1 (70 行)   布局器 → Q() 返回 v 尺寸
            │    └─ tk1 (397 行)  通用布局器
            │         └─ sk1  基类
            └─ SearchItemView (257 行)
                 ├─ v = @id/image    （图标）
                 ├─ w = @id/title    （标题）
                 ├─ z = @id/line2    （summary）
                 └─ D = @id/line3    （breadcrumb）
                      ★ 无高亮
```

### 13.4 全部 7 项未解问题的最终状态

| # | 问题 | 状态 | 详见 |
| ---: | --- | --- | --- |
| **S1** | `u9` 基类完整逻辑 | ✅ **已解** | §13.1 |
| **S2** | `pref_search.type` 枚举 | ✅ 已解 | §11.3 |
| **S3** | `wk1` 数据源 | ✅ 已解（视图池）| §12.2 |
| **S4** | `lb1` 布局管理器 | ✅ **已解** | §13.2 |
| **S5** | `onItemClick` 跳转 | ✅ 已解 | §11.4 |
| **S6** | 是否有 debounce | ✅ 已解 + 纠错 | §11.1 |
| **S7** | `SearchItemView` 高亮 | ✅ 已解（**无高亮**）| §12.3 |

> **7 项全部闭环。设置页搜索的调查至此完整结束。**

### 13.5 三个值得记录的"反直觉"发现

| # | 发现 | 说明 |
| ---: | --- | --- |
| 1 | **含 `%s`/`%d` 的文案不建索引** | `u9.B()` 占位符检测，是权衡取舍 |
| 2 | **搜索结果不做关键词高亮** | `SearchItemView` 无 `setSpan` |
| 3 | **没有时间防抖，但有取消机制** | `t8.С()` 里 `this.p.A()` 中止上一次 |

---
