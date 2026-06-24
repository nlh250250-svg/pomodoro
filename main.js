const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// ── Logging ───────────────────────────────────────────────────────────
const LOG_FILE = path.join(app.getPath('userData'), 'pomodoro.log');

function log(level, message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) { /* ignore log write errors */ }
}

const L = {
  info: (msg) => log('INFO', msg),
  warn: (msg) => log('WARN', msg),
  error: (msg) => log('ERROR', msg),
  debug: (msg) => log('DEBUG', msg),
};

// ── Store ─────────────────────────────────────────────────────────────
const store = new Store({
  defaults: {
    settings: { workDuration: 25, breakDuration: 5 },
    history: {},
    // Persist timer state across restarts
    timerState: {
      mode: 'work',
      isRunning: false,
      endAt: null,
      remainingSeconds: 0,
      totalSeconds: 0,
    }
  }
});

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── Timer State (in main process) ─────────────────────────────────────
// Use wall-clock (endAt) approach — immune to setInterval drift/throttling
const timer = {
  mode: 'work',          // 'work' | 'break'
  isRunning: false,
  endAt: null,           // Date.now() + remainingSeconds * 1000
  remainingSeconds: 0,   // seconds left (computed live from endAt)
  totalSeconds: 0,       // total seconds for current session
  intervalId: null,
};

function loadTimerState() {
  try {
    const saved = store.get('timerState');
    if (saved && saved.endAt && saved.isRunning) {
      // Restore running timer based on wall-clock endAt
      const remaining = Math.max(0, Math.ceil((saved.endAt - Date.now()) / 1000));
      L.info(`Restoring timer: mode=${saved.mode}, remaining=${remaining}s, endAt=${new Date(saved.endAt).toISOString()}`);

      timer.mode = saved.mode || 'work';
      timer.totalSeconds = saved.totalSeconds || 0;

      if (remaining <= 0) {
        // Timer already expired — auto-complete and switch mode
        L.info('Timer already expired on restore — auto-completing');
        timer.mode = saved.mode;
        timer.isRunning = false;
        timer.endAt = null;
        timer.remainingSeconds = 0;
        timer.totalSeconds = timer.mode === 'work' ? getWorkDuration() : getBreakDuration();
        // Immediately complete and switch
        handleTimerComplete();
      } else {
        timer.isRunning = true;
        timer.endAt = saved.endAt;
        timer.remainingSeconds = remaining;
        // Resume the tick interval
        startTick();
      }
      return;
    }
  } catch (e) {
    L.error(`Failed to load timer state: ${e.message}`);
  }

  // Default state
  timer.mode = 'work';
  timer.isRunning = false;
  timer.endAt = null;
  timer.totalSeconds = getWorkDuration();
  timer.remainingSeconds = timer.totalSeconds;
}

function saveTimerState() {
  store.set('timerState', {
    mode: timer.mode,
    isRunning: timer.isRunning,
    endAt: timer.endAt,
    remainingSeconds: timer.isRunning
      ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000))
      : timer.remainingSeconds,
    totalSeconds: timer.totalSeconds,
  });
}

function getWorkDuration() {
  const settings = store.get('settings');
  return (settings && settings.workDuration) ? settings.workDuration : 25;
}

function getBreakDuration() {
  const settings = store.get('settings');
  return (settings && settings.breakDuration) ? settings.breakDuration : 5;
}

// ── Path helpers (dev vs packaged) ────────────────────────────────────
function getAssetPath(filename) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', filename);
  }
  return path.join(__dirname, 'assets', filename);
}

function loadAssetImage(filename) {
  try {
    const filePath = getAssetPath(filename);
    const buffer = fs.readFileSync(filePath);
    return nativeImage.createFromBuffer(buffer);
  } catch (_) {
    return nativeImage.createEmpty();
  }
}

// ── Timer Tick ─────────────────────────────────────────────────────────
function startTick() {
  // Clear any existing interval first
  stopTick();

  L.info('Interval created');

  timer.intervalId = setInterval(() => {
    if (!timer.isRunning) return;

    const now = Date.now();
    const newRemaining = Math.max(0, Math.ceil((timer.endAt - now) / 1000));

    if (timer.remainingSeconds !== newRemaining) {
      timer.remainingSeconds = newRemaining;
    }

    // Send state to renderer
    broadcastState();

    if (timer.remainingSeconds <= 0) {
      L.info('Timer complete');
      handleTimerComplete();
    }
  }, 250); // Check every 250ms for smooth UI
}

function stopTick() {
  if (timer.intervalId) {
    L.info('Interval cleared');
    clearInterval(timer.intervalId);
    timer.intervalId = null;
  }
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const remaining = timer.isRunning
      ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000))
      : timer.remainingSeconds;
    mainWindow.webContents.send('timer-state', {
      mode: timer.mode,
      isRunning: timer.isRunning,
      remainingSeconds: remaining,
      totalSeconds: timer.totalSeconds,
    });
  }
}

// ── Timer Controls ─────────────────────────────────────────────────────
function handleStart() {
  if (timer.isRunning) {
    L.warn('handleStart called but timer already running — ignoring');
    return;
  }

  // If remaining is 0, set up a fresh timer
  if (timer.remainingSeconds <= 0) {
    timer.totalSeconds = timer.mode === 'work' ? getWorkDuration() * 60 : getBreakDuration() * 60;
    timer.remainingSeconds = timer.totalSeconds;
  }

  timer.endAt = Date.now() + timer.remainingSeconds * 1000;
  timer.isRunning = true;

  L.info(`Timer start: mode=${timer.mode}, remaining=${timer.remainingSeconds}s, endAt=${new Date(timer.endAt).toISOString()}`);
  saveTimerState();
  startTick();
  broadcastState();
}

function handlePause(userInitiated = true) {
  if (!timer.isRunning) {
    L.warn('handlePause called but timer not running — ignoring');
    return;
  }

  // Compute and freeze remaining
  timer.remainingSeconds = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
  timer.endAt = null;
  timer.isRunning = false;

  L.info(`Timer pause: userInitiated=${userInitiated}, remaining=${timer.remainingSeconds}s`);
  stopTick();
  saveTimerState();
  broadcastState();
}

function handleReset() {
  L.info('Timer reset');
  stopTick();

  timer.isRunning = false;
  timer.endAt = null;
  timer.totalSeconds = timer.mode === 'work' ? getWorkDuration() * 60 : getBreakDuration() * 60;
  timer.remainingSeconds = timer.totalSeconds;

  saveTimerState();
  broadcastState();
}

function handleSkip() {
  L.info('Timer skip');
  handlePause(false);
  switchMode();
  broadcastState();
}

function handleTimerComplete() {
  stopTick();
  timer.isRunning = false;
  timer.endAt = null;

  // Play alarm (via renderer)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('play-alarm');
  }

  // Save record
  const settings = store.get('settings');
  const duration = timer.mode === 'work'
    ? (settings && settings.workDuration) || 25
    : (settings && settings.breakDuration) || 5;

  saveRecord({ type: timer.mode, duration });

  // Send notification
  sendCompletionNotification();

  // Switch mode and reset
  L.info(`Timer completed — switching from ${timer.mode} to ${timer.mode === 'work' ? 'break' : 'work'}`);
  switchMode();
  broadcastState();
}

function switchMode() {
  timer.mode = timer.mode === 'work' ? 'break' : 'work';
  timer.isRunning = false;
  timer.endAt = null;
  timer.totalSeconds = timer.mode === 'work' ? getWorkDuration() * 60 : getBreakDuration() * 60;
  timer.remainingSeconds = timer.totalSeconds;
  stopTick();
  saveTimerState();
}

function sendCompletionNotification() {
  if (Notification.isSupported()) {
    const notifIcon = loadAssetImage('icon.png');
    const title = timer.mode === 'work' ? '🍅 番茄钟' : '☕ 番茄钟';
    const body = timer.mode === 'work'
      ? '工作时间结束！休息一下吧~'
      : '休息时间结束！开始新的番茄吧~';

    const notif = new Notification({
      title,
      body,
      icon: notifIcon.isEmpty() ? undefined : notifIcon,
    });
    notif.show();
  }
}

function saveRecord(record) {
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

  // Send updated stats to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('today-stats', getTodayStats());
  }
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

// ── Create the main window ────────────────────────────────────────────
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
      nodeIntegration: false,
      backgroundThrottling: false, // Prevent timer throttling when window is hidden
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Close to tray — never quit unless explicitly exiting
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      L.info('Window hidden to tray');
    }
  });

  mainWindow.on('minimize', () => {
    L.info('Window minimized');
  });

  mainWindow.on('show', () => {
    L.info('Window shown');
    tray && tray.setContextMenu(buildTrayMenu());
    // Resync state when window appears
    broadcastState();
  });

  mainWindow.on('restore', () => {
    L.info('Window restored');
    broadcastState();
  });

  mainWindow.on('focus', () => {
    // Re-broadcast state on focus to ensure UI is in sync
    broadcastState();
  });
}

// ── System Tray ────────────────────────────────────────────────────────
function createTray() {
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
          L.info('Window hidden to tray (menu)');
        } else {
          showAndFocus();
        }
      }
    },
    {
      label: '开始计时',
      click: () => {
        L.info('Tray: start');
        handleStart();
      }
    },
    {
      label: '暂停',
      click: () => {
        L.info('Tray: pause');
        handlePause();
      }
    },
    {
      label: '重置',
      click: () => {
        L.info('Tray: reset');
        handleReset();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        L.info('User quit from tray');
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
    broadcastState();
  }
}

// ── PowerMonitor (system sleep/wake) ──────────────────────────────────
function setupPowerMonitor() {
  powerMonitor.on('suspend', () => {
    L.info('System suspend — timer remains (wall-clock)');
    // Wall-clock approach means we DON'T pause — the endAt remains valid
    // But we stop the interval to save CPU
    stopTick();
    saveTimerState();
  });

  powerMonitor.on('resume', () => {
    L.info('System resume — recalculating timer from wall-clock');

    if (timer.isRunning && timer.endAt) {
      const remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
      L.info(`After resume: remaining=${remaining}s`);

      if (remaining <= 0) {
        // Timer expired during sleep — complete it
        L.info('Timer expired during sleep — completing');
        timer.remainingSeconds = 0;
        handleTimerComplete();
      } else {
        timer.remainingSeconds = remaining;
        startTick();
      }
    }
    broadcastState();
  });

  powerMonitor.on('lock-screen', () => {
    L.info('Screen locked');
  });

  powerMonitor.on('unlock-screen', () => {
    L.info('Screen unlocked');
  });
}

// ── IPC Handlers ──────────────────────────────────────────────────────
function setupIPC() {
  // Timer controls (from renderer)
  ipcMain.handle('timer-start', () => {
    L.info('IPC: start requested');
    handleStart();
    return getTimerStateForRenderer();
  });

  ipcMain.handle('timer-pause', () => {
    L.info('IPC: pause requested');
    handlePause();
    return getTimerStateForRenderer();
  });

  ipcMain.handle('timer-toggle', () => {
    if (timer.isRunning) {
      L.info('IPC: toggle → pause');
      handlePause();
    } else {
      L.info('IPC: toggle → start');
      handleStart();
    }
    return getTimerStateForRenderer();
  });

  ipcMain.handle('timer-reset', () => {
    L.info('IPC: reset requested');
    handleReset();
    return getTimerStateForRenderer();
  });

  ipcMain.handle('timer-skip', () => {
    L.info('IPC: skip requested');
    handleSkip();
    return getTimerStateForRenderer();
  });

  ipcMain.handle('timer-get-state', () => {
    return getTimerStateForRenderer();
  });

  // Save a completed Pomodoro record
  ipcMain.handle('save-record', (_event, record) => {
    saveRecord(record);
    return getTodayStats();
  });

  // Get full history
  ipcMain.handle('get-history', () => {
    return store.get('history') || {};
  });

  // Get today's stats
  ipcMain.handle('get-today-stats', () => {
    return getTodayStats();
  });

  // Get/save settings
  ipcMain.handle('get-settings', () => {
    return store.get('settings');
  });

  ipcMain.handle('save-settings', (_event, settings) => {
    store.set('settings', settings);
    // If not running and in work mode, update remaining
    if (!timer.isRunning) {
      if (timer.mode === 'work') {
        timer.totalSeconds = settings.workDuration * 60;
        timer.remainingSeconds = timer.totalSeconds;
      } else {
        timer.totalSeconds = settings.breakDuration * 60;
        timer.remainingSeconds = timer.totalSeconds;
      }
      saveTimerState();
      broadcastState();
    }
    return settings;
  });

  // Send desktop notification
  ipcMain.handle('send-notification', (_event, { title, body }) => {
    if (Notification.isSupported()) {
      const notifIcon = loadAssetImage('icon.png');
      const notif = new Notification({
        title,
        body,
        icon: notifIcon.isEmpty() ? undefined : notifIcon,
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
  ipcMain.on('minimize-window', () => {
    L.info('Minimize requested from renderer');
    mainWindow.minimize();
  });
  ipcMain.on('close-window', () => {
    L.info('Close requested from renderer');
    mainWindow.hide();
  });
}

function getTimerStateForRenderer() {
  const remaining = timer.isRunning && timer.endAt
    ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000))
    : timer.remainingSeconds;

  return {
    mode: timer.mode,
    isRunning: timer.isRunning,
    remainingSeconds: remaining,
    totalSeconds: timer.totalSeconds,
  };
}

// ── App Lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(() => {
  L.info('App starting');

  // Load persisted timer state before creating window
  loadTimerState();

  setupIPC();
  setupPowerMonitor();
  createWindow();
  createTray();

  // Broadcast initial state once window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    broadcastState();
    // Send today's stats
    mainWindow.webContents.send('today-stats', getTodayStats());
  });

  L.info('App ready');
});

app.on('before-quit', () => {
  L.info('App before-quit');
  isQuitting = true;
  stopTick();
  saveTimerState();
});

app.on('window-all-closed', () => {
  // Don't quit on Windows — app stays in tray
});

app.on('activate', () => {
  L.info('App activate');
  showAndFocus();
});
