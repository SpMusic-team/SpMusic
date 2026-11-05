---
doc_id: "TEST-GENRE-COLLECTION-INSETS"
title: "流派根与专辑概览页留白复核"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-05"
source_documents:
  - "user request: 流派根页及流派内专辑列表左右边距与播放列表对齐"
  - "src/features/player/components/genreCollectionInsets.browser.test.mjs"
  - "src/features/player/components/AlbumLibraryPanel.tsx"
  - "src/features/player/styles/player/album-library.css"
  - "docs/test/category-song-insets.md"
---

# 流派根与专辑概览页留白复核

## 摘要与范围

流派根、流派专辑概览及“该流派全部歌曲”入口的左右留白复核通过。主代理运行真实页面浏览器脚本并获得退出码 0；Test Agent 只读审查生产代码与断言，独立读取原始几何数据重新计算 60 组普通页面对比、4 组虚拟滚动前后对比，并查看窄屏和宽屏截图。结果一致，没有直接把运行者的通过文字当作结论。

本轮只修改上述两层的布局。先前已修复的流派、年份歌曲详情范围见 `category-song-insets.md`；本报告不把旧测试的执行算作本轮重新运行。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；浏览器脚本由主代理独占创建和运行，Test Agent 未修改业务或该脚本。
- 正式产物为 `D:/spmusic-artifacts/genre-collection-insets/geometry.json`，包含 98 条测量：30 条真实 PlaylistPanel 参考、60 条流派根/概览结果、8 条虚拟滚动前后结果。页面错误及控制台错误均为空。
- 新缺陷来自用户对根页与专辑概览留白的反馈；本轮没有单独保存这两页修改前的浏览器几何，因此不声称独立重建了新的 UI 失败基线。修复位置及前后样式关系已只读核对。
- 数据使用真实 PlayerShell、PlayerSurface 和集合组件，既有 Tauri 传输由测试 fixture 替换。没有更改媒体库分组、播放协议或添加原生能力。

## 根因与修复核对

歌曲详情已有独立的页级留白；流派根及概览仍直接使用原有 collection spacer/grid，缺少统一的页级边界。概览带快速索引，其隐藏滚动条策略还会回收 10px 右侧槽位，不能只补左 padding 后宣称两侧一致。

只读审查确认：

1. `data-genre-collection-view` 仅由 `genreMode && !detail` 产生，覆盖流派根与流派专辑概览；和歌曲详情的 `data-song-view` 互斥。
2. 为已有 `albumSpaceRef` 元素设置 `genre-collection-space` 类，以 16px/25px margin 收窄 grid 的定位包含块；未新增 DOM 层，也未以裁切或隐藏溢出模拟留白。
3. 根与概览内部列表的横向 padding 清零，避免和页级留白叠加。概览的全部歌曲入口消费相同留白变量。
4. 恢复右侧稳定滚动条槽的规则限定于 `.genre-library` 和 collection 标记。配套 hero 宽度调整抵消原隐藏滚动槽的补偿，保留其可见位置。
5. 原有歌曲 spacer、歌曲留白变量和年份/贡献者样式没有被新规则选中；原数据、导航、键盘及虚拟窗口算法不变。

## 命令与执行责任

主代理执行：

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node src/features/player/components/genreCollectionInsets.browser.test.mjs
# 退出码 0：60 次 collection 页对比、入口对齐、根封面/间距比例、4 个 virtual scroll 场景通过

npm run lint
npm run build
git diff --check
# 主代理汇报均通过；Test Agent 未重复运行全仓命令
```

Test Agent 独立执行原始 JSON 复算：按每组三条记录确认参考/根/概览身份与窗口、密度一致，重新比较全部页级左右边界、单列卡片外框、概览入口，并确认每对虚拟记录的绝对定位、有限渲染数量及前后宽度/边界。独立复算输出为 `60 normal page comparisons and 4 virtual before/after pairs passed; no errors`。

## 几何与截图复核

普通矩阵覆盖 456、640、1440 三种窗口及全部 10 个密度。页级外框与参考 PlaylistPanel 一致：

| 窗口宽度 | 左留白 | 右留白（含 10px 滚动槽） | 概览全部歌曲入口 |
| --- | ---: | ---: | --- |
| 456 | 16 | 26 | 同一组边界 |
| 640 | 16 | 26 | 同一组边界 |
| 1440 | 25 | 35 | 同一组边界 |

右值包含实际滚动槽，没有按 clientWidth 归一化把 10px 差异隐去。row 与单列 text 密度还验证实际卡片外框；tile 及双列 text 保留各自列宽和居中规则，仅比较页级可用区域，不强行把不同卡片系统的内部封面尺寸改成播放列表歌曲卡。

根页密度 3 的封面与文案间距仍为原设计 165/48px；456 窄窗按 456/640 比例缩放，封面实测 117.5625px。根组件没有通过缩小封面或截断点击背景实现边距对齐。

Test Agent 独立查看：

- `D:/spmusic-artifacts/genre-collection-insets/root-456-3.png`
- `D:/spmusic-artifacts/genre-collection-insets/overview-456-3.png`
- `D:/spmusic-artifacts/genre-collection-insets/overview-1440-3.png`

窄屏根页留白、概览入口与专辑行的可见边界合理；宽屏概览入口与专辑行外框对齐，封面保持各自组件尺寸，没有发现通过裁切背景遮掩问题。截图使用缺图 fixture 的既有占位封面。

## 虚拟窗口与邻近回归

130 个独立流派、Rock 内 130 张专辑分别触发真实 `useAlbumRenderWindow`。456/1440 两种窗口各测根/概览，均断言 grid 实际为 absolute、挂载项少于 130、滚动后首 key 改变，以及 spacer、grid 和卡片左右边界保持。原始记录中窄根渲染 9→12 项、窄概览 7→10 项，宽根及概览均 7→10 项，证明检查到了真实窗口推进。

已修歌曲页与年份页本轮作静态选择器回归：collection 标记与 `data-song-view` 互斥，新增 `.genre-library` gutter 规则不命中年份或歌曲详情；旧歌曲页 120 组及虚拟滚动结果保留在原报告中。本轮没有重新执行完整旧歌曲矩阵，也没有据此宣称已复跑全部历史 UI 测试。

## 风险、临时缓解与结论

没有临时缓解。该修复为现有组件局部布局调整；本轮不验证原生标签读取、声音输出、动效全矩阵或性能吞吐。新页面修改前的独立几何基线未保存，属于证据限制；当前正确边界、滚动槽以及虚拟窗口结果有直接测量与独立复算支持。

未发现阻塞本次留白修复的实现或断言问题，建议主代理完成整合。结论限于本报告声明的页面、密度、窗口和证据，不扩展为原生功能或所有历史回归通过。
