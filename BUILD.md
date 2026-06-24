# 桌面番茄钟 — 开发与打包说明

## 一、开发运行

```bash
# 首次使用先安装依赖
npm install

# 启动开发模式
npm start
```

## 二、本机双击启动（无需终端）

### 方式1：直接双击 VBS 脚本（推荐）
双击项目根目录的 **`start-pomodoro.vbs`**，会静默启动番茄钟（不显示命令行窗口）。

### 方式2：创建桌面快捷方式
1. 右键点击 `start-pomodoro.vbs` → 发送到 → 桌面快捷方式
2. 在桌面上找到快捷方式，右键 → 属性
3. 将名称改为 **"桌面番茄钟"**
4. （可选）点击"更改图标" → 浏览 → 选择 `assets/icon.ico`

### 方式3：BAT 脚本
双击 `start-pomodoro.bat`（会显示命令行窗口，方便查看日志）。

## 三、打包

```bash
# 生成安装包（NSIS 安装版 + 便携版）
npm run dist
```

首次打包可能需要下载 Electron 二进制文件，请确保网络畅通。
如果下载慢，可设置镜像：
```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dist
```

## 四、打包完成后文件位置

打包输出在 `dist/` 目录下：

```
dist/
├── 桌面番茄钟 Setup 1.0.0.exe        ← NSIS 安装包（发给别人用这个）
├── 桌面番茄钟_1.0.0_portable.exe      ← 便携版（免安装直接运行）
├── win-unpacked/                      ← 未打包的开发目录
└── builder-effective-config.yaml      ← 打包配置快照
```

## 五、发给别人使用

### 推荐：发送安装包
把 **`桌面番茄钟 Setup 1.0.0.exe`** 发给对方，对方双击安装即可：
- 支持选择安装目录
- 自动创建桌面快捷方式和开始菜单快捷方式
- 安装后像普通 Windows 软件一样使用

### 备选：发送便携版
把 **`桌面番茄钟_1.0.0_portable.exe`** 发给对方，对方双击即可运行，无需安装。

## 六、项目文件说明

| 文件 | 说明 |
|------|------|
| `main.js` | Electron 主进程 |
| `preload.js` | 预加载脚本（安全 IPC） |
| `renderer/` | 前端界面（HTML/CSS/JS） |
| `assets/icon.ico` | Windows 应用图标 |
| `assets/icon.png` | 托盘/通知图标 |
| `start-pomodoro.bat` | 命令行启动脚本 |
| `start-pomodoro.vbs` | 静默启动脚本（推荐双击） |
| `dist/` | 打包输出目录 |

## 七、功能清单

- 🍅 25 分钟工作 / 5 分钟休息自动切换
- ⏯️ 开始 / 暂停 / 重置 / 跳过
- ⚙️ 自定义工作时长和休息时长
- 🔔 Windows 桌面通知
- 🔊 计时结束提示音
- 📊 今日番茄数统计
- 📋 7 天历史记录
- 🖥️ 系统托盘最小化，右键菜单操作
- 🎨 无边框暗色主题窗口
- 💾 设置和历史自动保存（electron-store）
