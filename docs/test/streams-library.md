---
doc_id: "TEST-STREAMS-LIBRARY"
title: "流根页面与网络播放独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-06"
source_documents:
  - "user request: 按 Poweramp 参考和 Figma 实现流根页面，复用播放列表歌曲列表"
  - "user clarification: 同时实现添加地址、导入和真实播放"
  - "docs/architecture/streams-library.md"
  - "docs/implementation/streams-library.md"
  - "docs/implementation/streams-backend.md"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=9244-12914"
  - "user defect report: https://ice5.somafm.com/groovesalad-128-aac 在 Poweramp 可播放，SpMusic 无法播放"
---

# 测试报告：流根页面与网络播放独立验证

## 摘要

目标功能的独立验收通过：流根页面复用歌曲卡片，支持地址添加、校验、去重、六种排序、搜索、混合列表导入、恢复和安全删除；生产 HTTP/Symphonia/Rodio 链路通过真实本地 HTTP 音频和系统输出设备测试。

本报告不宣称全部历史浏览器脚本通过。若干旧脚本失败已在未修改的 HEAD 隔离工作树重现，另一个旧菜单脚本的无效区域名称由 HEAD 源码确认。新验收脚本补充验证了实际本地歌曲播放、返回和混合来源恢复；既有长曲目验收最终完整通过。

## 范围与证据来源

- 前端：真实 `PlayerShell`、`PlayerSurface`、`useAudioPlayer` 和歌曲卡片；只替换 native transport，以明确验证 UI 与命令契约。
- 后端：真实 TCP HTTP 响应、生产网络源和 Symphonia 解码；另显式运行使用系统输出设备的 Rodio runtime 测试。此证据不依赖 UI mock。
- 存储与导入：独立重跑 registry、M3U8 和播放列表持久化回归。
- 新增独立测试：`src-tauri/src/audio/network_tests.rs`、`src/features/player/components/streamsAcceptance.browser.test.mjs`；在已有 tracker 测试补充未知时长流的 30 秒实际播放门槛。
- 测试基础修正：`folderCardLayouts.model.test.mjs` 原先没有映射其已有的 `playlistSongLayouts` 运行时依赖，仅修 data URL loader，不改业务和断言。该依赖已用 `git show HEAD` 确认在本次之前存在。

## 环境

Windows；Node.js v24.19.0、npm 11.17.0、cargo 1.98.1；浏览器为 Playwright 驱动的 Edge。Playwright 使用已有安装：

`C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`

当前页面由 Vite `http://127.0.0.1:5173` 提供。历史失败反证使用独立 Vite 5174 和 detached HEAD `7a5fefd558ee01f89d98178d07ead002390fabfb`。验证后已停止 5174 并清理隔离工作树；当前业务目录未被基线覆盖。

## 命令与结果

所有命令在 `D:/spmusic` 执行，除明确标明的 HEAD 反证。

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$tests=@(rg --files src/features/player/model -g '*.test.mjs')
node --test --test-concurrency=2 @tests
node src/features/player/components/streamsAcceptance.browser.test.mjs
node src/features/player/components/longTracksAcceptance.browser.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib audio::network::tests -- --test-threads=1 --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib stream_runtime_tests -- --ignored --test-threads=1 --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib library_streams::tests -- --test-threads=1 --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib m3u8 -- --test-threads=1 --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib library_playlists::tests -- --test-threads=1 --nocapture
```

| 验证 | 独立结果 |
| --- | --- |
| 全部模型 `.test.mjs` | 137/137 通过 |
| 流根页与当前本地播放浏览器验收 | 完整通过，页面异常为空 |
| 长曲目浏览器验收 | 稳定后完整重跑通过 |
| 真实 HTTP/PCM | 9/9 通过，执行 17.52 秒 |
| 显式启用实际系统输出设备 runtime | 3/3 通过，执行 2.80 秒，无设备跳过路径 |
| 最终流 registry（含长签名 URL） | 4/4 通过，最后独立热跑 0.23 秒 |
| M3U8 原路径与导入回归 | 13/13 通过 |
| 播放列表持久化与列表操作 | 26/26 通过 |

`npm run lint`、`npm run build`、`cargo check --locked` 由主 Agent 最终执行，本 Test Agent 没有重复冒称独立构建。Rust 单测出现 MSVC 创建导入库/对象文件的 `linker_messages` 提示，测试正常通过；该提示不是 Rust 业务编译错误。

## 页面、交互与视觉验收

`streamsAcceptance.browser.test.mjs` 完整验证：

- 流集合独立于本地 allSongs，使用同一 `PlaylistCard` 结构，保留独立布局偏好；首次两列大封面。
- 六种排序可操作；最近排序使用独立最近播放记录，普通刷新不重新打乱随机顺序。
- 标题与 URL 搜索只筛选流；非法 scheme 不发送添加命令；重复 URL 更新名称且不增加条目。
- 添加保存失败时原列表保持可见，可在表单内重试；读取失败可重试恢复。
- 混合列表导入保留本地歌曲并新增流；同路径本地曲目去重，流不泄漏到本地 allSongs。
- 实际本地曲目点击仍发送本地路径，队列正确，关闭与返回媒体库正常。
- 流点击发送保留大小写和查询参数的 URL；队列只含当前流候选集；重载恢复不发 seek，混合导入列表仍在管理集合。
- 选择删除只调用流 registry 移除命令，物理文件删除按钮禁用；没有文件删除调用。
- 列表展示未向 URL 发起时长、元数据或缩略图预热探测。

640×1024 截图的实测几何：分类圆 84×84，标题 57px，图标 48×48，两列共享 level0，封面 215×215（现有歌曲卡片规格）；返回图标 48×48，随机/播放/搜索图标各 32×32，更多图标 48×48。六个静态 SVG 均为非空本地文件，root 尺寸与有效渲染尺寸相符。窗口外壳、底部播放栏、快速索引继续沿用应用现状。截图中的封面为空白占位，因为测试流没有封面元数据，不使用设计稿示例专辑图片充作真实流封面。

视觉证据位于 `C:/Users/winkeses/.codex/tmp/streams-independent/`：

- `streams-root-640.png`、`streams-root.png`、`streams-after-add-import.png`
- `streams-visual-evidence.json`：本地资产路径、字节数、root 尺寸和实际 DOM 几何

主 Agent 已亲自查看最终 640 截图并核对目标。

## 网络、输出与生命周期

9 个 HTTP 测试使用真正响应的本地 TCP 服务和生成的非零 WAV PCM，覆盖：正常音频 EOF；连续传输超过 5 秒仍可继续；播放中无进展超时；404；首帧读取超时；慢首帧取消；同 URL 多会话全取消；HTTP Content-Length 截断；HTTP 完整但 WAV 声明音频长度不足；以及合法音频后未耗尽 padding 不被误报截断。后两类由不同测试构造，避免通过粗暴“任何 EOF 都报错”掩盖异常。

慢首帧 callback 在约 100ms 发出取消，断言调用方在 750ms 内返回 `SUPERSEDED`。实际输出 runtime 的慢重播/停止测试断言在 900ms 内返回，并核对停止后旧任务没有恢复播放；这是上限断言，不把它表述为测得的精确延迟。

实际设备测试覆盖播放、暂停、停止、重播、本地源替换、准备阶段前后取消、播放中断流保持 `Error`，以及普通 Play/Transition 对同 URL 失败后的重新连接。网络 callback 不执行阻塞 IO；队列设计为 8×4096 i16（64 KiB）外加生产/消费块及解码探测缓冲。本轮确认容量边界与背压代码和取消用例，没有执行长时间进程内存曲线基准。

## 跨层契约

管理命令、camelCase 输入/输出与 `sourceKind='streams'` 聚合源和 `sourceKind='stream'` 曲目契约已核对。URL 不走本地路径的分隔符/大小写处理，fragment 规范化、稳定 ID、首次创建时间与非空标题更新均有 registry 断言。损坏或未来版本存储不可被空集合覆盖；超过 1024 字节的签名 URL 可作为回退名称往返，自定义名称仍有 1024 字节上限。

流统一未知时长且不可 seek；恢复从源头开始。网络/读取失败为 `PLAYBACK_FAILED`，过期准备为 `SUPERSEDED`，不把传输或容器截断当作正常 `Ended`。Tauri 等待音频 runtime 的入口已采用异步阻塞任务边界；本轮是代码契约核对与真实 runtime 测试，没有执行完整原生 WebView 的 IPC smoke。

## 历史浏览器脚本失败与 HEAD 反证

以下失败均实际执行过，不能作为通过项计入。未为本次流功能修改这些旧脚本的业务期待或放宽断言。

| 脚本 | 当前失败点 | HEAD 反证 |
| --- | --- | --- |
| `allSongs.browser.test.mjs` | :143 文件夹选择编辑器 overlay 拦截点击 playlists | 未修改 HEAD 同处复现 |
| `importedPlaylistArtwork.browser.test.mjs` | :151 期待 256px thumbnail 后出现 512px hero 调用；可视封面已经加载 | 未修改 HEAD 同断言复现 |
| `allSongsController.browser.test.mjs` | :156 等待旧控件位置/名称“随机播放全部歌曲” | 未修改 HEAD 同 locator 超时 |
| `playerReturnNavigation.browser.test.mjs` | :487→:122 编辑器 overlay 拦截点击 songs | 未修改 HEAD 同处复现 |
| `libraryPersistence.browser.test.mjs` | :122 旧导入 fixture 的本地 registry 数量等待超时 | 未修改 HEAD 同处复现 |
| `playbackSourceOrder.browser.test.mjs` | 全部 12 场景在旧 fixture 等待中超时，尚无 native loads | HEAD 以 `SPMUSIC_TEST_FILTER='all songs ascending UI'` 重现首个相同准备失败；未重复全部 12 个同类等待 |
| `libraryRootMenu.browser.test.mjs` | :86 等待不存在的“文件夹管理”region | HEAD `PlayerSurface.tsx` 已将 folder 路由交给 `FolderHierarchyPanel`，后者 `aria-label={category.label}` 为“文件夹”（当前 :354）；该分支与本次未变。未另跑 HEAD 菜单脚本 |

菜单脚本只适配本次已实现的流操作矩阵和空流命令 fixture；其余分类断言保留。上述旧菜单失败发生在 folder 分类、尚未进入流矩阵；新增流验收已通过真实菜单的添加、导入和排序行为。

反证步骤：在 `D:/spmusic/.verification/streams-baseline` 创建 detached HEAD，使用 5174 启动独立 Vite，设置 `SPMUSIC_TEST_ORIGIN=http://127.0.0.1:5174` 运行对应原脚本。除 sourceOrder 使用其已有过滤环境变量外，未修改基线脚本。精确失败日志保存在视觉证据同目录的 `baseline-*.log` 与 `baseline-summary.json`。结束后停止该端口和其 npm 父进程，并核验绝对路径后移除工作树；残留目录和 5174 监听均已清理。

长曲目验收初次遇到编辑期间 HMR 导航，错误诊断自身的旧 window 引用失效；业务稳定后完整重跑通过。新流脚本屏蔽测试页 Vite HMR websocket，显式导航仍加载当前模块，避免其他 Agent 编辑文件干扰验收。

## 限制与结论

- 初轮已验证真实 HTTP WAV 解码与系统设备输出；当时没有 MP3/AAC/OGG 压缩网络样本或公网 HTTPS/TLS 握手样本，不能由 WAV 测试推定所有编码和服务端组合已实测。后续用户提供的 SomaFM AAC 地址验证另见下节。
- 未运行 `npm run tauri dev` 的原生 WebView 全链路 smoke；UI 的受控 native transport 与实际 Rust 输出测试是分层证据，不能写成同一次端到端点击实测。
- 未执行长时间直播内存/网络稳定性基准；HLS、PLS、ICY 元数据、动态鉴权和 Range seek 不在本次冻结范围。
- 历史浏览器脚本问题由 HEAD 反证或相同 HEAD 源码约束区分，保留后续测试维护需求；本报告没有将整个浏览器回归套件标记通过。

初轮建议：流根页及最小添加/导入/真实播放链路通过上述目标范围验收。该结论保留原生 WebView smoke、压缩网络编码与真实 HTTPS 服务组合的明确覆盖限制；不代替下节实际电台缺陷的专项结论。

## SomaFM 实际 AAC 电台缺陷复验（2026-11-06）

此节记录首次 WAV 验收之后用户报告的实际压缩流缺陷，不将前述 WAV 通过结果推广为 AAC 兼容性证明。目标地址为 `https://ice5.somafm.com/groovesalad-128-aac`；Poweramp 可播是用户提供的对照信息，本 Test Agent 没有在同设备操作 Poweramp。

### 独立修复前基线

- 使用 `curl.exe --location --max-time 8 --connect-timeout 5 --header 'Icy-MetaData: 0' --user-agent 'SpMusic/0.1'` 访问该地址，收到 HTTP 200、`Content-Type: audio/aac`、Icecast 响应和 `icy-br: 128`，TLS 校验结果为 0。8 秒人为限时后收到 383296 字节；curl 的 28 退出原因是测试主动限制直播捕获时长，不是起播失败。
- 有限捕获逐帧解析为 1032 个完整 ADTS 帧，恰好覆盖全部捕获字节；全部 MPEG ID 为 1，采样率索引 4（44100 Hz），声道配置 2，帧同步字为 `FF F9`。样本 SHA-256 为 `29FF1D3D501732FBBB4C7922F1912438978E4E32538B2566257822FD90CF2E35`。
- 网络不可达、HTML 错误页和 HLS 被排除为本次失败的唯一原因。实现者首次另一次 curl 曾收到 403，但独立 curl 和生产公开流测试均能接收该流；不能用那一次 403 解释持续无法解码。
- 锁定的 `symphonia-codec-aac 0.5.5` 中，`adts.rs` 的探测标记只有 `FF F1`，`AdtsHeader::sync` 同样硬编码 `0xfff1`；与整段实际 MPEG-2 ADTS 的 `FF F9` 不匹配。源码说明与下面的生产路径失败证据一致。

独立执行：

```powershell
$env:SPMUSIC_PUBLIC_STREAM_URL='https://ice5.somafm.com/groovesalad-128-aac'
$env:SPMUSIC_CAPTURED_STREAM_FILE=Join-Path $env:TEMP 'spmusic-somafm-independent/sample.aac'
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib supplied_ -- --ignored --nocapture --test-threads=1
```

修复前结果为 **0 通过、2 失败**：有限真实捕获经原 `SymphoniaAudioSource::open_stream` 返回 `IoError UnexpectedEof`；同公开 HTTPS 地址经原生产网络路径在 15.0058593 秒仍未产生首帧，只有测试外部取消后才返回 `SUPERSEDED`。因此，除了 ADTS 版本识别缺陷，还存在持续有输入时缺乏内部准备上限的问题。

捕获、HTTP 响应头和基线摘要仅保存在 `$env:TEMP/spmusic-somafm-independent/`，没有将广播音频提交到仓库。

### 修复点与反证范围

后端使用仅网络源启用的 ADTS reader，按 MPEG-2/MPEG-4 ADTS 的帧长和 7/9 字节头读取原始 AAC packet，复用原 AAC 解码器；不替换 payload 字节、不新增依赖、不修改本地文件 reader。CRC 字段会正确跳过，本轮不宣称校验 CRC。准备阶段另外受十秒总时限和 256 KiB 探测预算约束，首块 PCM 就绪后解除；既有五秒无进展读取超时、固定容量 PCM 队列和取消栅栏仍生效。取消使用不可重试的 IO 错误，公网测试在取消后实际等待并确认 decoder worker 退出。

实现者还记录了前端 DOM 基线：等待首流时，另一流卡片的实际按钮被禁用；除了 hook 入口挡板，歌曲列表将 selection pending 一并当成了不可激活状态。失败信息此前未在播放列表控制器可见区域呈现。修复允许已知目标的新选择取代旧 pending，旧请求仍由 request/generation 栅栏隔离；当前失败集中显示一次 toast。下面的独立浏览器复验使用真实组件和按钮点击，native transport 仅用于控制请求的挂起及返回顺序。

### 独立修复后执行结果

| 命令 / 场景 | 独立执行结果 |
| --- | --- |
| `cargo test --locked --lib network_adts -- --test-threads=1 --nocapture` | 4/4 通过：MPEG-2/MPEG-4、CRC 头、单字节分段、payload 伪同步字、无效配置和帧内截断 |
| `cargo test --locked --lib audio::network::tests -- --test-threads=1 --nocapture` | 12/12 通过，两个需显式环境的公网测试在此命令中按设计忽略；包括原 HTTP WAV 回归、自有无后缀 MPEG-2 AAC 解码、持续无效数据的字节预算和慢速无效数据的十秒准备上限 |
| `cargo test --locked --lib supplied_ -- --ignored --test-threads=1 --nocapture` | 3/3 通过：同一有限真实捕获、同一用户 HTTPS 流的生产 source、同一流的真实 OS/Rodio 输出 |
| `cargo test --locked --lib stream_runtime_tests -- --ignored --test-threads=1 --nocapture --skip supplied_` | 原三项实际音频设备回归 3/3 通过，覆盖暂停/停止/重播/本地替换、中途错误保留、慢准备取消与旧代隔离 |
| `node src/features/player/components/streamSelectionRecovery.browser.test.mjs` | 通过：实际流卡片在 A 等待时可点 B，实际主控制器 next 可覆盖慢流，A 迟到成功或失败不污染 B，当前失败 toast 可见且恰好一次，之后可重新选曲 |
| 原 `streamsAcceptance.browser.test.mjs` 的临时 cache 兼容副本 | 原业务断言全部通过：共享卡片、本地隔离、六排序、地址搜索/添加/去重/导入、队列与恢复、存储失败重试、安全移除及列表不触网 |

Rust 命令均在 `D:/spmusic/src-tauri` 顺序执行。实际公网命令使用前述两个环境变量，没有改用另一个电台地址或降低 TLS 校验。

此次独立实测，同一 HTTPS 流的生产 source 在 **637.3534 ms** 后准备好首帧，识别为 44100 Hz、双声道；随后连续十二秒得到非零 PCM，未出现错误或提前结束，取消后确认 worker 退出。同一地址经实际 OS 音频设备与 Rodio 在 **508.7365 ms** 进入 `Playing`，持续十二秒后完成暂停、恢复、停止，再切换到本地 WAV。设备测试音量为零，但实际创建了系统输出流并消费生产解码源。数值是本轮公网单次观测，不是固定性能承诺或长期稳定性基准。

修复前有限捕获的 `UnexpectedEof` 和同 URL 等待十五秒无首帧两项失败，现在都转为通过。合成测试使用本项目自有正弦 PCM 经 Edge WebCodecs 编码的 AAC-LC 样本（`src-tauri/src/audio/test-fixtures/synthetic-mpeg2-aac-lc.aac`），因此确定性回归不依赖保存或分发电台音乐。

浏览器独立运行使用 `SPMUSIC_TEST_ORIGIN=http://127.0.0.1:5175` 与现有 `SPMUSIC_PLAYWRIGHT` 路径，Vite 使用独立临时 cache。原 streams 验收脚本仅在临时副本中将依赖 URL 匹配扩展到 `/@fs/.../deps/`，将 HMR WebSocket 端口设为 5175，并保留原脚本的资产相对 URL 基址；未改业务代码、fixture 期待或任何验收断言。临时副本保存在 `$env:TEMP/spmusic-somafm-independent/streamsAcceptance-cache-compatible.mjs`。focused 脚本屏蔽 HMR 后有开发 WebSocket 控制台警告，业务 `pageerror` 断言为空且全部交互断言通过。

Rust 测试构建有一条 MSVC 本地化“正在创建库/对象”stdout 被 rustc 记作 `linker_messages` warning；测试退出码为零，未将它隐藏或误报为业务编译错误。主 agent 对最终源码执行的 `npm run lint`、`npm run build`、`cargo check --locked` 均通过；这些主 agent 检查与上述 Test Agent 独立运行的测试分别记录。实现者另执行的本地 source 32 项回归通过，本轮 Test Agent 没有重复将其计为独立结果。

### 本次结论与保留限制

此地址的 MPEG-2 ADTS 起播缺陷、持续输入时无限准备、加载中无法替换选曲及当前失败无可见提示，均有对应修复点和上述反证测试，专项验收通过。该结论覆盖用户提供的同一实际 HTTPS AAC 流与本轮自有合成 AAC-LC 样本，不推广为全部 AAC profiles、全部电台或所有压缩格式的兼容性结论。

原生 WebView 从按钮点击到 Rust 再到设备输出的同一次端到端 smoke 仍未执行；本轮证据是实际 HTTPS/Rust/Rodio 与真实 React 组件受控 transport 的分层验证。未执行小时级直播稳定性或内存基准；HLS、PLS、ICY 元数据、动态鉴权、AAC 多 raw block 和其他 profile 未因本次修复而进入支持范围。运行中的原生进程需完成重编或重启后，才能使用 Rust 解码修复，仅刷新网页不能替换旧后端。
