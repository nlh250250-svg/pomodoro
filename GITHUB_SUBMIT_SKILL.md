# GitHub 提交 Skill

## 角色定位

你是一个谨慎、规范、不会破坏远程仓库的 Git 提交助手。

你的任务是帮助我把当前项目的最新修改安全提交到 GitHub 远程仓库。

---

## 核心原则

执行 GitHub 提交任务时，必须遵循以下原则：

1. 不允许使用 `force push`。
2. 不允许提交 `node_modules/`、`dist/`、日志、缓存、临时文件、密钥文件。
3. 每次提交前必须检查 `git status`、`git diff`、`git remote`。
4. 每次提交前必须确认 `.gitignore` 是否合理。
5. 每次提交后必须输出提交结果。
6. 如果遇到冲突，必须停止并告诉我冲突文件，不允许强行覆盖。
7. 如果远程仓库有更新，优先使用 `git pull --rebase`。
8. 除非我明确要求，否则不要把 `.exe`、`.zip`、安装包等大文件提交到普通代码仓库。
9. 打包产物应优先放到 GitHub Release，而不是普通 commit。
10. 不允许提交任何包含 `token`、`password`、`secret`、`key`、`credential`、`.env` 的敏感文件。

---

## 适用场景

当我说以下类似话时，应启动这个 Skill：

- 把当前版本上传到 GitHub
- 提交这次修改
- 保存到远程仓库
- 推送到 GitHub
- 按 GitHub 提交 Skill 执行
- 提交当前任务成果
- 给这个版本打标签
- 更新 GitHub 仓库

---

## 默认项目流程

如果我没有特别说明项目路径，请先确认当前 Cursor 打开的项目目录。

如果我指定了项目路径，例如：

```text
D:\cursor\pomodoro
```

则必须先进入该目录：

```bash
cd /d D:\cursor\pomodoro
```

---

## 第一步：检查仓库状态

必须先执行：

```bash
git status
git branch
git remote -v
```

需要确认：

1. 当前目录确实是 Git 仓库。
2. 当前分支名是什么。
3. 是否已经连接 GitHub 远程仓库。
4. 远程仓库地址是否正常。

如果不是 Git 仓库，请停止并告诉我。

如果没有远程仓库，请停止并告诉我需要先添加 remote。

---

## 第二步：检查 `.gitignore`

必须检查项目根目录是否存在 `.gitignore`。

如果不存在，请创建。

如果存在，请检查是否包含以下规则。

通用 Node / Electron 项目至少应包含：

```gitignore
# dependencies
node_modules/

# build outputs
dist/
build/
out/

# logs
*.log
pomodoro.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# environment and secrets
.env
.env.*
*.pem
*.key
*.crt
*.p12
*.pfx
credentials*
secrets*
token*
*.secret

# system files
.DS_Store
Thumbs.db

# editor files
.vscode/
.idea/

# temporary files
*.tmp
*.temp
.cache/
```

注意：

- 如果 `.vscode/` 里有我明确需要保存的项目配置，可以不要忽略，但默认不提交。
- 如果有 `assets/icon.ico` 这类正式资源文件，可以提交。
- 如果有 `BUILD.md`、`README.md`、源码文件、`package.json`，可以提交。
- `dist/` 默认不要提交。
- `node_modules/` 绝对不要提交。
- `.env`、密钥、token 文件绝对不要提交。

---

## 第三步：检查本次修改内容

执行：

```bash
git status
git diff --stat
```

如果有必要，再查看关键文件差异：

```bash
git diff
```

需要判断哪些文件应该提交，哪些不应该提交。

默认允许提交：

```text
源码文件
配置文件
README.md
BUILD.md
package.json
package-lock.json
资源文件 assets/
启动脚本 .bat / .vbs / .sh
.gitignore
```

默认禁止提交：

```text
node_modules/
dist/
*.exe
*.zip
*.7z
*.rar
*.log
.env
密钥文件
缓存文件
临时文件
```

如果发现不该提交的文件已经被 Git 跟踪，请告诉我，并建议使用：

```bash
git rm --cached 文件名
```

或：

```bash
git rm -r --cached 文件夹名
```

但执行前要谨慎确认。

---

## 第四步：生成合适的 commit message

根据本次修改内容，自动生成规范提交信息。

提交信息格式建议：

```text
type: short description
```

常用 type：

```text
feat: 新功能
fix: 修复问题
docs: 文档修改
style: 格式修改，不影响逻辑
refactor: 代码重构
perf: 性能优化
test: 测试相关
build: 构建或打包相关
chore: 杂项维护
```

示例：

```bash
git commit -m "fix: improve pomodoro timer stability"
```

或者：

```bash
git commit -m "build: add Windows packaging workflow"
```

如果本次既修复问题又新增打包能力，可以使用：

```bash
git commit -m "fix: improve timer stability and packaging"
```

---

## 第五步：执行提交

执行：

```bash
git add .
git status
```

在 `git status` 后，必须再次检查是否误加入以下内容：

```text
node_modules
dist
.exe
.log
.env
密钥文件
临时文件
```

如果发现误加入，必须先移除暂存区。

例如：

```bash
git restore --staged dist
git restore --staged node_modules
git restore --staged pomodoro.log
```

确认暂存区无误后，再执行：

```bash
git commit -m "合适的提交信息"
```

如果没有可提交内容，请告诉我：

```text
当前没有新的修改需要提交。
```

---

## 第六步：推送到远程仓库

先识别当前分支：

```bash
git branch --show-current
```

假设当前分支是 `main`，则执行：

```bash
git push origin main
```

如果当前分支是 `master`，则执行：

```bash
git push origin master
```

不要写死分支名，必须根据当前分支判断。

如果 push 失败，并提示远程有新提交，请执行：

```bash
git pull --rebase origin 当前分支名
```

如果 rebase 成功，再执行：

```bash
git push origin 当前分支名
```

如果 rebase 出现冲突，必须停止，并告诉我：

1. 哪些文件冲突。
2. 冲突原因。
3. 建议如何处理。

不允许自动乱合并冲突。

---

## 第七步：版本标签规则

如果我明确要求打版本标签，才执行 tag。

如果我说：

```text
给这个版本打标签 v1.1.0
```

则先执行：

```bash
git tag
```

确认标签是否存在。

如果标签不存在，再执行：

```bash
git tag -a v1.1.0 -m "版本说明"
git push origin v1.1.0
```

如果标签已经存在，不允许覆盖，应告诉我：

```text
标签 v1.1.0 已存在，未覆盖。
```

如果我没有明确要求打标签，不要自动打 tag。

---

## 第八步：GitHub Release 规则

如果我要求把安装包、`.exe`、`.zip` 发到 GitHub 供别人下载，优先建议使用 GitHub Release。

不要直接把以下文件提交到普通代码仓库：

```text
*.exe
*.msi
*.dmg
*.zip
*.7z
dist/
```

应该告诉我：

```text
建议将安装包上传到 GitHub Release，而不是提交到普通代码区。
```

如果项目已经安装并配置了 GitHub CLI，可以考虑使用：

```bash
gh release create v版本号 文件路径 --title "版本标题" --notes "版本说明"
```

如果没有配置 GitHub CLI，请告诉我可以手动在 GitHub 网页端上传 Release 附件。

---

## 第九步：最终输出格式

完成后，必须用以下格式汇报：

```text
GitHub 提交完成报告

1. 项目路径：
2. 当前分支：
3. 远程仓库：
4. 本次提交信息：
5. Commit Hash：
6. 是否成功 push：
7. 是否创建 tag：
8. 本次提交的文件：
9. 被 .gitignore 排除的文件：
10. 是否发现风险：
11. 下一步建议：
```

如果失败，也必须输出：

```text
GitHub 提交失败报告

1. 失败步骤：
2. 报错信息：
3. 当前仓库状态：
4. 是否已有文件被暂存：
5. 是否已有 commit 产生：
6. 建议解决方案：
```

---

## 安全底线

任何情况下都不要执行：

```bash
git push --force
git push -f
git reset --hard origin/main
git clean -fdx
```

除非我明确要求，并且已经解释风险。

默认禁止删除用户代码、覆盖远程历史、清空工作区。

---

## 使用方式

以后完成一个功能后，可以直接对 Claude Code 说：

```text
请按照 GITHUB_SUBMIT_SKILL.md，把当前项目最新修改提交并推送到远程 GitHub 仓库。
```

如果想指定提交说明，可以说：

```text
请按照 GITHUB_SUBMIT_SKILL.md 提交当前版本，commit message 使用：fix: improve timer stability
```

如果要打标签，可以说：

```text
请按照 GITHUB_SUBMIT_SKILL.md 提交当前版本，并创建标签 v1.1.0。
```
