---
doc_id: "IMPL-CONTRIBUTOR-LIBRARY"
title: "媒体库专辑艺术家与作曲家分类实现"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-10-29"
updated: "2026-10-29"
source_documents:
  - "user request: 完成专辑艺术家和作曲家分类，样式动效等全部与已有艺术家页一致，仅查看属性不同"
  - "docs/architecture/contributor-library.md"
  - "docs/implementation/artist-library.md"
  - "docs/decisions/2026-07-09-document-metadata-standard.md"
---

# 媒体库专辑艺术家与作曲家分类实现

## 标签与成员

三个分类共用 `artistEntries(songs, categoryId)`，分别读取原始 `libraryArtistName`、`albumArtist` 和 `libraryComposerName`。缺失标签归入对应“未知…”实体，不能从其他标签或歌曲展示文案借值；未完成摘要的 undefined 不产生实体。多人拆分沿用 `/`、去空、去重以及 `AC/DC`、`+/-` 例外规则。实体 key 包含分类 id，真实标签为“未知作曲家”与标签缺失仍可区分。

DTO 的新增 `composer?: string | null` 兼容旧响应和现有 typed fixture；摘要 parser 将缺省规范为 null，拒绝数字等错误类型。`playlistTrackRowFromSummary`、行相等比较、ViewModel 和 PlayerShell 原始摘要覆盖共同保留 `libraryComposerName`。播放 hydration 继续提供展示信息，不改写分类归属。

进入实体后，先得到该实体的歌曲，再由现有 `albumEntries` 聚合专辑。专辑仍使用自身的 ALBUMARTIST/ARTIST 署名规则，作曲家不成为专辑署名；当前实体之外的同专辑歌曲不会混进详情和队列。批量播放的合作曲按真实歌曲 key 去重，播放继续使用原始 scope/trackId。

## 页面与交互

两个新入口和艺术家共用 `AlbumLibraryPanel` 的圆形卡片、头图、所有歌曲入口、歌曲行、布局手势、快速索引、搜索、选择、更多菜单、封面租约、虚拟窗口和主题动效。业务 CSS 无需新增；根分类图标、分类文案、辅助技术标签和置顶目标随 categoryId 变化。

PlayerShell 分别保存 `artistLocation`、`albumArtistLocation`、`composerLocation`。分类切换重置目标分类根位置；播放器往返保持当前分类与实体层级。route、layout storage、封面及共享投影身份带分类命名空间，搜索/选择状态随各自场景实例隔离。摘要预读取、优先时长聚合、全库展示补全和播放器返回白名单均覆盖两个新分类。

加载、导入、重扫和恢复期间沿用原艺术家的操作及位置保护；稳定后仅当前 present 场景可清理失效实体或专辑位置。现有工作区控制器动效改动完整保留。

## 验证

- `npm run build` 与 `npm run lint` 通过；构建仍提示既有大 chunk，不阻止构建。
- 艺术家、专辑和新分类纯模型合计 28 项通过，覆盖原始属性隔离、缺失值、拆分例外、分类身份、成员作用域及原专辑分组回归。
- 摘要行测试 8 项通过；摘要协议测试 2 项通过，覆盖旧缺省 composer、正确文本和非法类型。
- 既有 `artistLibrary.browser.test.mjs` 回归通过，覆盖实际 PlayerShell 的艺术家详情、所有歌曲、播放返回、多人选择并集、pending 与过时完成。
- 既有 `albumLibrary.browser.test.mjs` 回归通过，覆盖多碟/合作分组、未知/加载/错误、选择播放与随机、播放器返回、快速索引以及过时完成取消。
- 新分类浏览器独立验收由 Test Agent 记录于其测试报告；真实 Rust 标签读取由 Rust/Tauri Agent 的合成音频测试验证。

## 边界

本次不新增依赖、命令、权限、数据库、标签写入或联网封面。此前艺术家文档中的“专辑艺术家分类不在范围”是旧任务范围，本次用户授权已扩展并实现该分类及作曲家分类。
