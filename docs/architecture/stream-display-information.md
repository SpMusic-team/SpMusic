---
doc_id: "ARCH-STREAM-DISPLAY-INFORMATION"
title: "流视图信息与电台名称契约"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "project"
created: "2026-11-06"
updated: "2026-11-06"
source_documents:
  - "user request: 解压 Downloads.zip 并按十张 Poweramp 截图补齐各流视图信息"
  - "Downloads.zip :: Screenshot_20261106-152402_Poweramp.png 至 Screenshot_20261106-152422_Poweramp.png"
  - "docs/architecture/streams-library.md"
  - "src/features/player/model/playlistSongLayouts.ts"
  - "src/features/player/components/PlaylistCard.tsx"
  - "src-tauri/src/audio/network.rs"
  - "src-tauri/src/library_streams.rs"
---

# 流视图信息与电台名称契约

## 范围

本轮补齐十种既有布局的电台名称、播放地址、来源标记和无封面状态。截图提供信息层级参考；继续使用现有主题、布局手势和 `PlaylistCard`，不复制外部播放器的背景、图标或另一套列表。

静态电台名称取自已经建立的播放 HTTP 响应的 `icy-name`。本轮不请求额外地址，不解析 ICY 动态曲目元数据，不搜索或下载网络封面，不引入依赖、权限或公开命令。

## 截图到布局映射

| 级别 | 截图时间 | 信息 |
| --- | --- | --- |
| 0 | 152402 | 两列大封面，名称与地址 |
| 1 | 152404 | 三列封面，名称与地址 |
| 2 | 152407 | 四列封面，名称与地址 |
| 3 | 152409 | 大封面行，名称、地址、下方音乐图标与“流” |
| 4 | 152411 | 中封面行，名称、地址、下方音乐图标与“流” |
| 5 | 152414 | 小封面行，名称、地址、右侧来源标记 |
| 6 | 152416 | 详细文本行，名称、地址、右侧来源标记 |
| 7 | 152418 | 紧凑文本行，名称与右侧来源标记 |
| 8 | 152420 | 极简文本行，名称与右侧来源标记 |
| 9 | 152422 | 双列紧凑文本，名称与各行右侧来源标记 |

名称和地址分别省略，不能将地址拼入名称后只剩一行。紧凑布局不渲染地址行。来源使用现有音乐图标与“流”文案；无真实封面时可使用项目已有的流图标作为静态占位，不伪造远程封面。

## 共享字段

Rust `AudioTrackRef` 和 `AudioFolderTrackRef` 各增加可省略的 `stationName?: string`，沿用 camelCase 与 `skip_serializing_if`。该字段代表服务器观察到的静态电台名称，与用户或播放列表提供的 `title` 分离。

描述符 `title` 保留显式标题或 URL 回退的含义，`fileName` 可以为解析后的可读显示名。前端 `Track`、`TrackSummary` 和歌曲卡片视图模型以可选 `stream: { url: string; stationName?: string }` 传递流信息，不将 URL 写进 artist，不将来源“流”伪装为专辑。

统一显示优先级为：根注册表的非空非 URL 显式名称、当前播放列表的非空非 URL 标题、当前播放响应的 stationName、缓存 stationName、其他可用非 URL 显示名，最后原规范 URL。URL 回退不能压住真实电台名称。该规则同时用于列表、当前播放、队列、搜索与名称排序，URL 身份和稳定 track ID 保持不变。

## 名称取得与后台保存

1. 网络 worker 从既有响应读取 `icy-name`，只保存到本次 `StreamStatus`。它不访问注册表、不触发额外网络，也不直接改变当前曲目。
2. 名称仅接受 UTF-8、trim 后非空、不含控制字符且至多 1024 字节的值。无效值忽略，不清空已有缓存；名称始终作为普通文本渲染。
3. runtime 在首帧成功准备时从 status 合并 stationName。后续无网络的 hydration 不能以空值或 URL 回退覆盖它。
4. 已接受的详情解析任务携带名称快照，使用现有 FIFO parser/details worker 完成元数据保存。controller 可向该后台 worker 注入注册表访问回调或服务；禁止在解码回调、runtime 命令循环或 latest-intent commit gate 中执行 JSON 写入与 fsync。
5. 保存完成或失败后，仍走原有 `TrackDetailsHydrated` 和 request/generation 栅栏发出 `Ready`。前端只接受当前结果，再调用一次既有 `library_get_streams` 刷新列表；不新增公开事件或命令，不让列表刷新先于缓存提交。

静态名称缓存按 URL 归属，不等同于当前选曲状态。后台保存只能更新仍存在的注册表成员，不能插入或复活已移除的条目；不得覆盖用户标题，也不得覆盖损坏或未来版本注册表。相同名称不重复写盘。保存错误记录可诊断日志，但不回滚已成功开始的音频，不将名称保存失败改成播放失败，也不宣称保存成功。

前端可以按 URL 保留本会话已接受的观察名称，合并到已有成员的行显示。这样保存失败后的旧磁盘快照不会让本次名称重新退回 URL；该合并不能增加已删除成员，也不能接受过时 Ready。重启后的持久缓存仍以实际保存结果为准。

## 既有注册表兼容

v1 `StoredStream` 新增可省略的 `stationName`、`titleOrigin: 'user' | 'playlist'`，新字段使用 serde 默认值。旧文件可读，不要求破坏性迁移。旧非 URL 标题且没有 origin 时保守视为用户标题。

手动非空非 URL 名称归为 user；导入的有效非 URL 标题归为 playlist。导入可更新 playlist 名称，但不能覆盖 user。没有显式标题的条目保持 URL 回退，并独立保存 stationName。创建时间不因名称发现或刷新而改变。

## 渲染与几何边界

继续使用同一个卡片和十级布局，来源与地址具有独立语义节点。补齐 pending、summary、播放详情、队列及播放栏映射，摘要指纹应包含会改变显示的 title/stationName；原来只比较 id/path 的缓存不可继续屏蔽名称更新。

如现有内容高度代表机制无法区分流的地址与来源组合，可在原 contentShape 中增加高位 16，并将所有相关形状枚举与数组同步到 32，隔离普通曲目代表；不重写虚拟窗口或滚动时序。混合本地曲目与流在滚动重入、布局切换和选择时不得引用错误高度。

## 方案取舍与质量属性

仅修改前端可补地址行，但无法从 HTTP 获取用户截图中的电台名称。把地址放进 artist/album 会污染普通曲目、统计和布局语义，因此不采用。独立网络抓取或新增元数据命令会让列表展示额外触网，本次也不采用。

选用现有播放请求、详情 worker、Ready 事件及列表命令，保留模块方向与取消边界。显示使用已有主题 token，缓存保存按名称变化执行，播放首帧和控制不等待磁盘，静态占位不请求图片。旧描述符的新字段可省略，普通本地曲目不受流专用节点影响。

## 所有权与验收

Frontend Agent 唯一写 `src/**` 与其实现说明，负责视觉字段、十级渲染、名称 resolver 和已接受 Ready 后的刷新。Rust/Tauri Agent 唯一写相关 audio、registry、DTO 及其测试，负责响应名称、后台缓存和 hydration 合并。共享 Rust 字面量测试由后端顺序修正，前端不得覆盖 Rust 生成物。Architecture Agent 只写本文；Test Agent 的新增测试文件需与实现者明确移交。

独立验收须覆盖十张布局的信息矩阵，长名称/长 URL、省略及选中状态；本地曲目没有流 URL/来源；无名称和无效响应头回退；显式用户名优于导入和服务器名；已有 URL 成员的名称更新、名称搜索排序、当前播放与队列同步、重启缓存；过时详情、删除后后台返回不复活、保存失败不打断播放；列出、添加、恢复与切换布局均不触网。混合列表还应验证内容高度测量与滚动重入。使用实际电台证明 icy-name 来源，同时用本地 HTTP fixture 保证可重复回归。
