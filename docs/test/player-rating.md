---
doc_id: TEST-PLAYER-RATING
title: 播放界面五星评分与视频手势验证
doc_type: test
status: active
owner_agent: Test Agent
version_scope: player-rating
created: 2026-11-07
updated: 2026-11-07
source_documents:
  - user request: 补全播放界面五星评分并参照两段视频实现交互
  - src/features/player/components/StarRating.tsx
  - src/features/player/components/playerRating.browser.test.mjs
  - src/features/player/model/streams.model.test.mjs
---

# 播放界面五星评分与视频手势验证

## 摘要

使用真实 PlayerShell / PlayerSurface 在 Edge 无头浏览器独立执行评分模式和参考视频交互验证。默认运行正常动效，另测 reduced motion；原生音频传输复用既有模拟 fixture。

## 范围

静止按评分显示实星（0分一颗空星）、按下展开、横向拖动0～5、释放收回、长按5与0切换、键盘、取消清理、模式切换及曲目隔离。最高评级分类不在本次范围。

## 实现交付与证据完整性

- 实现 Owner：Frontend Agent；测试由 Test Agent 独立编写执行。
- 改动链：pointer capture 拦截评分手势 → 曲目 ID 整数评分 → 按下/焦点控制展开 → CSS宽度动画；模式偏好独立于评分。
- 复现基线：此前五颗按钮常驻；用户视频要求静止折叠、按下展开及长按行为。
- 反证：真实拖动没有触发封面换歌；模式切换未损失2～4；长按释放未发生二次点击写入；换曲、cancel、lostcapture、disabled、unmount后均无待执行长按写入。
- 测试发现并回归：More Dialog默认自动聚焦评分导致静止展开，改为聚焦弹窗根；封面右内边距露下一星，改为内部轨道剪裁。

## 命令

```powershell
$env:SPMUSIC_PLAYWRIGHT='C:/Users/winkeses/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node src/features/player/components/playerRating.browser.test.mjs
node --test src/features/player/model/streams.model.test.mjs
```

浏览器测试通过；模型排序5/5通过。`npm run build`、`npm run lint` 由主 Agent / Frontend Agent 最终执行，Test Agent未重复运行。无本次评分 Rust命令或音频能力变化，未执行cargo或Tauri实机。

## 人工检查

Test Agent已查看两段视频抽帧，及实际浏览器的更多层和640宽封面截图。更多层无胶囊背景，使用inverse-primary；封面折叠/展开样式保留最大宽度为封面1/3。真实曲目封面像素和Tauri桌面硬件未验证。

证据位于 `%TEMP%/spmusic-player-rating-evidence/`：

- `gesture-motion.json`：正常动效opening/closing逐rAF宽度、expanded/pressed状态及got/lostpointercapture记录。
- `rating-opening-midframe.png`：展开中间帧。
- `rating-more.png`：更多层静止4星。
- `rating-1280.png`、`rating-640.png`、`rating-420.png`：三视口。
- `final.json`：场景汇总和浏览器错误列表。

## 根因与因果链反证

正常动效宽度连续跨越多个中间值，计算transition为0.25s；非瞬时切换。pointermove使用固定首星坐标和pitch，写入0、2、3、4，释放收为当前颗数。真实mouse捕获事件和可信CDP touch路径均通过。长按400ms后按下前3→5及5→0，释放后继续等待仍保持结果。

## 跨层契约

未新增Rust命令、权限或文件写入。展示层回调绑定当前layer的track.id；非active层禁用并清timer。实际下一首/上一首及旧层按住过程中换曲验证新曲没有旧长按写入。

## 回归覆盖

- 0分一颗空星；2/3/4静止颗数正确，模式切换无损且赞踩均不选。
- 按下展开5颗，横拖可到0，释放收回；got/lostpointercapture有记录。
- 长按3→5、5→0只触发规定写入；快速按下释放不晚触发长按。
- pointercancel/lostcapture清理；disabled/unmount后等待460ms不产生额外写入。
- 键盘焦点展开、箭头、Home、End、Delete；失焦收回。
- 更多层同手势并同步评分，透明背景、无阴影/内边距、inverse-primary。
- 鼠标和可信touch拖动均不切换封面曲目。
- 三视口展开布局宽度≤封面1/3；reduce motion无transition，交互仍可用。
- 之前一轮已验证模式reload持久化、SVG外部资源解码和currentColor、流真实整数排序。

## 性能 / 时序

无性能优化主张。正常CSS动画逐rAF取证；长按计时以已定义400ms为基准，测试等待460ms观察结果和取消路径。旧层卸载及禁用清理在正常动效环境执行，不以reduce motion掩盖。

## 发现与风险

范围内无残留阻塞。420宽既有歌词/传输控件布局裁切未扩大本次评分任务处理。真实Tauri运行、硬件音频及不同触屏设备未验证；CDP touch为浏览器可信触摸输入。评分当前会话保存，模式保存本地偏好。

## 临时缓解

本次评分交互非临时缓解。

## 验证结论

本次评分范围通过，建议主Agent完成最终集成确认。

## 2026-11-07：收起状态命中与同分清零缺陷回归

用户报告：一颗实星再次点按不能清零；收起后原第三星位置点击会触发封面返回；更多层手势难以触发。本轮不以先键盘展开来覆盖收起状态。

独立修复前基线位于 `%TEMP%/spmusic-rating-hits-evidence/baseline-first.json`：

- score=1点按后仍1，预期0；native事件证明正常rating capture，不是未收到事件。
- score=1点击原第三槽空白命中cover-actions，随后track-card-deck捕获并打开playlist，评分仍1；因果链为视觉裁剪同时移除了五槽点击区。
- 更多从可见第一颗起手的mouse和可信touch拖4原本都通过，未把用户笼统反馈错误归为整个手势处理器失效；追加更多收起第三空槽起手回归。

新增正式命令：

```powershell
node src/features/player/components/playerRatingHitTargets.browser.test.mjs
```

测试通过真实坐标mouse和CDP touch，而非VM写值代替手势。VM仅用于准备1分状态。覆盖实星短点清0、封面空第三槽点击3且不返回、更多空第三槽点击3、更多可见第一颗mouse/touch拖4，以及420宽封面和更多第三空槽可信触摸。弹窗打开只等待几何稳定，不使用键盘先展开；打开动画中的旧坐标不能用于判断最终命中。

实现将固定五槽root作为命中区，视觉track和::before背景独立收缩；按坐标选分；同分未拖/未长按短点在up清零。旧完整手势套件已改采样visual track而非固定root，重新通过开合中间帧、长按、取消、键盘、disabled/unmount、模式和曲目隔离。完整证据保留在 `%TEMP%/spmusic-rating-hits-evidence/findings.json` 与 `regression-log.txt`。

## 2026-11-07：封面操作统一缩放与边距验证

用户要求封面更多和赞踩按钮随封面宽度统一缩放，并要求评分和更多底边距等于评分左边距。新增正式比例测试：

```powershell
node src/features/player/components/playerCoverActionsScale.browser.test.mjs
```

真实Shell独立执行20组：2560×1440 DPR1、1920×1080 DPR1、1440×960 DPR2（对应2880×1920/200%）、640×1024 DPR1、420×900 DPR1；每组五星/赞踩、播放/暂停。按封面宽度归一化比较按钮、图标、左右/底边距和赞踩间距，不写死各屏CSS像素；每次播放状态变化后等待实际cover/按钮/icon几何连续5帧稳定，再采样，以免把已有封面播放动画中的瞬态投影作为最终比例。

20组全部通过，更多宽高/封面约72/990，图标约48/990，左/右/底约12/990；赞踩宽约106/990、间距约24/990。两模式、播放/暂停和DPR2比例一致，420/640无操作重叠或封面边界裁切。更多弹窗仍是inverse-primary，根及::before透明、无阴影，独立的更多层缩放未受封面规则影响。

播放态代表几何（CSS px）：

| CSS视口与DPR | 封面宽 | 更多宽高 | 图标宽高 | 左=底 |
| --- | ---: | ---: | ---: | ---: |
| 2560×1440 / 1 | 1062 | 77.23 | 51.48 | 12.86 |
| 1920×1080 / 1 | 796.5 | 57.92 | 38.61 | 9.64 |
| 1440×960 / 2 | 602 | 43.78 | 29.19 | 7.30 |

测试发现首版遗漏container-type导致cqw回退viewport，独立测出more越出封面；已退回前端补inline-size容器并重新通过。五星完整交互测试也在最终CSS下重跑通过（`playerRating.browser.test.mjs`退出0）。

证据位于 `%TEMP%/spmusic-cover-actions-scale-evidence/geometry.json`、`result.log`、`1920-1-stars.png`、`1440-2-thumbs.png`、`420-1-stars.png`、`more-popup.png`。Test Agent已实际看图确认。无真实跨显示器拖窗/操作系统DPI切换验证；DPR通过浏览器设备指标模拟。
