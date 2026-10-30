---
doc_id: "TEST-ARTIST-LIBRARY"
title: "媒体库艺术家分类独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-28"
updated: "2026-10-29"
source_documents:
  - "user request: 实现艺术家分类；进入艺术家默认看专辑，专辑前提供所有歌曲入口"
  - "docs/architecture/artist-library.md"
  - "docs/implementation/artist-library.md"
  - "src/features/player/components/artistLibrary.browser.test.mjs"
  - "src/features/player/model/artistLibrary.model.test.mjs"
  - "user request: 按艺术家内层设计修正所有艺术家歌曲入口和专辑网格"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=8114-18993"
  - "user request: 右侧索引覆盖内容而不预留布局空间；修复部分艺术家封面不加载"
  - "user request: 艺术家头图统计跟随标题左对齐，头图随内容区域扩展"
  - "src/features/player/components/collectionArtworkOverlay.browser.test.mjs"
  - "src/features/player/components/collectionQuickIndexOverlay.browser.test.mjs"
  - "user request: 艺术家头图更多菜单复用详情菜单，专辑字号与全局同布局档一致"
  - "src/features/player/components/playlistHeroMoreMenu.browser.test.mjs"
  - "user request: 更多菜单按内容自然高度展开；头图与对应更多菜单不足一小时省略小时"
  - "src/features/player/components/collectionDurationLabels.browser.test.mjs"
---

# 媒体库艺术家分类独立验证

## 摘要

Test Agent 独立执行艺术家模型、摘要测试及真实 PlayerShell 浏览器验收。456px、1280px、456px 启用动效三种运行均通过；归属、专辑边界、所有歌曲入口、播放候选和异步清理均有运行证据。原生命令采用模拟传输，结论限于前端流程，不替代 Tauri 实机解码和声音输出。

## 范围

艺术家根页、艺术家专辑、艺术家所有歌曲和艺术家内专辑详情。测试新增键盘索引与所有歌曲激活、搜索后的随机候选、无封面资源、空态和重扫保留位置断言。未修改生产代码。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；架构契约在实施前由 Architecture Agent提供。
- Test Agent 运行真实 React 组件和 PlayerShell，模拟目录、标签、播放命令及事件，未用伪页面替代实际交互。
- 50 首曲目覆盖重叠目录、未选存储、缺失 ARTIST、ALBUMARTIST 后备、失败摘要、合作曲、例外名称、同名专辑、多碟和无专辑曲目。
- 新功能无历史缺陷复现基线；原始标签污染与合作曲重复等替代失败机制通过定向输入反证。

## 命令

独立执行且通过：

```powershell
node --test src/features/player/model/artistLibrary.model.test.mjs
node --experimental-strip-types --test src/features/player/model/playlistTrackSummary.test.ts
git diff --check

$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_WIDTH='456' # 另一次设置为1280
$env:SPMUSIC_TEST_SCREENSHOTS=Join-Path $env:TEMP 'spmusic-artist-verification-20261028/artist-verification-456'
node src/features/player/components/artistLibrary.browser.test.mjs

$env:SPMUSIC_TEST_WIDTH='456'
$env:SPMUSIC_TEST_MOTION='1'
$env:SPMUSIC_TEST_SCREENSHOTS=Join-Path $env:TEMP 'spmusic-artist-verification-20261028/artist-motion-456'
node src/features/player/components/artistLibrary.browser.test.mjs
```

- 艺术家模型：5/5；摘要：7/7；浏览器三种运行退出码均为 0。
- Vite 位于 `http://127.0.0.1:5173`，浏览器为 headless Microsoft Edge，窗口高 1440px。
- `npm run lint` / `npm run build`：主代理和 Frontend Agent 报告通过，非本 Test Agent 重复执行。
- `cargo check` / `npm run tauri dev`：未运行；本次没有 Rust 或原生命令契约变更。

## 人工检查

Test Agent 已通过图像工具实际查看两个宽度的根页、专辑视图和无封面截图。456px 根页双列圆形封面为 194×194px，1280px 为三列 280×280px，圆角 999px；封面与名称间距 26px。所有歌曲入口位于专辑卡片前，动态图片采用测试像素缓冲区；无封面时使用现有 Mic 资产，mask 与实际本地 import 值精确匹配。该 SVG 文件为 884 字节。

截图保存在仓库外：

- `C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-verification-20261028/artist-verification-456/`
- `C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-verification-20261028/artist-verification-1280/`
- `C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-verification-20261028/artist-motion-456/`

每个目录包含 `artist-root.png`、`artist-albums.png`、`artist-all-songs.png`、`artist-empty.png`、`artist-no-cover.png`。失败调试截图不作为通过证据。

## 根因与因果链反证

- ARTIST 为空而 ALBUMARTIST 为 Ensemble：艺术家根页不出现 Ensemble，保持未知艺术家归属；真实“未知艺术家”与缺失实体不碰撞。
- Singer A/Singer B/Singer A 合作曲分别进入 A/B 一次；多选两个艺术家播放时只保留一次。
- 进入 A 的 Mixed 专辑，候选仅含 A 独唱和合作曲，不含 B 独唱。所有歌曲额外包含 A 的无专辑曲目。
- 搜索 duet 后随机播放，队列严格为一首 duet，排除“UI过滤但候选仍是整位艺术家”的替代实现。
- 摘要尚未完成时无可播放未知实体；清空目录后再释放延迟摘要不会复活实体。

## 跨层契约

核对 `libraryArtistName` 从摘要 mapper、行相等比较、view model 到 PlayerShell 展示覆盖的完整透传。播放器水合更新不替代原始归属。队列使用真实原始 scope/trackId；既有 `all-songs` 队列类型沿用。没有新增权限、命令或后台持久化。

## 回归覆盖

- 完整层级返回、播放器往返保留艺术家/专辑位置。
- 所有歌曲支持键盘 Enter；索引 Z 键盘定位和回顶均通过。
- 搜索、多选、播放、随机及成员去重通过；隐藏存储不贡献实体。
- 清空目录后位置归根且显示空态；重扫期间位置保留，完成后仍处于原艺术家。
- 已启用动效复跑，离场保留场景不清理当前实体位置。立即关开播放器可保留搜索/选择会话，完整卸载后重置；测试明确清理会话再继续独立场景。
- 全局专辑模型/浏览器回归由 Frontend Agent 独立于本艺术家浏览器流程执行并报告通过，本报告不重复宣称为 Test Agent 自己执行。

## 性能 / 时序

本次不宣称性能提升。覆盖延迟摘要、清空后晚完成、重扫临时数据以及正常动效下播放器快速往返；未做大曲库吞吐、内存、长时间租约泄漏或真实多线程原生事件压力测试。

## 发现

首轮1280px测试的所有歌曲选择器同时命中侧栏与详情，已收窄到详情 `.artist-all-songs`，未放松业务断言。Vite 将小 SVG 转为 data URL，资产断言采用与真实本地 import 值比较，未依赖临时 Figma URL。

主代理视觉复核发现艺术家头图标题下存在空作者胶囊；交 Frontend Agent 在作者为空时省略 extraMetadata，并为艺术家专辑层和所有歌曲层加入无空作者 badge 回归断言。

修复后 Test Agent 使用浏览器脚本中从启动至 `artist-all-songs` 截图检查点的同一段流程生成仓库外定点脚本 `C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-verification-20261028/artist-visual-check.mjs`，分别以 456/1280px 执行 `node`，均退出 0。两个视图的 `.collection-hero-parent-meta` 均为 0，更新后的截图已经再次实际查看，空胶囊消失。其余已通过功能流程没有重复全量执行。

## 风险

没有进行 Tauri 实机音频、真实用户曲库图片或触摸设备人工验收；浏览器模拟传输不能证明真实磁盘读取或解码正确。拆分范围为批准的 `/` 及 AC/DC、+/- 例外，不覆盖尚未提供的可配置拆分设置。

## 临时缓解

无。测试未吞掉应用错误、放宽成员断言或修改生产功能绕过失败。

## 验证结论

前端功能与成员契约通过；空作者胶囊修复已定点复核，发现关闭。原生命令/音频硬件不属于本轮已验证结论。

## 艺术家内层设计对齐复验

用户补充节点 `8114:18993` 后，仅复验新入口、紧接的专辑网格及必要相邻交互，未重复上轮全套测试。主代理已成功获取高保真 Figma 上下文；Test Agent 的同节点调用遇到 MCP HTTP 传输失败，随后通过图像工具直接查看用户原始 640×1440 设计截图 `C:/Users/winkeses/AppData/Local/Temp/codex-clipboard-13ea8a1c-fd12-400a-ae90-9d029de4b628.png` 作为视觉目标。

执行命令：

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_ARTIST_DESIGN_ONLY='1'
$env:SPMUSIC_TEST_WIDTH='640' # 第二次为1920
$env:SPMUSIC_TEST_SCREENSHOTS=Join-Path $env:TEMP 'spmusic-artist-verification-20261028/artist-entry-640'
node src/features/player/components/artistLibrary.browser.test.mjs
```

最终 640/1920px 定点运行均退出 0。首轮截图发现继承布局间距使入口封面在 y=401、专辑封面在 y=582；Frontend Agent 修正本层 margin、grid padding 及入口透明边框后，640px 实测 hero 底 y=360、入口封面 y=375、专辑封面 y=530，与原图对应位置一致。测试保留相对位置断言，避免仅匹配孤立字号而漏掉整行偏移。

- 入口 125×125px 圆形封面，padding 15px 40px、封面与文字间距15px、两行文字间距4px；行高155px。
- “所有艺术家歌曲”28/36px；数量24/32px、music24图标24×24px、图标文字间距16px。颜色等于运行时 `--player-inverse-primary`（默认 rgb(150,205,248)）。
- 精确使用本地 `src/assets/artist-library/24b9a.svg`，文件1182字节；实际mask与该资源的import值相同，不引用临时Figma URL。
- Singer A 显示4首，Singer B显示3首，计数来自实际成员；点击和键盘Enter都进入包含正确成员的歌曲视图。
- 紧接专辑封面240×240px，专辑名32/40px、作者24/32px，网格gap为22px 48px；640px为双列。1920px保持入口封面及文字聚在左侧，不再把数量分离到最右端。
- 无封面入口正确显示Mic后备；全局专辑页仍为16px名称/14px作者，局部设计样式没有污染全局专辑。

Test Agent 已实际查看最终640/1920入口截图及640无封面截图，验证通过。截图分别位于 `C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-verification-20261028/artist-entry-640/` 和 `artist-entry-1920/`，文件包括 `artist-design-entry.png`、`artist-design-root.png`、`artist-design-songs.png`、`artist-design-no-cover.png`。新入口动态图片采用测试像素缓冲区，未把示意人像写死到运行时代码；实机音频限制沿用上文。

## 索引覆盖与实体封面回归

本轮用真实 PlayerShell 新增140个单曲艺术家及“首曲无图、第二曲有图”的艺术家，补足上一轮所有路径统一返回成功像素造成的覆盖缺口。原始标签、水合 coverArt 与缩略图响应按真实路径区分，不把设计示意图当封面证据。

修复前独立基线：初始虚拟窗口之外的 Artist139 滚动到可见后，观察500ms仍为0次缩略图请求、0张封面；截图位于外部 `spmusic-artist-verification-20261028/artwork-baseline/virtual-late-artist.png`。同key冷overview场景未独立复现失败，不能把静态Map风险当作已证实的原始缺陷。mixed场景在补基线期间生产已开始修改，因此不宣称取得了其修复前失败证据。

修复后的 `collectionArtworkOverlay.browser.test.mjs` 三场独立执行退出0：

- 虚拟窗口新挂载艺术家：从旧0请求/0图变为1请求/1图。
- 冷缓存单曲艺术家overview：1次请求，hero与所有歌曲入口均有图。
- 首曲无图、第二曲有图：候选继续访问第二曲，入口成功显示封面。艺术家与艺术家内专辑是独立资源，本场两候选各请求2次，不宣称跨实体只读一次。

命令（沿用上文Playwright变量）：

```powershell
node src/features/player/components/collectionArtworkOverlay.browser.test.mjs
node src/features/player/components/collectionQuickIndexOverlay.browser.test.mjs
```

索引脚本在640和1280px覆盖所有歌曲、文件夹、文件夹层次结构、专辑、艺术家、播放列表共12个组合，全部退出0。逐一真实切换索引 `display:none`，panel/grid/所有已挂载卡片的边界和列布局均不变；索引为absolute且pointer-events:auto，恢复显示后键盘激活回顶仍有效。所有歌曲左右padding均24px；其他实体无额外右侧索引留位。播放列表原有左32px/右16px是其独立布局，验证其显隐索引不改变该布局，没有为“对称”修改无关样式。

既有 `allSongs.browser.test.mjs` 中“歌曲给索引留空间”的旧断言已由主代理更新为absolute覆盖和显隐行边界不变，本Test Agent复核保留该更新。本轮未重复整套旧allSongs脚本，新跨消费者脚本直接覆盖新契约。

Test Agent截图目录为 `C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-verification-20261028/artwork-fixed/`。主代理也独立运行三场封面回归并通过。真实磁盘/解码硬件与长时间revision压力仍未由浏览器模拟传输证明；原有缓存和文件夹候选回归由Frontend Agent另行执行并报告通过。

## 艺术家头图统计及宽度定点复验

更新设计分支的旧970px宽度上限断言为相对内容panel左右各25px，并加入标题与统计的实际几何关系、真实总量以及隐藏索引后hero rect不变的断言。`SPMUSIC_TEST_ARTIST_DESIGN_ONLY=1` 下640/1920px分别执行 `artistLibrary.browser.test.mjs`，均退出0；没有重复构建或上一轮完整业务测试。

1920px窗口内容panel宽1600px，头图宽1550px；标题左355px、底246px，统计左355px、顶251px，间距5px，文字为真实 `4 | 0:12:00`。640px头图宽590px，同样左右各25px，统计紧接标题。125px入口封面、240px专辑封面和375/530纵向位置继续通过。

Test Agent已实际查看最终两宽截图，统计位于标题下面且左对齐，宽屏头图覆盖内容区域。截图：

- `C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-verification-20261028/artist-hero-640/artist-design-entry.png`
- `C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-verification-20261028/artist-hero-1920/artist-design-entry.png`

本轮验证通过，原生命令及真实音频限制沿用前文。

## 2026-10-29 艺术家详情更多菜单与专辑字号

用户明确要求内层专辑字体随全局同布局档，本节取代前述设计复验中32/24px的历史字号验收。新断言比较艺术家内专辑与全局专辑的实际字号及行高，当前默认大卡档均为名称16/24px、作者14/20px；未以旧设计截图覆盖用户此次文字要求。

Test Agent 独立执行：

```powershell
# 沿用上述bundled Playwright；Vite位于127.0.0.1:5173
$env:SPMUSIC_TEST_ARTIST_DESIGN_ONLY='1'
$env:SPMUSIC_TEST_WIDTH='640' # 另一次为1920
$env:SPMUSIC_TEST_SCREENSHOTS=Join-Path $env:TEMP 'spmusic-artist-verification-20261029/artist-menu-640'
node src/features/player/components/artistLibrary.browser.test.mjs

# 独立验证album/songs内层仍使用完整artist菜单上下文及无封面后备
$env:SPMUSIC_TEST_ARTIST_MENU_CONTEXT_ONLY='1'
node src/features/player/components/artistLibrary.browser.test.mjs

node src/features/player/components/playlistHeroMoreMenu.browser.test.mjs
```

艺术家两个定点分支均在640/1920px退出0，旧播放列表完整菜单回归退出0。初次启动因5173未监听而ECONNREFUSED，没有进入应用；启动Vite后执行成功，未把该环境失败当产品缺陷。

验证结果：

- 艺术家头图使用42×42px、无边框、有填充的详情更多按钮。菜单为“艺术家更多操作”，没有挂载分类root菜单，没有混入播放列表去重、排序、添加地址操作。
- 菜单展示真实Singer A、4首及0:12:00、160×160px本地动态封面。5项为选择文件夹、重新扫描、封面、在侧栏置顶（或取消置顶）、列表选项。
- Escape返回触发按钮焦点；封面/列表选项转诚实未接入说明，返回仅保留一个dialog焦点陷阱且不使用错误播放列表文案。
- 选择文件夹转入已有文件夹选择dialog，保持单一焦点陷阱。重新扫描实际触发已有选中曲库callback，扫描中选择/重扫禁用，完成后保留艺术家位置；播放队列未变化。
- 依据主代理确认的现有契约，pin只改变artist分类，其他分类保持不变；切换取消状态与aria-pressed正确，反向操作恢复原集合。没有新增单个艺术家持久化pin。
- 从只含2首的Mixed专辑详情、艺术家所有歌曲分别以键盘打开菜单，仍展示完整artist的4首/0:12:00和artist封面资源key，不错用专辑子集；无封面时显示Mic后备。
- 默认播放列表7项及原有诚实notice保持；完整旧回归覆盖实际滚动条拖动、端点/中点、resize、固定头部、原播放器滚动条对比、静态资源和焦点恢复。

已实际查看640/1920艺术家菜单截图及640无封面菜单。最终截图位于 `C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-verification-20261029/artist-menu-640/` 与 `artist-menu-1920/`，包括 `artist-detail-more.png`、`artist-album-more-context.png`、`artist-songs-more-context.png`、`artist-no-cover-more.png`；旧菜单证据在同父目录 `playlist-hero-menu-regression/`。本轮未运行Tauri实机音频；该限制不影响已验证的前端菜单作用域和布局结论。

## 2026-10-29 菜单自然高度及紧凑总时长

用户再次明确修改菜单设计，本节替代上述固定高度、自定义滚动条的历史验收约定。`playlistHeroMoreMenu.browser.test.mjs` 已改为自然高度及整个Dialog的唯一原生滚动后备测试，不再要求固定592px、自定义thumb或固定header。正常艺术家5项和播放列表7项应同时可见，极小视口才允许滚动。

独立执行通过：

- `node --experimental-strip-types --test src/features/player/model/playlistDuration.test.ts`：23/23。新增共享formatter边界0→0:00、59→0:59、60→1:00、1596→26:36、3599→59:59、3600→1:00:00、5196→1:26:36、90061→25:01:01；null/undefined/负数/非有限值返回null，loading/error/unknown标签保持。
- `node src/features/player/components/playlistHeroMoreMenu.browser.test.mjs`：640×1440及1920×1080全部7项完整可见，无需滚动；360×420和360×260使用整个dialog原生overflow，最后一项可键盘聚焦并激活，Escape恢复触发焦点。保留原7项诚实notice断言，另验证播放列表hero/more的26:36、1:26:36和三种状态文本。
- `SPMUSIC_TEST_ARTIST_DESIGN_ONLY=1` 的艺术家定点640/1920均退出0：全部5项完整可见，无需滚动，hero及more显示12:00，原菜单动作/焦点回归继续通过。
- `node src/features/player/components/collectionDurationLabels.browser.test.mjs`：艺术家专辑/所有歌曲26:36、艺术家内专辑13:18、全局专辑19:57、平铺文件夹19:57、文件夹层级5:12:33、超过一小时艺术家hero/more为1:26:36。360×260艺术家菜单最后一项可到达并激活。resize后等待实际dialog进入视口约束，再检查焦点可达，未用任意延时掩盖布局。

已实际查看正常艺术家5项、播放列表7项和极小视口滚动截图。最新证据目录 `C:/Users/winkeses/AppData/Local/Temp/spmusic-hero-fit-20261029/`，其中 `artist-640/artist-detail-more.png`、`artist-1920/artist-detail-more.png` 为正常艺术家图；`playlist/playlist-fit-640.png` 为正常7项图；`collections/artist-tiny-native-overflow.png` 为极小视口后备图。

本轮通过，未重复无关封面、索引、Tauri音频或完整旧业务验收。主代理已报告构建/lint通过；本Test Agent独立`git diff --check`通过。

## 索引叠加与封面加载修复复验

本轮新增 `collectionArtworkOverlay.browser.test.mjs` 与 `collectionQuickIndexOverlay.browser.test.mjs`。Test Agent 在封面修复前实证：140 个艺术家的虚拟列表滚动至末段后，新挂载卡片封面为 0 请求、0 图片。主代理在修复后执行同一场景，结果为 1 请求、1 图片。冷缓存直接进入单曲艺术家详情时，页头和所有歌曲入口均显示封面；首曲无封面、后曲有封面的成员集也显示后续候选封面。后两项是补充回归，未宣称已取得其修复前失败证据。

主代理执行封面三场景脚本退出 0，截图在 `C:/Users/winkeses/AppData/Local/Temp/spmusic-artwork-overlay-regression/`。Frontend Agent 执行共享 hook 的 `allSongsCoverCache.browser.test.mjs` 和 `flatFolderCoverCandidates.browser.test.mjs` 均退出 0；缓存回收至 60 项，卸载及资源释放断言通过。本轮 lint、build 通过，未进行用户真实音频文件的原生读取复测。

索引验收使用真实 PlayerShell，逐类隐藏和恢复索引，比较内容面板、网格、卡片位置与列数，另验证键盘回顶。所有歌曲列表要求左右内边距对称，其他分类保留其原有设计内边距。旧 `allSongs.browser.test.mjs` 中“歌曲行为索引预留空间”的断言已更新为绝对定位和索引显隐前后歌曲行几何一致。

主代理执行 `collectionQuickIndexOverlay.browser.test.mjs` 验证 640/1280px 的 songs、folder、folders、album、artist、playlists 共 12 个组合，全部通过几何一致和键盘回顶断言。一次运行在页面切换后的键盘检查阶段超时，重跑完整 12 组合通过；测试随后将分离的 focus/全局键盘调用合并为当前索引按钮的原生键盘操作，避免切页中焦点转移影响定位。播放列表场景复用真实管理组件 fixture，其余场景复用真实 PlayerShell 与模拟原生传输，未把这项验证描述为真实磁盘或音频设备验收。

## 统一头图及浮动控制器返回图标

本轮将播放列表、专辑、艺术家、文件夹和文件夹层次详情的头图返回，以及共用浮动控制器返回，统一为现有 `427b5.svg` 原始 Arrow Turn Right Up 图形。正确的媒体库根返回按钮保持不变。Test Agent 先记录真实 DOM 基线，主代理接手执行 `collectionReturnIcon.browser.test.mjs`，五类页面共十个位置均通过：头图 28×28、浮动图标 24×24、按钮尺寸及 aria 与基线一致；精确资源 mask、currentColor、头图点击与浮动按钮键盘返回均通过。测试按实际 SVG 根节点读取 mask；颜色断言直接验证 SVG currentColor，不将页面原有显式图标颜色规则误判为不继承按钮颜色。

截图与基线位于 `C:/Users/winkeses/AppData/Local/Temp/spmusic-return-icons-20261029/`。本轮 build、lint 及 diff-check 通过。浏览器采用模拟原生传输，仅验证图标与导航，不代表音频硬件验收。

## 艺术家所有歌曲页设计对齐（8117:19352）

本轮仅验证新songs页。主代理已取得Figma高保真上下文及截图；Test Agent 使用实际PlayerShell定点分支 `SPMUSIC_TEST_ARTIST_SONGS_ONLY=1`，分别设置 `SPMUSIC_TEST_WIDTH=640` 和 `1920` 执行 `node src/features/player/components/artistLibrary.browser.test.mjs`，修后均退出0。

两位艺术家均使用固定标题“所有艺术家歌曲”，不拼接名字；返回按钮仍分别显示Singer A/B并使用28px返回图形。头图320px高，相对内容左右各25px；标题16/24px、500字重、padding 2px 15px，音乐图标为原77262.svg的16px资源。计数真实为4/3首，当前页头不再显示时长；对应更多菜单仍保留真实艺术家名字、数量和总时长（B为3 | 9:00）。左侧四操作、右侧42px更多按钮位置正确。

首轮640px发现共享窄屏actions margin造成metadata至操作间距9px；Frontend Agent仅在songs局部清除该margin，复测两宽均为5px。测试保留该几何断言，没有放松设计要求。另一处菜单h2命中sr-only标题的测试选择器已收窄至信息区。

交互验证通过：Singer A整页播放候选为4首（包含合作曲和无专辑曲目）；搜索duet后选择播放仅生成duet队列，页头计数仍表示完整艺术家4首；键盘返回当前艺术家albums层正确，切换Singer B后固定标题、真实3首及菜单上下文正确。旧时长消费者脚本同步将songs页断言更新为count-only，未重跑无关菜单、封面和索引验收。

Test Agent已实际查看最终640/1920截图：`C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-songs-20261029/640/artist-songs-page.png`、`C:/Users/winkeses/AppData/Local/Temp/spmusic-artist-songs-20261029/1920/artist-songs-page.png`。主代理已报告lint/build通过，本Test Agent的diff-check通过。原生磁盘和音频硬件限制沿用前文。

## 全局与艺术家内专辑详情对齐（8134:19952）

Test Agent 独立执行 `SPMUSIC_TEST_ALBUM_DETAIL_ONLY=1` 分支，分别以 `SPMUSIC_TEST_WIDTH=640`、`1920` 运行 `node src/features/player/components/artistLibrary.browser.test.mjs`，两宽均退出0。实际头图320px、相对面板左右25px；标题/作者/计数时长均16/24px、padding 2px 15px，列间距5px；音乐16px、填充更多按钮42px。默认歌曲行封面135px，标题/作者/元信息分别28/22/16px，保存的level5布局未被重置；未虚构年份。

全局Mixed为3曲 | 9:00，艺术家内Mixed为2曲 | 6:00；对应更多弹窗分别使用真实专辑Mixed（3 | 9:00）与完整艺术家Singer A（4 | 12:00），封面资源身份一致且图片成功解码。整页播放候选分别3/2曲，选择duet后仅播放该曲；键盘分别返回专辑根页/当前艺术家albums层，Escape恢复更多按钮焦点。新增封面身份断言首次因嵌套同名容器触发严格选择器错误，已收窄至实际资源节点并复测；未改变业务断言。

已实际查看640详情与更多弹窗、1920艺术家内详情截图；目录为 `C:/Users/winkeses/AppData/Local/Temp/spmusic-album-detail-20261029/{640,1920}/`，文件为 `global-album-detail.png`、`global-album-detail-more.png`、`artist-album-detail.png`、`artist-album-detail-more.png`。主代理最终lint/build通过，本Test Agent diff-check通过。本轮采用真实PlayerShell及模拟原生传输，仅验收详情外观与作用域，未重复无关索引/封面全套，未验证真实音频硬件。

## 真实专辑年份及标准标题字号

用户进一步授权真实年份摘要，并纠正缺年直接省略。本轮替代上节标题16px断言：640px为标准24/32px，1920px为22/28px。Test Agent 独立运行 `node --experimental-strip-types --test src/features/player/model/playlistTrackSummary.test.ts src/features/player/model/albumLibrary.model.test.mjs src/features/player/model/artistLibrary.model.test.mjs src/features/player/services/audioCommands.summary.test.mjs`，24/24通过；`npx tsc -b`、`git diff --check`通过。canonical typed fixtures已补year:null。

实际parser保留其他标签并将旧响应省year、null、0、负数、小数、非有限数、字符串和越u32值单独规范成null，正整数与u32上界通过；pending与已知缺失不同，年份单独变化触发row equality；年份改变不改变专辑key、成员、scope和trackId。唯一有效年混合缺失仍显示，冲突保守省略；艺术家内专辑只聚合其成员。

以 `SPMUSIC_TEST_ALBUM_YEAR_ONLY=1`、`SPMUSIC_TEST_WIDTH=640/1920` 分别运行 `node src/features/player/components/artistLibrary.browser.test.mjs`，最终均退出0。唯一年显示 `3 | 9:00 | 2023`；全局冲突仅 `3 | 9:00`，同专辑的艺术家局部显示 `2 | 6:00 | 2023`；旧响应缺年只显示两项，无“年份未知/不一”或末尾分隔符。播放hydration故意返回1999，原摘要2023和头图不受污染；标题字号两宽均符合标准。首轮测试在媒体库概览等待尚未启用的懒摘要而超时，已修正为先进入专辑分类，未修改生产或放宽断言。

已实际查看640唯一年/缺年及1920艺术家局部截图；目录 `C:/Users/winkeses/AppData/Local/Temp/spmusic-album-year-20261029/{640,1920}/`，文件为 `album-year-unique.png`、`album-year-conflict.png`、`album-year-legacy.png`、`artist-album-year-scoped.png`。Rust Agent报告摘要8/8、cargo check及rustfmt通过；Test Agent只读核对Option<u32>始终序列化year、ts-rs number|null、tag.date过滤0以及真实WAV日期/缺年/无效年用例，未重复执行后端全套。浏览器为真实Shell加模拟原生传输；原生音频设备与用户文件未在本轮复测。本轮范围验收通过。
