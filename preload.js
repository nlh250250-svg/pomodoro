const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timerAPI', {
  // Save a completed Pomodoro record
  saveRecord: (record) => ipcRenderer.invoke('save-record', record),

  // Get full history
  getHistory: () => ipcRenderer.invoke('get-history'),

  // Get today's stats (count, minutes, records)
  getTodayStats: () => ipcRenderer.invoke('get-today-stats'),

  // Get settings
  getSettings: () => ipcRenderer.invoke('get-settings'),

  // Save settings
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Send desktop notification
  sendNotification: (title, body) => ipcRenderer.invoke('send-notification', { title, body }),

  // Set tray tooltip
  setTrayTooltip: (text) => ipcRenderer.invoke('set-tray-tooltip', text),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // Listen for tray menu actions
  onTrayAction: (callback) => {
    ipcRenderer.on('tray-action', (_event, action) => callback(action));
  }
});
