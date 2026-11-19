---
doc_id: "ARCH-POWERAMP-FORUM-LYRICS"
title: "Poweramp 论坛讨论取证：歌词 Lyrics 主题组"
doc_type: "architecture"
status: "active"
owner_agent: "lead"
version_scope: "corpus"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: Poweramp 论坛讨论取证（歌词 Lyrics 主题组）"
  - "Wayback Machine: forum.powerampapp.com/topic/<slug>（存档快照，抓取于 2026-11-18）"
---

# Poweramp 论坛讨论取证：歌词 Lyrics 主题组

> 取证来源：Wayback Machine（web.archive.org）对 `forum.powerampapp.com` 的存档快照
> 抓取时间：2026-11-18
> 抓取流程：`http://archive.org/wayback/available?url=...` 解析快照 URL → 抓取完整 HTML → 按 `<article id="elComment_*">` / `data-role="commentContent"` 结构解析
> 本文件只收录**实际抓取到的原文**。凡未抓到者，均在 §4 显式标注，未做任何补写或推测。

---

## §0 一句话结论

共抓取 **4 个帖（全部有存档，无失败）**，累计 **63 条帖子**；**4 个帖全部有开发者/版主回复**，合计 **20 条**——其中 **andrewilley（Andre，profile/127，版主 badge + Administrators 组）16 条**、**maxmp（profile/1749，Max 本人，版主 badge）4 条**。该需求自 **2021-02-08** 提出，官方从「longer-term to-do list」→「planned feature」→ **2023-01-17 随 build 948 正式落地**（LRC + 同步歌词），此后讨论转向「歌词 tag 编辑」被明确拒绝（「Poweramp is a music player, not a fully fledged file editor」）。

---

## §1 逐帖取证表

| # | slug | 存档快照时间 | 实际抓到帖数 | 帖子总页数 | 开发者回复数 | 核心诉求 |
|---|------|------------|------------|-----------|------------|---------|
| 1 | `20715-support-for-lrc-lyrics` | 20241011214346 | **15** | 1 | **4**（andrewilley）+ **1**（maxmp）= **5** | 支持 .lrc 同步歌词显示 |
| 2 | `21585-request-to-make-a-lyrics-scrolling-interface` | 20241015094058 | **19** | 1 | **5**（andrewilley）+ **1**（maxmp）= **6** | 从播放界面滑入独立「歌词滚动界面」，支持同步滚动 |
| 3 | `23478-support-for-lrc-lyrics-synced-lyrics` | 20241011220957 | **25** | 1 | **6**（andrewilley）+ **2**（maxmp）= **8** | .LRC 同步歌词 + 内嵌 tag 读取优先级；讨论具体实现方案 |
| 4 | `26076-option-to-add-lyrics-to-an-audio-file-using-tag-editor` | 20241206014541 | **4** | 1 | **1**（andrewilley）+ 0 = **1** | 在 Info/Tags 编辑器里编辑歌词 tag、内置歌词编辑器 |
| — | **合计** | — | **63** | — | **20 条版主/开发者发言**（andrewilley 16 + maxmp 4） | — |

**身份判定依据（逐字取自 HTML）**：

- **andrewilley 的 badge 标记**：`<span class="cAuthorPane_badge cAuthorPane_badge--moderator" data-ipstooltip title="andrewilley is a moderator"></span>`
- 其 profile 链接：`/profile/127-andrewilley/`；用户组渲染为 `<li data-role="group"><span style="color:red;">Administrators</span></li>`；自定义字段 Location = `Birmingham UK`，帖数 22k、solutions 328；正文签名统一署名 **`Andre`**
- **maxmp**：`/profile/1749-maxmp/`，同样带 `cAuthorPane_badge--moderator`，用户组渲染为 `<li data-role="group">Moderators</li>`（无 `<span>` 包裹，故本表解析结果显示 `group=null`，实为 **Moderators**）。其头像是 `forum_logo`——**这是 Poweramp 开发者 Max 本人的账号**
- 其余全部为普通用户，无任何 moderator badge

> ⚠️ **重要区分**：`andrewilley`（Andre）是**版主 / 团队核心成员 / 设计提案人**，但**不是**引擎开发者，且他本人多次明确自陈不掌握排期（见 §3.2）。`maxmp`（Max）才是决定实现与排期的开发者。二者在本文中**分开统计**，不混算。

---

## §2 开发者回复原文摘录（逐字引用）

> 格式：`slug` + `#comment-<id>` + 日期（取自存档 HTML 中 `<time datetime="...">` 的原值，UTC）+ 作者
> 引文由脚本从已解析的 HTML 正文块直接导出（去标签、解实体、压缩空白），**未做任何人工改写**。原帖中的排版换行予以保留。
> 以 `〔引用〕` 开头的位置，表示原帖该处有一个已被剥离的引用块（blockquote），被引内容在正文后的括注中单独说明来源。

### 2.1 andrewilley（Andre，版主 / 团队核心成员）—— 共 16 条

分布：`20715`（4 条）、`21585`（5 条）、`23478`（6 条）、`26076`（1 条）。

#### 【20715】`20715-support-for-lrc-lyrics` #comment-94413 · 2021-02-08T10:59:40Z · andrewilley （版主）

> It is something that's on the longer-term to-do list, but remember Poweramp is not really aimed at the karaoke market.
>
> There is a plugin that might help in the meantime, see
>
> Andre

*（此条正文中的 "see" 后接一个**嵌入式 iframe 引用**，指向 `forum.powerampapp.com/topic/18989-releaselrc-plugin-for-poweramp`，即第三方 LRC 插件发布帖；该 iframe 在存档中被渲染为空框，故正文到此中断。）*

#### 【20715】`20715-support-for-lrc-lyrics` #comment-105823 · 2022-02-05T09:29:25Z · andrewilley （版主）

> @Xander71 Synced lyrics are rarely accurate word by word, as far as I know each whole line has a timestamp showing when it should be displayed.
>
> I rather assumed that whenever this feature does appear, it would be as soft-scrolling text over the album art area - probably showing the currently playing line larger/bolder in the middle, with a line or two of history/upcoming displayed above and below.
>
> There is a further enhanced spec that provides word-by-word timecodes, so perhaps if found the colour of the current word could be highlighted in some way? See towards the bottom of https://en.wikipedia.org/wiki/LRC_(file_format)#:~:text=Enhanced format[edit,format%3A <mm:ss.xx>. , but I've no idea how widely supported it is though.
>
> Andre

★ **关键 UI 设计提案**：歌词以「软滚动文本叠在封面区域」呈现，当前行居中加粗，上下各留一两行历史/预告。

#### 【20715】`20715-support-for-lrc-lyrics` #comment-117599 · 2023-01-17T18:32:04Z · andrewilley （版主）

> Please try the newly released build 948, which provides improved lyric support including LRC files and synced lyrics.
>
> Andre

★ **功能落地公告**（正文内嵌 `files/file/83-poweramp-build-948-uniapk/` 下载条目）。

#### 【20715】`20715-support-for-lrc-lyrics` #comment-126509 · 2023-11-22T08:56:11Z · andrewilley （版主）

> @Indra Markam That sort of thing is more related to skins rather than the core app.
>
> Andre

*（回应 `#comment-126507` Indra Markam「Lyrics ui customisation like custom FONTS and colourful highlighted Fonts」）*

---

#### 【21585】`21585-request-to-make-a-lyrics-scrolling-interface` #comment-99216 · 2021-07-15T18:56:29Z · andrewilley （版主）

> Thanks Max, that sounds like a good idea.
>
> Once the PA Parametric EQ release has been issued, and any immediate fixes addressed, there are also a few niggling little bug threads that have been building up that it would be nice to look into too.
>
> Andre

*（回应 maxmp #comment-99209 的排期表态）*

#### 【21585】`21585-request-to-make-a-lyrics-scrolling-interface` #comment-103586 · 2021-12-14T08:46:01Z · andrewilley （版主）

> In the meantime, there is already a plugin to do this:
>
> Andre

*（同样内嵌 `topic/18989-releaselrc-plugin-for-poweramp` iframe）*

#### 【21585】`21585-request-to-make-a-lyrics-scrolling-interface` #comment-103588 · 2021-12-14T09:06:05Z · andrewilley （版主）

> 〔引用〕 Well no one is forcing you to use the addon. But it's there if for whatever reason you desperately need to see the lyrics. Maybe for karaoke purposes, or hearing-related issues?
>
> Andre

*（所引原帖为 Dagwbl #comment-103587：「Sure, but I think Poweramp is an elegant and clean APP, and this approach is not elegant at all」）*

#### 【21585】`21585-request-to-make-a-lyrics-scrolling-interface` #comment-103590 · 2021-12-14T10:01:13Z · andrewilley （版主）

> Feel free to make any requests you want, it's then up to Max the PA dev to decide how (or if) to prioritise them.
>
> But if there's already a workable solution in the meantime I will point it out here though - how is that disappointing?
>
> Andre

★ **权限边界自陈**：明确「排期由 Max 决定」。

#### 【21585】`21585-request-to-make-a-lyrics-scrolling-interface` #comment-117600 · 2023-01-17T18:32:34Z · andrewilley （版主）

> Please try the newly released build 948, which provides improved lyric support including LRC files and synced lyrics.
>
> Andre

---

#### 【23478】`23478-support-for-lrc-lyrics-synced-lyrics` #comment-108156 · 2022-04-13T23:53:22Z · andrewilley （版主）

> This is a planned feature, but there is no specific timescale.
>
> Andre

#### 【23478】`23478-support-for-lrc-lyrics-synced-lyrics` #comment-108181 · 2022-04-14T08:57:41Z · andrewilley （版主）

> Feature Requests often get prioritised by fitting them in around other work in that area of code. For example I would hope A-B Repeat is not lost forever (even if the request is 13 years old) but waiting for a long-planned user customisation feature for the row of control icons under the cover artwork. Perhaps the same applies to my own often-requested updating of the wording of the Repeat icon to use a more logical and user-friendly series of labels such as Play One Song | Play Current Category | Play All Categories | Repeat One Song | Repeat Current Category | Repeat All Categories. If implemented, adding A-B Repeat as a seventh option (probably after Repeat Song) would be a nice idea while working in that area.
>
> Synced Lyrics (including using LRC files) is on the to-do list for the medium term, but I guess might require a bit more extensive work than a simple A-B Repeat. Max has referred to it several times over the last year or so if you want to check out these threads, so it's definitely still on the radar:
>
> Andre

★ **排期机制说明**：需求按「代码区域就近合并」原则排期。

#### 【23478】`23478-support-for-lrc-lyrics-synced-lyrics` #comment-108240 · 2022-04-15T11:36:41Z · andrewilley （版主）

> I don't know for sure how Max plans to implement this, but I would expect some sort of ordered fall-back process depending on what is encountered for any given audio file:
>
> - SYLT / LYRICS
> - USLT / UNSYNCED LYRICS
> - TXXX:LYRICS
> - LRC sidecar file
>
> In all cases, I suspect PA should look for and parse any provided timing data, even if it's technically stored in an unsynced tag (as that can happen in the wild).
>
> It might also be worth having an option in Settings to allow the presence of a LRC file to always override the use of any embedded data.
>
> Andre

★ **重要技术提案**：歌词来源的**逐级回退链**（SYLT → USLT → TXXX:LYRICS → LRC sidecar），且「即便存在 unsynced tag 也要解析其中的时间戳」。注意：这是 Andre **个人的推测性提案**（"I don't know for sure how Max plans to implement this"），且其优先级顺序随后被 Max 在实际实现中**推翻**（见 #comment-108245）。

#### 【23478】`23478-support-for-lrc-lyrics-synced-lyrics` #comment-108247 · 2022-04-15T16:30:46Z · andrewilley （版主）

> 〔引用〕 Makes sense, and it'd be easy enough to just delete or rename the file to stop it taking over anyway.
>
> Andre

*（所引原帖为 maxmp #comment-108245：「"sidecar" file with matching file name takes priority...」）*

#### 【23478】`23478-support-for-lrc-lyrics-synced-lyrics` #comment-108283 · 2022-04-16T11:39:58Z · andrewilley （版主）

> I can't help with sample files I'm afraid, as none of the 7,000+ songs on my phone have any attached lyrics at all (neither embedded or as sidecar files). Zero. I have also never once sung karaoke either - I'm a "listen with my ears" kinda guy. So it's all a completely theoretical discussion for me.
>
> But if anyone has any real-world examples of files with embedded synced lyrics (not ones you've added yourself) then I'm sure it would help if you could send some samples to Max for testing purposes.
>
> Andre

#### 【23478】`23478-support-for-lrc-lyrics-synced-lyrics` #comment-115876 · 2022-12-05T11:50:42Z · andrewilley （版主）

> Improved LRC support is due in the next main feature release, I don't know how soon that will be though.
>
> Andre

★ **落地前最后确认**：距 build 948 发布（2023-01-17）约 6 周。

---

#### 【26076】`26076-option-to-add-lyrics-to-an-audio-file-using-tag-editor` #comment-120624 · 2023-03-23T13:03:06Z · andrewilley （版主）

> Poweramp is a music player, not a fully fledged file editor. There may be an option at some point in the future to allow limited editing of the Lyrics tag via the Info/Tags editor, but just as a block of text that you have already sourced from elsewhere - in the same way you can edit the Title, Artist, Album, etc tags.
>
> If your songs don't have any lyrics, and you already have a third-party lyrics app installed on your phone, Poweramp can use that (or Google) to search for and display lyrics via that separate interface. There is also a programmer's communication interface (API) which allows third-party app developers to provide their searched lyrics back to Poweramp, but that has not been implemented by anyone as yet. None of these options will write data back into your audio files though, the displayed content is transient while listening to the music - and potentially inaccurate of course, it's just an online search.
>
> Andre

★ **产品边界表态**（本组唯一一条，也是全文最长的一条拒绝性回复）。

### 2.2 maxmp（开发者 Max 本人，版主）—— 共 4 条

#### 【20715】`20715-support-for-lrc-lyrics` #comment-94418 · 2021-02-08T13:02:50Z · maxmp （版主 / 开发者）

> This is planned feature - there will be better UI similar e.g. to Apple Music lyrics for synced/non-synced lyrics + .lrc support. Poweramp won't download lyrics though as this is copyrighted and "grey" legal area, but the lyrics plugin API is in the works as well.

★ **全组最重要的一条开发者表态**：一次性给出三件事——① UI 参照 Apple Music；② 支持同步 + 非同步 + .lrc；③ **官方不下载歌词**（版权/灰色地带），但会做歌词插件 API。无签名。

#### 【21585】`21585-request-to-make-a-lyrics-scrolling-interface` #comment-99209 · 2021-07-15T16:09:06Z · maxmp （版主 / 开发者）

> The next Poweramp beta is the Parametric Equalizer release. After that I guess it will be a good time to add better lyrics UI + LRC support (+ support for the simple 3rd party lyrics plugins).

★ **排期锚点**：明确「参数均衡器之后」。

#### 【23478】`23478-support-for-lrc-lyrics-synced-lyrics` #comment-108245 · 2022-04-15T14:30:01Z · maxmp （版主 / 开发者）

> @andrewilley "sidecar" file with matching file name takes priority (this way it's possible to easily override embedded lyrics). This is easy to override with some future setting if such requests are made.

★ **对 Andre 回退链提案的权威修正**：**同名 sidecar 文件优先级最高**，而非最低。理由是「便于覆盖内嵌歌词」。

#### 【23478】`23478-support-for-lrc-lyrics-synced-lyrics` #comment-108280 · 2022-04-16T11:18:08Z · maxmp （版主 / 开发者）

> @Audiofile this mostly depends on how many tracks with that tag are "in the wild" just to able to test it. Fast check for LRC format is possible for any source of lyrics.

★ **实现取舍的关键约束**：是否支持某类 tag，取决于「实际文件里有多少这种 tag」——即**真实样本可得性**决定支持范围。

---

## §3 从讨论中提炼的要点

### 3.1 需求边界（用户侧，均为用户举证）

| 编号 | 诉求 | 出处 |
|---|---|---|
| L1 | **.lrc 同步歌词显示**（最基础诉求） | `20715` OP #comment-94408 · 2021-02-08 · arinzz7；`23478` OP #comment-108150 · 2022-04-13 · Audiofile |
| L2 | **歌词滚动界面**：从播放界面滑入，而非弹出式浮层 | `21585` OP #comment-99086 · 2021-07-11 · Dagwbl：「Slide the picture from the play interface to enter and start」 |
| L3 | **歌词叠在封面区域**，替换标题/专辑/艺人文字；无歌词时回退显示原信息 | `20715` #comment-105821 / #comment-105824 / #comment-105826 · 2022-02-05 · Xander71 |
| L4 | **逐行时间戳即可，不强求逐字** | `20715` #comment-105826 · Xander71：「I'll be ok with the simple each-line way」；Andre #comment-105823 亦持此判断 |
| L5 | **内嵌歌词 tag 的读取优先级**（SYLT / USLT / TXXX:LYRICS / USLT 中内嵌 LRC） | `23478` #comment-108230 / #comment-108271 / #comment-108301 · 2022-04 · Audiofile（做了大量实测） |
| L6 | **歌词 tag 可编辑 / 内置歌词编辑器** | `26076` OP #comment-120622 · 2023-03-23 · princestark；#comment-126446 / #comment-126453 · 2023-11-19 · Justawatcher |
| L7 | 歌词字体/配色自定义 | `20715` #comment-126507 · 2023-11-22 · Indra Markam（**被开发者归入 skin 范畴**） |

**用户侧反例**（可作反面证据）：
- 有用户认为第三方 LRC 插件「在整块屏幕上做 overlay、不是嵌进 Poweramp」，「feels like a workaround instead of a solution」——`23478` OP #comment-108150 · Audiofile。
- Dagwbl 认为插件方案「not elegant at all」——`21585` #comment-103587。

### 3.2 官方态度演变（时间轴，均有原文支撑）

| 时间 | 主体 | 表态 | comment |
|---|---|---|---|
| 2021-02-08 | **andrewilley** | 「on the longer-term to-do list」，但「Poweramp is not really aimed at the karaoke market」 | `20715` #comment-94413 |
| 2021-02-08 | **maxmp（开发者）** | **「This is planned feature」**：UI 参照 Apple Music；**不下载歌词**（版权）；歌词插件 API 在做 | `20715` #comment-94418 |
| 2021-07-15 | **maxmp（开发者）** | 「参数均衡器之后」是加歌词 UI + LRC 的好时机 | `21585` #comment-99209 |
| 2021-12-14 | andrewilley | 反复引导到第三方插件 | `21585` #comment-103586 / #comment-103588 |
| 2021-12-14 | andrewilley | **「it's then up to Max the PA dev to decide how (or if) to prioritise them」** | `21585` #comment-103590 |
| 2022-04-13 | andrewilley | 「planned feature, but there is no specific timescale」 | `23478` #comment-108156 |
| 2022-04-14 | andrewilley | 「on the to-do list for the **medium term**」 | `23478` #comment-108181 |
| 2022-04-15 | andrewilley | 提出歌词来源**回退链**（SYLT→USLT→TXXX:LYRICS→LRC sidecar） | `23478` #comment-108240 |
| 2022-04-15 | **maxmp（开发者）** | **推翻优先级**：**同名 sidecar 文件优先**，便于覆盖内嵌歌词 | `23478` #comment-108245 |
| 2022-04-16 | **maxmp（开发者）** | 是否支持某种 tag 取决于「in the wild」的样本量 | `23478` #comment-108280 |
| 2022-12-05 | andrewilley | **「Improved LRC support is due in the next main feature release」** | `23478` #comment-115876 |
| **2023-01-17** | andrewilley | **「Please try the newly released build 948」，含 LRC 与同步歌词** | `20715` #comment-117599 / `21585` #comment-117600 |
| 2023-03-23 | andrewilley | 请求转向「歌词 tag 编辑」→ **明确拒绝**：「Poweramp is a music player, not a fully fledged file editor」 | `26076` #comment-120624 |
| 2023-11-22 | andrewilley | 字体/配色自定义 → **归入 skin 范畴**，不进核心 app | `20715` #comment-126509 |

**关键判断**：

1. **本需求已实现**——这是本组与其他主题组（如 A-B Repeat 至今未做）最大的差异。build 948（2023-01-17）是落地节点。
2. **andrewilley 全程自我定位为版主 / 设计提案人，而非决策者**。他反复使用 `I don't know for sure how Max plans to implement this`（#comment-108240）、`it's then up to Max the PA dev to decide`（#comment-103590）。引用他时**必须守住这条边界**：他的「回退链」提案是**个人推测**，且**已被 Max 否定**。
3. **唯一一条 Max 本人的完整产品定义**是 `#comment-94418`（2021-02-08）：UI 参照 Apple Music + 同步/非同步 + .lrc + **不下载歌词** + 歌词插件 API。这条应作为最能代表官方立场的引文。
4. **「歌词插件 API 未落地」**：andrewilley 在 2023-03-23 明确说第三方歌词 App 通过 API 回传歌词的能力「has not been implemented by anyone as yet」（`26076` #comment-120624）。即 2021 年 Max 承诺的 API 在当时仍未真正被第三方采用。
5. **不可核实的信息**：用户 `#comment-108212` Audiofile 称「I was surprised to see LRC lyrics was on the TODO list since 2011」——这是**用户转述**，本帖未抓到 2011 年的原始依据，不作官方表态使用。

### 3.3 技术约束（全部出自开发者原文）

**① 歌词来源与优先级（最重要的实现约束）**

- Andre 的**提案**（#comment-108240，个人推测）：`SYLT / LYRICS` → `USLT / UNSYNCED LYRICS` → `TXXX:LYRICS` → `LRC sidecar file`
- **Max 的实际决定**（#comment-108245，权威）：**「"sidecar" file with matching file name takes priority (this way it's possible to easily override embedded lyrics)」**

> 即：**同名 .lrc sidecar 覆盖内嵌歌词**，与 Andre 提案的顺序**相反**。这是本组唯一一处开发者明确纠正版主提案的地方，对实现最具约束力。

**② 时间戳可能出现在「非同步」标签里** — Andre #comment-108240：
> "In all cases, I suspect PA should look for and parse any provided timing data, **even if it's technically stored in an unsynced tag** (as that can happen in the wild)."

用户侧实测佐证（Audiofile #comment-108230）：LRC 内嵌到 ID3v2 的 **USLT** 帧虽在标准上属于「非同步歌词」，但 MusicBee / foobar2000(ESLyric) / WMP(MiniLyrics) / Musicolet 等播放器实际都能识别——所以解析器**不能因为 tag 名义是 unsynced 就跳过时间戳**。

**③ 支持范围由真实样本量决定** — Max #comment-108280：
> "this mostly depends on **how many tracks with that tag are "in the wild"** just to able to test it. Fast check for LRC format is possible for any source of lyrics."

含义：能否支持某类 tag（尤其 SYLT），取决于是否有足够真实样本可供测试；而「快速检测 LRC 格式」可以对任意来源做。

**④ 官方不下载/不抓取歌词（版权约束）** — Max #comment-94418：
> "Poweramp **won't download lyrics** though as this is **copyrighted and "grey" legal area**, but the lyrics plugin API is in the works as well."

**⑤ 显示内容不写回文件** — Andre #comment-120624：
> "None of these options will **write data back into your audio files** though, the displayed content is **transient** while listening to the music"

**⑥ UI 形态约束（Andre 的设计口径）** — #comment-105823：
- 歌词**软滚动叠在封面区域**，而非新开独立窗口（对应 L2 的滑入式界面，被软化为"over the album art area"）
- 当前播放行 **larger/bolder in the middle**
- 上下各显示**一两行**历史/预告
- 逐字高亮（enhanced LRC / `<mm:ss.xx>`）只是「perhaps」，且 Andre 明言「I've no idea how widely supported it is」

**⑦ 产品边界：播放器 ≠ 编辑器** — Andre #comment-120624：
> "Poweramp is a **music player, not a fully fledged file editor**."

即便未来支持歌词 tag 编辑，范围也仅限「**a block of text** that you have already sourced from elsewhere」，与 Title/Artist/Album 同级；**不做内置歌词编辑器**。

**⑧ 字体/配色自定义属 skin，不进核心** — Andre #comment-126509。

### 3.4 对 SpMusic 的启示（推论，非论坛原文）

- **落地优先级顺序可直接照抄 Max 的决定**：同名 sidecar `.lrc` **优先**于内嵌 tag（用户可借此覆盖），这与多数用户直觉相反但在本组有明确开发者背书。
- **解析器必须对「名义 unsynced 的 tag」也做时间戳探测**（约束 ②），否则会漏掉大量实际带 LRC 的 USLT 帧。
- **不做歌词下载/在线抓取**（约束 ④）；若要做在线歌词，需走独立插件/API 通道并明确版权归属，且官方明确该 API 至 2023 仍未有人实现。
- **不写回音频文件**是官方基线（约束 ⑤）。这与仓库中既有的 `lyrics-cache-and-embed-boundary.md` 的「缓存 / 嵌入边界」议题直接相关——论坛原文可作为「为何官方在写回上极其保守」的外部佐证。
- **UI 直接做「叠在封面区 + 当前行居中加粗 + 上下各一两行」**，不需要独立歌词页（约束 ⑥ 为 Andre 原话，且与 L2 用户诉求兼容）。
- **歌词 tag 编辑可作为轻量可选项**（纯文本块，与 Title/Artist 同构），但**不要做富文本歌词编辑器**（约束 ⑦）。

---

## §4 抓取失败的帖子及原因

**本组 4 个 slug 全部抓取成功，无失败。**

但抓取过程中有若干需要记录的偏差与限制：

| # | 项目 | 情况 |
|---|---|---|
| 1 | `23478-...` 的 `available` API 首抓 | `available` API 返回的快照 URL 首次请求返回 **429 Too Many Requests / 502 Bad Gateway**；改用 **CDX API** 列出该 slug 的全部 9 个 200 快照，最终取到 **20240420092751** 与 **20241011220957** 两份（两者帖子集合完全一致，25 条）。表中记录的是 20241011220957（较新、字节更完整）。 |
| 2 | `26076-...` 的 `available` API 首抓 | 同样遇到 429/502；后台重试任务第 4 次成功，取到 **20241206014541**。该帖仅 **4 条**帖子且无分页，属正常（非截断）。 |
| 3 | `20715` / `21585` | 首次即 200，无异常。 |
| 4 | 分页 | 4 个帖在存档 HTML 中**均无 `ipsPagination` 分页控件、无 `Page X of Y`**，且 CDX 显示各 slug 只有单页快照。因此判定为**单页帖，无未抓取的分页内容**。 |
| 5 | 嵌入式引用（iframe） | `20715` #comment-94413、`21585` #comment-103586 正文中的插件引用是 **iframe 嵌入**，指向 `topic/18989-releaselrc-plugin-for-poweramp`。iframe 内容未展开抓取（非本组任务 slug），故正文在 "see" / "this:" 处即为原文终点——**这是原帖的真实结构，不是抓取失败**。 |
| 6 | 引用块（blockquote） | 解析时剥离了 blockquote，仅保留回复者自己的文字；被引内容在 §2 的括注中单独说明来源者。少数帖子（如 `20715` #comment-126506）**只有引用、无自有文字**，故未计入开发者回复正文。 |

> **未做任何推测性补写。** §2 中所有引文均可由 §1 表中的 slug + comment id 在对应 Wayback 快照中逐字复核。
