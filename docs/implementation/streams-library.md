---
doc_id: "IMPL-STREAMS-LIBRARY"
title: "流根页面前端实现"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-11-06"
updated: "2026-11-06"
source_documents:
  - "user request: 按 Figma 实现流根页面，歌曲列表直接复用播放列表，并接通添加地址、导入和真实播放"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=9244-12914"
  - "docs/architecture/streams-library.md"
  - "docs/test/streams-library.md"
  - "user report: SomaFM 流加载后没有提示且无法切换歌曲"
---

# 流根页面前端实现

流根页接入现有 `PlaylistLibraryPanel` 的歌曲分支，由同一个 `AllSongsCard → PlaylistCard` 展示歌曲，继续复用分类标题、按钮、布局手势、虚拟窗口、选择和播放栏。首次进入使用两列大封面；`spmusic.streams.layout-level.v1` 单独保存用户布局，其他分类的布局默认值不变。分类图标使用本次设计的 48×48 SVG，圆形底色继续消费主题分类颜色。

## 数据与交互

`useAudioPlayer` 读取 `library_get_streams` 并将聚合源注册到已有 session descriptor resolver。`PlayerShell` 从独立的流聚合源构建 `streamSongs`，不通过本地 `allSongs` 猜测网络条目。页面包含加载、失败重试、空列表和搜索无结果状态。

更多操作提供添加地址、导入播放列表、重新排序和列表选项。添加表单检查 HTTP(S) 地址，不接受用户名或密码；保存请求防止重复提交，并保留可重试的失败状态。导入沿用现有系统文件选择入口，导入成功后刷新流聚合源。列出、添加和恢复不在前端请求远程元数据、时长或封面。

六种排序使用名称、既有喜欢反馈、累计播放次数、独立最近播放记录、稳定洗牌顺序和首次添加时间；随机顺序在普通刷新时保持稳定。局部搜索匹配名称和地址，全局搜索使用独立的流分类。流不会进入本地歌曲、专辑、艺术家、流派、年份、长曲目或本地最近添加聚合。

## 播放与恢复

流播放继续调用已有 load-and-play 命令，输入为规范 HTTP(S) URL。网络源由后端按类型解析。流队列使用独立 `streams` 来源与 `streams:library` 聚合源；重启恢复从零开始，不提交 seek。未知时长不会触发拖动进度操作，流也不提供需要可靠位置的书签入口。

已有电台名称由 descriptor 保留：收到播放详情或本地 hydration 结果后，`namedStreamTrack` 合并 registry / 播放列表中已知的名称，避免加载后退回原始 URL。列表行没有虚构艺术家、专辑归属或时长；“流”只作为来源显示。

URL 身份保留路径、查询参数的大小写和转义，不经过本地路径分隔符转换。最近播放和累计次数沿用原持久机制，流在一次激活内累计实际播放达到 30 秒记录一次；暂停、加载和跳转不会补计。

## 删除边界

流根页选择使用流 scope 和稳定 track ID，删除只调用 `library_remove_streams`。共用删除对话框新增可选的 `canDeleteFiles` 约束，流根页关闭物理文件删除选项，其他页面保持既有行为。流根页也不向本地全库的添加、创建或删除解析器提交 `scope:null`。

## 验证

前端已执行 `npm run lint`、`npm run build`，以及 `streams.model.test.mjs` 的 URL 身份、无伪造标签、六种排序测试。独立浏览器验收与真实网络播放证据由 Test Agent 维护在 `docs/test/streams-library.md`；浏览器受控 native transport 的结果仅证明页面和命令交互，不替代后端网络解码验证。

网络直链播放范围、HLS / PLS / 远程播放列表等未覆盖能力，遵循冻结的架构文档和后端实现说明。

## 慢流加载与失败恢复修复（2026-11-06）

原实现同时在已知来源选曲入口和歌曲卡片禁用条件中拦截 `selectionPending`，导致首帧准备未结束时不能提交新的选曲请求。根页卡片现在只保留真正的打开文件、传输操作、跳转、删除和导入锁；已知 descriptor 的新选择可以复用已有 request ID / generation 栅栏取代旧请求。旧请求迟到的成功、详情或失败都不能改变新选择。

当前选择失败统一由 `settleSelectionFailure` 释放选择状态并通过现有 sonner 提示一次后端错误；过时请求和用户取消不提示。原 `FILE_NOT_FOUND` 分支的重复提示已移除。没有增加前端超时、延迟或强制刷新，网络探测的结束条件仍由后端负责。

`streamSelectionRecovery.browser.test.mjs` 使用真实 `PlayerShell` / `PlayerSurface` 与受控 native transport，经实际 DOM 点击验证等待中的 A 可以被 B 替换、A 迟到成功或失败不会覆盖 B、当前错误可见且仅一次、失败后可重新选曲。已建立队列后，主播放控制器的“下一首”也能取代等待中的流；该按钮原有导航锁无需修改。测试服务使用临时独立 Vite 缓存，不改变项目配置或用户开发服务。
