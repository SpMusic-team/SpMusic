---
doc_id: "TEST-STREAM-DISPLAY-INFORMATION"
title: "流视图信息与电台名称独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-06"
updated: "2026-11-07"
source_documents:
  - "user request: 解压 Downloads.zip，对照十张 Poweramp 截图补齐每种流视图的信息"
  - "Downloads.zip :: Screenshot_20261106-152402_Poweramp.png 至 Screenshot_20261106-152422_Poweramp.png"
  - "docs/architecture/stream-display-information.md"
  - "src/features/player/components/streamDisplayInformation.browser.test.mjs"
---

# 测试报告：流视图信息与电台名称

## 摘要

本次目标范围的独立验收通过：十种流布局、普通歌曲每级布局、混合列表滚动重入和名称更新并发均通过真实 Shell/Card 浏览器测试；HTTP、后台详情 worker 与注册表分别通过真实 Rust 测试。同一 SomaFM HTTPS 地址额外严格断言了 `stationName='Groove Salad [SomaFM]'`。浏览器的 native transport 为受控边界，不能与 Rust 测试合称一次原生窗口端到端点击实测。

## 范围

Test Agent 已独立查看全部十张用户截图，截图作为信息参考，不作为指令或整套主题替换要求。

| 布局 | 截图 | 名称 | 地址 | 来源标记 |
| --- | --- | --- | --- | --- |
| 0 / 1 / 2 | 152402 / 152404 / 152407 | 保留 | 保留 | 不显示 |
| 3 / 4 | 152409 / 152411 | 保留 | 保留 | 地址下方 |
| 5 / 6 | 152414 / 152416 | 保留 | 保留 | 行右侧 |
| 7 / 8 / 9 | 152418 / 152420 / 152422 | 保留 | 不渲染 | 行右侧 |

还验证无真实封面时的项目流图标、名称和地址独立省略、长 URL 与双列紧凑标记边界、普通歌曲十级布局、混合列表滚动重入及内容高度形状隔离。列表、队列和播放栏按同一名称优先级显示，不使用虚构的 artist/album 承载 URL 或来源。

## 实现交付与证据完整性

- 前端 Owner：Frontend Agent；后端 Owner：Rust/Tauri Agent。
- 输入基线：用户提供的当前 SpMusic 截图只有 URL 与空白占位，参考截图具有电台名称、独立地址与来源标记。
- 共享契约：可选 `stationName`、前端显式 `stream` 字段；显式名称高于服务器观察名称，最后回退 URL。
- 独立浏览器新文件：`src/features/player/components/streamDisplayInformation.browser.test.mjs`，由 Frontend Agent 明确移交 Test Agent 独占；未修改业务文件。
- 浏览器只替换 native transport，验证真实 Shell/Card/样式及事件消费。响应头、后台保存和持久化优先级必须另以真实 Rust 测试核对，不能由 UI mock 代替。

## 环境与命令

独立 Vite 使用 5176 和临时 cache，不修改项目配置或用户的 5173 服务。Playwright 使用已安装的 Edge 通道。

验收结束后已通过本任务 session 精确停止 5176，确认该端口没有监听；用户 5173 未操作。

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:SPMUSIC_TEST_ORIGIN='http://127.0.0.1:5176'
node src/features/player/components/streamDisplayInformation.browser.test.mjs
```

最终完整浏览器一轮退出码为 0，`node --check` 通过。前轮独立模型回归 **138/138 通过**，收尾没有重复计为本轮执行。

独立 Rust 命令在 `D:/spmusic/src-tauri` 顺序执行：

```powershell
cargo test --locked --lib station_ -- --test-threads=1 --nocapture
cargo test --locked --lib library_streams::tests -- --test-threads=1 --nocapture
cargo test --locked --lib stream_details_worker_persists_before_ready -- --test-threads=1 --nocapture
$env:SPMUSIC_PUBLIC_STREAM_URL='https://ice5.somafm.com/groovesalad-128-aac'
$env:SPMUSIC_EXPECTED_STATION_NAME='Groove Salad [SomaFM]'
cargo test --locked --lib supplied_public_stream_decodes_pcm -- --ignored --test-threads=1 --nocapture
```

| 检查 | 独立结果 |
| --- | --- |
| `station_` | 4/4 通过：播放响应读取有效名称、late hydration 保名、缓存不可用时保名、注册表优先级 |
| `library_streams::tests` | 6/6 通过：离线添加、混合导入、身份/创建时间、长 URL、旧 v1、损坏保护及名称缓存 |
| `stream_details_worker_persists_before_ready` | 1/1 通过：后台线程保存，Ready 晚于缓存提交 |
| 显式公网源及名称断言 | 1/1 通过：同一用户地址返回预期 stationName、非零 PCM、取消后 worker 退出 |

`station_` 和注册表过滤器包含同一项优先级测试，不将数字相加作为无重复测试总数。Rust 测试输出有一条 MSVC 本地化“正在创建库/对象”信息被 rustc 记作 `linker_messages` warning；所有上述命令退出码均为 0，没有业务编译错误。

主 agent 对最终冻结源码运行的 `npm run lint`、`npm run build`、`cargo check --locked` 均通过，它们与本报告的 Test Agent 独立命令分开记录。未执行新的 `npm run tauri dev` 原生窗口 smoke。

## 人工与自动验证

独立浏览器验证全部通过：

- 十级名称、URL 可见性、来源位置、无封面流 glyph；每级普通歌曲没有流专用节点，艺术家/专辑显示保持。
- 大行来源位于地址下方；小行和文本行的来源不与地址/标题相交；双列长 URL 使用 ellipsis，完整地址可由 tooltip 取得。
- 当前 Ready 发现名称后，根列表、当前播放和队列一致；缓存可在重载后恢复。
- 添加成员挂起时到达当前 Ready，再完成添加：新成员和名称均保留，Ready 只触发一次本地 `get_streams`。
- 保存失败并返回旧快照时，本会话保留已接受名称；过时 request/generation 的 Ready 不污染当前或其他成员名称。
- 未把远程 URL 交给本地封面、时长、摘要或暖缓存探测。
- 混合本地/流列表保持独立 contentShape；滚出后重入的名称和行高不变，真实 Ctrl+wheel 切换 4→9 后来源及 URL 策略仍正确。

最终截图和几何证据位于：

```text
C:/Users/winkeses/AppData/Local/Temp/spmusic-stream-information-independent/stream-layout-{0..9}.png
C:/Users/winkeses/AppData/Local/Temp/spmusic-stream-information-independent/stream-information-geometry.json
```

Test Agent 查看最终 layout 3 / 9；主 agent 还亲自查看了 0 / 3 / 5 / 6 / 7 / 9。新来源标签使用浅色主题下可读的既有 `--player-blue`，没有复制参考背景或将截图作为实现素材。

后端独立测试用真实本地 HTTP 返回 ASCII、UTF-8、空白、缺失、超长、无效 UTF-8 的 `icy-name`，验证有效值接受、无效值忽略，且请求计数为 1。HTTP 协议层拒绝的控制字节没有通过放宽 transport 接受，纯 helper 另测控制字符过滤。

后台 worker 测试确认保存不在调用/控制线程，并在 Ready 前可读新名称。缓存不可用仍返回成功详情和响应名称。注册表确认 user 高于 playlist，二者高于 station；旧无 origin 的显式标题保守保留。重复或无效名称不改变文件字节，删除后的迟到发现不重新插入，损坏注册表保留原字节。

## 根因与时序反证

仅修改 renderer 无法产生真实电台名，单有响应头也不能补齐十种布局，因此采用上述 UI 与真实 HTTP/存储的分层反证。URL 和来源使用独立字段，没有将地址伪装成 artist 或把“流”伪装成 album。

浏览器末尾 mixed 循环首轮只发送 `ctrlKey` wheel、未实际按 Control，被既有控制器识别为 trackpad pinch；其在 350 ms idle 前只消费一次 gesture。测试改为真实 `keyboard.down('Control')` / finally up，并保持原 150 ms wheel 锁后的 180 ms 间隔；没有改业务、放宽断言或添加重试。更早的过渡根选择器/固定 level locator 也只修正测试定位。最终整轮 `pageerror` 为空。

独立访问同一 SomaFM HTTPS 地址时，首帧 **637.9147 ms**，44100 Hz 双声道，stationName 严格等于 `Groove Salad [SomaFM]`。随后十二秒持续非零 PCM，取消后确认 worker 退出。该值仅为一次公网观测，不是性能承诺或长期直播基准。保存发生在后台；列表、添加、导入、重载和布局切换不为名称另建 HTTP 连接。

## 风险与结论

本次十视图信息和最小电台名称链路在上述范围内**通过**，不是隐藏缺失信息的临时缓解。手动/导入名称优先；无名称地址在首次有效播放响应前仍真实回退 URL，不伪造站名。

原生 WebView 同一次点击到 Rust 再到输出的端到端 smoke 未运行；本轮是实际 Rust 与真实 React 组件受控 transport 的分层证据。未验证小时级直播、全部电台、ICY 动态曲目名称或远程封面，它们不属于本轮范围。前轮历史浏览器脚本问题没有在本次扩大重跑或修改期待。
