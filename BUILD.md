# 桌面番茄钟 - 构建与使用说明

一个基于 Electron 的桌面番茄钟应用，支持 Windows 系统托盘、通知、历史记录等功能。

## 一、开发模式运行

```bash
# 安装依赖（首次）
npm install

# 启动开发模式
npm start
```

## 二、双击启动（无需终端）

### 方式 1：批处理文件（会显示终端窗口）
双击项目目录下的 `start-pomodoro.bat`

### 方式 2：VBS 脚本（无终端窗口，推荐）
双击项目目录下的 `start-pomodoro.vbs`

### 方式 3：创建桌面快捷方式
1. 右键桌面 → 新建 → 快捷方式
2. 目标指向 `start-pomodoro.vbs` 的完整路径
3. 命名如"桌面番茄钟"
4. 可自行更换图标

## 三、构建发布版本

```bash
# 构建安装包 + 便携版
npm run dist
```

构建产物在 `dist/` 目录下：
- `桌面番茄钟 Setup x.x.x.exe` — NSIS 安装包（可自定义安装路径、创建快捷方式）
- `桌面番茄钟_x.x.x_portable.exe` — 便携版（无需安装，双击直接运行）

## 四、分发给他人使用

### 安装包方式
将 `dist/桌面番茄钟 Setup x.x.x.exe` 发给对方，双击安装即可。
安装时可选择安装目录，安装完成后桌面和开始菜单自动创建快捷方式。

### 便携版方式
将 `dist/桌面番茄钟_x.x.x_portable.exe` 发给对方，直接双击运行，无需安装。

## 五、项目结构

```
pomodoro/
├── main.js              # Electron 主进程（计时器逻辑）
├── preload.js           # 预加载脚本（IPC 桥接）
├── renderer/
│   ├── index.html       # 前端页面
│   ├── style.css        # 样式
│   └── renderer.js      # 前端渲染逻辑
├── assets/
│   ├── icon.svg         # 图标源文件
│   ├── icon.png         # 应用图标
│   └── icon.ico         # Windows 图标
├── package.json         # 项目配置
├── start-pomodoro.bat   # 双击启动脚本（带终端）
├── start-pomodoro.vbs   # 双击启动脚本（无终端）
└── BUILD.md             # 本文件
```

## 六、技术说明

- **计时器**：采用基于 `Date.now()` 的挂钟计时方式，不受 `setInterval` 延迟、窗口隐藏、系统休眠等影响
- **状态持久化**：使用 `electron-store` 保存设置和历史记录，Timer 状态在应用重启后可恢复
- **系统托盘**：关闭窗口时最小化到托盘，右键菜单可控制计时器
- **快捷键**：仅在窗口聚焦且不在输入框中时生效（Space=开始/暂停，R=重置，S=跳过）
- **系统休眠**：系统休眠恢复后自动根据挂钟重新计算剩余时间
