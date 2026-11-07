---
doc_id: "TEST-YEAR-LIBRARY"
title: "媒体库年份双路径独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-03"
updated: "2026-11-04"
source_documents:
  - "user request: 按 Poweramp 年份页面逻辑及 Figma 设计实现年份分类"
  - "user request: 年份根菜单仅保留选择文件夹、重新扫描、列表选项；缺失曲目年份继承完整专辑最早有效年份"
  - "user request: 同目录同名专辑缺少 ALBUMARTIST 时按专辑合并，修复明日方舟 OST 缺年歌曲仍落入未知年份"
  - "user request: 年份分类隐藏经专辑继承后仍无有效年份的歌曲与专辑"
  - "user request: 年份专辑统计条靠左与标题对齐，年份全部歌曲头图边距与专辑页一致"
  - "user request: 年份子页内容边距对齐头图、全部歌曲入口改圆角方形、分类切换保留侧栏滚动位置"
  - "user request: 年份歌曲入口及头图统一为所有年份歌曲，补充歌曲快速索引"
  - "user request: 年份及三贡献者全集入口悬停和焦点边界与下方专辑行统一"
  - "user request: 中等行状带图专辑布局改为条目背景外框与头图对齐，封面内缩"
  - "user request: 补齐大行状带图及小行状带图，四类专辑页所有带图行统一外框对齐"
  - "user request: 三贡献者专辑页的头图至全集入口间距与年份页保持一致"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=9190-8873"
  - "docs/architecture/year-library.md"
  - "docs/architecture/poweramp-category-views.md"
  - "src/features/player/model/yearLibrary.model.test.mjs"
  - "src/features/player/components/yearLibrary.browser.test.mjs"
---

# 媒体库年份双路径独立验证

## 摘要

Test Agent 独立执行年份模型及真实 PlayerShell 浏览器验证。最新规则先按完整专辑继承年份，再隐藏仍无有效年份的歌曲与专辑，年份分类不再提供“未知年份”分支。四组模型 44/44 通过；640×1440 最新完整浏览器套通过，确认混合曲库无未知年份、全未知曲库显示既有空状态、旧未知位置回根、其他分类仍保留原始成员，以及同目录 OST 两曲继承 2022 后仍完整可播。根菜单、计数/时长、排序和共享面板邻接下钻继续通过。以下较早验证记录保留追溯，其中“未知年份可见”的旧预期由末节最新复验取代；本轮未重复宽屏及动效全套。

本轮年份功能和上述邻接路径通过。既有贡献者浏览器整套因局部搜索断言与已有全局搜索行为不兼容而未通过，详见“发现”。原生命令采用模拟传输，本报告不能证明真实磁盘标签读取、音频解码或硬件声音输出。

## 范围

年份根、年份专辑、该年份全部歌曲、年份内专辑歌曲，以及派生年份、子层独立排序、播放、选择、返回、重扫和异步清理。年份根更多弹窗仅有“选择文件夹 / 重新扫描 / 列表选项”，没有排序和置顶入口；保留旧根排序缓存读取及默认降序。视觉目标为指定 Figma 根页；其他页面仅检查复用行为及可用性，没有推定未提供的独立设计稿。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；架构由 Architecture Agent 实施前提供。
- 测试运行实际 `PlayerShell`、`PlayerSurface`、`AlbumLibraryPanel` 和外观 Provider，仅替换既有 Tauri command/event 传输。
- 九首可见唯一曲目覆盖跨目录混合年份专辑、重叠扫描根、缺失/无效年份、摘要错误；隐藏根额外包含 2027 曲目，验证其不会贡献分类。
- 混年专辑三曲为 2018、2019、无年份；实际播放水合故意返回 1999，用于反证播放后标签污染。
- 新功能无历史缺陷复现基线。测试独立验证成员规则及原始播放身份；未将实现者自测当作独立通过依据。

## 命令

Test Agent 独立执行：

```powershell
node --test src/features/player/model/albumLibrary.model.test.mjs src/features/player/model/artistLibrary.model.test.mjs
# 实施前基线：22/22 通过

node --test src/features/player/model/yearLibrary.model.test.mjs src/features/player/model/albumLibrary.model.test.mjs src/features/player/model/artistLibrary.model.test.mjs src/features/player/model/contributorLibrary.model.test.mjs
# 最新调整后：41/41 通过，其中年份模型 13/13

$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/fallback-test-640'
node src/features/player/components/yearLibrary.browser.test.mjs

# 以下两次是初版验证，本轮未重复。
$env:SPMUSIC_TEST_WIDTH='1280'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/test-1280'
node src/features/player/components/yearLibrary.browser.test.mjs

$env:SPMUSIC_TEST_WIDTH='640'
$env:SPMUSIC_TEST_MOTION='1'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/test-motion-640'
node src/features/player/components/yearLibrary.browser.test.mjs

npx eslint src/features/player/model/yearLibrary.model.test.mjs src/features/player/components/yearLibrary.browser.test.mjs
git diff --check
```

上述最终运行退出码均为 0。Vite 为 `http://127.0.0.1:5173`，浏览器为 headless Microsoft Edge。最新 640px 套包含完整原有流程、新增年份补齐断言、三项根菜单和补齐后未知年份消失的重扫场景；1280px 和动效套为初版运行记录。

- `npm run lint` / `npm run build`：主代理最终执行并报告通过；本 Test Agent 未重复整仓运行。
- `cargo check` / `npm run tauri dev`：未运行；本轮没有 Rust 或原生命令契约变更。
- `node src/features/player/components/contributorLibrary.browser.test.mjs`：独立运行失败，见下文；未修改旧测试或生产代码绕过此失败。

## 人工检查

Test Agent 通过图像工具实际查看 Figma 原图、最终 640px 根页/年份专辑截图及 1280px 专辑歌曲截图。根页动态曲目和封面使用测试数据；没有把设计稿中的示例年份、曲目数或封面图写入产品数据。

根页浏览器几何与资产断言通过：

| 检查项 | 实测 |
| --- | --- |
| 分类圆形与其图标 | 84×84 / 48×48px |
| 年份标题 | 57px 字号 / 64px 行高 |
| 更多按钮与图标 | 64×64 / 48×48px |
| 年份行 / 封面 | 88px 行高 / 64×64px |
| 封面圆角 | 20px |
| 行标题 | 24px 字号 / 32px 行高 |
| 封面至文案距离 | 24px |
| 统计图标 | 16×16px |
| 640px 首封面坐标 | x=25、y=364 |

新增 `1fed4.svg`、`36e6f.svg`、`1e93b.svg` 均为非空本地文件，测试将实际运行时 mask/src 与对应本地 import 值精确比较。缺封面显示现有本地图标后备。640/1280 根页均没有页面横向溢出。既有底部播放控制器、宽屏侧栏等未提供设计变更的区域仅观察，不纳入根页视觉修改。

初版截图位于仓库外三个 `test-*` 目录。最新截图位于 `D:/spmusic-artifacts/year-library/fallback-test-640/`，包含 `year-root.png`、`year-root-more.png`、`year-albums.png`、`year-album-tracks.png`、`year-all-songs.png`、`year-global-search.png` 和 `year-empty.png`。Test Agent 已实际查看最新三项菜单截图。

## 根因与因果链反证

- 最新规则下，2018 全部歌曲包含 mixed-a、mixed-c、solo，mixed-c 原标签仍为 null；年份根统计及全年歌曲头图均为 3 首 / 9:00。2018 的 Mixed 专辑详情包含 mixed-a、mixed-b、mixed-c，实际播放队列亦为完整三曲。
- 2019 全部歌曲只有 mixed-b，该年份没有 Mixed 专辑；排除“先筛曲目年份再聚合专辑”的替代实现。
- 未知年份全部歌曲仅含无可继承年份的 unknown、invalid 及完成但读取失败的 bad，不含 mixed-c。完整专辑全无有效年份时仍为未知，pending 尚未完成时不继承、不创建未知年份行。
- 年份根单选 2018 的实际队列为 mixed-a、mixed-c、solo；多选 2018/2019 的实际队列为 mixed-a、mixed-b、mixed-c、solo，重叠根不产生重复成员。全年歌曲播放同样为该视图的派生成员。
- 新增同名专辑不同艺术家 A/B/C 的模型反证：缺年歌曲只继承对应完整专辑最早有效年份，不能借用同名其他艺术家的年份。冻结对象与严格引用相等断言证明原始标签、scope/trackId、对象身份不变，已有有效年份不被专辑年份覆盖。
- 全库 `yearEffectiveYears` 提供给子集的年份排序：缺年曲 c 派生为 2018，与显式 2018 采用标题次序，不被当作 raw null 排到末尾。模型另外反证缺少已知年兄弟曲目的排序子集仍可读取全库派生年。
- 三个子层排序可操作且分别保存；根旧缓存仍可读取，根菜单不再暴露排序和置顶。模型保留四个存储作用域的兼容验证、坏 JSON 和存储异常检查。
- 全年歌曲页搜索按钮遵循既有全局搜索：搜索 mixed-a 只出现一个真实结果，随机播放候选亦只有 mixed-a；关闭搜索后保留原年份歌曲位置。没有将局部列表过滤作为产品行为。
- 播放水合返回 1999 后，曲库 `libraryYear` 仍由原始摘要决定，没有 1999 分类污染。

## 跨层契约

独立核对 Rust `AudioPlaylistTrackTagSummary.year: Option<u32>`、前端摘要类型/mapper、`libraryYear` 与 `PlayerShell` 的原始字段覆盖顺序。年份加入现有摘要、时长与歌曲分类门控；命令名称、事件、权限和来源类型没有变化。浏览器断言实际调用既有 `audio_load_and_play`，没有新增伪播放接口。

## 回归覆盖

- 专辑歌曲 → 年份专辑 → 年份根的返回，以及播放器往返保持年份/视图/专辑位置。
- 完成重扫后保留年份位置；重扫临时空投影不提前清理；清空库后返回根空态；晚完成摘要不复活已清空数据。
- 新增“未知年份补齐后消失”：最初两首全无年份的 Mixed 专辑停留未知年份，重扫期间保留位置；更新一首为 2018 后，完整两首都归入 2018，未知年份在稳定完成后消失并回年份根，根统计为 2 首 / 6:00。
- 最终 640px 尾段独立进入全局专辑、艺术家、专辑艺术家、作曲家，分别下钻 Mixed 专辑并核对完整三成员。
- 邻接模型 28 项加年份模型 13 项通过。全局搜索实际结果及播放接线在年份浏览器套覆盖。

## 性能 / 时序

本次不宣称性能提升；覆盖 pending、重扫、清空后晚完成以及启用动效的重复导航/播放器往返。动效几何检查等待实际布局变换收敛，未加入任意延时。未开展大曲库吞吐、内存、长时间封面租约或真实原生并发压力测试。

## 发现

1. 年份封面圆角被后写 `.album-card` 的同优先级变量覆盖为 10px。已退回 Frontend Agent，将年份规则改为 `.year-card.album-card`；修复后所有最终几何断言均为 20px，发现关闭。
2. 首轮浏览器按旧局部搜索假设等待年份列表过滤；实际进入全局搜索。主代理确认沿用现有行为，测试改为验证真实全局结果、播放候选和返回位置，没有修改产品。
3. 既有贡献者浏览器在第 161 行等待当前集合面板内 searchbox 超时，页面已打开全局搜索；无 pageerror。`git show HEAD:src/features/player/components/PlayerSurface.tsx` 已有 `LibrarySearchContext.Provider` 的全局路由逻辑，因此此失败与本轮新增年份分支无直接因果证据。旧脚本整套未通过；未扩大写集修改该脚本。已用当前真实 Shell 的四类邻接下钻和全局搜索验证补足本轮相关路径，不能宣称旧贡献者整套通过。

## 风险

没有验证 Tauri 实机标签提取、真实用户曲库图片、音频解码和硬件输出；测试中的原生传输为模拟实现。Poweramp 的专辑年份生成算法未取证，当前实现按批准架构沿用 SpMusic 全库专辑最早有效年份规则。既有贡献者浏览器的局部搜索断言仍需其 Owner 在独立测试维护任务中更新。

## 临时缓解

无。未修改生产代码掩盖测试失败，未放宽业务成员、队列或持久化断言。

## 验证结论

最新年份页面、完整专辑缺年补齐、双路径成员、三项根菜单、播放接线、子层排序与根缓存兼容、生命周期和根页设计几何通过，圆角发现已关闭。共享面板的四类指定邻接下钻通过；旧贡献者浏览器整套未通过并保留明确原因。主代理可据此验收本轮前端实现，原生硬件能力不属于本报告通过范围。

## 同目录不同曲目艺术家专辑修复复验（2026-11-03）

### 实现交付与独立基线

Frontend Agent 修改共享 `albumLibrary.ts` 的命名专辑身份。显式 ALBUMARTIST 使用专辑名与规范化署名，仍可跨目录聚合；缺失或空白 ALBUMARTIST 使用专辑名与规范化直接目录，不再用 ARTIST 拆分。年份派生模型复用该最终成员，没有增加按专辑名称跨组借年份的补偿。

Test Agent 只读解析 `E:/Music` 的两个实际容器，独立核对实现者证据：

| 文件 | 专辑标签 | 曲目艺术家 | 专辑艺术家 | 年份 |
| --- | --- | --- | --- | --- |
| Mentalmeisters - 「吾导先路」殉道者（第五个）.flac | 《明日方舟》游戏原声OST | Mentalmeisters | 无 ALBUMARTIST | DATE=2022 |
| 塞壬唱片-MSR - 「如我所见」夜幕.mp3 | 同上（TALB） | 塞壬唱片-MSR（TPE1） | 无 TPE2 | 无 TYER/TDRC |

采用 Node 直接解析 FLAC VorbisComment 和 ID3v2 标签，未修改音乐文件。替代假设“ALBUMARTIST 或年份在前后端映射中丢失”未获支持：原始文件本身缺少这些字段，Rust 摘要与水合均读取同一 `ItemKey::AlbumArtist` / `tag.date()`，前端保留原始空值。

Test Agent 在内存中分别加载 HEAD 的旧 `albumLibrary.ts` 与工作区版本，搭配相同当前年份模型及原始标签等价输入：旧实现输出 2 个专辑、年份 `[2022, null]`、每专辑 1 首；新实现输出 1 个专辑、年份 `[2022]`、专辑 2 首，原始缺年仍为 null。该独立前后对比确认首个错误状态是专辑成员被 ARTIST 拆开，修复在成员来源完成。

### 命令与结果

Test Agent 独立执行，均退出 0：

```powershell
node --test src/features/player/model/albumLibrary.model.test.mjs src/features/player/model/yearLibrary.model.test.mjs src/features/player/model/artistLibrary.model.test.mjs src/features/player/model/contributorLibrary.model.test.mjs
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/mixed-artists-640'
node src/features/player/components/yearLibrary.browser.test.mjs
```

模型 44/44 通过；完整 640×1440 Edge 浏览器套通过。主代理另外运行 `npm run lint`、`npm run build` 均通过，属于主代理证据，未记为 Test Agent 独立运行。未改 Rust、command/event、权限或依赖，未重复 cargo 和硬件检查。启动的 Vite 会话 37590（监听 PID 22952）已 Ctrl+C 停止，5173 不再监听。

### 回归与人工检查

- 真实标签等价 fixture 的年份根只有 2022，歌曲数 2；年份专辑及全局专辑均为一个完整 OST，详情保留两首，播放队列使用 `martyr`、`nightfall` 原始 ID。
- 全年歌曲同样为两首；播放水合故意返回 1999，仍未覆盖摘要原始年份，缺年成员 `libraryYear` 保持 null。
- 两个艺术家下钻各保留本人歌曲，不引入另一艺术家的成员；其专辑 key 由同名与同目录决定，作用域年份、署名、封面和时长仍由本作用域成员计算。
- 模型反例验证同名不同目录不借年份、显式专辑艺术家不与缺失值桥接、不同显式署名隔离、显式同署名跨目录、空白署名、路径分隔符、乱序、重叠根去重、pending 与已有有效年份不改。
- 旧完整浏览器中的根菜单、年份双路径、选择播放、独立排序、全局搜索、重扫、未知年份消失及延迟摘要清理继续通过；无 pageerror 或 console error。
- 截图位于 `D:/spmusic-artifacts/year-library/mixed-artists-640/`；已实际查看 `year-mixed-artists-album.png`，显示 2022、合并署名、两曲与各自艺术家，布局正常。

### 风险与结论

本次批准范围通过，属于根因修复。没有写入原始标签，也没有把 pending 当未知。无 ALBUMARTIST 的同名专辑在不同目录仍分开；若同一目录实际放入多个同名发行且均无专辑艺术家，本轮批准规则会将其聚合，这是规则边界而非已验证的发行鉴别能力。原始容器标签已只读取证，浏览器原生传输仍为模拟；本报告不声称验证打包桌面应用、真实解码和硬件声音输出。历史贡献者搜索整套未通过的记录保留，不影响本次已实际验证的下钻路径。

## 隐藏未解析年份的最新复验（2026-11-03）

### 范围与实现证据

用户进一步要求年份分类隐藏经过专辑继承仍无年份的歌曲与专辑。本次是已批准的显示规则变更：`yearEntries` 排除有效年份 map 的 null 和 undefined；`yearAlbums(albums, null)` 返回空数组。`yearEffectiveYears`、原始标签、全库成员、专辑聚合身份与 `YearLocation` 类型保持原状。保留旧 null 导航类型仅用于既有位置的清理，稳定数据下仍由 `AlbumLibraryPanel` 现有失效位置 effect 返回年份根，不增加强制刷新、延时或删除曲库数据。

Test Agent 独立核对生产逻辑与原有 effect，反证“只隐藏根行，旧详情或播放仍可进入未知年份”和“从底层库删除无年歌曲”两种风险。以下浏览器断言实际覆盖旧 null 的 albums/songs 位置、已知年份丢失、全局专辑成员与原始 allSongs 数量；模型直接验证空的 null 专辑入口。Frontend Agent 提供的新全未知失败基线为修复前输出未知年份实体、期望空数组；此失败命令由实现者执行，Test Agent 没有把它记为独立执行证据。

### 独立命令

```powershell
node --test src/features/player/model/albumLibrary.model.test.mjs src/features/player/model/yearLibrary.model.test.mjs src/features/player/model/artistLibrary.model.test.mjs src/features/player/model/contributorLibrary.model.test.mjs
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/hide-unknown-640'
node src/features/player/components/yearLibrary.browser.test.mjs
npx eslint src/features/player/components/yearLibrary.browser.test.mjs
git diff --check
```

上述独立命令均退出 0，模型 44/44 通过，完整 640×1440 Edge 浏览器套通过且无 pageerror 或 console error。主代理另行运行本轮 `npm run lint`、`npm run build` 通过。Test Agent 启动的 Vite 会话 9878 已 Ctrl+C 停止，随后确认 5173 无监听。

### 验收结果

- 混合曲库根只显示 2026、2019、2018、2017；原始 9 首唯一歌曲未减少，继承的缺年歌曲仍计入 2018 的歌曲数、时长及播放候选。
- 稳定状态下主动恢复旧 `{ year: null, view: 'albums' | 'songs' }` 均返回根页；浏览已知年份后仍无未知入口。
- 全未知双曲库显示“暂无年份”，不是未知年份卡；切换全局专辑仍可访问同一完整双曲专辑。`Invalid`、`Unknown` 和摘要失败对应的未知专辑也仍在全局专辑列表。
- 重扫期间不提前清理旧位置；完成后 null 位置回根。全未知取得有效年后出现 2018，成员 2 首；再次丢失最后有效年后回到空年份根，其他分类的双曲专辑仍完整。
- 原始同目录 OST 场景仍只有 2022，全年歌曲与专辑详情均有两首，播放身份和缺年 raw null 未改；艺术家各自只展示本人歌曲。
- 原有根菜单三项、设计几何、排序、选择播放、全局搜索、重扫与延迟摘要清理继续通过。已查看 `hide-unknown-640/year-all-unknown-empty.png`，空页布局正常。

### 结论与限制

本轮通过。排除仅作用于年份分类的派生输出，未删除或改写音乐数据，也未影响专辑继承后有有效年份的成员。既有异步保护继续生效。浏览器仍使用模拟原生传输，未重复验证打包应用、真实解码、硬件声音输出或宽屏动效；本轮没有新增这些能力或变更其契约。

## 年份子页头图与统计条视觉复验（2026-11-03）

最终验收按用户最后纠正执行：专辑页统计条靠左，与年份标题左缘一致，不水平居中；年份专辑页和该年份全部歌曲页的头图在相同窗口、侧栏条件下位置与尺寸一致。仅检查 Frontend Agent 的两处年份 CSS 规则，未修改生产代码、共享主题或其他分类选择器。

根因代码复核：歌曲页父容器原继承 folder hierarchy 的窄窗 16px／宽窗 25px padding，专辑页已清零；相同头图自身 margin 在父级不同 padding 上得到不同边界。桌面共享统计样式 `align-self: center` 使专辑页统计胶囊居中；新年份限定规则采用 `flex-start`。此次未在运行中回退生产 CSS；修复前证据为用户截图、此前源码读取及继承路径，修复后结果由独立实际 DOM 几何断言和截图证明。

Test Agent 扩展既有浏览器脚本读取 `getBoundingClientRect()`，断言两页头图 x/width/height 相同，专辑页 meta/title/copy 左缘相同，统计条在标题和动作之间无重叠，音符在统计条内垂直居中。测试没有按 CSS 声明复制预期布局算法，侧栏是否显示也从实际 DOM 读取。

| 窗口宽度 | 实际侧栏 | 两页头图 x | 两页头图宽 | 两页头图高 | 专辑标题／统计条左缘 |
| --- | --- | --- | --- | --- | --- |
| 640 | 无 | 25 | 590 | 320 | 35 |
| 1440 | 有 | 345 | 1070 | 320 | 355 |
| 1920 | 有 | 345 | 1550 | 320 | 355 |

独立执行均退出 0：

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/hero-alignment-640'
node src/features/player/components/yearLibrary.browser.test.mjs
$env:SPMUSIC_TEST_GEOMETRY='1'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/hero-alignment-desktop'
node src/features/player/components/yearLibrary.browser.test.mjs
npx eslint src/features/player/components/yearLibrary.browser.test.mjs
git diff --check
```

640 完整回归通过，涵盖原有年份数据、排序、播放、专辑及艺术家/专辑艺术家/作曲家下钻、未知年份排除和生命周期检查。桌面专项实际覆盖 1440、1920 两档，未重复整套业务测试；两次运行均无 pageerror 和 console error。已实际查看 `hero-alignment-desktop/year-albums-1440.png`：统计条与 2018 左对齐、音符/计数/时长纵向正常，头图和侧栏边界正常。主代理亦已审阅该图，并报告本轮全仓 lint/build 通过。

结论：指定两处视觉问题通过；其他分类的既有下钻回归通过，但没有把其他分类所有桌面几何声明为已全面验证。原生传输仍为模拟，此 CSS 任务未重复解码/硬件测试。Test Agent 的 Vite 会话 13490 已 Ctrl+C 关闭。

## 内容边距、入口封面与侧栏滚动最终复验（2026-11-04）

三项验收通过。测试在 11 月 3 日晚执行，11 月 4 日恢复后取得遗留 640 完整套最终退出 0 日志；桌面专项和侧栏专项已有成功记录，未重复运行。生产代码由 Frontend Agent 负责，Test Agent 只扩展既有浏览器脚本及本报告。

### 视觉结果

验收以可见封面和文字区域为准，透明卡片外框、网格容器并非对齐基准；tile 最后一行不足整行不要求末张封面顶满右边。实际 DOM 几何如下，尺寸均为 CSS px：

| 窗口宽度 | 头图左缘 | 专辑首封面左缘 | 全部歌曲入口封面左缘 | 歌曲首封面左缘 | 歌曲文字区域右缘／头图右缘 |
| --- | --- | --- | --- | --- | --- |
| 640 | 25 | 25 | 25 | 25 | 615／615 |
| 1440 | 345 | 345 | 345 | 345 | 1415／1415 |
| 1920 | 345 | 345 | 345 | 345 | 1895／1895 |

全部歌曲入口封面保持 125×125，实际圆角为 12，符合圆角方形。专辑 tile 文本区域均位于头图横向边界内；网格容器本身仍可覆盖整个主面板，卡片内部留白不构成可见封面偏移。既有头图同宽同高及统计条左对齐断言也继续通过。

已查看 `D:/spmusic-artifacts/year-library/content-alignment-desktop/year-albums-1440.png` 和 `content-alignment-640/year-all-songs.png`，入口为圆角方形、可见封面与头图左缘一致，文字区域未越过右缘。主代理亦审阅了这两张截图。桌面专项覆盖 1440、1920 的默认专辑 tile 与歌曲 row；640 完整套覆盖同一用户路径及原有业务回归，没有把全部布局级别、字体缩放及真实曲库长文本声明为已全面验证。

### 侧栏根因与独立回归

修复前独立失败：1440×1000 窗口，专辑分类侧栏滚至 438，实际点击年份后主内容正常切换，新侧栏 scrollTop 为 0。原因是分类切换重建侧栏 DOM，各实例没有共享会话位置。最终实现将 desktop／overlay 的分类滚动值放在常驻 owner 的会话 store；导航前及滚动时保存，挂载及隐藏转可见时恢复，退出或隐藏实例不写回。未增加磁盘持久化，也未以组件 cleanup 写回旧位置。

独立验证中发现中间版本“桌面 200 → 窄屏 overlay 切分类 → 回宽屏变 0”，已退回 Frontend Agent。最终 ResizeObserver 版本重新通过 200 → 200，证明隐藏挂载后转为可见也恢复旧桌面存档。

最终专项开启动效，点击前经 Playwright actionability 处理后，记录原生 click 和切换后位置：518 → 518、512 → 512、364 → 364、438 → 438，重复点击当前年份仍为 438。键盘 focus/Enter 可用。四次旧侧栏仍连接、处于退出动画时，向旧节点派发迟到 scroll 均不移动新侧栏，也不污染后续分类存档。主内容实际滚动不改变分类列表，分类列表滚动不改变主内容。overlay 首次为独立 0，跨分类关闭／重开保留自身位置；随后恢复宽屏仍取得独立 desktop 的 200。

曾测到 438 → 518 及 overlay 512 → 435；采样确认变化发生在 Playwright 自动 scrollIntoView 的输入准备阶段，实际原生 click 前位置与切换后相同。正式断言仍要求输入前后严格相同，没有放宽阈值或增加任意延时。

### 执行与最终状态

相同脚本三种模式均退出 0，无 pageerror／console error：

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/content-alignment-640'
node src/features/player/components/yearLibrary.browser.test.mjs
$env:SPMUSIC_TEST_GEOMETRY='1'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/content-alignment-desktop'
node src/features/player/components/yearLibrary.browser.test.mjs
Remove-Item Env:SPMUSIC_TEST_GEOMETRY
$env:SPMUSIC_TEST_SIDEBAR='1'
$env:SPMUSIC_TEST_MOTION='1'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/content-sidebar'
node src/features/player/components/yearLibrary.browser.test.mjs
```

640 完整套保留年份继承、未知年份排除、排序、选择／播放、搜索、其他贡献者下钻、重扫和延迟摘要清理断言。侧栏目录中的历史 `year-failure.png` 来自最终修复前失败，不代表最终结果；最终成功截图为 `sidebar-return-desktop.png`。11 月 4 日独立 `npx eslint src/features/player/components/yearLibrary.browser.test.mjs` 与 `git diff --check` 均退出 0；主代理报告最终全仓 lint/build 通过。

Test Agent 的 Vite 会话 63368 已结束，确认 5173 无监听、原服务 PID 14280 不存在。通过范围为本轮三项用户请求及上述回归，浏览器原生传输仍为模拟，未重复真实解码或音频硬件检查。

## 所有年份歌曲文案与快速索引复验（2026-11-04）

本轮通过。年份专辑页入口与歌曲页头图标题均为“所有年份歌曲”。独立源码基线确认原有索引渲染条件为 `!detail && !yearRoot`，年份歌曲页 `detail=true` 被排除；本轮没有在旧生产版本上取得浏览器失败日志，不将静态基线记为实际失败运行。最终复用 `CollectionQuickIndex`，歌曲页索引从当前排序及筛选后的歌曲名称派生，实际跳转使用与虚拟窗口一致的歌曲索引；共享组件未新增另一套索引逻辑。

Test Agent 在既有浏览器脚本新增专项，使用真实 Shell／面板与模拟原生传输；仅该 fixture 移除全局搜索回调，以运行组件已有的局部搜索分支，其他 fixture 的全局搜索接线保持原样。独立运行：

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_QUICK_INDEX='1'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/song-quick-index'
node src/features/player/components/yearLibrary.browser.test.mjs
npx eslint src/features/player/components/yearLibrary.browser.test.mjs
git diff --check
```

上述命令均退出 0，无 pageerror／console error。640×1000 的 12 首非虚拟列表与 1440×1000 的 600 首虚拟列表均通过；大列表最终仅渲染 8 行，M 字母实际将主滚动容器跳至 37345px 并渲染目标曲目。断言同时检查目标行进入滚动容器与底部控件上方的可见区域，未以索引高亮代替跳转成功。

- M、Z、数字、其他字符（中文尾曲）均跳到对应首个成员，覆盖鼠标和键盘 Enter；“返回列表顶部”恢复 scrollTop=0。
- 不存在的 B 不移动到无关歌曲；降序后 M 使用降序结果的首个 M 成员，未沿用升序下标。
- 局部筛选 Zulu 后，跳转仅定位筛选结果；空筛选下点击字母／顶部仍保持零歌曲，不恢复旧成员。
- 一次中间超时来自两个 fixture 共用已保存降序偏好；测试已在每次 fixture 导航时初始化升序，再独立验证用户切换降序，未改生产代码或放宽目标行断言。

已实际查看 `song-quick-index/year-song-index-1440.png`，右侧索引与“#”预览可见，列表实际到达中文尾曲；主代理也已审阅。按主代理要求，本轮未重复已通过且未改动的几何／侧栏模式，主代理报告最终全仓 lint/build 通过。Test Agent 的 Vite 会话 15410 已 Ctrl+C 停止，5173 无监听。真实磁盘、解码和硬件输出不属于本轮文案／索引验证范围。

## 全集入口悬停与焦点边界复验（2026-11-04）

本轮通过。年份、艺术家、专辑艺术家、作曲家四分支 × 640／1440 两档，共 8 个实际页面通过。fixture 采用既有布局偏好接口将专辑列表设为 row（level 5），逐页真实 hover、键盘 focus 和 Enter 导航；测量入口按钮与同页专辑行的 DOM 边界、圆角、四侧 padding、悬停色和最终焦点框，而非复制 CSS 计算预期。入口因现有 125px 封面自然更高，测试未强制其与 64px 行封面等高或裁切图片。

| 分类 | 640 入口与行横向边界 | 1440 入口与行横向边界 | 共同悬停圆角／内边距 |
| --- | --- | --- | --- |
| 年份 | 10～630 | 330～1430 | 10px／四侧 15px |
| 艺术家 | 0～640 | 320～1440 | 10px／四侧 15px |
| 专辑艺术家 | 0～640 | 320～1440 | 10px／四侧 15px |
| 作曲家 | 0～640 | 320～1440 | 10px／四侧 15px |

八场入口与行悬停背景均为 `rgb(221, 227, 234)`；键盘可见焦点最终均为 3px solid、offset=-3px。第一次即时测焦点取得入口 offset=0、行=-3，后续证实入口按钮的 `transition-all` 正在过渡，不能将该中间帧当最终样式；专项现等待元素实际有限动画 finished 后再测量，没有增加任意延时或放宽相等断言。年份入口封面仍为 125×125、圆角 12，左缘 25／345 与头图一致。其他三类原有圆形封面保留。每场 Enter 后真实歌曲列表出现，导航未失效。

独立命令均退出 0，无 pageerror／console error：

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_ENTRY_HOVER='1'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/entry-hover'
node src/features/player/components/yearLibrary.browser.test.mjs
npx eslint src/features/player/components/yearLibrary.browser.test.mjs
git diff --check
```

已实际查看 `entry-hover-year-1440.png` 与 `entry-hover-artist-1440.png`；主代理另审阅了两张 640 截图。入口悬停区域及圆角、图片周围留白符合对应专辑行，年份可见封面对齐保持。未扩大到所有 tile 密度、索引 600 曲、侧栏等本轮未变动路径；此前这些路径的验证记录保留。主代理报告最终全仓 lint/build 通过，Test Agent 的 Vite 会话 94673 已关闭且 5173 无监听。测试原生传输为模拟，本次 CSS 工作不涉及真实解码或硬件输出验收。

## 中等行状带图的外框基准纠正复验（2026-11-04）

本轮通过。用户最后纠正仅针对 level 4（单列中封面，专辑为 row-wide／medium，155×107 封面）：真实专辑条目与全集入口的背景外框左右应对齐头图，封面在框内保留 15px。该布局的旧“封面左缘等于头图左缘”标准已撤销，不能用于本轮 level 4 验收；level 5、tile、text、年份歌曲页仍按各自已批准规则，本轮未改动。修复前失配由原先 list／entry inset 源码及旧验收标准确认；在生产冻结前未取得旧 level 4 浏览器失败运行，不将源码推断记为实际失败命令。

为避免套用自建参照，既有测试 wrapper 将实际 Shell 的视图模型呈现为当前播放列表，使用现有曲库前三首作为当前 tracks；实际渲染 `OwnedPlaylistPanel`／`PlaylistPanel` 和同一原生传输 fixture，未注入布局 CSS。独立测得播放列表 level 4：640 窗口的 hero／歌曲背景外框均为 16～624，封面 x=31；1440 窗口两外框均为 345～1415，封面 x=360。参照关系明确为“外框相等、封面内缩 15”，而非所有页面必须采用同一个窄窗 margin 数字。

实际中等专辑布局 4 类 × 2 档共 8 场通过：

| 窗口宽度 | 年份／艺术家／专辑艺术家／作曲家：头图、专辑行、全集入口外框 | 封面左缘 | 内部留白 |
| --- | --- | --- | --- |
| 640 | 均为 25～615 | 40 | 15px |
| 1440 | 均为 345～1415 | 360 | 15px |

脚本明确断言 level=4、row-wide、medium，并要求 row 外框等于 hero、入口外框等于 row；年份入口使用外框断言，不接受旧封面对齐基准。悬停颜色、圆角 10、四侧 padding 15 和最终 focus 框相等，Enter 仍打开正确歌曲范围。入口 125×125 封面自然撑开高度，保留年份圆角方形及三贡献者圆形，不强制不同尺寸图片的条目等高。

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_MEDIUM_ROW='1'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/medium-row-frame'
node src/features/player/components/yearLibrary.browser.test.mjs
npx eslint src/features/player/components/yearLibrary.browser.test.mjs
git diff --check
```

以上独立命令均退出 0，无 pageerror／console error。已实际查看 `medium-entry-hover-year-1440.png`，主代理也已审阅；另有两个 `playlist-medium-row-reference-*` 原播放列表参考截图。主代理最终全仓 lint/build 通过。本轮未重复 tile/text、侧栏和大索引专项，Vite 会话 60932 已关闭且 5173 无监听；硬件音频不属于此视觉修正的通过范围。

## 补齐全部带图行档位的最终复验（2026-11-04）

本轮通过。新截图对应 level 3 的 row-wide／large（240×165），前轮仅 level 4 的选择器没有覆盖它；修复前证据为用户截图及旧 `[data-folder-level='4']` 限定规则，本轮冻结前没有取得旧 level 3 的独立浏览器失败日志。最终 CSS 按 `data-folder-flow='row'` 与父级 `data-layout-flow='row'` 匹配，覆盖 level 3／4／5，避免再依靠单个数字档位。该规则不匹配 tile/text，也不匹配年份歌曲页。

按主代理确认的最小矩阵独立执行 12 场，而非机械重复 24 场：640／1440 四分类 level 3 共 8 场，1440 年份与艺术家各 level 4／5 共 4 场。DOM 明确确认三档实际封面分别为 240×165、155×107、64×64，所有场次专辑行与全集入口的外框均等于头图；640 为 25～615、1440 为 345～1415，封面分别从 40／360 开始，框内留白严格为 15。悬停颜色、圆角、四侧 padding、最终焦点框及 Enter 导航均通过，无 pageerror／console error。

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_ROW_MATRIX='1'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/artwork-row-matrix'
node src/features/player/components/yearLibrary.browser.test.mjs
npx eslint src/features/player/components/yearLibrary.browser.test.mjs
git diff --check
```

以上均退出 0。已查看 `row-3-entry-hover-artist-1440.png`，主代理亦已审阅。测试中原 level 5 的“封面等于头图”入口断言已替换，所有带图 row 只接受“背景外框等于头图、封面框内 15px”这一标准；历史 level 5 旧表格仅保留追溯。未重复实际 PlaylistPanel 参考、tile/text、索引或侧栏专项；前轮真实播放列表的外框参照关系仍适用。主代理最终全仓 lint/build/diff-check 通过，Test Agent 的 Vite 会话 19531 已关闭，5173 无监听。

## 头图至全集入口的垂直间距复验（2026-11-04）

本轮通过。旧贡献者 albums 父容器的 `margin-top:0` 覆盖共享间距，上一轮留存的 artist 大行截图入口与 hero 相贴，而年份页已有正间距。修复仅删除该覆盖，让三个贡献者分支复用同一父级间距。

独立 9 场：640／1440 四分类 level 3 共 8 场，另补 1440 artist level 4。每个窗口先从年份页实际 DOM 得到参考值，再断言三贡献者入口背景顶部减 hero 底部等于该值且大于零；九场全部实测 25px。水平外框、行内 padding、hover/focus、Enter 导航继续通过，没有重跑索引、侧栏或 600 曲场景。

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_ENTRY_GAP='1'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/year-library/entry-gap'
node src/features/player/components/yearLibrary.browser.test.mjs
npx eslint src/features/player/components/yearLibrary.browser.test.mjs
git diff --check
```

以上独立命令均退出 0，无 pageerror／console error。已查看 `gap-row-3-entry-hover-artist-1440.png`：hero 底部 360、入口背景顶部 385，实际留白 25，左右边界保持前轮规则。主代理负责全仓 lint/build 最终汇总；Test Agent 的 Vite 会话 33336 已关闭，5173 无监听。此局部视觉复验不涉及真实音频或硬件验收。
