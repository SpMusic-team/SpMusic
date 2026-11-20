---
doc_id: "INDEX-CHANGES"
title: "变更记录索引"
doc_type: "index"
status: "active"
owner_agent: "lead"
version_scope: "project"
created: "2026-11-20"
updated: "2026-11-20"
source_documents:
  - "docs/README.md"
---

# 变更记录索引

41 篇 = 缺陷 20 + 优化 21。

## 缺陷

- [“未找到歌词”的样式未作适配](./bugs/BUG-0001.md) · `BUG-0001` · done
- [播放控制器的横向宽度未设置最小值](./bugs/BUG-0002.md) · `BUG-0002` · draft
- [按住进度条按钮时已播放进度条未变粗，释放时闪烁](./bugs/BUG-0003.md) · `BUG-0003` · done
- [标题与作曲家+专辑名称截断过短](./bugs/BUG-0004.md) · `BUG-0004` · done
- [标题滚动未呈现“慢-快-慢”速度](./bugs/BUG-0005.md) · `BUG-0005` · done
- [标题滚动间隔过快](./bugs/BUG-0006.md) · `BUG-0006` · done
- [歌词上下方模糊遮罩未实现](./bugs/BUG-0007.md) · `BUG-0007` · done
- [歌词点击跳转未实现](./bugs/BUG-0008.md) · `BUG-0008` · done
- [半屏视图下的按钮大小不正确](./bugs/BUG-0009.md) · `BUG-0009` · draft
- [半屏视图下的封面大小不正确](./bugs/BUG-0010.md) · `BUG-0010` · draft
- [切换歌曲时短暂显示尚未加载歌曲状态](./bugs/BUG-0011.md) · `BUG-0011` · done
- [歌词行间距偏短](./bugs/BUG-0012.md) · `BUG-0012` · done
- [点击歌词后按下 Shift 错误显示黑色圆角焦点框](./bugs/BUG-0013.md) · `BUG-0013` · done
- [更多信息面板第三行的歌曲信息与设计稿不符](./bugs/BUG-0014.md) · `BUG-0014` · draft
- [播放与暂停状态的图标尺寸和动效不一致](./bugs/BUG-0015.md) · `BUG-0015` · draft
- [连续切歌导致 WebView2 内存异常增长与卡顿](./bugs/BUG-0016.md) · `BUG-0016` · done
- [快速拖动切歌导致转场中断、白屏或旧封面抽搐](./bugs/BUG-0017.md) · `BUG-0017` · done
- [Surface Pro 10 商业版播放界面动画频繁出现封面重入](./bugs/BUG-0018.md) · `BUG-0018` · in-review
- [播放列表封面加载及持续滚动慢于所有歌曲](./bugs/BUG-0019.md) · `BUG-0019` · done
- [连续拖拽停止后封面切歌被原生拖放取消](./bugs/BUG-0020.md) · `BUG-0020` · in-review

## 优化

- [音频线程重 I/O 与时间敏感控制混在一起](./optimizations/OPT-0001.md) · `OPT-0001` · done
- [读取路径重复解析且只读操作会改写用户文件](./optimizations/OPT-0002.md) · `OPT-0002` · done
- [命令返回状态与事件推送双通道对账](./optimizations/OPT-0003.md) · `OPT-0003` · draft
- [播放进度依赖 500ms 轮询而非推送](./optimizations/OPT-0004.md) · `OPT-0004` · draft
- [封面图同时返回 dataUrl 与 filePath 导致负载膨胀](./optimizations/OPT-0005.md) · `OPT-0005` · draft
- [前后端 TS 契约手抄维护、缺少生成与校验](./optimizations/OPT-0006.md) · `OPT-0006` · draft
- [命令路径输入缺少规范化与范围校验](./optimizations/OPT-0007.md) · `OPT-0007` · draft
- [播放队列位于前端，曲目切换存在间隔且无法预加载](./optimizations/OPT-0008.md) · `OPT-0008` · draft
- [目录播放列表重复扫描目录](./optimizations/OPT-0009.md) · `OPT-0009` · draft
- [双解码栈与 vendored matroska 维护成本](./optimizations/OPT-0010.md) · `OPT-0010` · draft
- [日志在命令、控制器、运行时三层重复](./optimizations/OPT-0011.md) · `OPT-0011` · draft
- [播放信息按钮与输入到输出流程说明](./optimizations/OPT-0012.md) · `OPT-0012` · draft
- [竖向半屏播放器布局适配](./optimizations/OPT-0013.md) · `OPT-0013` · draft
- [切歌播放关键路径与展示元数据路径拆分](./optimizations/OPT-0014.md) · `OPT-0014` · done
- [播放状态轮询与封面解码内存治理](./optimizations/OPT-0015.md) · `OPT-0015` · in-review
- [歌曲列表封面缩略图持久化与播放列表加载反馈](./optimizations/OPT-0016.md) · `OPT-0016` · active
- [播放界面快速拖动切歌的封面解码内存峰值治理](./optimizations/OPT-0017.md) · `OPT-0017` · done
- [OPT-0018 列表封面路径方案集成记录](./optimizations/OPT-0018-develop-integration.md) · `OPT-0018-DEVELOP-INTEGRATION` · done
- [OPT-0018 v2 列表封面路径通道：实施、真机实测与保留/回滚判定依据](./optimizations/OPT-0018-v2-result.md) · `OPT-0018-V2-RESULT` · superseded
- [OPT-0018 真机实测指引](./optimizations/OPT-0018-verify.md) · `OPT-0018-VERIFY` · draft
- [专辑库列表封面由像素 IPC 改为 asset 协议路径下发](./optimizations/OPT-0018.md) · `OPT-0018` · superseded
