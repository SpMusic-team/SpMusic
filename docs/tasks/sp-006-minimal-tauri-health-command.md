# 任务：最小 Tauri 健康检查命令

## 背景

Tauri 后端当前只有启动逻辑，没有用于验证 React 到 Rust 通信的业务 command。

## 目标

实现一个最小 Tauri command，返回固定的结构化状态。

## 非目标

- 不访问文件系统。
- 不扫描媒体。
- 不播放音频。
- 不添加数据库或插件依赖。

## 负责 Agent

Rust/Tauri Agent

## 涉及文件 / 模块

- `src-tauri/src/lib.rs`

## 验收标准

- Rust 侧暴露一个可被前端调用的 command。
- command 返回架构契约定义的可序列化状态对象或字符串。
- 在 `src-tauri/` 下执行 `cargo check` 通过。
- 没有引入本地媒体、音频、数据库或插件能力。

## 备注

前端集成由 SP-007 处理。
