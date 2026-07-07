# Git 协作与版本管理流程规范

## 1. 目的

本规范用于约束项目的 Git 分支、提交、合并和发布流程，保证双人协作时：

* 稳定代码不会被日常开发影响
* 功能开发互不干扰
* 重要修改可追溯、可回滚
* `main` 始终保持可运行、可交付状态

---

## 2. 分支模型

项目采用以下分支结构：

```text
main        稳定分支，可运行、可交付
develop     日常集成分支
feature/*   新功能开发分支
fix/*       Bug 修复分支
```

示例：

```text
main
develop
feature/login
feature/user-profile
feature/order-management
fix/login-token-expire
fix/user-avatar-upload
```

分支关系：

```text
feature/* / fix/*
        ↓
      develop
        ↓
       main
```

---

## 3. 各分支职责

### 3.1 `main`

`main` 是项目稳定分支。

要求：

* 始终保持可运行、可部署、可交付
* 不允许直接推送
* 所有修改必须通过 Pull Request 合并
* Pull Request 至少需要 1 名其他成员 Review
* 禁止强制推送
* 禁止删除分支

适用内容：

```text
已完成测试的功能
稳定的版本代码
可部署的代码
正式发布版本
```

---

### 3.2 `develop`

`develop` 是日常开发集成分支。

要求：

* 用于整合各个功能分支
* 允许项目成员直接 push
* 禁止强制推送
* 禁止删除分支
* 合并进 `main` 前需要完成基础测试

适用内容：

```text
正在集成的功能
待测试的版本
多个功能模块合并后的代码
```

---

### 3.3 `feature/*`

`feature/*` 用于开发新功能。

命名规则：

```text
feature/功能名称
```

示例：

```text
feature/login
feature/register
feature/user-profile
feature/order-api
feature/admin-dashboard
```

要求：

* 从最新的 `develop` 创建
* 一个分支只处理一个功能或一个明确任务
* 完成后合并回 `develop`
* 合并完成后删除分支

---

### 3.4 `fix/*`

`fix/*` 用于修复 Bug。

命名规则：

```text
fix/问题名称
```

示例：

```text
fix/login-token-expire
fix/user-avatar-upload
fix/database-connection
fix/order-status-error
```

要求：

* 普通 Bug 从 `develop` 创建
* 修复完成后合并到 `develop`
* 如果是线上紧急问题，可从 `main` 创建并优先修复
* 修复完成后需要同步回 `develop`

---

## 4. 日常开发流程

### 4.1 开始开发前

开始任何任务前，先同步远程 `develop`：

```bash
git checkout develop
git pull origin develop
```

确认本地 `develop` 是最新后，再创建功能分支：

```bash
git checkout -b feature/login
```

或者：

```bash
git checkout -b fix/login-token-expire
```

---

### 4.2 开发过程中提交代码

开发时应保持“小步提交”。

推荐流程：

```bash
git status
git add .
git commit -m "feat: 新增登录接口"
```

完成一个阶段后推送远程分支：

```bash
git push -u origin feature/login
```

后续继续推送：

```bash
git push
```

---

### 4.3 合并功能到 `develop`

功能完成后，在 GitHub 创建 Pull Request：

```text
feature/login → develop
```

或：

```text
fix/login-token-expire → develop
```

Pull Request 描述至少应包括：

```text
修改内容
测试方式
可能影响的模块
是否包含数据库变更、配置变更或接口变更
```

合并前建议确认：

```text
功能可以正常运行
没有明显报错
没有提交 .env、Token、密码等敏感信息
没有无关文件
没有未处理的冲突
```

合并完成后删除远程功能分支。

本地删除分支：

```bash
git checkout develop
git pull origin develop
git branch -d feature/login
```

如果远程分支还在：

```bash
git push origin --delete feature/login
```

通常 GitHub 合并 PR 时直接勾选删除分支即可。

---

## 5. 发布流程：`develop` 合并到 `main`

当 `develop` 中的功能已经完成测试，可以发布时：

1. 从 `develop` 创建到 `main` 的 Pull Request。

```text
develop → main
```

2. 另一位成员进行 Review。
3. 确认项目能够运行、核心功能可用。
4. 合并到 `main`。
5. 为该版本打 Tag。

示例：

```bash
git checkout main
git pull origin main

git tag v0.1.0
git push origin v0.1.0
```

版本号建议使用：

```text
v0.1.0    初始可用版本
v0.2.0    新增功能
v0.2.1    Bug 修复
v1.0.0    首个正式稳定版本
```

---

## 6. 紧急 Bug 修复流程

如果 `main` 上发现严重 Bug，需要从 `main` 创建修复分支：

```bash
git checkout main
git pull origin main
git checkout -b fix/critical-login-error
```

修复后：

```bash
git add .
git commit -m "fix: 修复登录接口异常"
git push -u origin fix/critical-login-error
```

然后创建 Pull Request：

```text
fix/critical-login-error → main
```

合并到 `main` 后，还需要把修复同步回 `develop`：

```text
main → develop
```

或者将该修复分支再合并到 `develop`。

这样可以避免：

```text
main 修了 Bug
develop 没有该修复
后续发布时 Bug 又重新出现
```

---

## 7. Commit 提交规范

提交信息统一采用：

```text
类型: 简短描述
```

推荐类型：

```text
feat      新功能
fix       Bug 修复
docs      文档修改
style     格式、样式调整
refactor  重构
test      测试相关
chore     构建、依赖、配置、杂项
perf      性能优化
```

示例：

```bash
git commit -m "feat: 新增用户登录接口"
git commit -m "feat: 增加订单列表页面"
git commit -m "fix: 修复 Token 过期后无法跳转登录页"
git commit -m "docs: 更新项目启动说明"
git commit -m "refactor: 重构用户服务层"
git commit -m "chore: 更新 Docker 配置"
```

禁止使用无意义提交信息：

```text
update
test
修改
111
bug
改一下
先这样
```

---

## 8. 冲突处理规范

当执行 `git pull`、`git merge` 或合并 Pull Request 时，可能出现冲突：

```text
CONFLICT
```

处理原则：

1. 不要直接覆盖别人的代码。
2. 先确认双方分别修改了什么。
3. 保留正确逻辑后删除冲突标记。
4. 本地运行或测试确认无误。
5. 再提交冲突处理结果。

冲突标记示例：

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

## 9. 禁止事项

以下操作默认禁止：

```text
直接 push 到 main
git push --force 到 main 或 develop
删除 main 或 develop
提交 .env、密钥、Token、数据库密码
提交 node_modules、构建产物、日志文件
未经沟通大规模重构公共核心文件
多个功能混在同一个提交中
```

特别禁止：

```bash
git push --force origin main
git push --force origin develop
```

除非双方明确确认，否则不得使用强制推送。

---

## 10. 协作约定

以下文件属于高冲突、高风险文件，修改前应先在群里沟通：

```text
package.json
package-lock.json
pnpm-lock.yaml
docker-compose.yml
Dockerfile
.env.example
数据库模型
数据库迁移文件
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

---

## 11. 推荐操作示例

开发登录功能：

```bash
git checkout develop
git pull origin develop

git checkout -b feature/login

# 开发代码

git add .
git commit -m "feat: 新增登录接口"
git push -u origin feature/login
```

然后在 GitHub 创建：

```text
feature/login → develop
```

阶段发布：

```text
develop → main
```

发布完成后：

```bash
git checkout main
git pull origin main
git tag v0.1.0
git push origin v0.1.0
```

---

## 12. 最终流程图

```text
开始开发
   ↓
同步 develop
   ↓
创建 feature/* 或 fix/* 分支
   ↓
开发并小步提交
   ↓
推送远程分支
   ↓
创建 PR
   ↓
合并到 develop
   ↓
测试与集成
   ↓
develop 创建 PR 到 main
   ↓
另一成员 Review
   ↓
合并到 main
   ↓
打 Tag / 创建 Release
```
