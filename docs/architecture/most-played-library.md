---
doc_id: "ARCH-MOST-PLAYED-LIBRARY"
title: "最常播放分类与累计播放次数契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-05"
source_documents:
  - "user request: 按 Poweramp 文档及 Figma 9226:10916 完成最常播放页面，复用现有内容"
  - "docs/architecture/poweramp-recents-views.md"
  - "docs/architecture/recently-played-library.md"
  - "src/features/player/model/recentlyPlayed.ts"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src/features/player/components/PlayerShell.tsx"
  - "src/features/player/components/PlaylistLibraryPanel.tsx"
---

# 最常播放分类与累计播放次数契约

## 摘要与范围

复用当前歌曲列表、封面、虚拟化、布局、搜索、选择、控制器、动效和最近播放的有效实听判定，在分类 `most-played` 展示累计次数最高的歌曲。歌曲行显示累计次数，不显示字母索引，不允许手动拖动改变次数顺序。设计的具体视觉以 Figma `9226:10916` 的高保真上下文为准。

当前曲库没有 Poweramp 的 `folder_files` 数据库。采用既有前端 localStorage 与路径身份，新增纯统计模型即可；无需 Rust command、事件、依赖、权限、数据库或音频引擎改动。历史统计无法从最近播放的一条时间记录还原；旧最近记录不补造次数。

## 模块边界与数据契约

`RecentlyPlayedTracker` 继续负责已确认后端状态的累计实听判定。`useAudioPlayer.applyAudioState` 已通过 selection、generation、transport intent、seek 等保护后，现有 tracker 返回 true 的同一提交点，分别更新最近记录和最常统计；不得再创建一个跟随视觉进度的计数器。一次播放轮次首次实听达到曲长 50% 计 1 次，暂停恢复和 seek 不新增轮次，同歌新 generation 或已确认明确重播沿用 tracker 的现有规则。

新增 `mostPlayed.ts` 负责统计读写、偏好校验和列表派生。建议契约：

```ts
type MostPlayedEntry = { sourcePath: string; playCount: number; lastPlayedAt: number }
type MostPlayedStorage = { version: 1; entries: MostPlayedEntry[] }
type MostPlayedOptions = { limit: number; from: number; direction: 'asc' | 'desc' }
```

存储键独立为 `spmusic.most-played.v1`；选项可用独立版本键。路径使用 `normalizeAudioSourcePath`；次数为正安全整数，时间为有限正 Unix 毫秒数。读入坏条目忽略、坏整体回退空集；同路径重复条目保留最新有效记录，不把重复存储相加导致虚增；同时间可取较高次数。递增不得溢出安全整数。写失败保留内存状态及正常播放。扫描期间不因为暂时空库删统计；当前库不存在的路径不展示，原路径恢复后可重新关联。路径重命名不迁移。

现有最近播放与最常统计各自持久化，任一写失败不得阻止另一个更新。两者共享同一次真实播放提交事件，拥有独立清空语义。

## 集合、排序与选项

按规范化路径将当前 `allSongs` 与统计求交集，一曲一行，筛选 `playCount > 0 && lastPlayedAt > from`。先按累计次数降序选前 N 首，再按用户选定次数方向显示。两个阶段均用歌曲标题和规范化路径作为稳定次级键，保证截断和同次数排序可复现。搜索作用于已选定集合。

时间窗口仅筛选最后一次达标播放时间；次数仍是累计次数，不能标成该窗口内次数。默认 `from = 0`，表示全部历史。排序维度固定播放次数，默认降序，只开放升降序。条数输入最少 2，提供“查看全部”使列表不截断；应把它与全库歌曲分类区分。

Poweramp 文档只证明条数下限 2，没有取证默认条数。本项目首版默认 100 首，明确作为 SpMusic 策略，不宣称是 Poweramp 默认值。通过列表选项可调整条数与次数方向；时间筛选如开放，需以清晰的最近达标播放时间文案表达，不能伪装窗口累计统计。

根菜单“清空”应有明确确认，清除最常统计，保留最近播放记录、音乐文件和正在运行的播放快照。清空不重置当前轮次 tracker，防止同一轮已计数播放再次被累计；下一次新播放轮次可重新进入。若列表选项或清空存在当前轮次并发提交，以前端事件顺序为准，不重建播放快照。

## 播放来源与复用

`PlaybackQueueOrigin.kind` 增加 `most-played`，为跨来源派生集合，不带 playlist 的 sourceScope/sourcePlaylist。播放、随机、选择歌曲、队列持久化与校验、重启恢复、封面暖缓存及从播放器返回来源的所有 derived-song 分支支持该 kind。快照标题“最常播放”。

`PlayerShell` 派生并传入最常歌曲和次数；`PlaylistLibraryPanel` 复用歌曲分支，保留模型产出的顺序，禁用字母索引与手动排序。次数仅由最常页面传给共享歌曲行的可选展示属性，其他歌曲页面不出现该计数文本。

计数增加、排序切换、窗口或条数变化、清空、搜索、扫描均只改变展示，不替换已启动的播放快照；下一首依旧按建队列时的序列执行。

## 备选方案与质量属性

选择前端按路径聚合统计，因为真实播放 tracker 和 localStorage 已存在，每轮最多提交一次，新增数据量每曲一条。独立逐次历史表会引入无必要存储；直接照搬 Poweramp SQL 会扩大数据库迁移与跨层契约；借用最近记录推断次数会制造错误历史，均不采用。

列表派生约 O(n log n)，应 memoize，避免播放轮询或封面更新时不必要排序。启动只读取小型统计数据，不阻塞扫描；内存随已达标路径线性增长。所有平台沿用同一现有路径规范化及前端存储边界；localStorage 耐久性与现有会话相同，未完成轮次不跨重启延续。未来若数据库迁移获得授权，可以替换存储适配层而保留计数事件与派生集合语义。

## 实施所有权与验收

Frontend Agent 独占本轮 `src/**` 业务实现及其实现说明；Architecture Agent 只写本文。Rust/Tauri 无写集。Test Agent 在实现结束后独立验证，如需测试文件由主 Agent 另行分配，避免同时写同一路径。

- 49% 不计数、达 50% 计一次、继续播放不重复计、第二轮再加一；seek、暂停、旧 generation、未知时长和长采样空档沿用 tracker 防护。
- 旧最近记录不会伪造次数，统计重启恢复，坏存储、写失败、重复路径和扫描暂空可容忍。
- Top-N 先选集合再切换方向，窗口基于最后达标时间且严格大于，累计次数不变；同次数稳定排序。
- 页面复用歌曲列表，显示次数，无字母索引，布局、搜索、选择、随机和播放可用；空态按钮与控制器禁用正确。
- 播放来源返回最常页面且重启保留；计数和清空不会修改运行快照；最近播放及其他来源行为不回归。
- 独立验证模型、存储、队列校验及浏览器交互，主 Agent 执行 build/lint。
