---
doc_id: "DEC-2026-07-09-V0-1-UI-SCOPE"
title: "v0.1 UI 原型范围"
doc_type: "decision"
status: "superseded"
owner_agent: "PM Agent"
version_scope: "v0.1"
created: "2026-07-09"
updated: "2026-07-24"
source_documents:
  - "docs/requirements/v0-1-foundation.md"
  - "docs/sprint-plan.md"
  - "docs/decisions/2026-07-24-v0-1-real-audio-scope.md"
---
# 决策：v0.1 只做播放界面，虚构播放列表管理 UI 顺延到 v0.2

## 状态

已被 `docs/decisions/2026-07-24-v0-1-real-audio-scope.md` 覆盖。

## 原决策

2026-07-09 的原决策是：v0.1 只做播放界面，播放 / 暂停 / 上一首 / 下一首只改变前端 UI 状态；真实音频播放、本地文件读取、媒体库、数据库、播放列表持久化和最小 Tauri 通信验证不进入 v0.1。

## 覆盖原因

用户在 2026-07-24 明确要求将真实音乐播放放入 v0.1，并让后端开始工作。因此，旧决策中“不做真实音频播放”和“不做 Tauri command”的限制不再是当前 v0.1 范围规则。

## 保留仍有效的部分

- 虚构播放列表管理 UI 仍不进入 v0.1。
- 媒体库、数据库、真实播放列表、网络存储和插件系统仍不进入 v0.1。
- v0.1 仍需要保持可验证的边界，不把长期愿景一次性塞入当前版本。
