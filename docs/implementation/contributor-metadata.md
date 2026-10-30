---
doc_id: "IMPL-CONTRIBUTOR-METADATA"
title: "专辑艺术家与作曲家分类的标签元数据"
doc_type: "implementation"
status: "active"
owner_agent: "Rust/Tauri Agent"
version_scope: "project"
created: "2026-10-29"
updated: "2026-10-29"
source_documents:
  - "user request: 完成媒体库专辑艺术家与作曲家分类，复用艺术家页面"
  - "docs/architecture/contributor-library.md"
  - "src-tauri/src/audio/types.rs"
  - "src-tauri/src/audio/metadata.rs"
  - "src-tauri/src/audio/playlist_summary.rs"
---

# 专辑艺术家与作曲家分类的标签元数据

`AudioTrackMetadata` 和 `AudioPlaylistTrackTagSummary` 增加 `composer: Option<String>`，JSON 字段为 `composer`，TypeScript 导出类型为 `string | null`。缺失标签始终返回显式 `null`，不以艺术家或专辑艺术家补值。

完整元数据与批量标签摘要均通过现有 Lofty `ItemKey::Composer` 读取原始作曲家标签，沿用 `primary_tag().or_else(first_tag())` 的标签选择策略。专辑艺术家的 `albumArtist` 字段继续使用已有的 `ItemKey::AlbumArtist` 读取链路。拆分、未知分类和页面展示由前端模型处理，后端不改写标签。

本次只扩展现有返回结构，不增加 command、event、依赖、权限或持久化。摘要仍只读取标签和格式属性，不打开解码器、不加载封面、不读侧挂歌词、不写文件；播放及 hydration 继续复用原有完整元数据路径。

## 验证

- `cargo check`：通过。
- `cargo test --lib audio::playlist_summary::tests -- --nocapture`：9/9 通过。
- `cargo test --lib audio::types::tests`：14/14 通过。
- 新增合成 WAV/ID3v2 文件用例，分别写入不同的艺术家、专辑艺术家和作曲家，验证摘要与完整元数据读取结果一致；移除作曲家后返回 `null`，不会后备到其他属性；标签读取前后音频文件字节一致。
- 契约用例验证摘要 `composer` 字段存在且缺失值为 JSON `null`，两个 DTO 的 ts-rs 导出均包含 `composer: string | null`。

真实用户文件、所有容器的标签映射及桌面页面交互不由上述合成用例覆盖，由集成与独立验证另行报告。
