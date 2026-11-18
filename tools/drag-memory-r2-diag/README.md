# R2 拖动内存诊断工具

OPT-0018 第二轮（`docs/tasks/opt-0018-drag-memory-r2-ds-plan.md`）§4.1 要求的"A 路线诊断"所用工具。
配套报告：`docs/test/opt-0018-drag-memory-r2-diag-2026-11-18.md`。

三个工具各自只做一件事：

| 文件 | 作用 |
| --- | --- |
| `r2diag-probe.page.js` | 注入渲染进程的**只读**探针：统计临时预解码在途数、同 URL 重叠、离屏已解码图片数与源像素面积 |
| `r2diag-probe.mjs` | 把上面的页面脚本读成字符串并替换版本号的薄封装 |
| `probe-selftest.mjs` | 21 项回归，针对"探针会不会数错"（详见下） |
| `analyze-r2diag.mjs` | 读一次运行的 `r2diag*.json`，按**事前写死的阈值**给出 B/C/D 三线判定 |
| `run-r2-diag-block.ps1` | 一次完整诊断块：G（冷）→ H（盘熟），各含静置/活动/恢复与进程树采样 |

## 探针必须遵守的三条约束

1. **不发起任何请求、不改任何调度**。只拦截只读判断与计数；删掉这里所有文件，测量行为回到原样。
2. **临时预解码的判定是"由 `new Image()` 构造"**，不是"有 src 赋值"。React 挂载的封面元素走 `createElement`，若按 src 赋值判定，会把整片挂载网格算成在途（实测错到 1369）。
3. **释放路径是 `removeAttribute('src')`**，不是 src setter。`playlistCoverPathLane.predecodeCoverImage` 的 `finish()` 对每种结局都调用它；只盯 setter 会让已完成的临时元素永久留在在途里（实测错到 1005，真实值 16）。

第 2、3 条都是先踩到才发现的，`probe-selftest.mjs` 各有一条回归把守。

## 用法

```powershell
# 1. 一次诊断块（约 12 分钟，G+H）
./run-r2-diag-block.ps1 -Label 'A-diag-sweep' -Exe <arm>/app.exe -Route sweep `
  -StressSeconds 120 -WarmSeconds 30 -IdleSeconds 20 -RecoverySeconds 60 -SampleMs 50 -DiagSampleMs 250 -Port 9882

# 2. 判定
node analyze-r2diag.mjs <runroot>

# 3. 探针自身回归
node probe-selftest.mjs
```

## 依赖

被测二进制必须在编译期打上隔离补丁（`AppPaths` 走 `THUMB_UI_ROOT`、原生选文件对话框换成 `THUMB_UI_PLAYLIST`），
该补丁由 `D:/_work/SpMusic-drag-memory-r1-kit/lib/coverlane-isolation.patch.mjs` 施加，摘要应等于
`6ee4cd9a4ce2315d328c7c77b0c978ab67d9cc3a7294deeec285251e232f3b53`。

runner 侧（`D:/SpMusic-opt0018-r1/tools/memory-drag-r1.mjs`）为接入探针新增了 `--r2-diag` 与
`--r2-diag-sample-ms` 两个开关，**默认关闭**；关闭时与原 R1 行为完全一致。
