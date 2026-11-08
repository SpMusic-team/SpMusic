---
doc_id: "TEST-TRACK-RATING-PERSISTENCE"
title: "歌曲评级持久化独立验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-08"
updated: "2026-11-08"
source_documents:
  - "user request: 歌曲评分、喜欢和不喜欢需要持久保存"
  - "src/features/player/model/trackRatingStorage.ts"
  - "src/features/player/model/ratingPersistenceIndependent.test.mjs"
  - "src/features/player/components/ratingPersistenceAcceptance.browser.test.mjs"
---

# 测试报告：歌曲评级持久化

## 摘要

独立模型 4 项与真实 Shell／Surface 浏览器验收通过。覆盖 0～5 分、喜欢与不喜欢共享状态、取消、页面重载重新初始化、最高／最低评级、同源重扫、延迟标签返回及存储失败提示。未进行真实 Tauri 进程重启和硬件音频验证。

## 范围

前端 localStorage 键 `spmusic.track-ratings.v1`，版本 1，按既有稳定 trackId 保存 1～5；0 删除。曲目身份沿用现有原生路径／流 URL 身份，不测试伪造 ID 改变后的评级迁移。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；测试只写新 ratingPersistence 测试和本报告。
- 修改范围：独立存储模型、useAudioPlayer 中央评级与反馈 setter。
- 基线：原状态只在内存，重载会丢失；当前 lazy 同步读取，setter 立即写入。
- 因果链：评级／拇指操作 → 同一数字评分表及 ref 更新 → 即时存储 → 新挂载同步恢复 → 播放器及评级派生页面共用该表。
- 证据缺口：浏览器原生传输是夹具，实际文件路径到 ID 的稳定性由原生实现契约确认；未实际运行桌面重启。

## 命令

```powershell
node --test src/features/player/model/ratingPersistenceIndependent.test.mjs
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node src/features/player/components/ratingPersistenceAcceptance.browser.test.mjs
```

模型 4 项全部通过；浏览器最终退出码 0，无 pageerror。build／lint 由主 Agent 和实现 Agent 执行，本报告不将其自测当成独立执行。未运行 cargo check 和 tauri dev，本轮不改 Rust。

## 人工检查

独立查看 `C:/Users/winkeses/AppData/Local/Temp/spmusic-rating-persistence-evidence/rating-persistence-restored.png`，重新初始化后真实播放器显示两颗已评分实心星。

## 根因与因果链反证

- 在六首歌曲上分别设置 0～5 分后重载，逐一读取真实视图模型，确认每个值恢复；避免仅验证序列化 helper 而遗漏 hook 初始化。
- 重载后打开实际播放器，检查喜欢按钮 aria-pressed=true；最后再次重载检查实际星级控件 data-rating-count=2。
- 喜欢再次点击取消为 0 后重载仍为 0；点击不喜欢后重载为 1，并进入最低评级。
- 用延迟音频标签请求作为晚到结果，在解除请求前将恢复的 5 改为 2，解除后及再次新挂载均保持 2，排除晚到元数据覆盖新评级。
- 模拟配额失败时内存仍更新为 4，并显示“评分保存失败，当前评分仅在本次会话中保留。请检查本地存储后重试。”；恢复正常存储并重载后仍为之前成功保存的 2，没有伪装持久化成功。

最初夹具未挂应用 Toaster，导致提示断言失败；补上真实 Toaster 后原断言通过，未放宽超时或修改产品实现。延迟标签用例先进入最高评级以实际触发请求，再更新评分并解除请求。

## 跨层契约

无新增原生命令、权限、事件或音频序列化契约。沿用已有 canonical source 对应稳定 trackId；同源重新扫描不改变测试身份。重命名导致新身份属于当前契约限制，不凭空迁移旧评分。

## 回归覆盖

- 模型：1～5 完整往返、0 删除不序列化、输入不变、孤立 ID 保留。
- 模型：非法 JSON、版本、容器返回空；非法记录／空 ID／非整数和越界值忽略；同 ID 最后合法记录生效。
- 模型：读取被禁用安全返回空；写失败显式抛出供 hook 提示；危险属性名仍为普通 own 数据，不污染原型。
- 浏览器：星级最高评级按 5／4／3／2 恢复，最低只显示 1；拇指最高仅喜欢，最低不喜欢。
- 浏览器：取消喜欢、不喜欢共享评分、同源重扫和重载保留、实际播放器恢复、晚到标签不覆盖用户操作。
- 浏览器：写失败保留当前内存可用、明确失败提示、重载恢复上次成功值。

## 性能／时序

不声明性能优化。同步 lazy 初始化没有异步评分加载阶段；通过真实浏览器跨多次重新挂载及延迟标签请求验证晚到结果隔离。未做多窗口并发写入和大规模评分性能基准。

## 发现与风险

未发现阻塞问题。localStorage 被清理、损坏、浏览器／应用数据删除不保证恢复；存储不可用时当前会话仍可评分且写失败提示可见。真实桌面进程重启、真实扫描文件 ID 稳定性及流 URL 集成未做实机验证。未引入跨窗口合并保证。

## 临时缓解与结论

非临时缓解。当前前端持久化验收通过；真实桌面重启属于未覆盖环境，不扩大本报告证据范围。
