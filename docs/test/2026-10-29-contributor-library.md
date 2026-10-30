---
doc_id: "TEST-2026-10-29-CONTRIBUTOR-LIBRARY"
title: "专辑艺术家与作曲家分类独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-29"
updated: "2026-10-29"
source_documents:
  - "user request: 完成媒体库专辑艺术家和作曲家分类，样式动效与艺术家页面一致，仅属性不同"
  - "docs/architecture/contributor-library.md"
  - "docs/implementation/contributor-library.md"
  - "docs/implementation/contributor-metadata.md"
  - "src/features/player/model/contributorLibrary.model.test.mjs"
  - "src/features/player/components/contributorLibrary.browser.test.mjs"
---

# 测试报告：专辑艺术家与作曲家分类

## 摘要

本次功能的聚焦独立验证通过。新增 6 项纯模型测试、真实 PlayerShell/PlayerSurface 浏览器验收、原有专辑/艺术家与摘要 parser 共 24 项回归，以及真实 WAV/ID3v2 标签读取测试均通过。浏览器覆盖减少动效与正常动效；正常动效最后一轮还包含两个分类的多选播放与共享曲去重。

扩大 Rust 音频套件出现与本次未修改封面模块相关的不稳定失败，不能将整个音频套件描述为全绿。真实 Tauri 桌面文件访问与音频输出未在本报告中实机操作。

## 范围

验证 ARTIST、ALBUMARTIST、COMPOSER 的独立性，原始标签摘要、前端分类成员、实体专辑/歌曲、播放范围和页面生命周期。页面复用已有艺术家组件、CSS、主题及动效，不增加新的样式体系。未扩大到标签编辑、数据库或音频格式兼容矩阵。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent 和 Rust/Tauri Agent。
- 修改边界：Rust `AudioTrackMetadata`/`AudioPlaylistTrackTagSummary` 增加 nullable composer，Lofty 读取；TypeScript DTO/parser、摘要行和 Shell 透传；三个分类共用 `artistEntries` 与 `AlbumLibraryPanel`。
- 基线：新增功能，不声称修复历史缺陷；先前只有分类菜单，两个新入口未提供对应分类页面。
- 独立证据：Test Agent 自行运行新增模型、浏览器、既有模型/parser 及真实标签测试；检查实际 Rust/TypeScript 定义和数据流。没有把实现者自测作为本报告的独立执行。
- 证据缺口：未运行实际桌面点击和扬声器输出，浏览器以 native transport fixture 替换后端调用；实际标签解析由 Rust 合成音频测试补足。

## 命令

Test Agent 独立执行：

```powershell
node --test src/features/player/model/contributorLibrary.model.test.mjs
node --test src/features/player/services/audioCommands.summary.test.mjs src/features/player/model/artistLibrary.model.test.mjs src/features/player/model/albumLibrary.model.test.mjs
npx eslint src/features/player/model/contributorLibrary.model.test.mjs src/features/player/components/contributorLibrary.browser.test.mjs

# 工作目录 src-tauri
cargo test --lib audio::playlist_summary::tests::contributor_tags_remain_independent_in_summary_and_hydration_metadata

# Vite: http://127.0.0.1:5173，Microsoft Edge headless
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node src/features/player/components/contributorLibrary.browser.test.mjs
$env:SPMUSIC_TEST_MOTION='1'
node src/features/player/components/contributorLibrary.browser.test.mjs
```

结果：新增模型 6/6、既有回归 24/24、真实标签测试 1/1、新测试 ESLint 通过；减少动效和正常动效的浏览器验收均通过，无浏览器 console error 或 pageerror。正常动效最终一轮包含追加的多选播放断言。

主代理报告、非 Test Agent 独立执行的仓库级证据：`npm run lint`、`npm run build` 通过；后端实现者报告 `cargo check` 和聚焦 Rust 测试通过。`npm run tauri dev` 未由 Test Agent 运行。

## 页面与视觉检查

- 两分类根页正常渲染；封面圆形、字号、布局 class 与已有艺术家根页一致。样式比较使用元素布局尺寸，避免在正常动效中将入场 scale 误认为布局差异。
- 进入成员后显示该成员的专辑和“所有专辑艺术家歌曲”或“所有作曲家歌曲”，计数与真实成员一致。
- 查看专辑艺术家根页、作曲家概览截图，没有发现新增布局异常；主代理也独立查看这两张截图。
- 截图目录：`C:/Users/winkeses/.codex/visualizations/2026/10/29/01a187db-3a25-7590-ae09-ca641532bfd2/contributor-test/` 和同级 `contributor-motion-test/`。包含 `album-artist-root.png`、`album-artist-overview.png`、`composer-root.png`、`composer-overview.png` 和搜索截图。

## 归属与替代假设验证

- 使用同一歌曲的三个不同署名验证分类独立，反证“只是改菜单文案但仍按 ARTIST 分组”。
- ALBUMARTIST/COMPOSER 缺失但 ARTIST 存在时，分别进入各自未知实体；不借用歌手或展示 artist。真实名为“未知专辑艺术家”“未知作曲家”的实体与 null 实体 key 分离。
- `undefined` 尚未完成标签不形成未知分类；完成但缺失的 null 才形成未知分类。
- `/` 拆分、trim、空段和重复署名处理一致，保留 `AC/DC` 和 `+/-`。一首合作曲属于多个实体但多选展开后的播放队列只出现一次。
- 作曲家进入专辑时只包含该作曲家的成员；相同专辑内其他作曲家的歌曲和较早年份不会泄漏到当前成员集合。专辑分组依然使用已有专辑署名规则。

## 跨层契约

- Rust：`composer: Option<String>` 通过 `ItemKey::Composer` 读取，在 metadata 与 summary 中均序列化为 `composer`；没有新增 command 或权限。
- 真实 WAV/ID3v2 fixture 写入三个不同署名，分别由 summary 与 hydration metadata 读取并比较。移除 composer 后为 null，不回退 ARTIST/ALBUMARTIST；读取前后音频字节一致。
- 前端 parser：composer 缺省兼容旧响应并规范为 null，非法数值仍抛协议错误。独立执行 parser 回归覆盖这些行为。
- `libraryComposerName` 进入摘要行、相等比较、VM 和 Shell 的原始身份覆盖；播放 hydration 后浏览器仍检查到 `libraryArtistName='Singer A'`、`albumArtist='Album Group'`、`libraryComposerName='Writer One'`。

## 回归覆盖

- 两分类根页 → 成员专辑概览 → 所有歌曲、专辑详情的下钻和返回。
- 曲目播放的队列只含当前成员；播放器关闭/重新打开保留当前分类和歌曲层级。
- 分类切换不覆盖另一分类的 location；显式选择分类菜单按契约重置所选分类到根页。
- 菜单正确显示当前分类名称并仅改变当前分类置顶；搜索只筛选当前分类；多选播放去重共享成员。
- 只有选中文件夹曲库进入成员集合，隐藏根的署名不会混入。
- 重扫暂时清空投影时保留当前成员位置，重扫完成后仍有效；清库后两类 location 清理，显示正确空态；清库后晚到摘要不能重新创建成员。
- 现有艺术家和专辑纯模型共 22 项及摘要 parser 2 项通过。
- 布局偏好的分类命名空间、封面/hero identity 和共享动效 hooks 另经代码复核；本报告没有宣称逐一测量所有手势曲线或每种布局档位。

## 性能与时序

本次不是性能优化，没有建立速度提升基线，也不声称改善性能。正常动效浏览器运行覆盖实际导航和播放器往返；重扫及晚到摘要测试通过显式 gate 控制时序，没有以任意延迟掩盖状态问题。

## 扩大套件发现

以下为主代理执行并报告的结果，未由 Test Agent 独立重跑全部音频套件：

- `cargo test --lib audio::` 默认并行：257 通过、4 忽略、2 失败；`cover_pixels` 共享计数断言 `7 != 1`，随后出现 negative index 的 `PoisonError`。
- 相同范围 `--test-threads=1`：258 通过、4 忽略、1 失败；上述两项通过，但未修改的 `folder_cover` discovery 测试 `added_replaced_and_removed_covers_invalidate_the_discovery` 出现 `[]` 与 `cover.png` 不一致。
- 最后对该 discovery 测试 `--exact` 单独执行：1/1 通过。

这些结果提示封面缓存测试存在并发或环境/时序敏感性，尚不能证明全部都是既有失败，也未发现与本次署名标签变更有关的因果证据。应单独跟踪，不将它们隐藏或写成全部测试通过。

## 风险与验证结论

本次专辑艺术家和作曲家分类的聚焦验收通过，未发现阻塞本功能的生产缺陷。不是临时缓解。仓库扩大 Rust 套件存在上述不稳定失败，真实桌面文件访问/声音输出仍需实机验收；不能用浏览器 transport fixture 代表实际音频输出。
