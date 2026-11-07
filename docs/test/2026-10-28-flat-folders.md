---
doc_id: "TEST-2026-10-28-FLAT-FOLDERS"
title: "平铺文件夹分类与分类根索引验证"
doc_type: "test"
status: "active"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-28"
updated: "2026-10-28"
source_documents:
  - "user request: 文件夹平铺所有已添加存储中直接含歌曲的目录，详情只展示直接歌曲"
  - "user request: 无头图的分类根页面均添加所有歌曲式右侧索引条"
  - "https://www.figma.com/design/V4Gbm9HJrUOsTiwXl2XcXV/SpMusic?node-id=7645-15884"
  - "src/features/player/components/flatFolders.browser.test.mjs"
  - "src/features/player/model/flatFolders.model.test.mjs"
  - "docs/architecture/media-library-page-relationships.md"
---

# 平铺文件夹分类与分类根索引验证

## 摘要

独立验证覆盖平铺目录派生、直接歌曲范围、播放与返回、封面命令、分类隔离和所有无头图分类的快速索引。最终平铺浏览器用例通过，页面运行时错误与 React 控制台错误均为 0；模型测试 17 项通过。验证使用实际 React `PlayerShell` 和 `PlayerSurface`，仅替换原生传输，不把 fixture 结果表述为实机 Tauri 文件访问或解码验证。

## 范围

- 40 首歌曲形成 39 个平铺目录：父目录直接歌曲、子目录、深层叶子、纯容器、跨存储同名目录、相邻路径前缀、重叠存储根、失败和空根。
- 根页和详情的播放、随机、搜索、多选、播放器往返、数据移除与迟到扫描。
- 19 个分类根均有右侧索引；文件夹详情有头图时不显示根索引。
- 层次结构页的目录树、递归统计、共享布局动效和既有扫描选择行为回归。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；验证 Owner：Test Agent。
- 原实现基线：按代码检查，`folder` 分类使用注册根的递归播放列表，不会枚举任意深度的直接含歌目录。本次验收断言来自用户确认的范围，未复用实现内部判断。
- 实现者主张：聚合歌曲按父目录分组，详情只取该父目录；保留原有 `scope` / `trackId`，向播放入口传入明确候选数组。
- 独立反证：同时放入父目录直接歌曲、子目录和孙目录歌曲，分别检查目录列表、计数、候选队列和实际播放；跨存储同名目录独立取歌，重叠扫描不增加歌曲或目录数。
- 首轮发现：快速关闭/重开媒体库及分类切换触发重复 React key。Frontend 调整内部 presence 切换后，完整同路径用例的控制台错误归零，并执行共享动效回归。没有删除失败断言或放宽错误要求。
- 证据边界：未在真实 Tauri 进程中选取用户音乐目录；真实文件解码、磁盘 I/O 和音频输出不是本轮纯前端变更的已执行证据。

## 命令

独立执行：

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
node --test src/features/player/model/flatFolders.model.test.mjs src/features/player/model/folderHierarchyModel.test.mjs src/features/player/model/folderNavigationIdentity.test.mjs
node src/features/player/components/flatFolders.browser.test.mjs
node src/features/player/components/folderHierarchy.browser.test.mjs
node src/features/player/components/folderSelection.browser.test.mjs
node src/features/player/components/folderNavigationMotion.browser.test.mjs
node src/features/player/components/folderManagementParity.browser.test.mjs
```

浏览器环境为 Windows Edge headless、Playwright，Vite 地址 `http://127.0.0.1:5173`。`SPMUSIC_PLAYWRIGHT` 指向本机 bundled runtime 的 Playwright；新用例直接为本机测试开启 Chromium local-network feature 兼容参数，既有用例通过工作区外的启动适配器加入同一参数，未修改既有测试源。截图通过 `SPMUSIC_TEST_SCREENSHOTS=D:/spmusic-artifacts/flat-folders-test` 输出。

- 模型：17 / 17 通过。
- 新平铺浏览器集成：通过，包括全部 19 个分类根、根多选直接曲目并集、详情搜索播放与多选、metadata gate、scan 取消及全部错误断言。
- 既有 `folderHierarchy`：通过，包括 180 曲目窗口化和跨窗口 Tab、640 / 1920 / 2560 的 hero 宽度、mouse / touch 弹性及迟到任务清理。
- 既有 `folderSelection`：通过，包括目录选择、冲突恢复、设置保存与生命周期、晚到移除/清空/卸载、详情选择边界。
- 既有 `folderNavigationMotion`：14 条动效轨迹，0 失败；共享封面 URL 稳定，存在中间插值帧，没有在用 URL 被提前撤销。
- 既有 `folderManagementParity`：主代理补验通过；640 / 1280 窗口下工具栏几何、悬停、根页控制器边界和 Ctrl-wheel 的八区域矩阵一致。
- `npm run lint`、`npm run build`、`git diff --check`：主代理已执行并反馈通过；Test Agent 未重复执行。
- `cargo check`、实机 `npm run tauri dev`：未执行；本次没有 Rust 或原生命令契约改动。

## 交互与视觉检查

- 平铺根只显示直接含歌目录，纯容器 `/music/Parent` 不出现；它的 `/music/Parent/OnlyChild` 独立出现。层次页仍显示容器并能逐层进入。
- `/music` 详情只显示两首本层歌曲，hero 计数为 2；播放、随机和多选均不包含 Album / Disc 中的歌曲。根页选择 `/music` 和 `/music/Album` 后，只排入这两个目录的三首直接歌曲。
- 目录同名时按全路径保留不同条目；跨存储 Album 详情只展示对应存储的歌曲。
- 平铺卡片不含目录 glyph 或 badge，封面请求不调用递归 `audio_load_folder_thumbnail`。
- 默认大 tile 实测：封面 240 × 240，圆角 10px，名称字号/行高 32/40px，父名 24/32px，图文间距 26px。
- 索引键盘 Enter 跳至 Z，显示 Z 预览；鼠标按住 A 后拖至 Z，预览与 `aria-current` 更新，松手后预览消退；顶部按钮使列表归零。
- 从播放器返回保留平铺目录；切换层次分类不共用平铺位置；移除存储后详情回到合法根页。
- metadata 延迟完成只填充当前目录的直接歌曲；清空存储后迟到扫描不能重新恢复歌曲。
- 截图位于工作区外：`D:/spmusic-artifacts/flat-folders-test/flat-folders-root-640.png`、`flat-folders-detail-640.png`、`flat-folders-index-drag-640.png`。封面为 fixture 单色图，检验实际图片通道和几何，不替代真实曲库的封面内容。

## 跨层契约

前端仍使用既有扫描/元数据/时长/track thumbnail/播放命令；聚合项保留原曲目身份，播放列表快照由明确候选构造。本轮没有新增权限、后端数据结构或 command。真实 native transport 在浏览器中用 fixture 代替，因此仅确认消费方式与参数约束；实际磁盘行为的依据来自既有后端代码契约和已有功能，而非本轮模拟执行。

## 性能与时序

本次不作加载性能提升声明。验证了快速媒体库关开、跨分类切换、迟到 metadata、清空后的迟到 scan，以及既有 180 曲目渲染窗口；共享布局回归记录了实际帧序列和 URL 生命周期。

## 风险与临时缓解

不是临时缓解。未新增未解决的功能缺陷；真实用户曲库、Tauri 原生文件访问和音频输出仍需在用户环境中验收。测试不声称完成跨设备性能评估。

## 验证结论

本次前端范围通过。Test Agent 已独立完成平铺功能、索引交互、层次结构、目录选择及导航动效验证；主代理在最终文件版本上复跑 17 项模型测试、lint、build，并补齐管理页兼容回归。原生文件访问和真实音频输出不包含在上述已执行结果中。
