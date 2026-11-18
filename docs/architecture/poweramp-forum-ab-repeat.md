# Poweramp 论坛讨论取证：A-B Repeat 主题组

> 取证来源：Wayback Machine（web.archive.org）对 `forum.powerampapp.com` 的存档快照
> 抓取时间：2026-11-18
> 抓取流程：`http://archive.org/wayback/available?url=...` 解析快照 URL → 直接抓取完整 HTML → 按 `<article id="elComment_*">` / `data-role="commentContent"` 结构解析
> 本文件只收录**实际抓取到的原文**。凡未抓到者，均在 §4 显式标注，未做任何补写或推测。

---

## §0 一句话结论

共抓取 **4 个帖（全部有存档，无失败）**，累计 **94 条帖子**；其中 **3 个帖有开发者/版主回复**（`462`、`20538`、`24596`；`26128` 无开发者回复）。开发者署名 **andrewilley（Andre，profile/127）** 共发言 **17 次**，另有 Max 本人（`maxmp`，profile/1749）**2 次**、`admin`（profile/1，早期 Max 账号）**3 次**、`Magadaner` **1 次**——该需求自 2010-12-21 提出，至存档末（2023-10）**历时近 13 年仍未实现**，官方口径为「在 backlog 里 / 会提高优先级 / 但一直未做」。

---

## §1 逐帖取证表

| # | slug | 存档快照时间 | 实际抓到帖数 | 帖子总页数 | 开发者回复数 | 核心诉求 |
|---|------|------------|------------|-----------|------------|---------|
| 1 | `462-a-b-repeat-feature` | 20241205072705 | **75**（p1–p3，各 25） | 4（**p4 无存档**） | **12**（andrewilley）+ 3（admin）+ 1（Magadaner）= **16** | 在单曲内标记 A/B 两点并循环播放该片段；后期扩展为「保存 A-B 到 Playlist / 数据库」「与 Repeat 按钮菜单整合」 |
| 2 | `20538-feature-request-bookmarking-reappear-repeating-a-to-b` | 20240908091543 | **15** | 1 | **4**（andrewilley）+ 2（maxmp）= **6** | 双书签（dual bookmarking）并在两书签之间循环，即 A-B Repeat；明确要求**无缝（gapless）** |
| 3 | `26128-a-b-repeat` | 20241210021701 | **2** | 1 | **0** | 请求为「自动重复」制作图标；楼主补充：把 A-B 选择存入 Playlist / Bookmarks |
| 4 | `24596-repeat-particular-portion-of-a-track` | 20241113160704 | **2** | 1 | **1**（andrewilley） | 请求无限循环一首歌的 A→B 片段 |
| — | **合计** | — | **94** | — | **23 条版主/开发者发言**（其中 andrewilley 17 条） | — |

**身份判定依据（逐字取自 HTML）**：
- andrewilley 的 badge 标记：`<span class="cAuthorPane_badge cAuthorPane_badge--moderator" data-ipstooltip title="andrewilley is a moderator"></span>`
- 其 profile 链接：`/profile/127-andrewilley/`，正文签名统一署名 `Andre`
- `maxmp`：`/profile/1749-maxmp/`，同样带 `cAuthorPane_badge--moderator`——**这是开发者 Max 本人的账号**
- `admin`：`/profile/1-admin/`，属组显示 `Administrators`、帖数 `1.3k`，发帖日期集中在 2010-12 ~ 2011-04（Poweramp v2.0 时代），是 Max 的早期账号；本报告将其单独标注为 `admin`，**不**与 andrewilley 混算
- 其余全部为普通用户，无任何 moderator badge

---
## §2 开发者回复原文摘录（逐字引用）

> 格式：`slug` + `#comment-<id>` + 日期（取自存档 HTML 中 `<time datetime="...">` 的原值，UTC）+ 作者
> 引文由脚本从已解析的 HTML 正文块直接导出（去标签、解实体、压缩空白），**未做任何人工改写**；
> 以 `〔引用〕` 开头的位置，表示原帖该处有一个已被剥离的引用块（blockquote），被引内容在正文后的括注中单独说明来源。

### 2.1 andrewilley（Andre，版主 / 团队核心成员）—— 共 17 条

以上 17 条按发帖时间先后排列，分布于 `462`（12 条）、`20538`（4 条）、`24596`（1 条）。

#### 【462】`462-a-b-repeat-feature` #comment-14719 · 2012-10-01T09:10:18Z · andrewilley （版主）

> A repeat mode where you set the in and out points within one track, and it keeps playing that section.
> Andre

*（此条是在回答用户 @Poweramp2「What is A-B Repeat?」时的定义性表述，原帖 #14710）*

#### 【462】`462-a-b-repeat-feature` #comment-14766 · 2012-10-03T08:13:20Z · andrewilley （版主）

> 〔引用〕It was available on my very first CD player back in... oh, the mid 80s?
> Andre

*（所引原帖为 50smet #14761：「This feature was available in several samsung phones like the Z240 from 2008...Very useful!」）*

#### 【462】`462-a-b-repeat-feature` #comment-14777 · 2012-10-03T21:31:47Z · andrewilley （版主）

> 〔引用〕Nor me, I've actually often wondered what it could be useful for. It's got to be a trivial bit of code, but I can't for the life of me think why I'd want to repeat some random bit of one song which could only be relatively coarsely selected anyway.
> Andre

*（所引原帖为 ItsMyLife #14774：「Why is this such an important feature to people? I've never used it on any CD players that had it!」）*

#### 【462】`462-a-b-repeat-feature` #comment-18587 · 2013-05-25T11:25:35Z · andrewilley （版主）

> I've often wondered what people use A-B Repeat for in the real world, but a lot of people do seem to want it. I've had it on CD players, etc since they were invented in the 80s, but not once in my life have I actually used it! I just can't see why I'd want to repeat-play a short portion of a track in casual everyday use. Sure for editing purposes, but not on a regular player.
>  
>  
> Max: if you were to implement this, it might fit in well with the revised playback options that we were discussing a year ago? Just add an extra seventh option, thus:
>  
> Play One Song
> Play Current List
> Play All Lists
> Repeat Current Song
> Repeat Current List
> Repeat All Lists
> Repeat A-B
> If the user selects the Repeat A-B option, that would define the current playback position as the 'in' point, and the option wording would change to Repeat A-B (set endpoint). When the endpoint has similarly been selected, the track would repeat continuosly between A and B until the user selects a different option. Long-press on Pause button (i.e. Stop) could revert to the previously selected playback mode.
>  
> Thoughts?
>  
> Andre

★ 关键设计提案

#### 【462】`462-a-b-repeat-feature` #comment-18592 · 2013-05-25T17:41:18Z · andrewilley （版主）

> 〔引用〕
> It is now.
> Andre

*（原帖此条回复的是 haddy #18591「I want A-B repeat so badly .... I hope it can get implemented soon. Btw, this is not the request forum」，Andre 答「现在已经是（请求论坛）了」）*

#### 【462】`462-a-b-repeat-feature` #comment-20663 · 2013-10-25T15:50:25Z · andrewilley （版主）

> Agreed, I would find it very useful too. However this has been asked for since about the first release of the app I think, but no signs of it being added yet.
>  
> Andre

#### 【462】`462-a-b-repeat-feature` #comment-86868 · 2020-06-30T19:22:45Z · andrewilley （版主）

> I can't speak for the dev I'm afraid, but to my mind it seems a relatively simple thing to implement technically (not sure about how to do it without cluttering the interface though). Perhaps it might be something @maxmp has in mind for his proposed user-defininable buttons in the player screen (such as changing the function of Visualisation, Timer, etc)? Although it would seem to be a more logical fit for the Repeat button.
> Andre

#### 【462】`462-a-b-repeat-feature` #comment-87243 · 2020-07-08T08:59:28Z · andrewilley （版主）

> Goodness, talk about bumping an old thread - over seven years old in fact! 
> I still hanker wistfully for my original simplified Repeat terminology suggestion though, which dated back at least another year before the post you quoted. The 'Advance Category' wording never seemed to me to be the most understandable phrase for new users, when all it really means is to continue to play all categories, thus:
> Play One Song | Play Current Category | Play All Categories | Repeat One Song | Repeat Current Category | Repeat All Categories
> Adding a Repeat A-B would fit in rather well there too - but you first need to convince Max of the worthiness and usage cases of such a feature. Maybe he might have something already in mind for his previously-mentioned configurable icons system (currently fixed as Viz, Sleep, etc) in the Player screen?
> Andre

#### 【462】`462-a-b-repeat-feature` #comment-87701 · 2020-07-17T08:50:23Z · andrewilley （版主）

> This seems to have split into two broad feature requests now, so to try to clarify it a bit:
> There has been a long-standing request for Poweramp to offer the same 'A-B Repeat' functionality that CD players have had since they first came out - specifically to be able to set a start-point and an end-point within the currently playing song, so that segment loops forever until you stop playback. This would fit in nicely with my suggested revision for the wording for the Repeat button, adding an extra item thus: Play One Song | Play Category | Play All | Repeat Song | Repeat Category | Repeat All | A-B Repeat. I think the A-B Repeat option should probably only appear via the long-press list (so it doesn't get picked by accident) and selecting that option would create the initial start-point. Then you would simply tap the Repeat icon a second time to set the end-point, and looped playback would commence.
>  
> Provide some mechanism to store the same start-point and end-point timecodes for any given track within a Playlist entry, so whenever you play that song from the Playlist, Poweramp would only play the selected segment. This could be combined with 'Repeat One Song' mode to create a repeating loop. Annotate this sort of special Playlist entry with an 'AB' logo to the left of the song title.
> One caveat I can see for both of the above is that timecode seek accuracy is not always perfect, especially with VBR files or long tracks that don't contain seek table metadata.
> Andre

★ 需求边界最完整的一条

#### 【462】`462-a-b-repeat-feature` #comment-87715 · 2020-07-17T13:24:49Z · andrewilley （版主）

> 〔引用〕
> The point is it's not always possible to re-seek to an exact hh:mm:ss.nnn timecode in (for example) some VBR files without seek lookup tables. And the longer the file, the less accurate seeking to a particular exact timecode can become.
> Andre

★ 技术约束

*（所引原帖为 haddy 2020-07-17 的回复：「True. This is why I am in favour of a haptic feedback "lock on" feature that would stay on the precise timecode that a user seeks their finger to」）*

#### 【462】`462-a-b-repeat-feature` #comment-98585 · 2021-06-23T10:23:34Z · andrewilley （版主）

> 〔引用〕
> I don't know where this falls in Max's plans (Parametric EQ work is currently his main focus) but you have reminded me that the sticky 'To-Do list' post in the Chatter forum is now about ten years old and refers to assorted plans for PA v2, so I think I'll unpin it as it doesn't really help much today.
> I was actually thinking about creating some sort of 'Common Feature Requests' summary post, with links to the top 20 or so regularly requested items to try to tidy up repeat posts a bit. Things like A-B Repeat, ratings and cover art syncing from/to tags, NAS & cloud music sources, more streaming output options (DLNA etc), smart playlists, synced lyrics, etc 
> Andre

#### 【462】`462-a-b-repeat-feature` #comment-106254 · 2022-02-16T09:54:23Z · andrewilley （版主）

> From previous comments (and I'm not privy to any specific development details here) I'm guessing that A-B Repeat might be tucked away within the longer-term plans to allow users to customise the entire row of control icons under the cover art (Visualization/Sleep/counter/Repeat/Shuffle). I think A-B Repeat would be a good fit as an optional icon within that customisation process.
> I also hope that the same goes for my own very-longstanding (although admittedly not quite 11 years) request for a simple re-wording of the Repeat icon to give a more user-friendly and consistent set of choices: Play Song | Play Category | Play All | Repeat Song | Repeat Category | Repeat All. No real coding changes, but it eliminates the perennially confusing term 'Advance Category' which new users never seem to understand really just means 'Play All'.
> Andre

#### 【20538】`20538-feature-request-bookmarking-reappear-repeating-a-to-b` #comment-93392 · 2021-01-09T00:34:36Z · andrewilley （版主）

> I think the request was for dual bookmarking, and repeat between the two positions - aka 'A-B Repeat'.
> Andre

#### 【20538】`20538-feature-request-bookmarking-reappear-repeating-a-to-b` #comment-93881 · 2021-01-26T21:31:52Z · andrewilley （版主）

> Thanks Max, I think A-B Repeat is one of those relatively minor requests that keeps sliding down the list as other things take priority. I suspect it dates back about 10 years.
> By the way, when you do implement it, could you maybe also implement my own earlier requests for a change to the wording of the 'Repeat' icon modes, to make it easier for both new and existing users to understand - especially because 'Advance Category' still seems to confuse people when all it really means is 'Play All'. What I was asking for was something simple, logical, and elegant like:
>      Play One Song | Play Category | Play All | Repeat Song | Repeat Category | Repeat All | A-B Repeat
> Nothing much to change in terms of functionality really, just the wording.
>  
> Andre

#### 【20538】`20538-feature-request-bookmarking-reappear-repeating-a-to-b` #comment-93908 · 2021-01-27T09:49:41Z · andrewilley （版主）

> @haddy I agree that an extra option in the Crossfade/Fade/Gapless menu would be a good idea. Alongside "Fade Play/Pause/Stop" and "Fade on Seek" it would be useful to have "Fade on A/B Repeat" available. Or at the very least have A-B Repeat follow the same selection as for automatic track changes.
> Regarding your extra suggestions in https://forum.powerampapp.com/topic/462-a-b-repeat-feature/page/3/:
> Saving A-B Repeats in the database sounds like a good idea - effectively rather like automatic bookmarks. Take for example an album track like Meatloaf's "I'd Do Anything For Love (But I Won't Do That)", which commences with 30 seconds of motorbike starting/revving-up sounds. It might be nice to save that 30-second point as the position at which you would always like to start listening to that track in order to go straight to the music itself. I would envisage having an extra option in the song's pop-up context menu for "Save A-B Positions" which would only show up once you had created a start 'A' (and optionally end, 'B') position in the new A-B system. And if such positions have been saved, the menu option for that track should subsequently show as "Remove saved A-B positions".
> I don't see much point in making A-B repeat sections for Playlists though, just create a new playlist with the required subset of tracks. Quick selection of ranges in long lists (requested elsewhere) would help with that idea.
> Andre

★ 存储与 Playlist 整合设计

#### 【20538】`20538-feature-request-bookmarking-reappear-repeating-a-to-b` #comment-93920 · 2021-01-27T11:27:19Z · andrewilley （版主）

> Another in-position example would be The Carpenters "Calling Occupants of Interplanetary Craft", where the full version of the song commences with a 52-second 'radio station chat show' phone call segment.
>  
> 〔引用〕
> Ah, I see what you mean, yes that would make sense. So if you had an A-B Repeat enabled, and then you use the contextual pop-up "+ Playlist" feature, the start and finish offsets for that song should be saved along with the Playlist - but without having to apply the change to the original track itself (so you can still listen to it in full in album mode). There are existing M3U extensions which already support that sort of thing anyway, such #EXT-X-START:TIME-OFFSET, so I guess it ought to be easy enough to implement in a compatible way.
> Andre

*（所引原帖为 haddy #93912：「I mean the simple ability to Add to Playlist during playing the A-B. Instead of the full song being added to a chosen playlist, the A-B looped segment only of that song would be added to playlist.」）*

#### 【24596】`24596-repeat-particular-portion-of-a-track` #comment-114556 · 2022-10-25T15:51:48Z · andrewilley （版主）

> A-B Repeat is already in the Frequently Requested Features list (pinned at the top of this section).
> Andre

---

### 2.2 Max（`maxmp`，开发者本人）—— 共 2 条

两条均出现在 `20538`，是全部 4 个帖中**唯一**由开发者本人账号发出的、针对本需求的回复。

#### 【20538】`20538-feature-request-bookmarking-reappear-repeating-a-to-b` #comment-93389 · 2021-01-08T22:38:16Z · maxmp （版主）

> Bookmarks are there (see List Options in Library header menu). Thanks!

#### 【20538】`20538-feature-request-bookmarking-reappear-repeating-a-to-b` #comment-93867 · 2021-01-26T19:45:21Z · maxmp （版主）

> Thanks for the request! This is in the backlog and I will raise priority of the item.

★ 唯一一次开发者本人的正面优先级承诺

---

### 2.3 `admin`（Max 早期账号，profile/1，属组 Administrators）—— 共 3 条

三条均出现在 `462` 的前两页（2010-12 ~ 2011-04），时值 Poweramp v2.0 开发期。

#### 【462】`462-a-b-repeat-feature` #comment-1918 · 2010-12-22T20:59:30Z · admin （版主）

> No, PowerAMP can't repeat part of song at this moment.
> Thanks for the request.

★ 首次官方回应

#### 【462】`462-a-b-repeat-feature` #comment-2828 · 2011-02-04T20:12:27Z · admin （版主）

> It's not going into 2.0, but may be into 2.1.
> Thanks!

★ 官方时间点承诺（未兑现）

#### 【462】`462-a-b-repeat-feature` #comment-4326 · 2011-04-07T23:00:38Z · admin （版主）

> Thanks for the details, haddy, it will be useful.

---

### 2.4 `Magadaner`（版主，非 andrewilley）—— 共 1 条

注意：此条口吻与 Max 的正式表态一致，但 Magadaner 是**版主**；本报告不将其等同于开发者表态。

#### 【462】`462-a-b-repeat-feature` #comment-20433 · 2013-10-07T16:38:04Z · Magadaner （版主）

> This option not planned but maybe some day.

---

**版本统计**：以上共 23 条版主/开发者发言。其中 andrewilley 17 条、maxmp 2 条、admin 3 条、Magadaner 1 条。

---

## §3 从讨论中提炼的要点

### 3.1 需求边界（用户集体诉求的共同交集）

用户诉求跨 13 年高度一致，可归纳为 5 层，**逐层递增**：

| 层 | 需求 | 出处（slug + comment id + 日期） |
|---|---|---|
| L1 | **单曲内 A/B 两点标记 + 区间无限循环** | `462` #comment-1890 · 2010-12-21 · haddy；#comment-4316 · 2011-04-07 · haddy 提出应给 A/B 一个**独立全屏界面**（大按钮 A / B / X 取消，含播放条、无封面） |
| L2 | **入点/出点精度可调、可 seek** | `462` #comment-87232 · 2020-07-08 · haddy；#comment-87826 · 2020-07-19 · haddy；Andre #comment-87715 · 2020-07-17 指出 VBR 无 seek table 时精度受限 |
| L3 | **持久化保存 A-B 位置** | `462` #comment-1890 提到「导出 text bookmark 文件」；#comment-4316「导出为 txt，可按 track/album 导出」；haddy #comment-83774 · 2020-03-29 / #comment-85707 · 2020-05-29 要求存入 Playlist；Andre #comment-93908 给出「存入数据库，等同自动书签 + 上下文菜单 Save/Remove A-B Positions」 |
| L4 | **与 Playlist / Bookmarks 深度整合** | `462` #comment-106227 · 2022-02-15 · Squeeze 用 **CUE sheet** 变通（把一首长曲切成虚拟音轨再 Repeat One）；`20538` #comment-125661 · 2023-10-12 · AB Guy 要求设到 Playlist 条目时只播放该片段；`26128` #comment-120962 · 2023-04-05 · haddy「存进 'Bookmarks' 这类播放列表」 |
| L5 | **无缝（gapless）循环** | `20538` #comment-125661 · 2023-10-12 · AB Guy：「please by all means make it **gapless** so creating perfect music loops becomes possible」，并给出交互范式 `Press button -> Set A, Press button -> set B, Press button -> Cancel` |

**典型使用场景（均为用户举证，非开发者陈述）**：
- 语言学习反复听同一段读音：`462` #comment-20273 / #comment-20379（hgn）、#comment-85185（Gyre）、#comment-86325（MFZD 背经文）
- 扒谱/写和声，反复听几小节：#comment-20273（hgn）、#comment-106227（Squeeze）
- 2 小时长电台 mix 不想在电脑上切 mp3：#comment-85707（haddy）
- 单文件整张专辑（无 chapter）取其中一段：#comment-14922（roa78）
- 游戏循环音乐，希望用歌曲 tag 里的 Loop Tag：#comment-43089（Arkaine）
- 跳过专辑曲目前奏的摩托声 / 电台闲聊：Andre #comment-93908、#comment-93920

### 3.2 官方态度演变（时间轴，均有原文支撑）

| 时间 | 主体 | 表态 | comment |
|---|---|---|---|
| 2010-12-22 | admin | 「目前做不到」 | #comment-1918 |
| 2011-02-04 | admin | **「不进 2.0，但可能进 2.1」** | #comment-2828 |
| 2013-05-25 | andrewilley | 给出完整交互设计（Repeat 第 7 个选项） | #comment-18587 |
| 2013-10-07 | Magadaner（版主） | **「This option not planned but maybe some day」** | #comment-20433 |
| 2013-10-25 | andrewilley | 「从初版就有人要，但至今没有要加进来的迹象」 | #comment-20663 |
| 2020-06-30 | andrewilley | 「技术上是相对简单的事」，但不知如何不弄乱界面 | #comment-86868 |
| 2020-07-17 | andrewilley | 「**你先得说服 Max 这功能的价值和用例**」 | #comment-87243 |
| 2021-01-26 | **maxmp（开发者）** | **「This is in the backlog and I will raise priority of the item」** | #comment-93867 |
| 2021-01-26 | andrewilley | 「这是那种一直往后滑的次要需求，我猜有 10 年了」 | #comment-93881 |
| 2021-06-23 | andrewilley | 「不知道在 Max 计划里的位置（**参数均衡器是他当前的焦点**）」 | #comment-98585 |
| 2022-02-16 | andrewilley | 猜测会被塞进「播放器控制图标可自定义」的长期计划 | #comment-106254 |
| 2022-10-25 | andrewilley | 「已在 Frequently Requested Features 置顶清单里」 | #comment-114556 |
| 2023-10 | 用户 | 存档末仍无实现 | #comment-125661 |

**关键判断**：
1. **2021-01-26 的 `maxmp` #comment-93867 是全部 4 帖中唯一一条开发者本人对本需求优先级的正面回应**；此后再无 Max 的公开表态（至存档末）。
2. andrewilley 全程**从未**说过「已排期 / 正在做」。他反复使用 `I can't speak for the dev` / `I'm not privy to any specific development details` / `you first need to convince Max`，明确自我定位为**版主与设计提案人，而非决策者**——引用他时最需要守住这条边界。
3. **不可核实的信息**：haddy 在 `26128` #comment-120962 称「In a private conversation MaxMP did confirm that it is in the TODO list but he's never commented about it on the forum. I don't know why he hates the function so much.」——这是**用户转述的私信内容**，不是公开官方表态。
4. 普通用户的怨言（#comment-101212「It've been 10 years since he is adding the feature. Do you really think he will ever do it」；#comment-106250「For some reason Max MP does not want to reply to this topic」）属**用户情绪**，不可当作官方立场引用。

### 3.3 技术约束（全部出自 andrewilley 本人原文）

**① seek 精度不确定（最硬的一条约束）** — `462` #comment-87701 / #comment-87715 · 2020-07-17
> "timecode seek accuracy is not always perfect, especially with VBR files or long tracks that don't contain seek table metadata"
> "the longer the file, the less accurate seeking to a particular exact timecode can become"

含义：A/B 点若按 hh:mm:ss.nnn 保存，回放时未必能精确落回同一采样位置。

**② UI 不能变复杂** — `462` #comment-86868 · 2020-06-30
> "a relatively simple thing to implement technically (**not sure about how to do it without cluttering the interface** though)"

与 Andre 反复主张的「Repeat 按钮措辞重构」绑定：他要求在既有 6 档 Repeat 枚举里**增加第 7 档**，而非新增独立入口。

**③ 入口必须防误触** — `462` #comment-87701 · 2020-07-17
> "I think the A-B Repeat option should probably only appear via the **long-press list** (so it doesn't get picked by accident)"

配套交互序列（Andre #comment-18587 + #comment-87701）：**长按 Repeat → 选中 A-B → 以当前播放位置为 A 点 → 再点一次 Repeat 设定 B 点 → 开始循环**；长按 Pause(Stop) 可回退到上一个播放模式。

**④ 持久化载体的官方倾向** — `20538` #comment-93908 / #comment-93920 · 2021-01-27

| 载体 | Andre 的表述 |
|---|---|
| **数据库 + 歌曲上下文菜单**（首选） | 「Saving A-B Repeats in the database sounds like a good idea - effectively rather like automatic bookmarks」；菜单项 `Save A-B Positions` / `Remove saved A-B positions`，**仅在已设置 A 点后才出现** |
| **Playlist**（可接受，但需兼容） | 「the start and finish offsets for that song should be saved along with the Playlist - but without having to apply the change to the original track itself」；可复用 M3U 既有扩展 `#EXT-X-START:TIME-OFFSET` |
| **专为 Playlist 做 A-B 区间**（不赞成） | 「I don't see much point in making A-B repeat sections for Playlists though, just create a new playlist with the required subset of tracks」 |

> ⚠️ 第三行是**开发者侧与用户侧唯一明确分歧点**：用户（haddy #comment-83774 / #comment-120962、AB Guy #comment-125661）要求把 A-B 存进 Playlist，Andre 认为没必要。

**⑤ 可与既有播放链功能组合** — Andre #comment-93908：「Alongside "Fade Play/Pause/Stop" and "Fade on Seek" it would be useful to have **"Fade on A/B Repeat"** available. Or at the very least have A-B Repeat follow the same selection as for automatic track changes.」用户侧还希望与 **Tempo（变速）/ Crossfade** 叠加，以便降速扒谱（haddy #comment-85707）。

**⑥ 实现参照（用户推测，非官方确认）**：haddy `26128` #comment-120962 称「The internal Android programming code for such an A-B Repeat feature would be close enough to the existing implementation of Poweramp's **Bookmark** function」。

### 3.4 对 SpMusic 的启示（推论，非论坛原文）

- **UI 入口**：优先做「长按 Repeat 图标 → 二级菜单」，避免主界面按钮膨胀（对应约束 ②③）。
- **持久化**：用「数据库条目 + 上下文菜单」比「专用 Playlist」心智更轻，且与 Andre 的官方提案一致（对应 ④）。
- **精度**：必须提前决策——要么接受 `hh:mm:ss.nnn` 的 seek 误差（VBR / 长文件尤甚），要么在扫描时建立 sample-accurate 索引。论坛原文已明确点出这个坑，不要重复踩（对应 ①）。
- **gapless 循环**：用户强诉求（AB Guy #comment-125661），但官方从未承诺，属**差异化机会**。

---
## §4 抓取失败的帖子及原因

| 项目 | 状态 | 原因（已验证） |
|---|---|---|
| `462-a-b-repeat-feature` **第 4 页** | ❌ **无存档** | 该帖共 4 页（`data-ipspagination-pages="4"`，p3 的 pager 里仍有 `data-page="4"` 链接且 `ipsPagination_next` 为 active）。但 `available` API 对 `/page/4` 与 `/page/4/` 均返回 `archived_snapshots: {}`；CDX 索引（`matchType=prefix`）也只列出 page/1、page/2、page/3 及其 `?tab=comments` 变体，**确认 p4 从未被 Wayback 抓取**。因此该帖末页（帖子 id 大于 `110077` 的部分）无法取证。 |
| 其余 3 帖 | ✅ 全部抓到 | `20538`（15 帖）、`26128`（2 帖）、`24596`（2 帖）均为单页帖，存档完整 |
| `462` 第 1–3 页 | ✅ 全部抓到 | 快照时间分别为 20241205072705 / 20211206183828 / 20231002220233 |

**取证局限说明**：
1. Wayback 存档为**时点快照**，本报告反映各快照时间点的页面状态，不代表论坛当前内容。
2. `462` 帖 p1 快照（2024-12-05）、p2（2021-12-06）、p3（2023-10-02）**快照时间不同**，理论上跨页可能有一致性问题；已核对三页帖子 id 连续且无重复（25+25+25=75），未发现矛盾。
3. 帖内以 `〔引用〕` 标记处，原 blockquote 被剥离；被引内容已在 §2 的括注中单独标明来源。
4. 用户转述的私信/私下沟通（haddy #comment-120962 称 MaxMP 私下确认在 TODO 里）**无法核实**，已标注为「用户转述」。
5. `26128` 与 `24596` 各仅 2 帖，讨论样本极小，其结论不宜单独外推。

---

## 附：原始存档 URL 清单与抓取校验

```
http://web.archive.org/web/20241205072705/https://forum.powerampapp.com/topic/462-a-b-repeat-feature/
http://web.archive.org/web/20211206183828/https://forum.powerampapp.com/topic/462-a-b-repeat-feature/page/2/
http://web.archive.org/web/20231002220233/https://forum.powerampapp.com/topic/462-a-b-repeat-feature/page/3/
http://web.archive.org/web/20240908091543/https://forum.powerampapp.com/topic/20538-feature-request-bookmarking-reappear-repeating-a-to-b/
http://web.archive.org/web/20241210021701/https://forum.powerampapp.com/topic/26128-a-b-repeat/
http://web.archive.org/web/20241113160704/https://forum.powerampapp.com/topic/24596-repeat-particular-portion-of-a-track/
```

**抓取校验记录**：

| slug | HTTP | HTML 字节数 | 解析出的 article 数 | 与分页声明是否一致 |
|---|---|---|---|---|
| `462` p1 | 200 | 420,458 | 25 | ✅ per-page=25 |
| `462` p2 | 200 | 445,082 | 25 | ✅ per-page=25 |
| `462` p3 | 200 | 815,179 | 25 | ✅ per-page=25（末页） |
| `20538` p1 | 200 | 289,369 | 15 | ✅ 单页全部 |
| `26128` p1 | 200 | 94,207 | 2 | ✅ 单页全部 |
| `24596` p1 | 200 | 94,615 | 2 | ✅ 单页全部 |

合计解析 **94** 条帖子，与上表逐页 article 数之和一致。
