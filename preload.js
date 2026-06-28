const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timerAPI', {
  // ── Timer controls (main process handles all timer logic) ─────────
  timerStart: () => ipcRenderer.invoke('timer-start'),
  timerPause: () => ipcRenderer.invoke('timer-pause'),
  timerToggle: () => ipcRenderer.invoke('timer-toggle'),
  timerReset: () => ipcRenderer.invoke('timer-reset'),
  timerSkip: () => ipcRenderer.invoke('timer-skip'),
  timerGetState: () => ipcRenderer.invoke('timer-get-state'),

  // ── Timer state updates (main → renderer) ────────────────────────
  onTimerState: (callback) => {
    ipcRenderer.removeAllListeners('timer-state');
    ipcRenderer.on('timer-state', (_event, state) => callback(state));
  },

  // ── Alarm trigger (main → renderer) ──────────────────────────────
  onPlayAlarm: (callback) => {
    ipcRenderer.removeAllListeners('play-alarm');
    ipcRenderer.on('play-alarm', () => callback());
  },

  // ── Alarm system (main → renderer) ───────────────────────────────
  onAlarmStart: (callback) => {
    ipcRenderer.removeAllListeners('alarm-start');
    ipcRenderer.on('alarm-start', (_event, data) => callback(data));
  },
  onAlarmStop: (callback) => {
    ipcRenderer.removeAllListeners('alarm-stop');
    ipcRenderer.on('alarm-stop', (_event, data) => callback(data));
  },
  onAlarmSnoozed: (callback) => {
    ipcRenderer.removeAllListeners('alarm-snoozed');
    ipcRenderer.on('alarm-snoozed', (_event, data) => callback(data));
  },
  onAlarmSettingsUpdated: (callback) => {
    ipcRenderer.removeAllListeners('alarm-settings-updated');
    ipcRenderer.on('alarm-settings-updated', (_event, settings) => callback(settings));
  },

  // ── Alarm controls (renderer → main) ─────────────────────────────
  alarmDismiss: () => ipcRenderer.invoke('alarm-dismiss'),
  alarmSnooze: () => ipcRenderer.invoke('alarm-snooze'),
  alarmPreviewStart: (soundName) => ipcRenderer.invoke('alarm-preview-start', soundName),
  alarmPreviewStop: () => ipcRenderer.invoke('alarm-preview-stop'),
  updateAlarmSettings: (settings) => ipcRenderer.invoke('update-alarm-settings', settings),
  getAlarmSettings: () => ipcRenderer.invoke('get-alarm-settings'),
  getAlarmState: () => ipcRenderer.invoke('get-alarm-state'),

  // ── Today stats update (main → renderer) ─────────────────────────
  onTodayStats: (callback) => {
    ipcRenderer.removeAllListeners('today-stats');
    ipcRenderer.on('today-stats', (_event, stats) => callback(stats));
  },

  // ── History ──────────────────────────────────────────────────────
  getHistory: () => ipcRenderer.invoke('get-history'),

  // ── Today stats (direct query) ───────────────────────────────────
  getTodayStats: () => ipcRenderer.invoke('get-today-stats'),

  // ── Settings ─────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // ── Notifications ─────────────────────────────────────────────────
  sendNotification: (title, body) => ipcRenderer.invoke('send-notification', { title, body }),

  // ── Tray ──────────────────────────────────────────────────────────
  setTrayTooltip: (text) => ipcRenderer.invoke('set-tray-tooltip', text),

  // ── Asset path resolution (works in dev and packaged) ────────────
  getAssetUrl: (relativePath) => ipcRenderer.invoke('get-asset-url', relativePath),

  // ── Window controls ───────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // ── Task management ──────────────────────────────────────────────
  taskCreate: (taskData) => ipcRenderer.invoke('task-create', taskData),
  taskUpdate: (id, updates) => ipcRenderer.invoke('task-update', { id, updates }),
  taskDelete: (id) => ipcRenderer.invoke('task-delete', id),
  taskList: () => ipcRenderer.invoke('task-list'),
  taskSetActive: (id) => ipcRenderer.invoke('task-set-active', id),
  taskGetActive: () => ipcRenderer.invoke('task-get-active'),

  // ── Statistics ───────────────────────────────────────────────────
  getWeeklyStats: () => ipcRenderer.invoke('get-weekly-stats'),
  getStreak: () => ipcRenderer.invoke('get-streak'),
});
