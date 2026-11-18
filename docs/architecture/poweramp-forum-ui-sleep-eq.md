---
doc_id: "ARCH-POWERAMP-FORUM-UI-SLEEP-EQ"
title: "Poweramp 论坛取证：睡眠定时 / 界面交互 / EQ 声道平衡（开发者回复实录）"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "forum 存档快照（2020-2024）"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: Poweramp 论坛讨论取证（睡眠/界面/EQ 主题组）"
  - "Wayback Machine: forum.powerampapp.com/topic/<slug>（11 个主题帖存档快照）"
---

# Poweramp 论坛取证：睡眠定时 / 界面交互 / EQ 声道平衡

> 取证方式：Wayback Machine 存档页 → 解析 `cPost_contentWrap` 正文块 + `#comment-<id>` 锚点 + `<time datetime>` 时间戳。
> 所有引述均逐字摘自存档 HTML，未做任何改写或补全。

## 0. 一句话结论

11 个主题帖**全部抓到存档**（共 **70** 条帖子），其中 **10 个帖子**有官方管理员 **andrewilley（署名 Andre，Administrators 组 + moderator badge）** 的回复，共 **25 条**；唯一没有开发者回复的是 26672。

### 0.1 开发者身份认定（取证依据）

| 项 | 存档实证 |
| --- | --- |
| 账号 | `andrewilley`，profile id **127** |
| 用户组 | 每条帖子作者栏均为 `<li data-role="group">...Administrators</li>` |
| 徽章 | `<span class="cAuthorPane_badge cAuthorPane_badge--moderator" title="andrewilley is a moderator">` |
| 署名 | 正文结尾固定署名 **Andre** |
| 活跃度 | profile 统计 **22,225 posts / 345 solutions** |

> ⚠️ **重要边界**：andrewilley 是**官方管理员/版主兼对外发言人**，不是唯一代码作者。
> 他本人在正文中多次以 **`@maxmp`** 称呼开发者（"@maxmp Perhaps this could be an option..."、"I suggested to Max a while back..."），
> 即 **Max (maxmp) 才是实际开发者**，Andre 负责收集需求、维护 Frequently Requested Features 列表、并向 Max 转达。
> 因此下文 §2 的"开发者回复"更准确的定位是：**官方团队成员（管理员/版主）的权威答复**。

---

## 1. 逐帖取证总表

| # | slug | 帖数 | 开发者回复数 | 核心诉求 |
| --- | --- | ---: | ---: | --- |
| 1 | `19394-remove-sleep-timer-with-multiple-of-5-...` | 2 | **1** | 睡眠定时器取消 5 分钟倍数限制、支持"重复单曲 N 次后停止" |
| 2 | `20537-sleep-timer-improvement` | 6 | **2** | 睡眠定时器加**淡出（fade-out）**；更精细的时间粒度 |
| 3 | `20873-jump-to-first-track-on-end` | 4 | **2** | 专辑播完后播放头回到**首轨**（CD 机式），而非停在末轨 |
| 4 | `23622-swipe-from-the-left-side-of-the-screen-to-open-the-library` | 3 | **1** | 左侧边缘右滑打开曲库 |
| 5 | `24042-change-back-button-swipe-down-functionality-on-the-player-screen` | 23 | **9** | 返回键应回到**上一屏**而非退出；下滑手势语义 |
| 6 | `26672-save-balance-alongside-other-eq-values-as-a-preset-for-specific-device` | 2 | **0** | 声道平衡随设备/EQ 预设一起保存（**无官方回复**） |
| 7 | `26973-sleep-timer-improvement` | 14 | **5** | 睡眠定时器按"分钟:秒"精确设置、时长延到 180 分钟 |
| 8 | `27180-better-tablet-interface-...` | 3 | **1** | 平板**双栏布局**（左侧小面板 + 右侧列表） |
| 9 | `27237-save-balance-with-presets` | 2 | **1** | 声道平衡随预设保存（多副耳机左右不平衡） |
| 10 | `27389-channel-balance` | 2 | **1** | 声道平衡按**耳机设备**分配（蓝牙/有线各自独立） |
| 11 | `27583-looking-for-a-skin-thats-similar-to-retro-music-app` | 9 | **2** | 类 Retro Music 皮肤；**自适应取色**（封面驱动主题色） |
| | **合计** | **70** | **25** | **10 / 11 帖有官方回复** |

### 1.1 各帖存档快照与时间跨度

| slug 编号 | 快照时间戳 | 首帖日期 | 末帖日期 |
| --- | --- | --- | --- |
| 19394 | 2024-11-04 | 2020-06-17 | 2020-06-17 |
| 20537 | 2024-12-03 | 2021-01-08 | 2022-04-17 |
| 20873 | 2024-10-08 | 2021-03-10 | 2021-03-11 |
| 23622 | 2024-10-15 | 2022-05-17 | 2022-05-17 |
| 24042 | 2024-11-11 | 2022-07-23 | 2022-08-01 |
| 26672 | 2024-11-04 | 2023-07-11 | 2023-07-19 |
| 26973 | 2024-11-02 | 2023-08-29 | 2023-09-17 |
| 27180 | 2024-09-10 | 2023-10-07 | 2023-10-07 |
| 27237 | 2024-11-04 | 2023-10-18 | 2023-10-18 |
| 27389 | 2024-12-06 | 2023-11-23 | 2023-11-23 |
| 27583 | 2024-10-14 | 2024-01-16 | 2024-03-01 |

> 11 个帖子均为**单页主题**（无分页），存档覆盖该帖全部楼层，不存在截断。

---

## 2. 官方回复原文摘录（逐字引用）

> 每段均标注 **slug / comment id / 日期 / 作者**。斜体方括号 `[引用上文]` 表示原帖中被折叠的引用块。
> 原文拼写笔误（如 `abut`、`Plater Screen`、`waned`、`Android.#`）均按存档原样保留。

### 2.1 睡眠定时器（19394 / 20537 / 26973）

**★ 19394 · `#comment-86227` · 2020-06-17 · andrewilley（Administrators，moderator badge）**

> So just to clarify, you are asking for two features:
> 1) Finer control in the Sleep timer, so the slider bar has more freedom to be set anywhere from 1 minute upwards, in 1 minute increments, rather than only offering preset intervals.
> 2) Add a cutoff to the 'Repeat One Song' feature to allow (for example) a track to be played ten times and then stop.
> The second feature could be roughly achieved by using the first feature of course, but it would be a bit clumsy. For example if a repeated track was 3'30" and you wanted it to play it ten times, you could set the Sleep timer to 35 minutes and tick the 'Play Last Song to End' box.
> If I could be cheeky :) and add a little request of my own to this by the way, I've always thought that an inactivity tickbox would be handy in the Sleep timer setting panel. So you could set a timer to stop playback 15 minutes after the last manual interaction (track changes, volume change, pause, etc). Great for nighttime listening on headphones (assuming the headphones have control buttons of course) when you don't know how long it will take you to fall asleep.
> Andre

**★ 20537 · `#comment-93385` · 2021-01-08 · andrewilley**

> I tend to agree that a less granular slider control would be more useful, allowing 1 minute increments from 1 to 120 minutes. And if the 'Play to end of last track' option has not been selected, I agree that a gradual fade-out over (for example) 20-30 seconds would be a much more elegant and subtle way to handle the end of the sleep period.
> Andre

**★ 20537 · `#comment-104455` · 2022-01-05 · andrewilley**

> *[引用上文]*
> I don't think it would even need to be an option, could just be hard coded to fade out over maybe 20 seconds - as long as you haven't enabled the "play to end" of song feature.
> Andre

**★ 26973 · `#comment-124526` · 2023-08-29 · andrewilley**

> *[引用上文]*
> Why is it necessary? Are you looking for shorter/longer times, or some specific time?
> There are several existing requests about features people would like for the Timer, are these the sort of things you want:
> *[引用上文]*
> Andre

**★ 26973 · `#comment-124533` · 2023-08-29 · andrewilley**

> *[引用上文]*
> I ask again: why? What do you really need that the current system does not provide and which requires the urgent attention of the developer?
> OK, so you can't set a timer for 78' 31" - but why would you need to? The current increments seem fine for most scenarios, just wondering what specific requirement you have that makes this an urgent issue?
> Andre

**★ 26973 · `#comment-124539` · 2023-08-29 · andrewilley**

> *[引用上文]*
> No, it's not needed (as in the app doesn't work without it) but it might be a nice update at some point for the usage you describe. I'm not sure of any app that allows a Sleep timer to be adjusted in minutes and seconds though (and the "play last track to end" option already covers not stopping part-way though a chapter). But yes, I agree it's not a bad idea.
> Please take a look at the Frequently Requested Features list (which itself is only a small subset of all the requests in these forums, some dating back 10+ years that haven't yet made their way to the top of the to-do list) and work out what priority adding extra granularity to the sleep timer should fall within those requests?
> Andre

**★ 26973 · `#comment-124557` · 2023-08-29 · andrewilley**

> *[引用上文]*
> Most sleep timers I've come across support just a few steps, and certainly nothing down to a specific number of minutes.
> But yes I agree it's a fairly small amount of coding, but then so are a lot of other feature requests with a lot more user support behind them. I suggested to Max a while back that it might be a good idea to mop up 10-15 really simple "low hanging fruit" requests rather than doing a major project for the next beta phase, but not sure where his plans lie in that respect.
> Andre

**★ 26973 · `#comment-124939` · 2023-09-17 · andrewilley**

> There are a number of modifications for the Sleep Timer already mentioned in the Frequently Requested Features list, including supporting longer and shorter times. I don't know how far up the to-do priority order they are though:
> *[引用上文]*
> Andre

### 2.2 播放结束行为（20873）

**★ 20873 · `#comment-95311` · 2021-03-10 · andrewilley**

> Currently the only way to go back to the start of the current playback category is to use 'Repeat Category', but that will restart playback of the whole album again which does not seem to be what you want. The default method of playback is known as 'Advance Category', which would continue on to play the next album in order after the current one is finished.
> Personally, I would agree that the current behaviour doesn't really fit with any particular usage situation. I think there are two logical places to place the stopped playback counter when a category finishes:
> Paused at the end of the final track (or waiting at the start of the first track of the next category) - so pressing Play would commence playing the next album in order (this fits with PA's general logic of what you would expect to happen during ongoing playback).
> Paused at the start of the first track in the category - so pressing Play would play the current album again (more akin to a CD player stopping after playing a CD).
> @maxmp Perhaps this could be an option in Settings > Library > Lists, replacing the current behaviour which doesn't seem to make a lot of sense?
> Andre

**★ 20873 · `#comment-95367` · 2021-03-11 · andrewilley**

> If implemented, that would fit in nicely with a long standing request of mine to tidy up the wording for the Repeat button. I've lost count of the number of times I've had to explain what 'Advance Category' means to new users when all it really means is 'play all categories'.
> My suggestion was to unify and simplify the Repeat icon wording to a more logical and user-friendly: Play One Song | Play Category | Play All | Repeat One Song | Repeat Category | Repeat All
> Andre

### 2.3 手势与返回键（23622 / 24042）

**★ 23622 · `#comment-109222` · 2022-05-17 · andrewilley**

> *[引用上文]*
> It's always enabled, but it only functions if you are on the first or last track of the current category. Personally I'd like it to be available at any time, to allow category changing for those who do not want to use Pro Buttons. But I agree that side-swipe for library isn't needed when you can already swipe down (or tap on the artwork). Or tap the Library icon if you want to go straight to the top level of the Library.
> There have been a number of requests in the past to make the up/down/left/right swipe features plus tap and long-press customisable though. For example to support volume control instead of going to the library, or make up/down change category, etc. Since tapping currently goes to the Library, that too would become a customisable option if you waned to use it elsewhere. This would tie in nicely with making the functions of buttons under the cover artwork customisable too, which is also a long-term request.
> Andre

**★ 24042 · `#comment-111439` · 2022-07-23 · andrewilley**

> This is really a carry over from Poweramp V2 I think, and yes it has been requested a number of times in the past. I do tend to agree that Back should mean Back (as in go to previously viewed screen), as there are other buttons at the top of the library screens than navigate up to previous levels.
> I'll add this to the Frequently Requests Features thread.
> Andre

**★ 24042 · `#comment-111461` · 2022-07-24 · andrewilley**

> I actually very rarely use any page-swipe features for anything in PA to be honest - sorry Max, I know you put a lot of work into making them function smoothly. Taps on specific labelled buttons just seem so much more efficient and intuitive. I do scroll up and down lists of course, but no swipe left or right as my little brain finds it a bit counter-intuitive to swipe both left or right to go up a level.
> In fact, when I think about it, other than switching between tabs in apps (or changing home screens) I rarely use whole-page swipes at all. I will swipe individual items away, or drag or pinch things (e.g. maps or photos, but otherwise it's mainly scrolling up or down web pages or other list-style content.
> Andre

**★ 24042 · `#comment-111468` · 2022-07-24 · andrewilley**

> I wouldn't mind an option to have to press Back a second time to exit. But as PA doesn't really 'exit' while playing anyway, it just closes the user interface, it seems a bit of a moot point anyway.
> I would like an option to edit what swipes and taps do on the Player UI (up/down/left/right/tap/long-press) and also to edit the four buttons under the artwork area, which is a long-standing request that is somewhere in the to-do list.
> Andre

**★ 24042 · `#comment-111476` · 2022-07-24 · andrewilley**

> *[引用上文]*
> That's exactly how PA works at the moment. When you are already at the original entry screen (which as you say could be the Player UI or Library depending on your setting) the Back button exits back to Android.#
> The bit that I'm with you on is when you tap on the artwork area in the Player UI, which takes you to view the currently playing song in the current songs list. I agree that the logical expectation at that point would be for the Back button to return you to the Player UI where you came from, not to traverse up the next layer in the Library (e.g. going up to the higher Albums or Folders views).
> Andre

**★ 24042 · `#comment-111499` · 2022-07-25 · andrewilley**

> *[引用上文]*
> There is of course one very good reason for a common design language when it comes to the overall way that interfaces operate, and that's user familiarity and ease of use. That's why Google (for better or worse) goes to great lengths to try to ensure that all Android apps operate in much the same way in terms of their design language, look & feel, and user interface. So anyone who basically understands how Android works should be able to download and start using new apps seamlessly.
> The downside of this is that a great many apps look like generic homogenous copies of each other, with the same buttons in the same layout and similar options. Poweramp, like other 'power user' apps, has never slavishly followed that trend and prefers to do things its own way, which can lead to a longer learning curve. But once you've mastered its complexities and dug into the Settings to find all sorts of extra opportunities, it's far more versatile than the sanitised - indeed, almost childish - interfaces of Samsung's music player, Sonos app, etc.
> Just look at VLC and foobar2000 on PCs. Neither of them slavishly follow the latest Windows 11 design guidelines - in fact in many ways they still look like Windows 95/XP programs - but the features hidden away within their interfaces are second to none.
> Andre

**★ 24042 · `#comment-111502` · 2022-07-25 · andrewilley**

> *[引用上文]*
> I think we're all in agreement here that an option to make the Back button function more intuitive - by always going 'back' to the previously used screen, as usually expected, no matter where you have landed - would be a good idea. I don't think anyone is arguing against that?
> Andre

**★ 24042 · `#comment-111506` · 2022-07-25 · andrewilley**

> The biggest interface changes occurred between PA v2 and PA v3 abut six years ago. Lots of cheese was moved in those first betas, and some of it was quickly moved back again before the main public release. e.g. the initial releases only had a Play/Pause button, no 'Pro Buttons' feature for track/category control; there was no overall track progress bar, only a waveseek graph behind the Play/Pause button; and there were no star ratings, only the basic thumb up/thumb down facility. But once the interface had settled down for public release, there have been very few major UI changes beyond what skins have to offer.
> Andre

**★ 24042 · `#comment-111722` · 2022-08-01 · andrewilley**

> @osif32 Long-press on the cover art area rather than tapping, and select Album from the list. Or tap the three-dots menu icon if you prefer.
> Andre

**★ 24042 · `#comment-111727` · 2022-08-01 · andrewilley**

> @osif32 No problem.
> There are plans for an additional display option to view all planned upcoming tracks (and playback history too) in its own screen by the way, which you also mentioned. It would present a flattened list of every song scheduled to be played, regardless of the current playback mode (category, playlist, queue, shuffle, etc).
> Andre

### 2.4 EQ / 声道平衡（27237 / 27389）

**★ 27237 · `#comment-125798` · 2023-10-18 · andrewilley**

> Not at present, no.
> I've suggested that the 'Save/Assign' function in the EQ screen could potentially also offer a number of tickboxes in order to select what the user wishes to store in the Preset, in the same way that the recent update to PA's 'Export Settings/Data' now works.
> Andre

**★ 27389 · `#comment-126529` · 2023-11-23 · andrewilley**

> This has come up a few times in the past, and I've suggested that perhaps a tickbox selection screen within the EQ Save/Assign process might help.
> If implemented, that would allow choosing which aspects of the EQ system you want to save into any given Preset - e.g. save the EQ slider values only, Tone Controls, Preamp setting, Mono/Balance, Tempo, Reverb, etc. Then when you tap to restore that Preset later, only the saved elements would be reinstated (anything not saved in the Preset would remain as per its existing setting).
> Andre

### 2.5 平板布局与皮肤（27180 / 27583）

**★ 27180 · `#comment-125560` · 2023-10-07 · andrewilley**

> A two-pane horizontal layout - for example to show a Player interface on one side and the library song list on the other - has been requested a few times in the past for use on larger screens like tablets. I think I'll add this to the Frequently Requested Features list.
> Andre

**★ 27583 · `#comment-127851` · 2024-01-16 · andrewilley**

> If it's more the vertical position of each section/element that's concerning you, YAPS has a fully customisable layout, and lots of colour choices. But not dynamic colours, as the core Poweramp app does not support that.
> Andre

**★ 27583 · `#comment-128583` · 2024-03-01 · andrewilley**

> @heidl I have seen this request for adaptive colour schemes for text in the Plater Screen multiple times too, I'll add it to the Frequently Requested Features list.
> [Edit] Done, you can now vote here:
> Andre

---

## 3. 从讨论中提炼的要点

### 3.1 需求边界（官方认可的具体形态）

| 主题 | 官方认可的形态 | 出处 |
| --- | --- | --- |
| 睡眠定时颗粒度 | **1 分钟步进，范围 1–120 分钟**（不是"分钟:秒"） | 20537 `#comment-93385` |
| 睡眠淡出 | 未勾选"播放到曲末"时，末尾 **20–30 秒渐弱**；甚至**可硬编码 20 秒**、不必做成选项 | 20537 `#comment-93385`、`#comment-104455` |
| 睡眠定时附加项 | **"无操作后 N 分钟停止"**（inactivity tickbox）由 Andre 本人提出 | 19394 `#comment-86227` |
| 长时长需求 | 用户要求延到 **180 分钟**（失眠场景），官方承认已列入 Frequently Requested Features | 26973 `#comment-124938`（用户）、`#comment-124939`（官方） |
| 专辑结束播放头 | 两个候选方案：①停在末轨末/下一类首轨前；②**回到本类首轨**（CD 机式） | 20873 `#comment-95311` |
| 返回键 | **"Back 就是 Back"**：回到上一屏，而非向上穿越曲库层级 | 24042 `#comment-111439`、`#comment-111502` |
| 手势自定义 | up/down/left/right + tap + long-press **六个手势全部可自定义**，含封面下四按钮 | 23622 `#comment-109222`、24042 `#comment-111468` |
| EQ 预设粒度 | Preset 存哪些项**用勾选框选择**（EQ 滑块/Tone/Preamp/Mono-Balance/Tempo/Reverb） | 27237 `#comment-125798`、27389 `#comment-126529` |
| 平板布局 | **双栏水平布局**（一侧 Player、一侧曲库列表） | 27180 `#comment-125560` |
| 自适应取色 | 已加入 Frequently Requested Features 投票列表 | 27583 `#comment-128583` |

### 3.2 官方态度（可直接引用的立场）

1. **愿意承认现状不合理**：对"专辑播完停在末轨"，Andre 直言 "the current behaviour doesn't really fit with any particular usage situation"（20873）。
2. **愿意收编需求**：多帖以"加入 Frequently Requested Features"收尾——24042 `#comment-111439` 写 "I'll add this to the Frequently Requests Features thread."，27180 `#comment-125560` 与 27583 `#comment-128583` 写 "...Frequently Requested Features list"。说明**进列表是官方认可的正式需求入口**。
3. **优先级由 Max 决定，Andre 不承诺时间**：26973 `#comment-124557` 明说 "not sure where his plans lie in that respect"；`#comment-124939` 明说 "I don't know how far up the to-do priority order they are"。
4. **对小改动持开放态度**：Andre 曾向 Max 建议 "mop up 10-15 really simple 'low hanging fruit' requests"（26973）。
5. **反对为一致性牺牲特色**：24042 `#comment-111499` 完整阐述了"通用设计语言 vs power user 应用"的取舍，明确 Poweramp 选择后者。
6. **反复追问真实使用场景**：26973 中 Andre 先问 "Why is it necessary?"（`#comment-124526`），再追问 "I ask again: why?"（`#comment-124533`），要求用户给出具体场景，说明**需求评审以场景驱动**。

### 3.3 技术约束（论坛中明确出现的事实）

| 约束 | 内容 | 出处 |
| --- | --- | --- |
| 单人开发 | "There is just one developer for Poweramp."（用户 motleyg 指出，官方未反驳） | 26973 `#comment-124531` |
| 边缘手势生效条件 | 边缘滑动切换分类**始终启用**，但**仅在当前分类首/末曲时生效** | 23622 `#comment-109222` |
| 播放器"不真正退出" | 播放中 Back 只是关闭 UI，进程仍在 | 24042 `#comment-111468` |
| 皮肤能力边界 | YAPS 可完全自定义布局/颜色/进度条位置与粗细，但**动态取色核心不支持** | 27583 `#comment-127851`、用户 `#comment-127856` |
| 封面点击语义 | 点击封面 → 当前歌曲所在列表；**长按封面 → 可选 Album** | 24042 `#comment-111722` |
| 已有替代路径 | "播放到最后曲末"（Play Last Song to End）可用于重复 N 次的近似实现 | 19394 `#comment-86227` |
| 大改版历史 | 主要 UI 变革集中在 **PA v2 → v3**，此后除皮肤外少有重大 UI 变更 | 24042 `#comment-111506` |

---

## 4. 抓取失败的帖子及原因

**11 / 11 全部抓取成功，无失败帖子。**

### 4.1 过程中遇到的实际障碍（已克服，记录备查）

| 障碍 | 表现 | 解决方式 |
| --- | --- | --- |
| Wayback 限流 | `HTTP 429 Too Many Requests`（响应体 620 字节） | 串行抓取 + 每次请求间隔 5–40 秒退避重试 |
| TLS 握手失败 | `curl: (35) schannel: failed to receive handshake` | 等待限流窗口结束后重试；不使用 `--tlsv1.2` 强制 |
| 快照时间戳失效 | 直接用 `available` API 返回的时间戳偶发 502/000 | **回退到 CDX API** 取该 slug 的全部历史快照，逐个尝试 |
| `available` API 与 CDX 差异 | 20873 实际命中快照为 `20241008150929`（非 available 返回的 `20241011220104`） | 以**存档页内嵌的真实时间戳**为准记录 |

> 说明：本次全部通过本地 `curl` 抓取完整 HTML（最长 409,956 字节），未依赖有 100 KB 截断上限的抓取接口。

### 4.2 唯一无官方回复的帖子

**`26672-save-balance-alongside-other-eq-values-as-a-preset-for-specific-device`（2 帖，0 回复）**

- 楼主 ramg 于 2023-07-11 发帖 `@maxmp` 询问"能否给声道平衡加上像 EQ 那样的按设备指定/保存"；
- 2023-07-19 楼主在引用自己的帖子后仅 `@andrewilley` 追问（`#comment-123321`），**此后无任何官方或他人回复**；
- 该诉求在 27237、27389 两帖中**得到官方实质回应**（勾选式 Preset 方案），可视为同一需求已在别处被覆盖。

---

## 5. 取证方法与可复现性

| 环节 | 做法 |
| --- | --- |
| 存档定位 | `http://archive.org/wayback/available?url=forum.powerampapp.com%2Ftopic%2F<完整slug>`；失败时回落 CDX API |
| 页面抓取 | 完整 HTML 落盘，UA 使用常见浏览器 UA，串行 + 退避 |
| 正文提取 | 定位 `data-role="commentContent"` 的 `<div>`，按 `<div>` 标签配平截取 |
| 楼层识别 | 按 `<article id="elComment_<id>"` 切分，`id` 即 `#comment-<id>` |
| 作者识别 | `profile/<id>-<name>/` 链接 |
| 时间识别 | `<time datetime="YYYY-MM-DDTHH:MM:SSZ">` |
| 官方身份 | `cAuthorPane_badge--moderator` + `data-role="group"` 为 Administrators |
| 去皮 | 去 script/style、折叠 blockquote 为占位、表情按 `title` 还原、解 HTML 实体、压缩空白 |

> 已知局限：被折叠的 `blockquote` 引用块内容未保留（统一替换为占位符），因此官方回复中"引用上文"部分的具体所引原文，未能逐字还原；但**被引用内容均可在同一帖的前序楼层中找到原始正文**。
