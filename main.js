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
    },
    // Alarm system defaults
    alarmSettings: {
      sound: 'classic',
      volume: 0.7,
      continuous: true,
      snoozeMinutes: 9,
    },
    alarmState: {
      active: false,
      reason: null,
      snoozeUntil: null,
    }
  }
});

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── Timer State (in main process) ─────────────────────────────────────
const timer = {
  mode: 'work',          // 'work' | 'break'
  isRunning: false,
  endAt: null,
  remainingSeconds: 0,
  totalSeconds: 0,
  intervalId: null,
};

// ── Alarm State (in main process) ─────────────────────────────────────
const alarmState = {
  active: false,
  reason: null,         // 'workComplete' | 'breakComplete' | null
  message: '',
  startedAt: null,
  snoozeUntil: null,
  snoozeTimer: null,
};

// ── Snooze minutes validation ────────────────────────────────────────
function clampSnoozeMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 9;
  return Math.min(20, Math.max(1, Math.round(n)));
}

function getAlarmSettings() {
  const defaults = { sound: 'classic', volume: 0.7, continuous: true, snoozeMinutes: 9 };
  const saved = store.get('alarmSettings');
  const merged = { ...defaults, ...(saved || {}) };
  // Ensure snoozeMinutes is always within valid range
  merged.snoozeMinutes = clampSnoozeMinutes(merged.snoozeMinutes);
  return merged;
}

function saveAlarmSettingsToStore(settings) {
  // Clamp snoozeMinutes to valid range before saving
  if (settings && typeof settings.snoozeMinutes !== 'undefined') {
    settings.snoozeMinutes = clampSnoozeMinutes(settings.snoozeMinutes);
  }
  store.set('alarmSettings', settings);
}

function saveAlarmStateToStore() {
  store.set('alarmState', {
    active: alarmState.active,
    reason: alarmState.reason,
    snoozeUntil: alarmState.snoozeUntil,
  });
}

function getAlarmMessage() {
  return alarmState.reason === 'workComplete'
    ? { title: '工作时间结束', body: '该进入休息了', nextMode: 'break' }
    : { title: '休息时间结束', body: '该开始工作了', nextMode: 'work' };
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

// ── Load persisted timer state ────────────────────────────────────────
function loadTimerState() {
  try {
    const saved = store.get('timerState');
    if (saved && saved.endAt && saved.isRunning) {
      const remaining = Math.max(0, Math.ceil((saved.endAt - Date.now()) / 1000));
      L.info(`Restoring timer: mode=${saved.mode}, remaining=${remaining}s, endAt=${new Date(saved.endAt).toISOString()}`);

      timer.mode = saved.mode || 'work';
      timer.totalSeconds = saved.totalSeconds || 0;

      if (remaining <= 0) {
        L.info('Timer already expired on restore — auto-completing');
        timer.mode = saved.mode;
        timer.isRunning = false;
        timer.endAt = null;
        timer.remainingSeconds = 0;
        timer.totalSeconds = timer.mode === 'work' ? getWorkDuration() : getBreakDuration();
        handleTimerComplete();
      } else {
        timer.isRunning = true;
        timer.endAt = saved.endAt;
        timer.remainingSeconds = remaining;
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

// ── Load persisted alarm state ────────────────────────────────────────
function loadAlarmState() {
  try {
    const saved = store.get('alarmState');
    if (!saved) return;

    if (saved.snoozeUntil && saved.snoozeUntil > Date.now()) {
      // Still in snooze period — set a timer to resume
      const remainingMs = saved.snoozeUntil - Date.now();
      alarmState.reason = saved.reason;
      alarmState.snoozeUntil = saved.snoozeUntil;
      startSnoozeTimer(remainingMs);
      startSnoozeTick();
      L.info(`Restored snooze timer: ${Math.round(remainingMs / 1000)}s remaining, reason=${saved.reason}`);
      return;
    }

    if (saved.active || (saved.snoozeUntil && saved.snoozeUntil <= Date.now())) {
      // Alarm was active, or snooze period expired — trigger now
      alarmState.active = true;
      alarmState.reason = saved.reason || 'workComplete';
      alarmState.startedAt = Date.now();
      const msg = getAlarmMessage();
      alarmState.message = msg.body;
      saveAlarmStateToStore();
      L.info(`Restored active alarm: reason=${alarmState.reason}`);
    }
  } catch (e) {
    L.error(`Failed to load alarm state: ${e.message}`);
  }
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

// ── Timer Tick ─────────────────────────────────────────────────────────
function startTick() {
  stopTick();
  L.info('Interval created');

  timer.intervalId = setInterval(() => {
    if (!timer.isRunning) return;

    const now = Date.now();
    const newRemaining = Math.max(0, Math.ceil((timer.endAt - now) / 1000));

    if (timer.remainingSeconds !== newRemaining) {
      timer.remainingSeconds = newRemaining;
    }

    broadcastState();

    if (timer.remainingSeconds <= 0) {
      L.info('Timer complete');
      handleTimerComplete();
    }
  }, 250);
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

    const snoozeRemaining = alarmState.snoozeUntil
      ? Math.max(0, Math.ceil((alarmState.snoozeUntil - Date.now()) / 1000))
      : 0;
    const isSnoozing = !!(alarmState.snoozeTimer && alarmState.snoozeUntil);

    mainWindow.webContents.send('timer-state', {
      mode: timer.mode,
      isRunning: timer.isRunning,
      remainingSeconds: remaining,
      totalSeconds: timer.totalSeconds,
      // Alarm/snooze state for renderer display
      alarmActive: alarmState.active,
      alarmReason: alarmState.reason,
      snoozing: isSnoozing,
      snoozeUntil: alarmState.snoozeUntil,
      snoozeRemainingSeconds: snoozeRemaining,
    });
  }
}

function broadcastAlarmState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (alarmState.active) {
      const msg = getAlarmMessage();
      const settings = getAlarmSettings();
      mainWindow.webContents.send('alarm-start', {
        reason: alarmState.reason,
        title: msg.title,
        body: msg.body,
        sound: settings.sound,
        volume: settings.volume,
        continuous: settings.continuous,
        snoozeMinutes: settings.snoozeMinutes,
      });
    } else {
      mainWindow.webContents.send('alarm-stop', {
        reason: 'clear',
      });
    }
  }
}

// ── Timer Controls ─────────────────────────────────────────────────────
function handleStart() {
  if (timer.isRunning) {
    L.warn('handleStart called but timer already running — ignoring');
    return;
  }

  // Ignore start if alarm is active
  if (alarmState.active) {
    L.warn('handleStart called but alarm is active — ignoring');
    return;
  }

  // Clear snooze if user explicitly starts a new timer
  if (alarmState.snoozeTimer) {
    L.info('handleStart: clearing snooze timer');
    clearAlarm('reset');
  }

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

  // Clear any active alarm
  if (alarmState.active || alarmState.snoozeTimer) {
    clearAlarm('reset');
  }

  timer.isRunning = false;
  timer.endAt = null;
  timer.totalSeconds = timer.mode === 'work' ? getWorkDuration() * 60 : getBreakDuration() * 60;
  timer.remainingSeconds = timer.totalSeconds;

  saveTimerState();
  broadcastState();
}

function handleSkip() {
  L.info('Timer skip');

  // Clear any active alarm
  if (alarmState.active || alarmState.snoozeTimer) {
    clearAlarm('skip');
  }

  handlePause(false);
  switchMode();
  broadcastState();
}

function handleTimerComplete() {
  stopTick();
  timer.isRunning = false;
  timer.endAt = null;

  const settings = getAlarmSettings();

  if (settings.continuous) {
    // ── Continuous alarm mode: enter alarm state ──────────────────
    L.info('Timer complete — entering alarm state');

    alarmState.active = true;
    alarmState.reason = timer.mode === 'work' ? 'workComplete' : 'breakComplete';
    alarmState.startedAt = Date.now();
    const msg = getAlarmMessage();
    alarmState.message = msg.body;
    alarmState.snoozeUntil = null;
    alarmState.snoozeTimer = null;

    saveAlarmStateToStore();

    // Save record
    saveCompletionRecord();

    // Send notification
    sendCompletionNotification();

    // Tell renderer to start alarm and show popup
    broadcastAlarmState();

    // Show and focus window
    showAndFocus();
    // Brief top-most to catch user attention
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
        }
      }, 5000);
    }

    // Update tray menu to show alarm actions
    updateTrayMenu();

    // Do NOT switch mode — wait for user to dismiss
  } else {
    // ── One-shot alarm: old behavior ──────────────────────────────
    L.info('Timer complete — one-shot alarm');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('play-alarm');
    }
    saveCompletionRecord();
    sendCompletionNotification();
    switchMode();
    broadcastState();
  }
}

function saveCompletionRecord() {
  const settings = store.get('settings');
  const duration = timer.mode === 'work'
    ? (settings && settings.workDuration) || 25
    : (settings && settings.breakDuration) || 5;

  saveRecord({ type: timer.mode, duration });
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

// ── Alarm Controls ────────────────────────────────────────────────────
function clearAlarm(trigger) {
  L.info(`Alarm cleared by: ${trigger}`);

  // Clear snooze countdown tick
  stopSnoozeTick();

  if (alarmState.snoozeTimer) {
    clearTimeout(alarmState.snoozeTimer);
    alarmState.snoozeTimer = null;
    L.info('Alarm snooze timer cleared');
  }

  const wasActive = alarmState.active;
  alarmState.active = false;
  alarmState.reason = null;
  alarmState.message = '';
  alarmState.startedAt = null;
  alarmState.snoozeUntil = null;

  saveAlarmStateToStore();

  if (wasActive) {
    // Tell renderer to stop alarm
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('alarm-stop', { reason: trigger });
    }
  }

  updateTrayMenu();
}

function handleAlarmDismiss() {
  // Guard: ignore if no alarm is active and no snooze is running
  if (!alarmState.active && !alarmState.snoozeTimer) {
    L.warn('dismiss ignored because alarm inactive');
    return;
  }

  L.info('alarm dismissed');

  // Remember the completed mode before clearing alarm
  // alarmState.reason tells us: 'workComplete' means work just ended, 'breakComplete' means break just ended
  const completedMode = alarmState.reason === 'workComplete' ? 'work' : 'break';

  clearAlarm('dismiss');

  // Switch to the next mode
  timer.mode = completedMode === 'work' ? 'break' : 'work';
  timer.isRunning = false;
  timer.endAt = null;
  timer.totalSeconds = timer.mode === 'work' ? getWorkDuration() * 60 : getBreakDuration() * 60;
  timer.remainingSeconds = timer.totalSeconds;
  stopTick();

  if (completedMode === 'work') {
    // ── Work completed → auto-start break ──────────────────────────
    L.info('work dismissed, break auto started');
    timer.endAt = Date.now() + timer.remainingSeconds * 1000;
    timer.isRunning = true;
    saveTimerState();
    startTick();
  } else {
    // ── Break completed → wait for manual start ────────────────────
    L.info('break dismissed, work waiting for manual start');
    timer.isRunning = false;
    timer.endAt = null;
    saveTimerState();
  }

  broadcastState();
}

function handleAlarmSnooze() {
  if (!alarmState.active) {
    L.warn('snooze ignored because alarm inactive');
    return;
  }

  // Prevent multiple snooze timers
  if (alarmState.snoozeTimer) {
    L.warn('duplicate snooze timer prevented');
    return;
  }

  const settings = getAlarmSettings();
  const snoozeMs = (settings.snoozeMinutes || 9) * 60 * 1000;
  const snoozeUntil = Date.now() + snoozeMs;

  L.info(`alarm snoozed: snoozeUntil=${new Date(snoozeUntil).toISOString()}, snoozeMinutes=${settings.snoozeMinutes}`);

  // Stop the active alarm but keep the reason
  alarmState.active = false;
  alarmState.snoozeUntil = snoozeUntil;
  alarmState.startedAt = null;
  saveAlarmStateToStore();

  // Tell renderer to stop alarm and show snooze state
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('alarm-stop', { reason: 'snooze' });
    mainWindow.webContents.send('alarm-snoozed', {
      snoozeUntil,
      snoozeMinutes: settings.snoozeMinutes,
    });
  }

  updateTrayMenu();

  // Set snooze timer (fires alarm when snooze ends)
  startSnoozeTimer(snoozeMs);

  // Start snooze countdown tick (periodic UI updates)
  startSnoozeTick();
}

function startSnoozeTimer(delayMs) {
  // Clear any existing timer first
  if (alarmState.snoozeTimer) {
    clearTimeout(alarmState.snoozeTimer);
    alarmState.snoozeTimer = null;
  }

  alarmState.snoozeTimer = setTimeout(() => {
    L.info('snooze completed');
    L.info('alarm resumed from snooze');
    stopSnoozeTick();
    alarmState.snoozeTimer = null;

    // Reactivate alarm — keep the same reason (workComplete or breakComplete)
    alarmState.active = true;
    alarmState.snoozeUntil = null;
    alarmState.startedAt = Date.now();
    const msg = getAlarmMessage();
    alarmState.message = msg.body;
    saveAlarmStateToStore();

    // Trigger alarm in renderer
    broadcastAlarmState();

    // Show window
    showAndFocus();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
        }
      }, 5000);
    }

    updateTrayMenu();
  }, delayMs);

  L.info(`Snooze timer set for ${Math.round(delayMs / 1000)}s`);
}

// ── Snooze countdown tick (periodic broadcast to renderer) ──────────────
let snoozeTickInterval = null;

function startSnoozeTick() {
  stopSnoozeTick();
  L.info('snooze countdown tick started');
  snoozeTickInterval = setInterval(() => {
    if (!alarmState.snoozeUntil) {
      stopSnoozeTick();
      return;
    }

    const remaining = Math.max(0, Math.ceil((alarmState.snoozeUntil - Date.now()) / 1000));
    if (remaining <= 0) {
      // Snooze has expired — the setTimeout callback will handle the rest
      stopSnoozeTick();
      return;
    }

    L.debug(`snooze countdown tick: ${remaining}s remaining`);
    broadcastState();
  }, 500);
}

function stopSnoozeTick() {
  if (snoozeTickInterval) {
    clearInterval(snoozeTickInterval);
    snoozeTickInterval = null;
    L.info('snooze countdown tick stopped');
  }
}

// ── Record ─────────────────────────────────────────────────────────────
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
    height: 620,
    minWidth: 360,
    minHeight: 540,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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
    updateTrayMenu();
    broadcastState();
    broadcastAlarmState();
  });

  mainWindow.on('restore', () => {
    L.info('Window restored');
    broadcastState();
    broadcastAlarmState();
  });

  mainWindow.on('focus', () => {
    broadcastState();
    broadcastAlarmState();
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
  const hasAlarm = alarmState.active;
  const hasSnooze = !!alarmState.snoozeTimer;

  const menuItems = [
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
    { type: 'separator' },
  ];

  // Alarm action items (only when alarm/snooze is active)
  if (hasAlarm) {
    menuItems.push({
      label: '关闭提醒',
      click: () => {
        L.info('Tray: dismiss alarm');
        handleAlarmDismiss();
      }
    });
    menuItems.push({
      label: `延时 ${getAlarmSettings().snoozeMinutes} 分钟`,
      click: () => {
        L.info('Tray: snooze alarm');
        handleAlarmSnooze();
      }
    });
  } else if (hasSnooze) {
    menuItems.push({
      label: '关闭提醒（取消延时）',
      click: () => {
        L.info('Tray: dismiss (cancel snooze)');
        handleAlarmDismiss();
      }
    });
    menuItems.push({
      label: '延时中...',
      enabled: false,
    });
  } else {
    menuItems.push({
      label: '关闭提醒',
      enabled: false,
    });
    menuItems.push({
      label: `延时 ${getAlarmSettings().snoozeMinutes} 分钟`,
      enabled: false,
    });
  }

  menuItems.push({ type: 'separator' });

  menuItems.push(
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
        if (alarmState.active || alarmState.snoozeTimer) {
          clearAlarm('quit');
        }
        app.quit();
      }
    }
  );

  return Menu.buildFromTemplate(menuItems);
}

function updateTrayMenu() {
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
}

function showAndFocus() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    updateTrayMenu();
    broadcastState();
    broadcastAlarmState();
  }
}

// ── PowerMonitor (system sleep/wake) ──────────────────────────────────
function setupPowerMonitor() {
  powerMonitor.on('suspend', () => {
    L.info('System suspend — timer remains (wall-clock)');
    stopTick();
    saveTimerState();
  });

  powerMonitor.on('resume', () => {
    L.info('System resume — recalculating timer from wall-clock');

    // Check snooze timer
    if (alarmState.snoozeUntil) {
      const now = Date.now();
      if (alarmState.snoozeUntil <= now) {
        // Snooze expired during sleep — trigger alarm
        L.info('Snooze expired during sleep — triggering alarm');
        stopSnoozeTick();
        if (alarmState.snoozeTimer) {
          clearTimeout(alarmState.snoozeTimer);
          alarmState.snoozeTimer = null;
        }
        alarmState.active = true;
        alarmState.snoozeUntil = null;
        alarmState.startedAt = now;
        const msg = getAlarmMessage();
        alarmState.message = msg.body;
        saveAlarmStateToStore();
        broadcastAlarmState();
        showAndFocus();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(true);
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setAlwaysOnTop(false);
            }
          }, 5000);
        }
        updateTrayMenu();
        return;
      } else {
        // Still in snooze — restart timer
        const remaining = alarmState.snoozeUntil - now;
        L.info(`Snooze still active after resume: ${Math.round(remaining / 1000)}s remaining`);
        startSnoozeTimer(remaining);
        startSnoozeTick();
      }
    }

    // Check timer
    if (timer.isRunning && timer.endAt) {
      const remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
      L.info(`After resume: remaining=${remaining}s`);

      if (remaining <= 0) {
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

  // ── Alarm IPC handlers ──────────────────────────────────────────────
  ipcMain.handle('alarm-dismiss', () => {
    L.info('IPC: alarm dismiss');
    handleAlarmDismiss();
    return getTimerStateForRenderer();
  });

  ipcMain.handle('alarm-snooze', () => {
    L.info('IPC: alarm snooze');
    handleAlarmSnooze();
    return getTimerStateForRenderer();
  });

  ipcMain.handle('alarm-preview-start', (_event, soundName) => {
    L.info(`IPC: alarm preview start — ${soundName}`);
    // No main-process side effect; renderer handles audio preview
    return true;
  });

  ipcMain.handle('alarm-preview-stop', () => {
    L.info('IPC: alarm preview stop');
    return true;
  });

  ipcMain.handle('update-alarm-settings', (_event, settings) => {
    L.info(`IPC: alarm settings updated — ${JSON.stringify(settings)}`);
    saveAlarmSettingsToStore(settings);
    // Notify renderer if window is open
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('alarm-settings-updated', settings);
    }
    return settings;
  });

  ipcMain.handle('get-alarm-settings', () => {
    return getAlarmSettings();
  });

  ipcMain.handle('get-alarm-state', () => {
    const settings = getAlarmSettings();
    return {
      active: alarmState.active,
      reason: alarmState.reason,
      snoozeUntil: alarmState.snoozeUntil,
      snoozeMinutes: settings.snoozeMinutes,
    };
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
    if (!timer.isRunning && !alarmState.active) {
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

  const snoozeRemaining = alarmState.snoozeUntil
    ? Math.max(0, Math.ceil((alarmState.snoozeUntil - Date.now()) / 1000))
    : 0;
  const isSnoozing = !!(alarmState.snoozeTimer && alarmState.snoozeUntil);

  return {
    mode: timer.mode,
    isRunning: timer.isRunning,
    remainingSeconds: remaining,
    totalSeconds: timer.totalSeconds,
    // Alarm/snooze state for renderer display
    alarmActive: alarmState.active,
    alarmReason: alarmState.reason,
    snoozing: isSnoozing,
    snoozeUntil: alarmState.snoozeUntil,
    snoozeRemainingSeconds: snoozeRemaining,
  };
}

// ── App Lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(() => {
  L.info('App starting');

  // Load persisted state before creating window
  loadTimerState();
  loadAlarmState();

  setupIPC();
  setupPowerMonitor();
  createWindow();
  createTray();

  // Broadcast initial state once window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    broadcastState();
    mainWindow.webContents.send('today-stats', getTodayStats());
    // Broadcast alarm state if there's a restored alarm
    broadcastAlarmState();
  });

  L.info('App ready');
});

app.on('before-quit', () => {
  L.info('App before-quit');
  isQuitting = true;
  stopTick();
  if (alarmState.active || alarmState.snoozeTimer) {
    clearAlarm('quit');
  }
  saveTimerState();
});

app.on('window-all-closed', () => {
  // Don't quit on Windows — app stays in tray
});

app.on('activate', () => {
  L.info('App activate');
  showAndFocus();
});
