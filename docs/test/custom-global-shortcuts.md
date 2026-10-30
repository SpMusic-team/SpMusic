---
doc_id: "TEST-CUSTOM-GLOBAL-SHORTCUTS"
title: "自定义全局快捷键独立验证"
doc_type: "test-report"
status: "in-review"
owner_agent: "Test Agent"
version_scope: "project"
created: "2026-10-13"
updated: "2026-10-13"
source_documents:
  - "docs/tasks/custom-global-shortcuts.md"
  - ".agents/prompt/Test_Agent.md"
  - "src/features/shortcuts/"
  - "src-tauri/src/global_shortcuts.rs"
  - "src-tauri/tests/global_shortcuts.rs"
  - "user follow-up: 上一首与下一首默认组合追加 Alt"
---

# 测试报告：自定义全局快捷键

## 摘要

独立执行模型测试 6 项、真实浏览器组件测试 13 项、Rust 事务测试 13 项和 Windows 原生插件测试 1 项，均通过。验证期间发现并复验了录制后设置行高度归零的问题；原生测试程序缺少 Common Controls v6 清单的启动问题也已修复。真实播放器带音频、切到其他应用或最小化后的五项控制，以及退出重启整条链路尚未人工执行，完整桌面验收仍有证据缺口。

用户随后将上下首默认修改为 `Ctrl+Alt+ArrowLeft` / `Ctrl+Alt+ArrowRight`。本次追加复验模型 6 项及浏览器局部 3 项均通过，前后端默认一致；下文完整验证记录保留，未把原生插件测试扩大为完整播放器验收。

## 范围

- 五项默认值、录制规范化、清除、保存、恢复默认、重复与非法输入。
- 保存/注册/回滚失败、启动冲突、配置文件重载与损坏处理。
- 录制暂停、取消、失焦、卸载、迟到完成、恢复失败、StrictMode 监听清理。
- Windows 实际插件注册、后台按键事件、系统占用、取消注册。

环境：Windows、Node.js 24.19.0、Edge 156.0.4314.8。浏览器使用项目真实 React 组件，IPC 由测试替身提供；原生测试使用真实 Tauri 快捷键插件与系统注册。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent、Rust/Tauri Agent。
- 修改范围：`src/features/shortcuts/`、设置入口/播放器集成、快捷键 Rust 模块、插件依赖、Tauri 启动/退出及测试资源链接。
- 复现基线：新增能力无旧实现；录制后五行消失有独立浏览器失败记录，原生测试入口失败有进程退出码。
- 已知证据与待验证假设：前后端自测结论分别通过独立模型、浏览器、事务及原生插件检查核验。
- 因果链：录制结束重排 → fieldset 内 inline-size 容器高度为零 → 五行及重复提示没有布局尺寸 → 用户看不到设置内容。
- 证据缺口：未启动完整生产播放器执行音频后台控制及进程退出/重启验收；原生测试使用低冲突 Ctrl+Alt+F24，不代表五项用户默认组合在此机器都可注册。

## 命令

Test Agent 独立执行：

- `node --test src/features/shortcuts/model/globalShortcuts.test.ts`：6/6 通过。
- `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`：用于浏览器验证，验证后停止。
- `$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'; node src/features/shortcuts/components/globalShortcuts.browser.test.mjs`：最终 13/13 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib global_shortcuts::tests -- --nocapture`：13/13 通过，144 项其他测试未执行。
- `cargo test --manifest-path src-tauri/Cargo.toml --test global_shortcuts -- --nocapture`：首次编译成功但运行时 `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`；修复测试程序资源链接后 1/1 通过，测试耗时约 0.09 秒。
- `npx eslint src/features/shortcuts/model/globalShortcuts.test.ts src/features/shortcuts/components/globalShortcuts.browser.test.mjs`：退出码 0。

仅复核主 Agent / 实现 Agent 的结果：`npm run lint`、`npm run build`、`cargo check --manifest-path src-tauri/Cargo.toml`、`cargo check --tests` 通过。最终仓库检查由主 Agent 在全部写入完成后汇总。`npm run tauri dev` 未执行。

初期 Vite 因监听原生编译中的 `app_lib.dll` 抛出 EBUSY 后退出；改为串行执行原生编译与浏览器验证。Edge 对 Vite HMR WebSocket 的本地网络检查报错不影响最终静态组件测试；无未捕获页面异常。

## 人工检查

未执行完整桌面人工检查。待验步骤：

1. 启动播放器并加载至少两首音乐，确认五项默认组合或逐项冲突反馈。
2. 播放音乐后切到其他应用、最小化，验证上一首/下一首、Ctrl+P 播放暂停、音量每次 5% 及 0/100 边界。
3. 自定义并保存，确认旧组合释放；清除、恢复默认并保存后退出重启，确认界面和实际按键一致。
4. 让其他程序占用某组合后保存或重启，确认对应行错误、无成功提示、其他有效绑定保留。
5. 录制期间关闭设置/切走窗口，确认恢复；退出播放器后确认组合释放。

## 根因与因果链反证

- 独立等价基线：重复组合已经写入 draft 且按钮禁用，DOM 也存在两条错误文本，因此排除了校验未生效或异步提交未完成。
- 实际 SettingsDialog 同样复现：主题行正常，快捷键组宽 488 像素但高度 0，五行及错误节点尺寸均为 0，排除了独立组件测试父容器缺失的替代假设。
- Frontend Agent 仅取消新增组不需要的 inline-size containment 后，实际弹窗组高 327.25 像素；五行分别高 60.25/60.25/42.25/42.25/42.25，重复提示均高 20。没有放宽可见性断言。
- 原生测试进程没有 `.rsrc`，导入旧 `comctl32.dll` 缺少 `TaskDialogIndirect`；build.rs 给测试目标链接现有 v6 资源后同一测试通过。生产快捷键注册逻辑没有被替换为模拟。

## 跨层契约

- TypeScript / Rust 字段均为 `previous`、`next`、`volumeUp`、`volumeDown`、`togglePlayback`；动作 camelCase 序列化一致。
- 三个真实 command 名称与注册表一致：`global_shortcuts_get_settings`、`global_shortcuts_update_settings`（`input.bindings`）、`global_shortcuts_set_suspended`（顶层 `suspended`）。响应均包含 `bindings`、`issues`、`suspended`。
- Rust 向 `main` 发送 `spmusic://global-shortcut-action`，载荷 `{ action }`；前端同名监听。Rust 仅转发 Pressed，Released 不触发播放动作。
- 所有五个 binding 字段必须存在，`null` 表示禁用；Rust 单测检查真实序列化，前端模型拒绝畸形响应。后端错误包含 `code/message/action`，前端展示失败并读取有效状态，不伪造保存成功。
- 注册和设置变更在主线程串行执行；应用状态锁不跨插件主线程调度。退出清理及失焦恢复入口已只读核对；前端暂停队列、代次检查与迟到 unlisten 经浏览器测试覆盖。
- 没有新增前端插件命令权限；系统注册通过受控 Rust command 完成。

## 回归覆盖

- 浏览器：默认显示、清除/保存/模拟重新加载、自定义/保存/恢复、重复/非法/自动重复、候选按键未释放时 Esc 取消、保存失败保留 draft 与有效设置、录制期间事件抑制、全部修饰键释放后提交、取消/卸载迟到暂停、失焦取消、恢复失败重试、读取确认后台已恢复、恢复与读取双失败、StrictMode 监听清理、最新播放器回调、连续操作及音量边界、浏览器不可用提示、实际弹窗错误可见性。
- Rust 事务：真实临时文件保存与重载、互换、禁用、默认恢复、损坏文件不覆盖、启动部分冲突、部分注册清理、旧注册恢复、持久化失败、恢复失败的真实剩余集合、残留未提交按键不分发、暂停失败、暂停期间拒绝保存、恢复注册冲突。
- Windows 原生：无前台窗口的 Tauri 插件接收 Ctrl+Alt+F24 一次 Pressed 和 Released；外部系统注册失败/占用返回错误，失败绑定不显示已注册，取消与全部取消后系统所有权释放。
- 自动化缺口：浏览器通信替身及无音乐原生测试不能证明完整播放器后台音频链路；文件重载不能等同于实际进程重启。

## 性能 / 时序

不涉及性能优化，没有性能提升结论。相关时序覆盖包括迟到暂停完成、取消排队、卸载恢复、迟到监听清理及 StrictMode 单个有效监听；实际按键只产生一对 Pressed/Released。未做长时间运行、连续高频系统输入或资源占用基准。

## 发现

录制后设置内容不可见及测试程序清单缺失均已交对应 Owner 修复并独立复验，当前自动化检查没有未解决失败。

## 风险

系统可能占用用户默认组合；实际启动时应以逐项错误反馈为准。真实后台音乐控制、完整应用退出释放和进程重启仍待人工验收。其他操作系统未验证。

## 临时缓解

产品修复不是临时缓解；Vite 与原生编译串行运行只是验证环境处理。未通过禁用校验、放宽断言或忽略异常掩盖功能失败。

## 验证结论

上述 33 项自动化检查通过；完整桌面端到端验收证据不足。不得将未执行的后台音乐及进程重启检查标记为通过。

## 建议

交主 Agent 汇总实现与最终仓库检查；按人工步骤补齐桌面端到端证据后由 PM Agent 验收。

## 默认上下首追加 Alt 的复验

- 仅更新原有模型测试的默认值/显示断言，以及浏览器 fixture、默认/取消断言和重复组合录制按键；修饰键规范化用例语义不变。
- `node --test src/features/shortcuts/model/globalShortcuts.test.ts`：独立 6/6 通过。
- 在前述 Playwright 环境变量基础上，设置 `$env:SPMUSIC_TEST_FILTER='default'` 并运行 `node src/features/shortcuts/components/globalShortcuts.browser.test.mjs`：1/1 通过，覆盖默认标签、清除/保存、模拟重新加载、自定义/保存、恢复新默认。
- 设置 `$env:SPMUSIC_TEST_FILTER='duplicate'` 运行同一浏览器命令：2/2 通过，重复录制采用 `Control+Alt+ArrowLeft`；实际设置弹窗五行及重复错误仍可见，组高 327.25 像素、两条错误各高 20 像素。
- 只读核对前端 `defaultShortcutBindings` 与 Rust `ShortcutBindings::default()` 的上下首均包含 Alt；后端保存读取没有修改，既有持久化值不会被默认值变更覆盖。
- Rust/Tauri Agent 本轮报告 13 项单测与 `cargo check` 通过；Test Agent 未重复运行 cargo。原生插件/完整播放器端到端的证据边界不变。
