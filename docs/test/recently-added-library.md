---
doc_id: "TEST-RECENTLY-ADDED-LIBRARY"
title: "最近添加分类验证记录"
doc_type: "test"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-30"
updated: "2026-10-30"
source_documents:
  - "user request: 实现媒体库最近添加，复用已有歌曲页面"
  - "docs/architecture/recently-added-library.md"
---

# 最近添加分类验证记录

## 范围与执行者

Architecture Agent 给出扫描描述符契约后，实施与 Test Agent 均因运行用量限制退出。主 Agent 完成实现与以下验证；未取得独立 Test Agent 的最终验收意见。

最近添加按真实文件创建时间倒序，未知时间末尾，同时间按规范化路径排序。复用歌曲列表、控制器和动效，无字母索引，播放来源与最近播放区分。

## 验证结果

- `npm run build`：通过；保留现有大 chunk 提示。
- `npm run lint`、`git diff --check`：通过。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib recently_added_tests`：2 项通过，覆盖 Unix 毫秒转换、JavaScript 安全范围、Windows 实际文件创建时间、扫描输出 camelCase 序列化及恢复/缺失文件。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib library_folder_scan`：4 项通过，递归扫描、重叠身份、空树、链接边界无回归。
- `node --test` 最近添加/最近播放三个模型测试文件：15 项通过，含新来源兼容校验、输入不变、未知时间和稳定排序。
- `recentlyAddedAcceptance.browser.test.mjs`：通过，真实 PlayerShell/PlayerSurface，替换 native transport；覆盖创建时间顺序、同时间/未知时间、共享卡片与控制器、无索引、完整最近范围播放快照、来源标题与返回、持久化来源、刷新及随机范围；最近播放空态仍独立。
- 既有 `recentlyPlayedAcceptance.browser.test.mjs`：通过，50% 实听、seek/暂停、去重、稳定队列和刷新恢复无回归。

首次 Rust 超大时间边界测试在 Windows 构造超出 SystemTime 范围的输入时溢出；改为直接验证 Duration 转换的安全整数上限后通过。运行期转换也使用该纯函数，未放宽断言。一次浏览器回归受共享工作区热更新导航打断；改用禁用 HMR/文件监听的测试服务 5175 后，两种分类均通过。

截图：`C:/Users/winkeses/AppData/Local/Temp/spmusic-recent-added-test/recently-added-list.png`，主 Agent 已视觉检查。

## 结论与限制

已运行的模型、真实文件扫描、构建及浏览器验收通过。浏览器不验证真实音频设备输出；跨平台文件系统不支持创建时间时使用 null 并在列表末尾显示。没有新依赖、权限或数据库。
