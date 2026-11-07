---
doc_id: "TEST-STREAM-ADDRESS-DIALOG-2026-11-07"
title: "添加流地址弹窗设计验收"
doc_type: "test-report"
status: "active"
owner_agent: "Test Agent"
version_scope: "streams"
created: "2026-11-07"
updated: "2026-11-07"
source_documents:
  - "Figma V4Gbm9HJrUOsTiwXl2XcXV 9248:11977"
  - "src/features/player/components/LibraryRootMenu.tsx"
  - "src/features/player/styles/player/playlist-management.css"
  - "src/features/player/components/streamAddressDialog.browser.test.mjs"
---

# 添加流地址弹窗设计验收

## 范围与结果

按 Figma 高保真上下文及截图验收真实 LibraryRootMenu、现有 Dialog/Input/Button 和 AppearanceProvider；添加回调受控，不涉及原生注册和网络播放。Test Agent 创建聚焦测试后因运行额度限制停止，主 Agent 接手执行、修正测量时机并完成截图复核。

- 默认弹窗 566×255，圆角 40；标题 28/36、文字左缩进 38，输入框宽 490。
- 取消、添加按钮均为 124×62，圆角 30、文字 22/28。仅一个地址输入框，无名称栏、说明文字或关闭图标。
- CSS 下划线为 2.5px；当前 Chromium 计算样式按布局像素取整为 2px，测试允许 0.5px 的取整差异。
- 截图人工对照 Figma：布局、颜色、圆角和输入下划线符合目标；设计无静态图片或 SVG 资产。
- 初始 http://；清空时禁用添加；ESC 关闭并还原焦点；取消返回原更多菜单，退出菜单后焦点还原。
- FTP、带凭据地址在调用添加回调前被拒绝；失败错误态、重试成功通过。
- 保存期间输入与操作禁用，重复 submit 不重复调用，ESC 不打断保存。
- 360px 窗口中弹窗宽 328、左右各 16；长网址仅在输入框内部滚动，没有页面或弹窗横向溢出。

## 验证命令

`SPMUSIC_PLAYWRIGHT` 指向本机已安装 Playwright 后运行 `node src/features/player/components/streamAddressDialog.browser.test.mjs`，5 组检查通过，退出码 0。测试自有 5182 服务与浏览器已在 finally 中关闭。

完整 `npm run build`、`npm run lint` 和 `git diff --check` 通过。构建仅保留既有产物大小提示。测试测量等待动画及焦点还原完成，避免将过渡帧当作最终几何。

截图及结构化证据位于测试输出目录 `%TEMP%/spmusic-stream-address-dialog-evidence/`：`dialog-default.png`、`dialog-error.png`、`dialog-narrow.png`、`evidence.json`。该目录是临时本机证据，非项目运行资产。
