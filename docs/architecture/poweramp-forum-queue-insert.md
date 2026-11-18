# Poweramp 官方论坛取证：队列 / 插入（Queue / Insert）

> 主题组：**队列/插入**
> 取证方式：Wayback Machine 存档抓取原帖 HTML，解析 `<article id="elComment_…">` 块逐条提取
> 抓取时间：2026-11-18（本机时间）
> 取证范围：`forum.powerampapp.com` 官方论坛，共 9 个 topic
> 说明：**本文所有引述均为抓取到的原文逐字转录**，未做改写、未做翻译、未补全。凡未抓到的一律标注「无存档 / 抓取失败」。

---

## §0 一句话结论

**9 个帖子全部抓到存档，合计 115 条评论；其中 9 个帖子都有开发者回复 —— andrewilley（Andre，管理员/版主 badge）共 48 条，另有 Poweramp 主开发者 maxmp（Max）8 条出现在 3 个帖子中。**
两处开发者明确表态最值得注意：**「Now Playing / History 列表」类需求被 Max 明确以「目标列表本身就是 now playing」为由搁置**（#comment-95012），而**「插入位置（顶部/底部/随机）」需求被 Max 实际实现并承诺进 beta 934**（#comment-107979、#comment-108085）。

---

## §1 逐帖取证表

| 帖子 slug | 抓到评论数 | 抓到页数 | Andre 回复数 | Max 回复数 | 核心诉求 |
|---|---|---:|---:|---:|---|
| `19240-now-playing-listqueue-feature` | 25 | 1 | 10 | 1 | 要一个「Now Playing」扁平列表：可看上/下一首序列并重排（Queue 之外的播放视图） |
| `22022-insert-new-songs-on-top-of-the-playlist-rather-than-below` | 25 | 1 | 12 | 6 | 新歌插入播放列表/队列的位置（顶部 / 底部 / 随机散插）＋多选整块拖动 |
| `19725-next-queue-and-more-queues` | 9 | 1 | 4 | 0 | 「下一个队列」视图 ＋ 支持多个队列 |
| `20240-new-to-poweramp-want-to-see-list-of-next-tracks-when-i-shuffle-a-category` | 12 | 1 | 4 | 0 | Shuffle 播放分类时想看到并重排后续曲目（播放历史 / 未来序列视图） |
| `23036-request-add-shuffled-to-playlist` | 7 | 1 | 3 | 1 | 向正在播放的 shuffle 列表追加歌曲时，希望新歌洗牌并入未播放序列 |
| `17208-simultaneously-move-multiple-tracks-in-a-playlist` | 8 | 1 | 2 | 0 | 播放列表中多选后整块拖动多首曲目 |
| `21984-disable-album-art-tap-to-go-to-playlist` | 8 | 1 | 4 | 0 | 点按专辑封面跳转当前播放列表易误触，希望可关闭或可自定义手势 |
| `21714-shuffle-naming-so-complicated` | 16 | 1 | 7 | 0 | Shuffle/Repeat 术语（「Category」一词）难懂，用户要「只洗牌这个文件夹」 |
| `20035-rollover-to-next-folder-after-playing-last-song-of-current-folder` | 5 | 1 | 2 | 0 | 播放完当前文件夹最后一首后自动滚入下一文件夹（「Advance Category」语义与命名） |

**开发者身份核验（重要）**

- **andrewilley（署名 Andre）**：每个帖子中其 `<article>` 块内均含 `cAuthorPane_badge--moderator`（title="andrewilley is a moderator"），且 `data-role="group"` 显示为 **Administrators**。用户 uid=127。
- **maxmp**：同样带 `cAuthorPane_badge--moderator`，但**不属于 Administrators 组**；其发言内容均为「我加了 / 我实现了 / 下一步 beta build」式的开发动作陈述，可判定为 **Poweramp 主开发者 Max**。
- 其余发言者无 moderator badge，为普通用户/高级会员。

**版块归属**：`20035`、`21714` 位于 **General Chatter**（闲聊区）；其余 7 帖位于 **Poweramp Feature Requests**（`20240` 是 Andre 在帖内主动从 Chatter 移入 Feature Requests 的，见 #comment-91600 末段）。

---

## §2 开发者回复原文摘录（逐字引用）

> 标注格式：`#comment-<id>` · 日期(UTC) · 作者

### 2.1 队列概念与「Now Playing 列表」——官方定性拒绝（19240）

> **#comment-85224** · 2020-05-13 · **andrewilley**（开发者/管理员 Andre）
>
> Poweramp does not have the concept of a "Now Playing" list as such, which is why you cannot display it.
>
> Poweramp's playback order is determined from the Library category that you decide to use, and the sorting order that you have assigned for that category. For example, you could listen to your music by Artist, by Album, by Folder, etc. - and you would this hear all the songs in the first album (or folder, etc) that you select, then the next album in order, and so on. The order could be alphabetical, year, random shuffle, etc.
>
> If you want to do something a bit more ad hoc, that's what the Queue and Playlists are for:
>
> The Queue allows you to create a temporary list of songs (including full albums, folders, etc) which will be played back sequentially in the order you add them until they are finished. You can move the songs up and down in the Queue if you wish. You can also play the Queue in random order if you prefer.
>
> Playlists are very similar, but are saved for future use so you can go back to them later. You can also do more with them, such as give them names, sort the songs by various criteria, etc.
>
> Andre

> **#comment-95012** · 2021-02-26 · **maxmp**（Poweramp 主开发者 Max）
>
> @invaderzim Poweramp plays the target list (folder, album, playlist) directly - the target list becomes the “now playing” and you also may have now playing like playlist in a form of the Queue, but actually just a user created Playlist can do that too, including item reordering and permanent shuffle, other sorting orders, and stored lat played song position (enabled via header menu / List Options for the given playlist).

> ⬆ 这是 Max 对「Now Playing 列表」类需求最直接的一次定性说明：**目标列表本身就是 now playing**，Queue/Playlist 已覆盖。Andre 随后仍试图把需求转成「quick view history」，但未获采纳。

> **#comment-95017** · 2021-02-26 · **andrewilley**（开发者/管理员 Andre）
>
> @maxmp The request in this and other similar threads was more for a 'quick view' history facility. So you would be able to see all of the recently played songs for the current playback session, plus all of the upcoming songs in their planned order, as one long flattened list - similar to the All Songs list - with the currently playing song initially shown in the middle of the screen. This simple overview list would work regardless of whatever playback category, repeat or shuffle modes you happen to be using.
>
> It does seem like a useful idea to me, and accessing it could be via a simple tap on the track counter on the player screen.
>
> Andre

> **#comment-92965** · 2020-12-27 · **andrewilley**（开发者/管理员 Andre）
>
> 29 minutes ago, Okta said:
>
> The permanent queue option is totally a separate function that should exist the way it is.
>
> Poweramp doesn't have a permanent queue, only the transient one that you can add to with ">> Queue" and which normally exits when finished. The nearest thing to a "permanent queue" would be a Playlist.
>
> I think what you are asking for is something that has been requested a number of times before though, which is a method to see, in a very simple flatted list format, all the songs that have already been played in the current session and also the forthcoming ones too (regardless of your chosen playback Category and any Shuffle/Repeat modes).
>
> Andre

> **#comment-94918** · 2021-02-21 · **andrewilley**（开发者/管理员 Andre）
>
> @juvell The idea being discussed was to allow you to see the playback history and a list of the scheduled songs. That list would be based on the Library Category you are using, and the sorting order pre-defined via its List Options. It would be easy enough to move to elsewhere in the list (forward or backward) but not to manipulate the order at will, nor to skip items, as the playback order is a fundamental function defined for all songs before playback commenced.
>
> As you say, if you want a manually ordered playback method, or just a subset of the whole Library, please use either the Queue or a Playlist which are specifically designed for that purpose. Both of these can be re-sorted at will in a variety of orders, or adjusted manually by dragging songs up and down their local list, or adding/removing songs. Both of those options already allow you to see forward and backward through the list during playback incidentally.
>
> Andre

> **#comment-94652** · 2021-02-14 · **andrewilley**（开发者/管理员 Andre）
>
> I've not seen any particular feedback one way or the other from the Poweramp dev about this suggestion - either in this thread or other similar ones. Sorry.
>
> Andre

### 2.2 队列渲染顺序 / 可见性（20240）

> **#comment-91600** · 2020-11-19 · **andrewilley**（开发者/管理员 Andre）
>
> Ah, I see what you mean. No, when Shuffling normal playback categories there isn't a way to easily view full playback history or next-planned tracks, nor can you manually move specific tracks. You can skip forward and backward through the planned shuffled tracks with the >> and << buttons, but not see the internal ordering in a list layout.
>
> As I mentioned earlier, you can do what you want with either Playlists or Queue playback though - but only if you use the Re-sort option that I mentioned, which which may not be exactly what you want as it permanently randomises the list in question, so you'd lose any previously intended ordering of the list. You can also move tracks up and down the lists manually, but again that makes a permanent change to the list.
>
> There is a "sort-of" answer to your question though, which I think was put in place as a partial response to previous similar feature requests a while ago. In the List Options screen for any given Category's songs list, one of the sorting options in the menu is 'By Shuffle Order'. This allows you to view that particular category's list in the random order used if you enable the Shuffle icon on the player screen. This is most useful if you are using the All Songs category, in which case you can see the whole list in its shuffled order (forward and backward) when you tap on the album art in the player screen. You can't adjust that order though, other than by doing a re-shuffle.
>
> I'm going to move this thread from Chatter to the Feature Requests area, as I agree it would be really nice to have some sort of 'History' feature in the Player Screen's menu (alongside Folder/Album/Artist) which would open a view showing all the previously played and upcoming tracks for the current session using a simple scrollable flat list format.
>
> Andre

### 2.3 入队位置语义：末尾 vs 开头 vs Play Next（19725）

> **#comment-88740** · 2020-08-13 · **andrewilley**（开发者/管理员 Andre）
>
> If you are just playing the queue with the regular Shuffle feature enabled, you cannot then change the order of the tracks (or see upcoming tracks) as they are fully random.
>
> However if you first enqueue all the tracks you want to listen to, you can then use Library > Queue > (three-dots menu) > Re-Sort. That allows you to physically re-order all of the songs currently in the Queue in any way you like - including randomising them. Once you've done that, you can view the new random playback order and even move songs up or down the sequence (by long-pressing on song titles in the Queue list).
>
> You are right that the concept of multiple queues is really covered by Playlists, which can do everything that the Queue can do and quite a lot more, and you can create as many as you like and switch between them. They have the same Re-sort feature that the Queue does, so you can shuffle them and then see the new sequence in the list and move songs around.
>
> Andre

> **#comment-88747** · 2020-08-14 · **andrewilley**（开发者/管理员 Andre）
>
> A couple of things I forgot to mention before by the way:
>
> If you are listening in All Songs mode (or other categories) with Shuffle enabled, you can use the library three-dots-menu 'List Options' screen to set the viewing mode to see the tracks "By Shuffle Order". This allows you to follow the order in which PA has randomised the tracks - both forward and backward through the list. You can't change that order for an odd track or two though (other than by creating a whole new shuffle sequence) so for that functionality you still need to use the Queue (was as so mentioned is momentary) or a Playlist (more long-lasting if you want to create several lists of songs for later use).
>
> Also, adding to the Queue normally adds the new song(s) at the end of the the queue, so the most recently added songs will get played after any existing ones have been played first. However a new feature was added in recent builds which allows you to insert new items at the start of the queue, so they will play next. You can enable this mode with Settings > Library > Queue > Play Next.
>
> Andre

> **#comment-88750** · 2020-08-14 · **andrewilley**（开发者/管理员 Andre）
>
> When listening to either the Queue or a Playlist, you can pick any song in the planned running order and either drag it to the top to make it play next, or simply click on it to start it playing now. [ @maxmp might it be worth allowing dragging multi-selected items up and down the Queue and Playlists, allowing the user to move several songs at once? ]
>
> You can still use the temporary queue during playback of a Playlist by the way, which would enable you to find a few songs that you'd like to hear sooner and Add to Queue. However having queues nested recursively within queues within queues could become an Escher-like nightmare to navigate. Basically "Inception" for audio.
>
> I do agree that the new 'Play Next' feature perhaps still needs a bit of work though, as it would be more useful if you could choose to insert song(s) either as Next or at the End of the queue dynamically, rather than needing to preselect one mode in Settings (See this post).
>
> Andre

> ⬆ 关键产品断言：**Queue 默认追加到末尾；新版本已支持插入到开头（Settings > Library > Queue > Play Next）**；并当场向 Max 提出「多选整块拖动」的设想。

### 2.4 插入位置 / 随机散插 —— 唯一被实际实现的需求（22022）

> **#comment-101051** · 2021-09-07 · **andrewilley**（开发者/管理员 Andre）
>
> It's not a feature at the moment. You can do it with the Queue ("Play Next") but not playlists.
>
> Andre

> **#comment-101058** · 2021-09-07 · **andrewilley**（开发者/管理员 Andre）
>
> Back when the 'Play Next' feature was first introduced, there were several threads about it.
>
> I must admit I initially assumed 'Play Next' would not have anything to do with the queue at all, as the wording did not imply queueing. Instead, after the current song finished, playback would simply switch to the newly requested song/album/folder/etc and carry on seamlessly in that mode from there onward. It would be exactly as if you had tapped on a song title, pressed the 'Play' icon at the top of an album list, but the activity wouldn't happen until the present song had finished.
>
> Personally, I would still prefer that method of operation.
>
> Tasks like "Insert at beginning of Queue" or "Insert at beginning of Playlist" would instead be better suited to long-pressing on the current controls. So you'd tap on the '>>Queue' control to add something to the end of the queue, but you'd long-press on '>>Queue' to insert at the start of the queue.
>
> Andre

> **#comment-107085** · 2022-03-11 · **andrewilley**（开发者/管理员 Andre）
>
> Tying this up with another request thread discussing something similar, I think it would be very useful for both the '>>Queue' and '+Playlist' buttons to support a long-press context pop-up that offers three choices of action for how the selected songs(s) will be inserted into the requested list:
>
> Insert at Start
>
> Insert Shuffled
>
> Add to End
>
> The user's chosen action should probably then remain as the default operation for the next single-tap on that same button (could also be available as an option to configure in Settings, which would mention the existence of the new long-press shortcut).
>
> [Edit] When inserting randomly into a playlist that is already playing (or has List Memory enabled) the new items should get placed somewhere beyond the current playback position.
>
> Andre

**Max 的回应与实现：**

> **#comment-107962** · 2022-04-08 · **maxmp**（Poweramp 主开发者 Max）
>
> @andrewilley I added top/bottom option for Add to playlist dialog, but for the shuffled insert, I'm not sure what you mean here - do you want newly added tracks to be shuffled and added to the end? Or should the newly added tracks be randomly distributed in the target playlist?

> **#comment-107964** · 2022-04-08 · **andrewilley**（开发者/管理员 Andre）
>
> The idea was so the newly selected batch of songs could be inserted randomly throughout the whole of the target Playlist (or Queue). The request came about as a result of someone who wanted to listen to long pre-shuffled playlists, but when adding new songs to the list they would be interspersed amongst all the other shuffled songs rather than all being added at the end. If a given Playlist is currently playing (just like the Queue) the randomly added songs should be inserted after the current playback position.
>
> Andre

> **#comment-107965** · 2022-04-08 · **maxmp**（Poweramp 主开发者 Max）
>
> @andrewilley when in shuffle mode, this is already applied in the way the newly added tracks are shuffled too (but not intermixed with other existing tracks). I will try to implement that random insertion too, though these layers of shuffle logic may result in weird results.

> **#comment-107979** · 2022-04-08 · **maxmp**（Poweramp 主开发者 Max）
>
> Added (for playlists) in the next (beta) build 934. Thanks for the request.
>
> As for the Queue, while it's technically possible, we don't have UI room for the extra actions and the queue button is one-click action without intermediate dialogs.

> ⬆ **最重要的官方落地证据**：Max 明确「已为 playlist 加入」，并说明 **Queue 因 UI 空间与一键语义不做**。

> **#comment-108085** · 2022-04-12 · **maxmp**（Poweramp 主开发者 Max）
>
> @andrewilley thanks for the idea. I implemented something like this - will be available in the next beta build. While it works, enqueuing to the start of Queue is not that useful. Keeping it for the consistency with the playlists though.

> **#comment-108086** · 2022-04-12 · **andrewilley**（开发者/管理员 Andre）
>
> 5 minutes ago, maxmp said:
>
> enqueuing to the start of Queue is not that useful.
>
> Yes, it would need need to ignore already-played songs (i.e. historical stuff that is still visible at the top of the Queue view but which is not going to be played again) and insert the new content into the Queue as the next item(s) to be played.
>
> So if the Queue is not currently playing, the inserted items become the first items ready to be played when the queue commences. But if the Queue is already playing, the insert point should be immediately after the currently playing item.
>
> Andre

> **#comment-108088** · 2022-04-12 · **maxmp**（Poweramp 主开发者 Max）
>
> @andrewilley this is what Play Next already does. Currently Queue (at start) just enqueues new unplayed songs on top - the same way as playlist action does. The intermediate build will be ready soon so this can be further tested/polished as needed.

**多选拖动（多曲目整块移动）——明确进入 backlog：**

> **#comment-108383** · 2022-04-20 · **andrewilley**（开发者/管理员 Andre）
>
> This thread (or another of the similar ones?) also mentioned the idea that once you have selected multiple items in a Playlist or the Queue, using any of the selected songs' drag thumbs should drag all of the selected items (presumably grouped together as one block of songs rather than still spread out?) rather than just moving that one song. Perhaps that could be implemented while this work is going on?
>
> And when choosing the start/shuffled/end mode for +Playlist or >>Queue, the 'add to end' variant ought to have a symbol next to it to indicate the mode it is working in (at the moment, only the top and shuffle options cause the icon to be annotated).
>
> Andre

> **#comment-108401** · 2022-04-20 · **maxmp**（Poweramp 主开发者 Max）
>
> @andrewilley unfortunately dragging this way is too complicated to implement it in timely manner in the minor update (as we can drag items in grid and list modes), so this feature is in the backlog now.

### 2.5 「多选拖动」最早由 Andre 在 2019 年确认合理（17208）

> **#comment-74964** · 2019-06-02 · **andrewilley**（开发者/管理员 Andre）
>
> So when you have multi-selected several tracks in a list, if you start to drag anyone of them upwards you would like all of them to move together. Sounds sensible to me, I'd find that useful too.
>
> Andre

> **#comment-94910** · 2021-02-21 · **andrewilley**（开发者/管理员 Andre）
>
> Another related request (as this is discussed in several threads) was to more easily select a range of items. For example to select 20 items in one go, you'd start by long-pressing on the first song/folder/etc then scroll to the last one and long-press on that in order to select all the items in between. That feature, combined with being able to drag any resulting selection of items in one movement, would indeed be very handy.
>
> Andre

### 2.6 Shuffle 追加歌曲是否重新洗牌（23036）

> **#comment-105433** · 2022-01-28 · **andrewilley**（开发者/管理员 Andre）
>
> I just tried this, and when a new song is physically added to an existing Playlist, it will be appended at the end of the existing physical list of songs - that is by design, and it is how PA is meant to work.
>
> However if you are already listening to a Playlist in 'Shuffle Songs' mode (i.e. by using the Shuffle icon at the top of the Playlist to commence playback, or by altering the Shuffle mode from the player screen) any new song that gets added in the meantime will be inserted at some random point in the upcoming randomised sequence, not at the end of the random sequence. Which does seem to be what you are asking for. Does that work for you, as you seem to be saying it does not?
>
> As for the original ordered Playlist in the Category view, there is an existing Feature Request to create a long-press mode for the '+Playlist' button to insert a song at the beginning of a Playlist rather than at the end. I would have thought that if/when that mode gets implemented, it ought to be simple enough to have a third option for "Insert Randomly within Playlist". But I don't know how far that might be down the to-do list.
>
> Andre

> **#comment-105461** · 2022-01-29 · **andrewilley**（开发者/管理员 Andre）
>
> Correct, that is how PA works. If you add new several items at once (e.g. an album or two) then they will be inserted into any current shuffled playback sequence as the whole block that you asked to be added (e.g. two albums) not as a sub-collection of individual songs scattered around randomly. I was actually surprised that it did it at all to be honest, I was expecting to see the added songs appear at the end of the sequence because you added them after the original randomised order had been generated.
>
> As you say, the only way to change that would be a Reshuffle.
>
> Andre

> **#comment-105467** · 2022-01-29 · **andrewilley**（开发者/管理员 Andre）
>
> As I said earlier, there is already an existing Feature Request for adding songs to different places within a Playlist (and also for the Queue) and I agree adding a 'Random' position, as well as Beginning and End, would be a good idea.
>
> Fully shuffling the individual songs of any added albums into an already playing shuffled list is perhaps a bit esoteric, but I'm sure it would be technically pretty simple if Max sees that it has enough general appeal. I agree that might be preferable rather than the current method of inserting all the added songs into the sequence as one entire block.
>
> Andre

> **#comment-105478** · 2022-01-29 · **maxmp**（Poweramp 主开发者 Max）
>
> @Si64 songs added to the end of playlist, but new tracks are not shuffled. I will try to add shuffling for the newly added songs for playlists and queue when new shuffle logic is implemented (with the unplayed songs priority and few other tweaks) soon.

> ⬆ Max 确认这是**独立于插入位置的另一个待做项**：为 playlist 与 queue 的新增歌曲补上洗牌并入逻辑。

### 2.7 前进到下一分类 / Advance Category 语义（20035）

> **#comment-90574** · 2020-10-16 · **andrewilley**（开发者/管理员 Andre）
>
> 'Advance Category' - i.e. move on the to next category (such as next folder, album, etc) after the current one is finished - is the default setting when you install Poweramp. However it's easy to choose a different Repeat mode for a particular session and then forget to set it back again later. The terminology can sometimes prove a bit confusing for new users, but for more explanation of what the Repeat and Shuffle settings mean, please see:
>
> Andre
>
> [EMBEDDED KB ARTICLE] http://web.archive.org/web/20240918152815if_/https://forum.powerampapp.com/kb/en_us/faq/how-to-use-%E2%80%98repeat%E2%80%99-and-%E2%80%98shuffle%E2%80%99-in-poweramp-r4/?do=embed

> **#comment-90598** · 2020-10-17 · **andrewilley**（开发者/管理员 Andre）
>
> On 10/17/2020 at 5:40 PM, QnD said:
>
> not assuming that what I was looking for is "hidden" under Repeat modes.
>
> Don't worry, you are not the first new user to find the terminology can take a bit of getting used to. 'Advance Category' basically means that at the end of each category - which in your case would mean each folder in turn - playback moves on to the next one, and so on until the whole library has been played. Then playback starts again at the beginning, playing forever - effectively meaning 'Repeat All'.
>
> I've been suggesting for a while that when Max gets a chance it might be worth rewording that icon, so we end up with slightly easier to understand terms and more self-explanatory options:
>
> Play One Song --- Play current song and then stop
>
> Play Category --- Play current Category (e.g. current folder or album) and then stop
>
> Play All Categories --- Play through all Categories and then stop
>
> Repeat Song --- Repeat current song forever
>
> Repeat Category --- Repeat current Category (e.g. current folder or album) forever
>
> Repeat All Categories --- Listen to all Categories (every album/folder/playlist/etc) and Repeat forever [This is what 'Advance Category' currently does]
>
> Andre

### 2.8 术语「Category」的成因与改写建议（21714）

> **#comment-99676** · 2021-07-30 · **andrewilley**（开发者/管理员 Andre）
>
> The problem is that it's only a 'Shuffle Folder' mode if you happen to be listening to Folders in the first place. If you are listening by Album it is a 'Shuffle Album' mode, and so on with Artists, Genres, Years, etc. Hence the use of the general term "Category" to mean whatever library category you are currently listening to.
>
> If you want to shuffle just the current folder (or album etc) start playback from that Library Category and then use the Shuffle icon to enable either the 'Shuffle Songs' or the 'Shuffle Songs and Categories' mode. Both modes will initially do what you want and play the entire contents of the current folder in randomised order, but the difference is what happens after the current folder is finished - in the first case, PA simply moves on to play the next folder in order and randomises the contents of that folder, while in the second case its pick another folder at random to play the contents randomly.
>
> For more info on Categories, and all the available Shuffle and Repeat modes, please see:
>
> Andre
>
> [EMBEDDED KB ARTICLE] http://web.archive.org/web/20241208121323if_/https://forum.powerampapp.com/kb/en_us/faq/how-to-use-%E2%80%98repeat%E2%80%99-and-%E2%80%98shuffle%E2%80%99-in-poweramp-r4/?do=embed

> **#comment-100062** · 2021-08-10 · **andrewilley**（开发者/管理员 Andre）
>
> Glad you've got your setup working as you wanted now.
>
> 4 hours ago, John Gunner said:
>
> I found "Repeat Advance Category" a confusing term since it doesn't really Repeat but rather Continues to play songs within the Category.
>
> This has been a common area of confusion for new users for a long time. It's a historical throwback to the early days of Poweramp v2, when there were less options for this control. What it indicated was what should happen next after the current song or category list (which could be the current Album, or Folder, or a Playlist, etc) finishes: should it repeat, stop, move on to the next album/folder/playlist, etc. However with newer additions (such as 'play one song') the 'Advance Category' term in particular can get a bit confusing for new users.
>
> For what it's worth, I've been suggesting for some time that the wording of that button would make much more sense if it was re-phrased a bit to be more consistent and logical, something like:
>
> Play One Song
>
> Play Current Category
>
> Play All Categories
>
> Repeat One Song
>
> Repeat Current Category
>
> Repeat All Categories
>
> Additionally, it would be even better if the button (and the Shuffle button beside it) could display wording based on the current playback mode, instead of only using the word 'Category' which often causes confusion. So if you were listening to an Album, the word 'Category' would be dynamically changed to display as:
>
> Play One Song | Play Current Album | Play All Albums | Repeat One Song | Repeat Current Album | Repeat All Albums
>
> Or during Folder playback it would show as:
>
> Play One Song | Play Current Folder | Play All Folders | Repeat One Song | Repeat Current Folder | Repeat All Folders
>
> Or while listening to a Playlist:
>
> Play One Song | Play Current Playlist | Play All Playlists | Repeat One Song | Repeat Current Playlist | Repeat All Playlists
>
> No real code changes to the way Poweramp actually works during playback, just some minor tweaks to the way the buttons are worded. Just my little pipe-dream anyway, maybe Max will find time to look into it sometime?
>
> Andre

### 2.9 专辑封面点按跳转 / 手势可配置化（21984）

> **#comment-100846** · 2021-09-01 · **andrewilley**（开发者/管理员 Andre）
>
> Tapping on the artwork area is the main method for getting from the Player Screen to the currently-playing songs list (although you can also drag the whole player screen down to do the same thing, but tap is easier).
>
> Personally, I just disable anything that overlays the artwork area anyway (such as moving the title/artist/album lines below the cover art, and disabling the menu button and the rating stars/thumbs) in order to avoid such finger-misses. It looks better too.
>
> If you do end up in the songs list by accident, just tap on the mini-player at the bottom of the screen to go straight back to the Player Screen, no need for repeatedly tapping Back or swiping your way out.
>
> Andre

> **#comment-100849** · 2021-09-01 · **andrewilley**（开发者/管理员 Andre）
>
> No, a skin can't change main app functionality, only the look and placement of items.
>
> There quite an old Feature Request asking for the ability to user-customise some of the controls on the Player screen though - including the Visualization/Sleep-Timer/etc icons, and altering the swipe gestures and the tap/long-press functionality - which perhaps one day may make its way up the to-do list?
>
> Andre

> **#comment-100852** · 2021-09-01 · **andrewilley**（开发者/管理员 Andre）
>
> 1 hour ago, TheBestPessimist said:
>
> I would like a toggle
>
> `Look and Feel -> Player UI -> Tap Album Art goes to Playlist`
>
> As there is another current thread which refers to changing category by vertical swipe on the artwork area - just like horizontal swipe currently changes track - and previous threads asking for the swipe feature to be removed completely for accidental activation reasons (like you), I think it would be more useful to have several choices for each gesture/press action, such as the following suggestions from previous threads (current features are shown in bold):
>
> Horizonal Swipe Action: Change Track | Change Category | Library Category/Songs View | Volume | FastForward/Rewind | None
>
> Vertical Swipe Action: Change Track | Change Category | Library Category/Songs View | Volume | FastForward/Rewind | None
>
> Tap Action: Library Songs View | Song Options | Play/Pause | Mute | Delete | None
>
> Long-Press Action: Library Songs View | Song Options | Play/Pause | Mute | Delete | None
>
> Andre

---

## §3 从讨论中提炼的要点

### 3.1 需求边界（用户真正想要什么）

1. **「看见即将播放的序列」≠「看见队列」**。多个帖子的用户要的是：当前位置在中间、**上方是已播历史、下方是待播**的一条扁平列表，并且**无论当前用的是 Category / Queue / Playlist**。Andre 在 #comment-91600、#comment-94662、#comment-95017 反复把这个需求收敛成同一个描述（原文见下）。

> **#comment-94662** · 2021-02-15 · **andrewilley**（开发者/管理员 Andre）
>
> 4 hours ago, Someguyonline said:
>
> I am assuming you guys are talking about adding something like this one Spotify has? I would be all for that!
>
> Yes, we are discussing the idea of displaying a simple flattened list showing the entire current playback session. It would be formatted very much like the All Songs list with the currently playing song in the middle of screen, previously played songs listed above, and forthcoming songs listed below. This would work regardless of whatever Category, Repeat or Shuffle modes you are using.
>
> Andre

> 用户侧最完整的表述来自 #comment-94913，明确区分了「预视」与「剔除」两件事：

> **#comment-94913** · 2021-02-21 · **juvell**（普通用户）
>
> +1 for this, would love the ability to look ahead when shuffling a playlist/album/all songs and remove certain specific tracks. Poweramp must already know somewhere what's coming next when shuffling (presumably it knows the full list of what songs are coming and in what order), so giving the user control over this queue would be great. As others have said, this is the only "standard" music player feature that Poweramp lacks, and the one that makes me want to change to other apps the most.
>
> I'm used to the one from Google play music (rip), but other apps (Spotify, musicolet) have this ability, so anything like that would make this the perfect app.
>
> I know it's possible to work around by selecting all tracks I want to shuffle (e.g. all songs), adding them to the queue, in queue re-sorting the list with a random order, and then removing songs, but this is a lot of steps to achieve something that is usually one button.
2. **「重排」有两种强度**，必须区分：
   - **临时重排**：移动待播项、删除不想听的（用户 #comment-94913 明确要求）
   - **持久重排**：Re-Sort / Shuffle 会**物理改写列表本身**，会丢掉原有排序（Andre #comment-91600 专门警告）
3. **插入位置是独立维度**：顶部 / 底部 / 随机散插，且有「选中项作为一整块插入」与「拆散逐首插入」的区别。二者的实测差异由用户原话给出：

> **#comment-105438** · 2022-01-29 · **Si64**（普通用户）
>
> With regards adding to a shuffled playlist, it kind of does what you said, but not particularly well. I'll try to explain.
>
> So, as a test run, I selected two albums from the library and created a new playlist from them. I then launched the newly created playlist in 'shuffle just songs' mode, and off it goes.
>
> I then go back to the library and add a couple more albums to the new playlist, which is playing in shuffle mode, and the two new albums are added, but when I scroll through the progress of the playlist, the new albums seem to appear somewhere in the middle of the sequence, but are still in order as complete albums, so not shuffled.
>
> So, when I add a new album to an active shuffled playlist, it adds the album in a random position, but as a complete unshuffled album. When that new album gets to the end, the previously shuffled playlist continues.
>
> The only way for the new tracks to be shuffled into the existing playlist, is to reshuffle, which then means starting the playlist again and you get repeat plays.
>
> It's kind of hard to explain what I'm getting at, but does that make sense? Basically, when adding multiple tracks to a shuffled playlist, the newly added tracks aren't shuffled.

> **#comment-109616** · 2022-05-26 · **GeilerHeinz**（普通用户）
>
> I just tested to randomly insert songs of a few albums to the queue list by just selecting whole albums and click Queue shuffled?
>
> Right now this results in a queue list of correct ordered sequences of album tracks. Is this the desired behaviour?
>
> To get what I want I can of course Re-sort the Queue list with Shuffle (random sort) option afterwards. Songs of newly added albums are then randomly inserted to the Queue list if using the button Queue shuffled again.
>
> Regards
4. **插入点必须考虑播放位置**：Andre 明确提出「若列表正在播放，插入点应在**当前播放项之后**，而不是列表字面顶部（那已是历史区）」（#comment-107085 Edit、#comment-108086）。
5. **多选整块拖动**被反复索要（17208、22022、19725），且要求伴随「区间多选」（长按首项 → 滚动 → 长按末项全选中间）。

### 3.2 官方态度（分级）

| 需求 | 官方态度 | 证据 |
|---|---|---|
| Now Playing / History 扁平列表 | **未采纳**。Max 定性为「目标列表本身就是 now playing」，Queue/Playlist 已覆盖 | #comment-95012；Andre #comment-94652 承认「未见到 dev 任何反馈」 |
| 入队位置（顶部/底部/随机散插） | **已实现**（playlist，beta 934） | #comment-107979 |
| Queue 的「插入到开头/随机」 | **技术上可行但暂不做**：无 UI 空间、queue 按钮是一键式 | #comment-107979 |
| 多选整块拖动 | **进 backlog**（grid + list 双模式拖拽实现成本高） | #comment-108401 |
| 追加歌曲后重新洗牌并入 | **承诺做**，需配新的 shuffle 逻辑（未播放优先等） | #comment-105478 |
| 术语 Category 改写 | 长期认同、长期未做 | #comment-90598、#comment-100062 |

### 3.3 技术约束（实现时必须遵守的既有不变量）

1. **播放顺序来自「Library Category + 其 List Options 排序」**，而 Queue/Playlist 是唯一可被**持久重排**的容器（#comment-91600）。这是 Poweramp 的核心模型，UI 不能假装所有分类都可拖拽。
2. **Shuffle 顺序是预先整体生成的**，因此「按 shuffle 顺序查看」可以通过 `List Options > By Shuffle Order` 实现只读回看，但**不能局部改动**该顺序（改只能整体 re-shuffle）。
3. **Queue 是 transient（一次性）**，用尽即退出；「永久队列」的概念由 Playlist 承担（#comment-92965）。
4. **插入到「列表顶部」在 Queue 语境下是反直觉的**：顶部是已播历史，插入后永不播放；正确语义是「下一个未播位置」（#comment-108086、#comment-108088）。
5. **交互成本约束**：Queue 按钮被设计为**无中间弹窗的一键动作**，因此增加多选项会与既有交互哲学冲突（#comment-107979）。
6. **长按复用既有按钮**是团队偏好的低成本扩展方式（长按 >>Queue / +Playlist 弹出三选一），而非新增按钮（#comment-101058、#comment-107085）。

---

## §4 抓取失败的帖子及原因

| 帖子 slug | 情况 | 原因 |
|---|---|---|
| `23036-request-add-shuffled-to-playlist` | **已成功抓取**（7 条评论，完整单页） | 初次抓取 502，改用 CDX 精确时间戳 + `id_` 原格式 + 退避重试后成功 |
| `19240-now-playing-listqueue-feature` | **部分**：仅抓到第 1 页（25 条）；全文标注 *Page 1 of 4* | `?page=2`、`?page=3`、`?page=4` 在该快照下均返回 **404 NOT FOUND**（Wayback 未存档分页）；另该帖互动统计显示 93 条回复，故 **第 2–4 页内容未取证** |
| `22022-insert-new-songs-on-top-of-the-playlist-rather-than-below` | **部分**：仅抓到第 1 页（25 条）；全文标注 *Page 1 of 2* | `?page=2` 返回 **404 NOT FOUND**；该帖互动统计显示 27 条回复，故 **第 2 页约 2 条内容未取证** |
| 其余 7 帖 | 完整 | 均为单页，已全量解析（`20035`/`21714`/`21984`/`20240`/`23036`/`17208`/`19725`） |

**其他抓取说明（如实记录）**

- Wayback `/wayback/available` 与 CDX 接口在本次抓取中多次返回 **502 Bad Gateway** 与 **429 Too Many Requests**；最终通过「CDX 取精确 timestamp → 用 `{ts}id_/{原URL}` 直取原始 HTML → 逐页 45–90 秒退避」完成。
- `19240`（4 页只到第 1 页）与 `22022`（2 页只到第 1 页）存在**分页未取证**，因此 §1 表中的评论数是**已抓到的评论数**，不是该帖总回复数；真实总量见各帖互动统计（`19240`=93 条回复 / `22022`=27 条回复 / `23036`=7 条回复，后者已全量抓到）。
- 正文中若含嵌入的 KB 文章 iframe，已标注为 `[EMBEDDED KB ARTICLE] <url>`，其正文未展开抓取（不影响本帖论点）。
- 所有引述的日期为页面 `<time datetime>` 属性的 UTC 值（原始格式 `YYYY-MM-DDTHH:MM:SSZ`），本文按 UTC 日期显示。
