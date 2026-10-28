---
doc_id: "TEST-2026-10-28-ALBUM-LIBRARY"
title: "专辑分类与共享快速索引独立验证"
doc_type: "test"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-28"
updated: "2026-10-28"
source_documents:
  - "user request: 完成媒体库专辑分类，根页面复用所有歌曲侧边索引"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=8007-15164"
  - "docs/architecture/album-library.md"
  - "docs/implementation/album-library.md"
  - "src/features/player/model/albumLibrary.model.test.mjs"
  - "src/features/player/components/albumLibrary.browser.test.mjs"
---

# 专辑分类与共享快速索引独立验证

## 摘要

独立验证覆盖专辑身份、根与详情的候选队列、实际 React 页面交互、索引、元数据迟到和存储移除。模型、640px 减少动画和 1280px 开启动画的浏览器验收均通过。浏览器使用真实 `PlayerShell`、`PlayerSurface`、播放器 hook 和 command parser，只替换原生传输；这不代表在真实 Tauri 进程完成了磁盘读取或音频输出验证。

## 范围

- 44 首可见歌曲形成 42 个专辑，另含一首来自未选中存储的歌曲；存储根重叠不重复计入。
- 同名不同专辑艺术家、同一专辑跨碟目录、缺少专辑艺术家的多人合辑及同名目录隔离、未知专辑和真实“本地音频”标签。
- 标签读取失败与 pending、迟到摘要、清空存储、专辑详情失效、分类重入和播放器往返。
- 根/详情搜索、多选、播放、随机播放、单歌激活、返回，以及根页侧边索引的键盘、指针拖动、预览和顶部按钮。
- 180 首单专辑与 224 首所有歌曲的窗口化 DOM、跨窗口 Tab、所有歌曲远距离 Z 索引与返回顶部。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；独立验证 Owner：Test Agent。
- 本次为新增分类能力；基线是已有分类占位与后端标签摘要。验收标准来自用户设计与已审查的专辑身份契约，没有把内部分组算法本身用作期望值。
- 实现主张：raw 标签决定身份，当前存储投影决定曲库，专辑候选保留真实 `scope/trackId`；专辑、所有歌曲、文件夹共享 `CollectionQuickIndex`。
- 反证方式：放入同名不同作者、曲目作者不同的合辑、跨目录多碟、未知与字面默认文字、未选存储和重叠根；分别核对 DOM、原生请求和最终 queue IDs。
- 首轮代码审查发现关闭搜索按钮只隐藏输入而保留过滤词。Frontend 已清理关闭分支中的 query，新增断言检查关闭后恢复全部 42 张卡片并通过。没有删除或放宽失败断言。

## 命令

Vite 由主代理提供，地址 `http://127.0.0.1:5173`。独立执行：

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/album-library-test'
node --test src/features/player/model/albumLibrary.model.test.mjs src/features/player/model/flatFolders.model.test.mjs src/features/player/model/folderHierarchyModel.test.mjs src/features/player/model/folderNavigationIdentity.test.mjs
node src/features/player/components/albumLibrary.browser.test.mjs
node src/features/player/components/flatFolders.browser.test.mjs
npx eslint src/features/player/components/albumLibrary.browser.test.mjs src/features/player/model/albumLibrary.model.test.mjs

$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/album-library-test/motion-1280'
$env:SPMUSIC_TEST_WIDTH='1280'
$env:SPMUSIC_TEST_MOTION='1'
node src/features/player/components/albumLibrary.browser.test.mjs
```

- 模型 23/23 通过，其中新专辑模型 6 项。
- 新专辑浏览器集成：640 × 1440、减少动画模式，通过。
- 新专辑浏览器集成：1280 × 1440、开启动画模式，通过；每条完整路径同样核验窗口化、索引、迟到清理和控制台错误。
- 平铺文件夹既有浏览器回归：通过，含文件夹及层次视图、索引拖动、多选/搜索播放、播放器返回、迟到扫描和移除失效。
- 新测试文件 ESLint：通过。
- 全仓 `npm run lint`、`npm run build`、`git diff --check`：主代理已执行并反馈通过；此报告不将其列为 Test Agent 独立执行。
- `cargo check`、实机 `npm run tauri dev`：未执行；本轮未改 Rust、权限、扫描或原生命令契约。

另独立执行过 `node src/features/player/components/allSongs.browser.test.mjs`，该旧完整套件未通过：在 `navigationMotionRegression` 的概览分类点击处被已打开的 `folder-selection-overlay` 拦截。该套件的 `importChoice` 调用 `onSelectFolders()` 后直接等待 import pending 结束，没有操作选择弹窗；检查 `HEAD:src/features/player/hooks/useAudioPlayer.ts` 可见基线 `selectFolders` 已执行 `setFolderSelectionOpen(true)`，且旧 fixture 仍返回 `{folders:...}`。因此它存在与当前选择存储流程不匹配的覆盖缺口，不能作为本轮完整回归通过证据。没有修改旧套件；本次新集成测试已实际覆盖共享索引迁移影响的所有歌曲窗口化、跨窗口键盘和远距索引路径。

## 交互与视觉检查

- 根页没有 hero，显示分类图标、专辑标题、已有管理控制器及复用的右侧索引。详情含共享 hero，根索引不在详情显示。
- 640px 卡片实测封面 240 × 240、圆角 10px、名称字号/行高 32/40px、作者 24/32px、图文 gap 26px。截图由 Test Agent 实际查看；fixture 封面为纯色，只验证图片管线和几何，不替代真实曲库图像。
- 专辑封面使用 track thumbnail 命令；没有调用递归目录 thumbnail 命令。
- Z 索引键盘激活滚至第一张 Z 专辑；拖动更新预览和 `aria-current`，松开隐藏预览，顶部按钮归零。所有歌曲在小列表和 224 项窗口化列表中也完成 Z 跳转与归零。
- 根搜索只将两个 Echo 专辑排入播放；根多选 Box 与 Ann 的 Echo 后，播放和随机均只得到 `disc1/disc2/echo-a`。
- Box 详情两首跨碟歌曲：整专辑播放/随机均保持两首；搜索 disc2 后只播放 disc2，多选 disc1 后只播放 disc1，点击 disc2 保留整专辑候选并激活 disc2。
- 播放器返回保留专辑位置；重新从分类入口进入回到根；同名 Bob 专辑只包含其自身曲目。移除存储后详情回到空根。
- pending 摘要期间没有伪造未知专辑；完成后显示 42 项；清空后迟到摘要不能恢复已移除歌曲。
- 180 首单专辑保持少于 40 个歌曲 DOM 项并完成跨窗口 Tab；224 首所有歌曲执行相同边界及远距离 Z 跳转。
- 640px 和 1280px 完整集成运行中页面运行时错误、React 控制台错误均为 0。

截图位于工作区外：`D:/spmusic-artifacts/album-library-test/albums-root-640.png`、`albums-detail-640.png`、`albums-index-drag-640.png`。

## 跨层契约

核对真实 Rust `AudioPlaylistTrackTagSummary` 与 TS `PlaylistTrackTagSummary`：`album_artist` 经 `serde(rename_all="camelCase")` 对应 `albumArtist`，均允许缺失标签为 null。摘要映射保留 raw `libraryAlbumName/albumArtist`，并在 equality 中参与失效判断；活动播放展示数据不能覆盖曲库分组身份。播放入口仍使用既有 `all-songs` origin 和原始 `scope/trackId`，未引入伪造播放列表身份或新权限。

## 性能 / 时序

本次不作性能提升声明。验证 pending、迟到、清空、重入和共享索引迁移后的窗口化行为；未测真实用户曲库 I/O、跨设备性能或长时间音频播放。窗口化 DOM 上限和键盘边界测试是正确性验证，不是吞吐基准。

## 风险与临时缓解

不是临时缓解。缺少专辑艺术家的同名专辑按直接目录隔离，因此此类跨碟目录不会自动合并，这是已确认契约。真实 Tauri 文件访问、解码和扬声器输出仍需实机验收；旧 allSongs 完整套件的选择弹窗 fixture 需另行维护。

## 验证结论

上述前端范围通过。独立证据涵盖专辑分组、候选边界、关键交互、索引复用与受影响文件夹/所有歌曲路径；旧 allSongs 完整套件和真实原生音频范围不包含在通过声明中。

## 补充验证：多位艺术家名称展示

根据用户追加要求，缺少专辑艺术家标签的专辑改为使用 `/` 连接实际艺术家名称。复用现有模型用例独立验证：多位艺术家按首次出现顺序连接、名称 trim 后去重、忽略展示默认值、单人不加分隔符、全未知显示“未知艺术家”，以及原有专辑艺术家标签优先规则。执行 `node --test src/features/player/model/albumLibrary.model.test.mjs`，6/6 通过；两个新增测试文件 ESLint 通过。

静态核对根卡片和详情 hero 均直接消费同一 `AlbumEntry.artist`，根搜索也使用该字段。浏览器用例已补充 `Singer A/Singer B` 展示断言；此小幅模型变更没有重新执行完整浏览器套件，上述双尺寸浏览器结果属于此前版本的集成证据。

## 缺陷回归：Hypersynthetic 合作艺术家重复

主代理只读解析用户三个 FLAC 的标签后，提供了以下原始输入：`Ether Strike` 与 `Hypersynthetic` 的 `ARTIST=Akira Complex`，`message within the rift (Arcien Remix)` 的 `ARTIST=Akira Complex/kors k`，三者均没有专辑艺术家标签。Test Agent 使用这些标签和合成曲目描述符新增回归，没有重复读取或修改用户音频。

生产修复先于验证协调完成，因此旧基线通过 `node --input-type=module` 的测试加载器在内存中重建：将读取的模型源码 `items.flatMap(item => item.track.artist.split('/')).map(value => value.trim())` 恢复为旧 `items.map(item => item.track.artist.trim())`，运行同一组新增断言。生产文件未回退或覆盖。基线为 6 项通过、2 项失败；真实标签回归实际得到 `Akira Complex/Akira Complex/kors k`，期望为 `Akira Complex/kors k`。这是模型级重建基线，不能表述为 Test Agent 实机复现音频播放问题。

随后对实际修复源码执行 `node --test src/features/player/model/albumLibrary.model.test.mjs`，8/8 通过；聚焦测试 ESLint 通过。覆盖 `/` 分段后的空白、空段、展示默认值、多曲目交叉重复、首次出现顺序、单人、未知，以及优先专辑艺术家原串不拆分和分组身份不变；也确认 `&`、`;` 没有被新增为分隔符。静态核对根卡片、详情 hero 和根搜索仍共同消费 `AlbumEntry.artist`。本次未重跑完整浏览器套件或实机音频输出。
