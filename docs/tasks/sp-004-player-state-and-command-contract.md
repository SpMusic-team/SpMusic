# 任务：播放器状态与命令契约

## 背景

前端和 Rust/Tauri 实现需要共享最小状态与命令契约，避免各自实现后再返工。

## 目标

定义 v0.1 所需的最小前端播放器状态和 Tauri command 契约。

## 非目标

- 不设计真实音频引擎。
- 不设计持久化、媒体扫描或网络存储。

## 负责 Agent

Architecture Agent

## 涉及文件 / 模块

- `docs/architecture/player-state-and-command-contract.md`
- `src/App.tsx`
- `src-tauri/src/lib.rs`

## 验收标准

- 契约定义假歌曲渲染所需字段。
- 契约定义播放器状态字段，例如当前歌曲 ID、播放状态和队列。
- 契约定义一个 Tauri command 名称和返回结构。
- 契约明确 command 不扫描文件、不播放音频、不访问媒体存储。

## 备注

该任务阻塞前端和 Rust/Tauri 实现。
