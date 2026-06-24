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
    // Remove old listener to avoid duplicates
    ipcRenderer.removeAllListeners('timer-state');
    ipcRenderer.on('timer-state', (_event, state) => callback(state));
  },

  // ── Alarm trigger (main → renderer) ──────────────────────────────
  onPlayAlarm: (callback) => {
    ipcRenderer.removeAllListeners('play-alarm');
    ipcRenderer.on('play-alarm', () => callback());
  },

  // ── Today stats update (main → renderer) ─────────────────────────
  onTodayStats: (callback) => {
    ipcRenderer.removeAllListeners('today-stats');
    ipcRenderer.on('today-stats', (_event, stats) => callback(stats));
  },

  // ── History ──────────────────────────────────────────────────────
  getHistory: () => ipcRenderer.invoke('get-history'),

  // ── Today stats (direct query) ────────────────────────────────────
  getTodayStats: () => ipcRenderer.invoke('get-today-stats'),

  // ── Settings ──────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // ── Notifications ─────────────────────────────────────────────────
  sendNotification: (title, body) => ipcRenderer.invoke('send-notification', { title, body }),

  // ── Tray ──────────────────────────────────────────────────────────
  setTrayTooltip: (text) => ipcRenderer.invoke('set-tray-tooltip', text),

  // ── Window controls ───────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
});
