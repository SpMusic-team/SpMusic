---
doc_id: "TEST-GENRE-LIBRARY"
title: "媒体库流派双路径独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-05"
source_documents:
  - "user request: 参照 Poweramp 文档及 Figma 9208:9760 实现流派页面，优先复用现成内容"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=9208-9760"
  - "docs/architecture/genre-library.md"
  - "docs/implementation/genre-library.md"
  - "src/features/player/model/genreLibrary.model.test.mjs"
  - "src/features/player/model/librarySearch.test.mjs"
  - "src/features/player/components/genreLibrary.browser.test.mjs"
---

# 媒体库流派双路径独立验证

## 摘要

Test Agent 独立执行流派模型 7/7、聚合搜索模型 6/6，以及真实 PlayerShell 浏览器验收。流派双路径、混合流派专辑交集、多值拆分、跨流派播放去重、原始摘要标签保持、搜索集合展开、视图排序、重扫清理和共享面板邻近下钻均通过。最终 CSS 修改后另行重跑三种窗口的几何检查，确认 640 原始设计尺寸及窄窗口比例、工具栏同行和无横向溢出。

原有年份、专辑、贡献者三套浏览器脚本均未完整通过，其断言仍依赖已更改的既有界面或专辑分组规则；不把这些旧套标记通过，也未修改旧套来消除失败。本轮另用流派验收脚本聚焦验证了这几类共享面板的下钻成员，详见“发现”。真实 Tauri 传输、磁盘标签读取和硬件音频输出未在本轮浏览器检查中执行。

## 范围

流派根、该流派全部歌曲、该流派专辑、该流派内专辑歌曲；固定分隔符和未知项身份；选择/播放、聚合搜索、四视图排序、布局与响应式、等待摘要/重扫和稳定移除后的导航。共享专辑、艺术家、专辑艺术家、作曲家及年份仅作受影响邻近路径回归，不重新定义其产品规则。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；契约由 Architecture Agent 实施前审查。
- 浏览器执行真实 `PlayerShell`、`PlayerSurface`、`AlbumLibraryPanel`、`SearchPanel` 和外观 Provider，仅替换现有 Tauri command/event 传输。
- 九首可见唯一曲目包含重叠文件夹根、跨目录同专辑、多流派、单斜杠流派、空标签和摘要读取错误；未勾选根另有一首隐藏曲。
- `Mixed` 专辑：a 为 `Rock;Pop`，b 为 `Jazz`，c 为 `Rock//Electronic`。Rock 内专辑及全部歌曲必须仅有 a/c，全局专辑及年份专辑保留 a/b/c。
- 播放水合刻意返回 `Hydrated Wrong` 流派，反证播放标签污染分类的可能性。
- 新功能没有历史缺陷基线。验收使用独立成员与操作断言，不把实现者自测作为独立证据。
- 最终宽度检查发现容器把 10px 滚动条槽计入缩放，反馈 Frontend Agent 后修正为外层容器；本报告尺寸来自修复后的独立复测。

## 命令

Test Agent 独立执行：

```powershell
node --test src/features/player/model/genreLibrary.model.test.mjs
# 7/7 通过

node --test src/features/player/model/librarySearch.test.mjs
# 6/6 通过；包括本轮新增的两个多值流派搜索回归用例

$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_SCREENSHOTS='D:/spmusic-artifacts/genre-library'
node src/features/player/components/genreLibrary.browser.test.mjs
# 完整行为、搜索和 focused 共享面板回归通过，见下文最终几何复测

$env:SPMUSIC_TEST_GEOMETRY='1'
node src/features/player/components/genreLibrary.browser.test.mjs
# 最终 CSS 后 640/456/1440 几何及工具栏同行通过

node src/features/player/components/yearLibrary.browser.test.mjs
node src/features/player/components/albumLibrary.browser.test.mjs
node src/features/player/components/contributorLibrary.browser.test.mjs
# 三套均未完整通过，失败项见“发现”
```

Vite 由 Test Agent 通过 `npm run dev -- --host 127.0.0.1` 启动，源地址为 `http://127.0.0.1:5173/`；Playwright 使用已存在的缓存包及 headless Edge，未引入依赖。`npm run lint` / `npm run build` 由主代理执行并汇报通过，Test Agent 未重复运行全仓命令。Rust 文件及协议没有修改，未运行 `cargo check` 或真实 `npm run tauri dev`。

## 人工与几何检查

设计节点原始 frame 为 640×1440，工具展示的 456×1024 为缩略图，不能直接按同像素比较。640 原尺寸检查及另外两种窗口实测如下：

| 窗口 | 分类圆宽高 | Guitar 图标宽高 | 默认行封面宽高 | 四个工具按钮 top |
| --- | --- | --- | --- | --- |
| 640×1440 | 84 | 48 | 165 | 全部为 269 |
| 456×1024 | 59.84375 | 34.1875 | 117.5625 | 全部为 203.140625 |
| 1440×1024 | 84 | 48 | 165 | 全部为 269 |

三种窗口交互元素、名称和封面均未越出面板；按钮保持同一行。截图前已将鼠标移出工具栏并清除焦点，避免把 hover/focus 状态当作默认视觉。确认两份流派 SVG 本地文件非空，Guitar 的实际调用为本地 `src/assets/genre-library/00729.svg`，音乐图标调用 `86e1e.svg`。封面由真实视图成员提供；测试运输返回无图，截图显示既有缺图占位，不把设计示例封面写入业务数据。

最终截图保存在仓库外：

- `D:/spmusic-artifacts/genre-library/genre-root-640.png`
- `D:/spmusic-artifacts/genre-library/genre-root-456.png`
- `D:/spmusic-artifacts/genre-library/genre-root-1440.png`
- 同目录 `genre-albums-640.png`、`genre-albums-456.png`、`genre-albums-1440.png`、`genre-album-tracks.png`、`genre-all-songs.png` 和 `genre-empty.png`。

## 根因与因果链反证

本轮是新增功能。验证分别构造以下反例，避免仅检查“页面有内容”：

1. 若错误复用年份完整专辑路径，Rock 的 `Mixed` 会混入 Jazz 曲 b；实际断言只含 a/c，全局专辑及年份仍含 a/b/c。
2. 若多值分组或重叠根重复累计，Rock 计数/时长和 Rock+Pop 选择播放会重复曲 a；实际计数 2、时长 6:00，队列 a/c 各一次。
3. 若播放水合覆盖只读摘要字段，会产生 `Hydrated Wrong` 分类；实际原始 `Rock//Electronic` 保持。
4. 若临时空投影错误清导航，重扫会提前跳根；实际等待期间位置保持，稳定移除 Electronic 后才回根。
5. 若迟到摘要恢复已清空曲库，pending 请求完成后会重建流派；实际清空后仍为零项并显示空状态。
6. 若搜索沿用原始字符串聚合，Rock 搜索会出现 `Rock;Pop` 或包含无关歌曲；实际集合名称与根页一致，展开 Rock 仅有 a/c，播放也仅有 a/c。

## 跨层契约

只读核对现有 Rust `AudioPlaylistTrackTagSummary.genre: Option<String>`、前端 `genre: string | null` parser、`playlistTrackRowFromSummary.libraryGenreName` 和 Shell 原始字段优先路径。没有新增 command/event、权限或磁盘能力；流派仅消费该已存在的摘要链路。浏览器模拟命令的输入输出和事件名称沿用现有契约，播放断言核对真实源路径及 scope/trackId。上述检查不能代替真实文件/音频运行证明。

## 回归覆盖

- 模型：指定四种分隔符、保留单斜杠、同曲同名去重、大小写区分、pending 不入组、真实“未知流派”名称与空标签身份分离、重复源去重、原字段不变、双条件专辑成员、route、四 scope 排序持久化及不修改输入。
- 浏览器：冷进入、根统计/时长、管理菜单可达、专辑与全部歌曲、三种子视图排序、播放后返回保留、跨流派选中播放去重、全局搜索歌曲/流派集合展开、重扫/移除/清空后的迟到摘要。
- 邻近受影响路径：全局 `Mixed`、艺术家 `Singer Ensemble`、专辑艺术家 `Ensemble`、未知作曲家的 `Mixed` 均保留完整 a/b/c；年份 2022 的同专辑也保留 a/b/c，和流派交集路径明确区分。
- 页面和控制台错误：最终完整套及几何套均为空。
- 未覆盖：真实磁盘、硬件声音输出、完整动效矩阵、大规模性能/内存，以及旧三套全部断言。四视图排序模型独立保存已验证；没有穷举全部布局级别与每个滚动位置组合。

## 性能 / 时序

不声明性能优化或吞吐改进。生命周期以可控的 summary/scan gate 验证先后关系及清空后的迟到完成，无任意 sleep 或扩大超时来掩盖问题。复用现有窗口化/封面机制的代码未因本轮更改引入新调度协议；本报告没有规模性能测量。

## 发现

1. 初次流派脚本按旧年份脚本查找根工具栏“播放流派歌曲”；现有选择模式会隐藏该按钮，播放入口位于全局选择 dock 的“选择帮助 → 播放选中”。仅修正新测试的交互路径，实际选中队列通过。
2. 最初窄窗口工具栏换行；Frontend Agent 增加局部缩放后，几何复测发现滚动条槽令 640 的封面变为 162.42、分类圆 82.69。改用完整外层宽度后，最终尺寸恢复 165/84，456 封面 117.5625、圆 59.84375，按钮同行。
3. 旧 `yearLibrary.browser.test.mjs` 在 `sort` helper 等待“重新排序”按钮超时（调用约第 472 行）。该旧套所需排序入口已不符合现有年份分支；本次新增排序入口限定于 `genreMode`。此前根几何及年份完整专辑三曲检查已执行，focused 年份下钻另行通过。
4. 旧 `albumLibrary.browser.test.mjs` 第 147 行等待 43 张根专辑超时。fixture 中 `Mixed` 按现有同目录、缺 ALBUMARTIST 聚合为一张，当前共 42 张；旧套后续仍期望 `Mixed` 分两张。本次没有修改 `albumLibrary.ts`。focused 全局专辑完整成员检查另行通过。
5. 旧 `contributorLibrary.browser.test.mjs` 第 161 行等待面板内 searchbox 超时；当前入口打开全局聚合搜索。focused 三类贡献者下钻及本轮聚合搜索展开另行通过。没有修改旧套来把这些过时断言标记通过。

## 风险与临时缓解

没有实施临时缓解。真实桌面运行及上述未覆盖矩阵仍需在对应环境验收。旧浏览器脚本需要单独按现行产品规则维护，本轮保留原脚本及失败记录。

## 验证结论

本轮流派功能、搜索一致性、明确受影响的共享下钻路径及指定窗口的几何检查通过；可交主代理整合验收。三套旧浏览器整套仍未通过，不据此宣称全部历史 UI 回归已绿。原生文件读取与声音输出未验证。
