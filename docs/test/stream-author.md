---
doc_id: "TEST-STREAM-AUTHOR-2026-11-07"
title: "流播放控制器作者信息验收"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "streams"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "user request: 若播放流成功时能看到作者，则把第二行展示的网址改成作者"
  - "src/features/player/components/PlaylistPlaybackDock.tsx"
  - "src/features/player/model/audioTrackModel.ts"
  - "src/features/player/hooks/useAudioPlayer.ts"
  - "src-tauri/src/audio/network_icy.rs"
  - "src-tauri/src/audio/runtime.rs"
  - "src-tauri/src/audio/controller.rs"
  - "user request: 列表对应流第二行显示作者，流根页面移除字母索引"
  - "src/features/player/components/PlayerShell.tsx"
  - "src/features/player/components/PlaylistCard.tsx"
  - "src/features/player/components/PlaylistLibraryPanel.tsx"
---

# 测试报告：流播放控制器作者信息

## 摘要

作者展示专项已独立通过：真实本地 HTTP 的 ICY 元数据经生产解码路径提供作者，浏览器处理迟到作者、更新、清空、选曲隔离和失败恢复。整套网络回归仍存在不稳定失败，本报告不把专项通过扩展为完整发布结论。

本轮追加列表与索引验收也已通过：对应当前流的列表第二行同步作者，无作者回退网址；流根不显示字母索引，所有歌曲和播放列表根分类的既有索引保留。本轮只改前端，未重跑 Rust；下述 Rust 记录保留为上一轮证据。

## 范围

控制器及对应当前流的列表第二行有作者显示作者，无作者显示完整流地址；其他流继续显示自己的网址，节目作者不作为电台名写盘。验证元数据读取、既有 Ready 事件、迟到更新及选曲隔离。本轮追加流根移除索引与空白缩放相邻回归。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent、Rust/Tauri Agent。
- 修改范围：ICY 音频去元数据、当前会话作者、既有 Ready 事件、前端映射及控制器第二行。
- 复现基线：独立浏览器在映射已修而事件门禁未修时，初次选曲完成后发送作者 Ready；15 秒后第二行仍为网址，`playback.track.artist` 为空，无页面错误，命令退出 1。
- 已知证据：原网络请求关闭 ICY 元数据，流映射清空作者；初次详情完成后门禁清除 pending，使后续 Ready 被丢弃。
- 主张因果链：流作者字段 → 既有会话 Ready → 当前播放 Track.artist → 第二行作者或网址。
- 证据缺口：本报告后续各节区分真实 HTTP、真实浏览器与 mock native transport。

## 命令

- `node --test src/features/player/model/streamAuthor.model.test.mjs`：3/3 通过。
- `$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'; node src/features/player/components/streamAuthor.browser.test.mjs`：最终增强矩阵通过，退出 0。
- 本轮上述浏览器命令再次退出 0：含对应流列表实时作者、其他流隔离、0–9 布局密度、混合列表、失败恢复、索引与空白区域缩放；Model 3/3 再次通过。原始流列表模型仍不持久化作者，由当前播放身份叠加显示。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib icy_ -- --test-threads=1`：8/8 通过，其中包含 3 个 HTTP ICY、3 个解复用/解析及 2 个相邻 source policy 用例。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib stream_artist -- --test-threads=1`：1/1 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib progress_continues_beyond_five_seconds_without_total_lifetime_timeout -- --test-threads=1`：1/1 通过，测试执行 6.62 秒。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib existing_playback_response_exposes_only_valid_station_name_without_extra_requests -- --test-threads=1`：1/1 通过，包含 6 个电台名称 case，执行 0.07 秒。
- `git diff --check -- src/features/player/components/streamAuthor.browser.test.mjs src/features/player/model/streamAuthor.model.test.mjs docs/test/stream-author.md`：通过。
- `npm run lint`、`npm run build`、`git diff --check`：主 Agent 报告最终通过；`cargo check`：Rust/Tauri Agent 报告通过。本 Test Agent 不重复认领这些命令。
- `npm run tauri dev`：未运行。

Rust/Tauri Agent 另运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib network::tests -- --test-threads=1`，最终为 15 通过、1 失败、2 ignored，失败为旧电台名称 case 0 连接失败。此前整套中还曾出现旧长时 progress 连接中断，独立单跑则通过。本 Test Agent 未再重复整套；上述独立单项结果不能消除整套不稳定性。

浏览器使用自有 Vite 5178、TEMP 缓存、Edge headless；测试 mock native command/event，真实加载 PlayerShell、hook、组件与 CSS。启动命令：

```powershell
node --input-type=module -e "import {createServer} from 'vite'; const server=await createServer({cacheDir:process.env.TEMP+'/spmusic-stream-author-vite',server:{host:'127.0.0.1',port:5178,strictPort:true}}); await server.listen(); server.printUrls();"
```

测试结束已关闭浏览器，精确中断自有 Vite session；未操作用户的 5173 服务。

## 人工检查

物理设备、打包 WebView 及外部电台当前节目人工检查未执行。

## 根因与因果链反证

纯映射测试通过时，真实浏览器迟到 Ready 仍失败，反证“只改显示表达式即可”的假设。修复事件门禁后同一测试收到作者、更新作者、null/空白回退网址均通过。

真实 HTTP AAC 用例通过生产 `open_with_status` 连接和解码，将每 97 音频字节交错的 ICY 块去除后，与原始合成 AAC 前 4096 个 PCM 样本逐项比较一致，且作者为 `Artist`。另 HTTP 短写用例验证首位作者、零块保持、明确作者更新、纯标题清空；截断元数据用例验证记录播放错误，不能以 clean EOF 掩盖。不是只在 DOM 中隐藏网址。

对于旧网络套件不稳定，提出过“HTTP fixture 只 read 一次请求头导致未读字节/RST”的替代假设；实现者改成有界完整读取请求头后，整套仍发生连接失败，因此该假设未被证明，亦不能将套件失败归因于无元数据 wrapper。最终实现仅在有效 metaint 时启用解复用，普通 HTTP 保留直接读取路径；这属于范围明确的分支，不能作为未证实的根因结论。

## 跨层契约

既有 Rust `AudioTrackDetailsChanged::Ready` 的 `kind/requestId/generation/track` 与 TypeScript union 对齐；作者复用 `AudioTrackMetadata.artist`，未新增公开事件或字段。`audio_track_details_changed` 方向仍是后端至前端，`null` 表示清空作者。只读核对 controller 的 GetState/GetCurrentTrack 路径：在 runtime 当前会话作者实际变化时发送 Ready，动态更新不再被新选曲 latest intent 截断；原静态详情 hydration 发送合并后曲目，防覆盖最新作者。

## 回归覆盖

- 初始无作者 → 迟到作者 A → 作者 B → null/空白 → 网址 → 新作者。
- 错误 generation、旧 request、同 id 错误 sourcePath、切台新 pending 期间旧 Ready 均不能污染当前展示。
- 流列表对应当前 sourcePath 的行随作者 A/B/null 实时更新；其他流保持网址。普通混合播放列表中同源流同步作者。切到普通歌曲后原流回退网址，同 id 错误 sourcePath 的 Ready 不会污染列表。
- 0–6 布局原第二行显示作者；7–9 布局继续隐藏第二行，未增加紧凑视图密度。“流”标记保留；控制器无该标记；流进度 range/thumb 隐藏，普通歌曲正常可见。
- 流根索引 DOM 为 0；所有歌曲与播放列表根分类索引 DOM 为 1。普通 PlaylistPanel 原先没有索引，保持该行为。索引位于 content section 同级，测试检查其父容器，不用错误的后代选择器制造通过。
- 移除流索引后，在 hit-test 确认的卡片外空白区域使用物理 Ctrl+wheel，布局 9→8 正常；之后还能缩回 4。
- 本地歌曲 artist/album 保持；作者更新不改电台标题、不重复刷新流 registry。
- 即时选曲失败恢复旧流后，旧成功会话的新作者继续接受。
- 新选曲 pending 期间观察到旧流新作者或明确清空，pending 时不呈现；新选曲失败恢复旧流后立即应用最新值，无须等待下一次元数据。
- 后端：真实 HTTP AAC 的 PCM 一致、作者更新/零块/清空、metadata 最大 4080 字节/短读/截断、runtime 重复值抑制、晚详情不覆盖、旧 generation/停止/会话替换隔离。

## 性能 / 时序

本任务没有性能优化主张。作者更新依赖既有播放状态轮询；浏览器以条件等待检验可见结果，不以任意长延时模拟成功。解复用单块上限 4080 字节，无整流缓存或新增 HTTP 请求。独立长时 progress 用例超过 5 秒后正常完成；10 秒准备预算、取消等整套项本次仅复核实现者结果，未独立重跑。

## 发现

首轮独立验证发现已 settled Ready 门禁遗漏，已退回前端补充。主 Agent 另发现 latest intent 与旧播放会话恢复的事件抑制问题；前端补入单条会话作者暂存，并已通过独立失败恢复检查，后端当前会话发送路径已复核。另记录整套网络用例不稳定，根因未定，未以单项重跑通过掩盖。

## 风险

本地 HTTP 解码与浏览器 mock transport 分层证据不能等同于完整打包应用端到端验收。作者仅识别有效 UTF-8 的明确 Artist/StreamArtist 字段或约定 `Artist - Title` 格式；服务器未提供可识别作者时回退网址，不把电台名或纯曲名冒充作者。整套网络回归未全过，旧连接失败尚无确定根因。

## 临时缓解

不是通过隐藏错误或放宽断言实现的临时缓解。

## 验证结论

本需求专项通过：后端作者生产、既有事件契约、前端展示/回退及失败恢复均有独立证据。整体网络回归未通过且失败根因未定，完整发布验收证据不足，不能宣称全部后端测试通过。

本轮追加的列表作者、流根索引移除及相邻缩放检查通过；没有新增后端能力或重新宣称历史网络整套通过。

## 建议

可交主 Agent 集成本需求限定改动与测试；保留所有已有未提交工作。完整发布前应另行定位网络套件的连接不稳定，不在本次作者显示需求中擅自扩大生产修改。
