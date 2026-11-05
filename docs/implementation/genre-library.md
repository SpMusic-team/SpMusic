---
doc_id: "IMPL-GENRE-LIBRARY"
title: "流派分类页面实现"
doc_type: "implementation"
status: "active"
owner_agent: "Frontend Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-05"
source_documents:
  - "user request: 参照 Poweramp 文档及 Figma 实现流派页面"
  - "docs/architecture/genre-library.md"
  - "docs/architecture/poweramp-category-views.md"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=9208-9760"
---

# 流派分类页面实现

## 数据与边界

新增 `genreLibrary.ts`，从既有摘要的 `libraryGenreName` 派生流派，按真实歌曲 key 去重，保留原歌曲对象及播放身份。`undefined` 为标签尚未完成，不生成分类；已完成的 null、空白及只有分隔符的标签进入未知流派。未知项 key 使用 null，与真实名称“未知流派”不同。

首版按分号、全角分号、双斜杠、美元符拆分，多值 trim、去空及同曲同名去重；单斜杠保留在名称中，大小写精确区分。此规则属于 SpMusic 首版实现，并不声称是 Poweramp 的默认设置。不从专辑或其他曲目继承流派。

流派内专辑由当前流派的歌曲调用既有 `albumEntries` 聚合；专辑详情仅含该流派歌曲。两条路径为“流派 → 该流派全部歌曲”和“流派 → 专辑 → 专辑内当前流派歌曲”。随机、播放、选择、删除及加入播放列表复用既有真实 scope/trackId 和操作管线，跨流派展开时去重，未新增后端 command、权限或依赖。

## 复用与界面

`AlbumLibraryPanel` 显式增加流派模式，复用集合页头、hero、歌曲卡片、列表窗口、封面候选调度、侧栏、选择栏及滚动位置缓存。`PlayerShell` 保存会话内 `genreLocation`，分类主动重入回到根，播放器往返保留位置。摘要、时长优先级和歌曲分类数据门控均包括流派。加载、恢复和重扫期间暂停失效位置清理，数据稳定后依当前流派、专辑是否存在逐级回退。

Figma 已成功取得高保真上下文和截图。根默认采用大行布局，按设计使用 165 方形封面、48 内容间距、32 标题和 28 统计文字；640px 设计宽度及更宽窗口保持原尺寸；更窄的流派根容器通过局部容器查询按可用宽度与 640 的比例缩放页头、工具栏及默认大行，保持操作同行，不对页面使用 transform。Guitar 和音符使用下载的本地 SVG，更多、返回和播放等精确匹配现有资产；封面、名称、数量和时长来自真实曲库，不硬编码设计示例。颜色、字体缩放及圆角消费现有主题变量。

四视图分别使用 `spmusic.genre-{root|albums|songs|album-tracks}.sort.v1` 和 `.layout-level.v1`。根更多提供选择文件夹、重新扫描、列表选项；列表选项可调整排序字段、方向和列表布局。详情更多也提供排序及列表选项。根排序支持名称和歌曲数，未伪造没有可靠来源的创建时间。

搜索工具栏沿用既有全局搜索入口；全局搜索的流派集合也复用 `genreEntries` 拆分规则，保持未知项、名称和成员一致。搜索仍按原来的源路径去重与搜索详情展开方式工作，年份及其他分类搜索不变。

年份及流派的“全部歌曲”和“专辑内歌曲”视图使用与真实 `PlaylistPanel` 相同的横向留白：窗口不超过 1024px 时为 16px，更宽时为 25px。留白由现有虚拟列表 spacer 的外边距提供，grid 自身横向 padding 归零；这会同时缩窄绝对定位窗口化 grid 的包含块，并保留播放列表 level 2 原有的宽度扩展及负边距规则。歌曲页保留与播放列表相同的原生稳定滚动条预留，不再因快捷索引隐藏 gutter 而把卡片右边界延伸到窗口边缘；对应移除旧 hero 宽度的 10px 补偿以保持 hero 实际几何不变。根列表和专辑列表不采用此规则。

流派根列表及流派内专辑列表另复用现有 `albumSpaceRef` 外壳提供同样的 16/25px 页级留白，列表本身不再重复叠加横向 padding。“该流派全部歌曲”入口使用同一留白变量；流派内专辑列表保留原生稳定滚动槽，并同步移除旧 hero 的隐藏槽宽度补偿。此规则通过流派集合视图专属标记限定，不改变其他分类及歌曲详情分支，也不改变根大行的 165 封面、48 内部间距和已有窄窗缩放。虚拟集合列表的绝对定位包含块随外壳外边距一起缩窄，无需新增 DOM 层。

## 验证

前端实现阶段已执行 `npx tsc -b`。独立模型、浏览器验收以及最终仓库 lint/build 由 Test Agent 和主代理分别执行，实际结论见 `docs/test/genre-library.md` 及主代理交付记录。浏览器验收使用既有模拟原生 transport 驱动真实 PlayerShell，不能代替真实桌面音频输出验证。
