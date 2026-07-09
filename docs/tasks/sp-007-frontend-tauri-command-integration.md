# 任务：前端 Tauri command 集成

## 背景

Rust command 存在后，前端需要调用它并展示连接状态。

## 目标

从 React UI 调用最小 Tauri command，并展示返回状态或不可用状态。

## 非目标

- 不增加更大的后端 API。
- command 失败时不阻塞整个 UI。

## 负责 Agent

Frontend Agent

## 涉及文件 / 模块

- `src/App.tsx`
- `src/App.css`

## 验收标准

- 前端调用 Architecture Agent 定义、Rust/Tauri Agent 实现的 command。
- UI 展示成功结果或不可用 / 错误状态。
- command 调用失败不会导致应用崩溃。
- `npm run lint` 通过。
- `npm run build` 通过。

## 备注

该任务依赖 SP-006。
