const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store({
  defaults: {
    settings: { workDuration: 25, breakDuration: 5 },
    history: {}
  }
});

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── Path helper (dev vs packaged) ───────────────────────────────
// In development: assets are under __dirname/assets/
// In packaged:    assets are in extraResources (process.resourcesPath/assets/)
function getAssetPath(filename) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', filename);
  }
  return path.join(__dirname, 'assets', filename);
}

// Load an image from assets — works in both dev and asar-packaged modes
function loadAssetImage(filename) {
  const fs = require('fs');
  try {
    const filePath = getAssetPath(filename);
    const buffer = fs.readFileSync(filePath);
    return nativeImage.createFromBuffer(buffer);
  } catch (_) {
    // Fallback: create a simple colored icon programmatically
    return nativeImage.createEmpty();
  }
}

// ── Create the main window ──────────────────────────────────────────
function createWindow() {
  const iconPath = getAssetPath('icon.png');

  mainWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 360,
    minHeight: 480,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Prevent closing to tray — minimize instead
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('show', () => {
    tray && tray.setContextMenu(buildTrayMenu());
  });
}

// ── System Tray ─────────────────────────────────────────────────────
function createTray() {
  // Load tray icon — 16x16 from asset PNG, works in both dev and packaged
  const trayIcon = loadAssetImage('icon.png');
  const sizedIcon = trayIcon.isEmpty()
    ? nativeImage.createEmpty()
    : trayIcon.resize({ width: 16, height: 16 });

  tray = new Tray(sizedIcon);

  tray.setToolTip('番茄钟 — 准备开始');
  tray.setContextMenu(buildTrayMenu());

  tray.on('double-click', () => {
    showAndFocus();
  });
}

function buildTrayMenu() {
  const isVisible = mainWindow && mainWindow.isVisible();
  return Menu.buildFromTemplate([
    {
      label: isVisible ? '最小化到托盘' : '显示窗口',
      click: () => {
        if (isVisible) {
          mainWindow.hide();
        } else {
          showAndFocus();
        }
      }
    },
    {
      label: '开始计时',
      click: () => { mainWindow.webContents.send('tray-action', 'start'); }
    },
    {
      label: '暂停',
      click: () => { mainWindow.webContents.send('tray-action', 'pause'); }
    },
    {
      label: '重置',
      click: () => { mainWindow.webContents.send('tray-action', 'reset'); }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function showAndFocus() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    tray.setContextMenu(buildTrayMenu());
  }
}

// ── IPC Handlers ────────────────────────────────────────────────────
function setupIPC() {
  // Save a completed Pomodoro record
  ipcMain.handle('save-record', (_event, record) => {
    const today = new Date().toISOString().split('T')[0];
    const history = store.get('history') || {};
    if (!history[today]) {
      history[today] = [];
    }
    history[today].push({
      ...record,
      completedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    });
    store.set('history', history);
    return getTodayStats();
  });

  // Get full history
  ipcMain.handle('get-history', () => {
    return store.get('history') || {};
  });

  // Get today's Pomodoro count
  ipcMain.handle('get-today-stats', () => {
    return getTodayStats();
  });

  // Get settings
  ipcMain.handle('get-settings', () => {
    return store.get('settings');
  });

  // Save settings
  ipcMain.handle('save-settings', (_event, settings) => {
    store.set('settings', settings);
    return settings;
  });

  // Send desktop notification — uses NativeImage to avoid asar path issues
  ipcMain.handle('send-notification', (_event, { title, body }) => {
    if (Notification.isSupported()) {
      const notifIcon = loadAssetImage('icon.png');
      const notif = new Notification({
        title,
        body,
        icon: notifIcon.isEmpty() ? undefined : notifIcon
      });
      notif.show();
      return true;
    }
    return false;
  });

  // Set tray tooltip
  ipcMain.handle('set-tray-tooltip', (_event, text) => {
    if (tray) {
      tray.setToolTip(text);
    }
  });

  // Window controls from renderer
  ipcMain.on('minimize-window', () => mainWindow.minimize());
  ipcMain.on('close-window', () => mainWindow.hide());
}

function getTodayStats() {
  const today = new Date().toISOString().split('T')[0];
  const history = store.get('history') || {};
  const todayRecords = history[today] || [];
  const workCount = todayRecords.filter(r => r.type === 'work').length;
  const totalWorkMinutes = todayRecords
    .filter(r => r.type === 'work')
    .reduce((sum, r) => sum + r.duration, 0);
  return { date: today, workCount, totalWorkMinutes, records: todayRecords };
}

// ── App Lifecycle ───────────────────────────────────────────────────
app.whenReady().then(() => {
  setupIPC();
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Don't quit on Windows — app stays in tray
});

app.on('activate', () => {
  showAndFocus();
});
