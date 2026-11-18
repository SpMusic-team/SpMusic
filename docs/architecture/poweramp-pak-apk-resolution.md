---
doc_id: "ARCH-POWERAMP-PAK-APK-RESOLUTION"
title: "插件系统（十三）：apk:// pak 的物理定位与扫描分流"
doc_type: "architecture"
status: "active"
owner_agent: "Architecture Agent"
version_scope: "build-1025-uni (versionCode 1025009)"
revision: 1
open_items: 0
created: "2026-11-18"
updated: "2026-11-18"
source_documents:
  - "user request: 逐项逆向插件系统"
  - "docs/architecture/poweramp-pak-uri-schemes.md（五）"
  - ".rea-analysis/smali/smali/com/maxmpz/milk/scanner/B.smali"
---

# 插件系统（十三）：apk:// pak 的物理定位与扫描分流

## 0. 一句话结论

第五篇只到"`apk://<pkg>` 取包名"，本轮补齐**物理定位**：

`apk://` 按**是否是自己包**走两条完全不同的分支，最终都指向 APK 文件路径，
再交给 `Х(apkPath, pkg, flag, ...)` 打开 zip 扫描。

---

## 1. 分流主体（`milk/scanner/B.smali:639-736`）

```smali
pkg = Uri.decode(uri.substring(6));        // "apk://".length()
if (pkg == null || pkg.length() <= 0) {
    Log.e("scanContainer bad container=" + uri);
    return;
}

if (pkg.equals(ctx.getPackageName())) {            // ① 自己包
    apkPath = ctx.getApplicationInfo().publicSourceDir;
    Х(apkPath, pkg, 0x8, null);                    // flag = 8
} else {                                           // ② 外部包
    appInfo = pm.getApplicationInfo(pkg, 0x80);    // GET_META_DATA
    if (appInfo != null) {
        src = x1.c(pm, appInfo);                   // ★ 返回 milk/scanner/В 对象
        if (src != null) {
            Х(src.А, src.B, 0xa, null);            // flag = 0xa (10)
        } else {
            Log.e("scanContainer invalid presets pak=" + pkg);
        }
    }
}
```

### 1.1 两条分支的差异

| | 自己包 | 外部包 |
| --- | --- | --- |
| 路径来源 | `getApplicationInfo().publicSourceDir` | `x1.c(pm, appInfo)` 返回对象 |
| 额外字段 | 无 | `В.А` + `В.B` 两个字符串 |
| flag | **`0x8`（8）** | **`0xa`（10）** |
| 失败处理 | — | `Log.e("scanContainer invalid presets pak=")` |

> **`0x8` vs `0xa`** 差一个 bit2（`0x2`）。
> 推测 `0x2` = "外部包"标志，影响后续资源读取方式。

---

## 2. `x1.c(pm, appInfo)` 返回什么

返回类型是 **`milk/scanner/В`**（有两个字段）：

| 字段 | 类型 | 推测语义 |
| --- | --- | --- |
| `А` | `String` | APK 路径（`sourceDir`） |
| `B` | `String` | 包名或资源前缀 |

> 调用点 `:689`：`x1.c(pm, appInfo)` → `:706-708` 读 `В.А` 和 `В.B`。
> 与"自己包"分支的 `publicSourceDir` 对照，`В.А` 极可能是 `sourceDir`。

---

## 3. 四种 scheme 的完整执行表（五 + 十三）

| scheme | 分流判据 | 动作 | 目标 |
| --- | --- | --- | --- |
| `builtin:` | `equals` | `y(true)` | 内置表（不走文件） |
| `compiled:` | `equals` | `y(true)` | 同上 |
| `dir:` | `equals` | `File.fromUri` → `isDirectory` | 文件系统目录 |
| `apk://`（自己） | `equals(packageName)` | `publicSourceDir` | **自己的 APK** |
| `apk://`（外部） | 否则 | `pm.getApplicationInfo(pkg,0x80)` → `x1.c` | **外部 APK** |

> `apk://` 是唯一有**内部分叉**的 scheme。

---

## 4. 与插件体系的对比（重要）

| | 插件发现 | pak 发现 |
| --- | --- | --- |
| 包来源 | **遍历全部已安装包** | **单一指定包**（URI 里写死） |
| 权限标记 | `getApplicationInfo(pkg, 0x80)` | 同样 `0x80` |
| 读的资源 | 固定 id `0x7f160020` | `sourceDir` 里的 zip 内容 |
| 失败 | 打日志继续下一个包 | 打日志返回 |

> **插件是"广播式发现"，pak 是"点对点寻址"**。
> 二者都用 `0x80`（GET_META_DATA）取 appInfo，但用途不同：
> 插件读 metaData，pak 读 sourceDir。

---

## 5. 可借鉴 / 不建议照抄

### 5.1 值得借鉴

| # | 做法 | 理由 |
| --- | --- | --- |
| A1 | **自己包与外部包分两条路径** | 自己包可直接 `getApplicationInfo()`，省一次 PM 查询 |
| A2 | **`0x8` / `0xa` 区分来源** | 后续处理可据此分支 |
| A3 | **包名先 `Uri.decode`** | 与构造端 `Uri.encode` 对称 |
| A4 | **空包名/无效包都有明确日志** | 可追踪 |

### 5.2 不建议照抄

| # | 问题 | 后果 |
| --- | --- | --- |
| N1 | flag 值 `0x8`/`0xa` 无命名常量 | 含义不可读 |
| N2 | `x1.c()` 返回自定义类型而非直接返回路径 | 多一层间接 |
| N3 | `substring(6)` 仍硬编码（见第五篇） | 改 scheme 即断 |

---

## 6. 未解 / 边界

| # | 问题 | 现状 |
| --- | --- | --- |
| ~~Q1~~ | ~~flag 位含义~~ | ✅ **已判定**（三十八）：`А()` 内只 `int-to-long` 入库，**无位运算** |
| ~~Q2~~ | ~~`Х()` 如何打开 zip~~ | ✅ **已闭合**（三十九）：**不含 zip 逻辑**——仅校验/去重/转调 `у()` |

---

## 7. 证据索引

| 主题 | 位置 |
| --- | --- |
| `apk://` 分包名 | `milk/scanner/B.smali:629-637` |
| 空包名校验 | `B.smali:639-645` |
| 自己包判定 | `B.smali:647-651` |
| 自己包路径 | `B.smali:659-663`（`publicSourceDir`） |
| 自己包调用 | `B.smali:667`（flag `0x8`） |
| 外部包查询 | `B.smali:676-685`（`getApplicationInfo` `0x80`） |
| 外部包解析 | `B.smali:689`（`x1.c`） |
| 外部包调用 | `B.smali:712`（flag `0xa`） |
| 失败日志 | `B.smali:717-723`、`:728-734` |

> 口径：**build-1025**。
