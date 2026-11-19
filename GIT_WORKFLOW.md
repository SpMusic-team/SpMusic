# Git 协作与版本管理流程规范

## 1. 目的

本规范约束项目的分支、提交与发布流程，目标是：

* 日常开发不互相阻塞
* 提交历史可追溯、可回滚
* 发布版本有明确的版本号与制品证据

---

## 2. 分支模型

```text
develop     主干开发分支，日常提交直接推到这里
feature/*   可选分支，用于大改动或长周期任务的隔离
main        暂未启用，保留给未来的稳定发布线
```

分支关系：

```text
feature/*（可选）
        ↓
      develop
        ↓
       main（未来启用）
```

> `main` 目前只有初始提交，尚未承接开发内容。首次正式发布前，所有工作都在 `develop` 上进行。

---

## 3. 各分支职责

### 3.1 `develop`

`develop` 是主干开发分支，也是当前唯一的集成分支。

要求：

* 日常提交直接推送到这里，不需要额外审批流程
* 禁止强制推送
* 禁止删除
* 推送前本地 `npm run lint` 和 `npm run build` 应通过
* 完成任务并跑完验证后默认提交，不需要逐次征询；一次任务按主题拆成若干提交，不要把不相关的改动塞进同一个提交

### 3.2 `feature/*`

用于隔离大范围改动、需要反复试验的功能，或可能中途放弃的探索。

命名规则：

```text
feature/功能名称
```

示例：

```text
feature/opt-0018-path-lane
feature/playlist-import
```

要求：

* 从最新的 `develop` 创建
* 一个分支只处理一个功能或一个明确任务
* 完成后合回 `develop` 并删除分支
* 小改动不需要建分支

### 3.3 `main`

稳定分支，保留给可运行、可交付的版本。

当前状态：**未启用**。只有初始提交，不承接开发内容。

启用条件：首次正式发布时，由 `develop` 合入并打第一个 tag。启用后禁止直接推送。

---

## 4. 日常开发流程

### 4.1 开始开发前

```bash
git checkout develop
git pull origin develop
```

### 4.2 提交代码

保持小步提交，一个提交只做一件事：

```bash
git status
git add .
git commit -m "feat(player): 新增播放进度拖动"
git push
```

### 4.3 需要隔离时使用 feature 分支

改动面大、需要多次试验、或可能与主干并行时：

```bash
git checkout -b feature/xxx
# 开发
git push -u origin feature/xxx
```

完成并验证后合回 `develop`：

```bash
git checkout develop
git pull origin develop
git merge --no-ff feature/xxx
git push
```

清理分支：

```bash
git branch -d feature/xxx
git push origin --delete feature/xxx
```

---

## 5. Commit 提交规范

提交信息统一采用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 风格：

```text
<type>(<scope>): <subject>

[body]

[footer]
```

其中 `<type>` 必填，`<scope>`、`body`、`footer` 按需填写。

### 5.1 类型（type，必填）

类型使用小写英文，取值固定为以下集合：

```text
feat      新功能
fix       Bug 修复
docs      文档修改（README、docs/、AGENTS.md、GIT_WORKFLOW.md 等）
style     代码格式或样式调整（不改变运行逻辑）
refactor  重构（不新增功能、不修复 Bug）
perf      性能优化
test      测试相关（新增或修改测试）
chore     构建、依赖、配置与杂项
ci        CI/CD 配置与流程
revert    回滚提交
```

不允许使用集合之外的类型，也不允许省略类型。

### 5.2 作用域（scope，可选）

作用域标注影响模块，使用小写 kebab-case，写在类型后的括号中。不填写时省略括号。

本项目常用作用域：

```text
player        播放器界面与播放控制
audio         音频后端（Tauri command、解码、输出设备）
artwork       封面加载与缓存
library       媒体库与曲库
theme         外观主题与动效
docs-manager  本地文档工作台
docs          项目文档
rea           逆向分析资料
ci            构建与 CI
```

示例：`feat(player): ...`、`fix(audio): ...`、`docs: ...`。

### 5.3 主题（subject，必填）

* 用祈使语气概括"做了什么"，简洁明确。
* 默认使用简体中文描述，与项目文档语言一致；代码标识符、文件名、API 名称可保留英文。
* 建议不超过 50 个字符，避免把多个改动塞进一个主题。
* 末尾不加句号。
* 禁止使用无意义或笼统描述，例如 `update`、`test`、`修改`、`111`、`bug`、`改一下`、`先这样`。

### 5.4 正文（body，可选）

正文说明"为什么改"和"怎么改"，不重复主题：

* 主题后空一行，再写正文。
* 需要引用任务卡、决策或 Bug 编号时，使用仓库内稳定标识，例如 `SP-018`、`BUG-0004`、`docs/decisions/...`。
* 多行提交信息使用多个 `-m` 参数或 heredoc，不使用单行拼接换行符。

### 5.5 页脚（footer，可选）

* 破坏性变更：`BREAKING CHANGE: 说明`；也可在类型后加 `!`，例如 `feat!:`。
* 关联 Bug / Issue：`Closes #123`、`Refs BUG-0004`。

### 5.6 示例

```bash
git commit -m "feat(player): 新增播放进度拖动"
git commit -m "docs: 更新项目启动说明"
git commit -m "fix(audio): 修复输出设备切换后无声音"
```

带正文与引用：

```bash
git commit -m "fix(player): 修复歌词行点击跳转位置偏移" \
  -m "点击歌词行时按行时间戳执行 seek，使进度与歌词高亮保持同步。" \
  -m "Refs BUG-0004"
```

带破坏性变更：

```text
feat(audio)!: 重构播放状态事件契约

audio_state_changed 的 payload 结构变更，旧前端监听方需同步升级。
BREAKING CHANGE: AudioPlaybackState 字段调整。
```

### 5.7 提交前检查

* 一条提交只包含一个逻辑改动，禁止多个功能混在同一个提交中。
* 提交前执行 `git diff --cached --stat` 和 `git status`，确认暂存内容与提交描述一致。
* 保持小步提交，便于追溯与回滚。

---

## 6. 冲突处理规范

当 `git pull` 或 `git merge` 出现冲突：

处理原则：

1. 不要直接覆盖别人的代码。
2. 先确认双方分别修改了什么。
3. 保留正确逻辑后删除冲突标记。
4. 本地运行或测试确认无误。
5. 再提交冲突处理结果。

冲突标记形如：

```text
<<<<<<< HEAD
当前分支代码
=======
另一分支代码
>>>>>>> develop
```

解决完成后：

```bash
git add .
git commit -m "fix: 解决合并冲突"
git push
```

---

## 7. 禁止事项

以下操作禁止：

```text
git push --force 到 develop
删除 develop
提交 .env、密钥、Token、数据库密码
提交 node_modules、构建产物、日志文件
多个功能混在同一个提交中
```

`main` 启用后，额外禁止直接 push 到 `main` 和强制推送 `main`。

除非明确确认，否则不得使用强制推送。

---

## 8. 协作约定

以下文件属于高冲突、高风险文件，修改前应先在群里沟通：

```text
package.json
package-lock.json
Cargo.toml
Cargo.lock
tauri.conf.json
路由总入口
权限与鉴权模块
CI/CD 配置
.github/
```

建议沟通格式：

```text
我准备修改：用户鉴权模块
预计影响：登录、注册、Token 校验
预计时间：今晚完成
分支：feature/auth-refactor
```
