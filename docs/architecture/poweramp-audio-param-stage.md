---
doc_id: "ARCH-POWERAMP-AUDIO-PARAM-STAGE"
title: "插件系统（三十一）：阶段⑤ 音频参数的动态列表构建"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 1
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/architecture/poweramp-device-opts-render-stages.md（十九）"
---

# 插件系统（三十一）：阶段⑤ 音频参数的动态列表构建

## 0. 一句话结论

第十九篇说阶段⑤"占 720 行、条件最密集"。本轮测完发现：

**只有 5 个键、35 条 if、0 次 `w()` 调用**——
它的篇幅不在分支，而在 **`NumberListPreference` 的动态列表构建**：
把 `ArrayList<Integer>` 灌进 int[]、`ArrayList<String>` 灌进 String[]。

---

## 1. 实测结构

| 指标 | 值 |
| --- | ---: |
| 行区间 | `:1180-1900`（720 行） |
| 字符串键 | **5 个** |
| `if-` 指令 | **35 条** |
| `c1.w()` 调用 | **0 次**（与阶段⑦ 的开关不同） |
| `StringBuilder.append` | 23 次（最多的调用） |

### 1.1 五个键

| 行 | 键 |
| ---: | --- |
| `:1213` | `buffer_size` |
| `:1458` | `sample_rate` |
| `:1487` | `sample_rate_static` |
| `:1837` | `sample_fmt` |
| `:1864` | `sample_bits_static` |

> 前两个是**可交互选择**，后两个带 `_static` 后缀的是**只读展示**。

---

## 2. ★ `NumberListPreference` 的三步装配

以 `sample_rate` 为例（`:1458-1590`）：

### 2.1 第一步：定位 Preference

```smali
// :1458-1474
key  = "sample_rate";
name = media/A.К("sample_rate", <url>);        // 拼出完整 key
pref = findPreference(key);
if (pref == null) pref = findPreference(name);  // ★ 双 key 回退
pref = (NumberListPreference) pref;
```

> **`media/A.К(String,String)`** 用于拼接设备前缀后的 key，
> 找不到再退回原始 key。这让同一页面能适配"全局"与"按设备"两种模式。

### 2.2 第二步：values（int[]）

```smali
// :1540-1576
int[] values = new int[list.size()];
for (i = 0; i < list.size(); i++) {
    values[i] = ((Integer) list.get(i)).intValue();   // ★ 逐项拆箱
}
pref.setValues(values);
```

### 2.3 第三步：entries（String[]）

```smali
// :1578-1590
String[] entries = strList.toArray(new String[0]);  // ★ ArrayList -> 数组
pref.setEntries(entries);
pref.setValue(currentValue);                        // 当前选中项
```

### 2.4 三元组

| 方法 | 参数 | 来源 |
| --- | --- | --- |
| `setValues(int[])` | 实际值 | `ArrayList<Integer>` 拆箱 |
| `setEntries(String[])` | 显示文本 | `ArrayList<String>` 直接转 |
| `setValue(int)` | 当前选中 | 用户偏好 |

> **values 与 entries 按下标一一对应**——典型的"值/文案双数组"模式，
> 与 idea 58 的 `playlist_insert_args1`/`modes`、idea 11 的 `repeat_modes` 同源。

---

## 3. ★ 采样率上限常量

`:1534` 出现 **`0x2ee00` = 192000**：

| 值 | 含义 |
| ---: | --- |
| **192000** | **192 kHz** —— Hi-Res 上限 |

上下文（`:1519-1537`）：

```smali
if (devList.size() > 1) {
    if (pref.С == 0 && !flag20) {          // 某偏好为 0 且非某状态
        if (mode == 2) goto :goto_10;       // 已是最高档
        limit = 0x2ee00;                    // ★ 192000
    }
    ...
}
```

> **`0x2ee00` 是"允许的最高采样率"**，用于过滤可选列表。
> 与 idea 40 的 Bit Perfect / Hi-Res 主题呼应。

---

## 4. 为什么 720 行

| 原因 | 占比推测 |
| --- | --- |
| 五个参数各自的"构建列表 → 灌数组 → 设值"重复 | **主体** |
| `StringBuilder.append` 拼显示文本（23 次） | 次要 |
| 依赖判断（35 条 if） | 少量 |

> **不是"分支复杂"，而是"重复劳动"**：5 个参数 × 各自约 100 行的装配代码。
> 这是可重构的信号——本可抽成一个 `setupNumberList(key, values, entries, current)` 方法。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **值/文案双数组按下标对应** | 与项目其它枚举一致 |
| A2 | **双 key 回退查找**（带前缀 / 原始） | 同页适配全局与按设备 |
| A3 | **动态生成采样率列表** | 依设备能力裁剪，而非写死 |
| A4 | **192000 上限过滤** | 明确的能力边界 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | **5 个参数各写一遍装配** | 720 行重复代码 |
| N2 | `Integer` 装箱后再逐个拆箱 | 无谓分配 |
| N3 | `new String[0]` 传 `toArray` | 每次都新建空数组（可用 `list.size()`） |
| N4 | 上限 `0x2ee00` 是魔法数 | 无命名常量 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| Q1 | `strList`/`list` 的**填充来源**（设备能力查询） | 只见消费端，生产端在 native 或别处 |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| 阶段⑤ 区间 | `preference/c1.smali:1180-1900` |
| 五个键 | `c1.smali:1213/1458/1487/1837/1864` |
| 双 key 回退 | `c1.smali:1462-1486` |
| values 拆箱 | `c1.smali:1559-1569` |
| `setValues` | `c1.smali:1576` |
| entries 转换 | `c1.smali:1580-1586` |
| `setEntries` | `c1.smali:1588` |
| `setValue` | `c1.smali:1590` |
| 192000 上限 | `c1.smali:1534` |

> 口径：**build-1025**。
