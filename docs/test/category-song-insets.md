---
doc_id: "TEST-CATEGORY-SONG-INSETS"
title: "流派与年份歌曲页左右边距回归验证"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-11-05"
updated: "2026-11-05"
source_documents:
  - "user request: 修复流派、年份最内层歌曲与播放列表左右窗口边距不一致"
  - "src/features/player/components/categorySongInsets.browser.test.mjs"
  - "src/features/player/components/AlbumLibraryPanel.tsx"
  - "src/features/player/styles/player/album-library.css"
---

# 流派与年份歌曲页左右边距回归验证

## 摘要与范围

Test Agent 独立执行修复前基线与修复后浏览器几何测试，主代理复核产物、截图及仓库检查，并汇总本报告。比较真实 PlaylistPanel 与流派、年份的全部歌曲和专辑内歌曲页面，使用相同窗口尺寸和列表密度；不以 clientWidth 归一化掩盖滚动条槽差异。

## 实现交付与根因证据

生产修改限定于 AlbumLibraryPanel 的歌曲场景标记、既有 spacer 类及 album-library.css；没有新增 DOM 层或修改数据、播放协议。

640 像素窗口、密度 3 的修复前实测：

| 页面 | 卡片左留白 | 卡片右留白 | 封面距面板左侧 |
| --- | ---: | ---: | ---: |
| 播放列表 | 16 | 26 | 31 |
| 流派全部歌曲 | 0 | 0 | 15 |
| 年份全部歌曲 | 10 | 10 | 25 |
| 流派、年份专辑内歌曲 | 16 | 26 | 31 |

单位为 CSS px；播放列表右留白包含 10px 原生滚动条槽。流派旧 grid padding 被更高优先级的共享规则覆盖，年份另有不一致的密度补偿；QuickIndex 隐藏原生槽又改变了右侧物理边界。

修复对这两类歌曲场景使用 spacer 横向 margin：窄窗 16px，宽于 1024px 时 25px；grid 横向 padding 归零，并恢复与播放列表相同的稳定滚动槽。虚拟绝对 grid 的包含块同步收窄，保留密度 2 原本的宽度扩展及负边距。对应 hero 的滚动槽补偿同步调整；根列表和专辑列表不在修改范围。

## 独立回归与反证

- 456、640、1440 三种窗口，十种密度，四种歌曲页面，共 120 组与真实播放列表的对比全部通过。
- 比较卡片背景、首行各卡封面和文字区域的左右物理边界，容差小于 0.15px；没有通过裁切背景或只修改悬停效果使断言通过。
- 修后密度 3：窄窗背景左右 16/26px、封面左 31px；宽窗背景左右 25/35px、封面左 40px，与播放列表一致。
- 456、1440 窗口下各用 240 首歌曲，四种页面滚动前后共 16 个虚拟列表样本均保持边界一致；验证 grid 为 absolute、渲染数量小于 240、滚动后首曲变化及网格宽度不变。宽窗实测渲染数量从 10 变为 13。
- 几何产物含 168 次测量（含参考页面），mismatches、page errors、console errors 均为 0。主代理另行检查了完整组合及虚拟滚动样本是否齐全。
- 主代理目视核对窄、宽窗口的大行悬停截图，确认卡片背景及封面边界没有贴边或被裁切。

## 命令与产物

- `npm run lint`：主代理执行，通过。
- `npm run build`：主代理执行，通过；仅有既有构建包体积提示。
- `git diff --check`：通过。
- 浏览器脚本：`node src/features/player/components/categorySongInsets.browser.test.mjs`，需 Vite 服务及环境中可用的 Playwright；可通过 `SPMUSIC_PLAYWRIGHT` 指定模块路径。
- `SPMUSIC_TEST_BASELINE=1` 为基线模式，预期在修复前记录不一致；正常模式要求全部边界一致。
- 原始测量及截图位于 `D:/spmusic-artifacts/category-song-insets/`，包括 `baseline-geometry.json`、`fixed-geometry.json` 和各页面的大行普通/悬停截图。

## 验证结论与限制

本次边距缺陷修复通过，修复前失败路径与原本已对齐的专辑内歌曲分支均被覆盖。浏览器使用真实 PlayerShell/PlaylistPanel 和模拟原生通信；本轮只证明布局及虚拟滚动几何，不重新验证真实音频、磁盘访问或性能吞吐。没有新增后端或权限，跨层协议不变；没有实施临时缓解。
