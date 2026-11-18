---
doc_id: "ARCH-POWERAMP-MSG-PROTOCOL-NATIVE-EVIDENCE"
title: "插件系统（三十四）：msgID 协议与 native 侧字符串佐证"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
created: "2026-11-18"
updated: "2026-11-18"
open_items: 2
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/architecture/poweramp-plugin-command-protocol.md（九）"
  - ".rea-analysis/natives/libpowerampcore.so"
---

# 插件系统（三十四）：msgID 协议与 native 侧字符串佐证

## 0. 一句话结论

第九篇解出了 Java 侧命令协议（msgID 在 offset 0x14，合法值 1）。
本轮在 libpowerampcore.so 里找到三条直接对应的错误串，
证实 Java 侧校验逻辑与 native 侧的协议定义是同一套。

---

## 1. native 侧的四条关键字符串

| 偏移 | 字符串 | 对应 Java 侧 |
| ---: | --- | --- |
| @347401 | bad msg id=%d | MilkPluginService 的 bad msgID= |
| @347401 | msg_id=%d bad data_size=%d min_length<=%d | bad msg size= 加长度校验 |
| @327380 | failed GetPrimitiveArrayCritical plugin_id=%d msg_id=%d | JNI 临界区失败（Java 无对应） |
| @358118 | bad handle_msg call for=%s(%d) ret=%d msg_id=%d msg->plugin_id=%d | 插件分发失败（Java 无对应） |

### 1.1 逐项对照

| Java 侧（第九篇） | native 侧 | 一致 |
| --- | --- | :---: |
| Log.e 内容 bad msgID= 加 msgID | bad msg id=%d | 语义完全一致 |
| Log.e 内容 bad msg size= 加 capacity | bad data_size=%d min_length<=%d | native 更详细 |

> 这是本项目最直接的 Java 与 native 协议互证——两侧措辞几乎相同。

---

## 2. 从错误串反推的协议字段

| 字段 | 依据 |
| --- | --- |
| plugin_id | @327380 与 @358118 各一处 |
| msg_id | 三处都有 |
| data_size | bad data_size=%d |
| min_length | min_length<=%d |

### 2.1 与 Java 侧偏移的对应

| Java 偏移 | 大小 | 推断字段 | native 佐证 |
| ---: | ---: | --- | --- |
| 0x00-0x13 | 20 | 未知头部 | 可能含 plugin_id |
| 0x14 | 4 | msg_id | 三处字符串 |
| 0x1c | 4 | 子类型或长度 | min_length |
| 0x20 | 8 | 载荷 | data_size |

> plugin_id 很可能就在那 20 字节内——这解释了第九篇的疑问：
> Java 不需要读它，因为消息总由 native 定向投递；native 用它做路由。

---

## 3. 新发现：FLAG_CMD_MSG_USED_NOW

@336101 附近出现 callbackOnEnded、callbackOnMsgBusMsg、%s msg FLAG_CMD_MSG_USED_NOW。

| 字符串 | 含义 |
| --- | --- |
| FLAG_CMD_MSG_USED_NOW | 消息标志：立即使用 |
| callbackOnMsgBusMsg | native 会回调 Java 的 MsgBus |

> 暗示消息可能有两个字段：msg_id（做什么）加 flag（何时做）。
> 与第九篇观察到的 0x1c 子类型吻合。

---

## 4. msgID 枚举的边界

| 尝试 | 结果 |
| --- | --- |
| Java 侧搜 getInt(0x14) 合法值 | 只有 1（第九篇） |
| native 侧搜 msg 相关字符串 | 只找到错误串，无 msgID 常量表 |
| native 侧搜 MSG_ 前缀 | 3 处，均为非本协议字符串 |

### 4.1 结论

msgID 的完整枚举不可从静态产物取得：

| 侧 | 原因 |
| --- | --- |
| Java | 只校验 1（可能只处理这一种） |
| native | msgID 常量以立即数编译进代码段，不在字符串表 |

> 判定为硬边界（需反汇编代码段或运行期 trace）。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | 两侧错误串用词一致 | 便于跨语言排查 |
| A2 | native 校验比 Java 更详细 | min_length 给出期望值 |
| A3 | 消息含 plugin_id 做定向 | 一条总线多插件复用 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | msgID 无常量表 | 只能靠反汇编 |
| N2 | Java 只校验单一值 | 新 msgID 需改 Java |
| N3 | 20 字节头部无文档 | 字段含义靠推测 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | msgID 的完整枚举 | **硬边界**：native 常量在代码段，无字符串表 |
| Q2 | 0x00-0x13 二十字节头部布局 | 推测含 plugin_id，偏移未定 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| Java bad msgID | `plugin/milk/MilkPluginService.smali:196` |
| Java bad msg size | `MilkPluginService.smali:166` |
| native bad msg id | `libpowerampcore.so` @347401 |
| native data_size/min_length | @347401 |
| native plugin_id | @327380、@358118 |
| native FLAG_CMD_MSG_USED_NOW | @336101 |
| native callbackOnMsgBusMsg | @336101 |
| 协议偏移 msgID 0x14 | `MilkPluginService.smali:186` |

> 口径：**build-1025**；native 为 `libpowerampcore.so`（3,592,656 字节）。