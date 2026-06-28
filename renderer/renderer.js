// ── DOM Elements ──────────────────────────────────────────────────────
const el = {
  modeBadge: document.getElementById('modeBadge'),
  timerMinutes: document.getElementById('timerMinutes'),
  timerSeconds: document.getElementById('timerSeconds'),
  timerDisplay: document.querySelector('.timer-display'),
  ringProgress: document.getElementById('ringProgress'),
  btnStart: document.getElementById('btnStart'),
  iconPlay: document.getElementById('iconPlay'),
  iconPause: document.getElementById('iconPause'),
  btnReset: document.getElementById('btnReset'),
  btnSkip: document.getElementById('btnSkip'),
  todayCount: document.getElementById('todayCount'),
  sessionInfo: document.getElementById('sessionInfo'),
  workDuration: document.getElementById('workDuration'),
  breakDuration: document.getElementById('breakDuration'),
  workDurationLabel: document.getElementById('workDurationLabel'),
  breakDurationLabel: document.getElementById('breakDurationLabel'),
  settingsToggle: document.getElementById('settingsToggle'),
  settingsPanel: document.getElementById('settingsPanel'),
  historyList: document.getElementById('historyList'),
  btnMinimize: document.getElementById('btnMinimize'),
  btnClose: document.getElementById('btnClose'),
  titleBar: document.getElementById('titleBar'),

  // ── Background video ──────────────────────────────────────────
  backgroundVideo: document.getElementById('backgroundVideo'),

  // ── Alarm UI elements ───────────────────────────────────────────
  alarmOverlay: document.getElementById('alarmOverlay'),
  alarmCardVideo: document.getElementById('alarmCardVideo'),
  alarmCardSubtitle: document.getElementById('alarmCardSubtitle'),
  btnAlarmDismiss: document.getElementById('btnAlarmDismiss'),
  btnAlarmSnooze: document.getElementById('btnAlarmSnooze'),

  // ── Alarm settings elements ─────────────────────────────────────
  alarmSound: document.getElementById('alarmSound'),
  btnPreview: document.getElementById('btnPreview'),
  alarmVolume: document.getElementById('alarmVolume'),
  volumeLabel: document.getElementById('volumeLabel'),
  alarmContinuous: document.getElementById('alarmContinuous'),
  snoozeMinutes: document.getElementById('snoozeMinutes'),
  snoozeLabel: document.getElementById('snoozeLabel'),
  snoozeMinutesValue: document.getElementById('snoozeMinutesValue'),

  // ── Task elements ─────────────────────────────────────────────
  taskInput: document.getElementById('taskInput'),
  taskEstimatedPomos: document.getElementById('taskEstimatedPomos'),
  btnTaskAdd: document.getElementById('btnTaskAdd'),
  taskList: document.getElementById('taskList'),
  taskActiveBadge: document.getElementById('taskActiveBadge'),
  taskActiveName: document.getElementById('taskActiveName'),
  btnTaskClearActive: document.getElementById('btnTaskClearActive'),

  // ── Stats & History tabs ──────────────────────────────────────
  bottomTabs: document.querySelectorAll('.bottom-tab'),
  statsPanel: document.getElementById('statsPanel'),
  historyPanel: document.getElementById('historyPanel'),
};

// ── Constants ─────────────────────────────────────────────────────────
const RING_CIRCUMFERENCE = 2 * Math.PI * 90;
el.ringProgress.style.strokeDasharray = RING_CIRCUMFERENCE;
el.ringProgress.style.strokeDashoffset = '0';

// ── Local UI state ─────────────────────────────────────────────────────
const ui = {
  mode: 'work',
  isRunning: false,
  remainingSeconds: 0,
  totalSeconds: 0,
  todayWorkCount: 0,
  settings: { workDuration: 25, breakDuration: 5 },
  // Alarm settings (mirrored from store)
  alarmSettings: {
    sound: 'classic',
    volume: 0.7,
    continuous: true,
    snoozeMinutes: 9,
  },
  // Whether an alarm is currently showing
  alarmActive: false,
  // Whether we're in snooze period
  isSnoozing: false,
  snoozeUntil: null,
  snoozeRemainingSeconds: 0,
  // Preview state
  isPreviewing: false,
  // Alarm video URLs (resolved via IPC)
  alarmVideoUrls: {},
  // Tasks
  tasks: [],
  activeTaskId: null,
  activeTaskTitle: null,
};

// Local snooze countdown tick (for smooth UI updates independent of main process)
let localSnoozeTick = null;

// ── Audio (legacy one-shot beep for non-continuous mode) ──────────────
function playBeep(frequency = 800, duration = 200, type = 'sine') {
  try {
    SoundEngine.setVolume(ui.alarmSettings.volume);
    SoundEngine.playOnce(ui.alarmSettings.sound);
  } catch (_) { /* audio not available */ }
}

function playAlarm() {
  playBeep();
}

// ── Local snooze countdown tick (for smooth UI independent of main ticks) ─
function startLocalSnoozeTick() {
  stopLocalSnoozeTick();
  localSnoozeTick = setInterval(() => {
    if (!ui.isSnoozing || !ui.snoozeUntil) {
      stopLocalSnoozeTick();
      return;
    }
    const remaining = Math.max(0, Math.ceil((ui.snoozeUntil - Date.now()) / 1000));
    if (remaining <= 0) {
      // Snooze has expired — main process will handle reactivation
      stopLocalSnoozeTick();
      return;
    }
    ui.snoozeRemainingSeconds = remaining;
    updateDisplay();
  }, 500);
}

function stopLocalSnoozeTick() {
  if (localSnoozeTick) {
    clearInterval(localSnoozeTick);
    localSnoozeTick = null;
  }
}

// ── Snooze minutes validation ─────────────────────────────────────────
function clampSnoozeMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 9;
  return Math.min(20, Math.max(1, Math.round(n)));
}

// ── UI Update ─────────────────────────────────────────────────────────
function updateDisplay() {
  let remaining, total;

  if (ui.isSnoozing) {
    // During snooze, show snooze countdown based on wall-clock snoozeUntil
    if (ui.snoozeUntil) {
      remaining = Math.max(0, Math.ceil((ui.snoozeUntil - Date.now()) / 1000));
    } else {
      remaining = ui.snoozeRemainingSeconds || 0;
    }
    const snoozeMin = ui.alarmSettings.snoozeMinutes || 9;
    total = snoozeMin * 60;
  } else {
    remaining = ui.remainingSeconds;
    total = ui.totalSeconds || 1;
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  el.timerMinutes.textContent = String(mins).padStart(2, '0');
  el.timerSeconds.textContent = String(secs).padStart(2, '0');

  const progress = total > 0 ? remaining / total : 0;
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  el.ringProgress.style.strokeDashoffset = offset;

  // Show/hide snooze label with dynamic countdown
  if (ui.isSnoozing) {
    el.snoozeLabel.style.display = 'block';
    el.snoozeLabel.textContent = `稍后提醒 ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  } else {
    el.snoozeLabel.style.display = 'none';
  }

  // Tray tooltip
  const modeText = ui.mode === 'work' ? '工作中' : '休息中';
  window.timerAPI.setTrayTooltip(`番茄钟 — ${modeText} ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
}

function updateModeUI() {
  if (ui.mode === 'work') {
    el.modeBadge.textContent = '🍅 工作中';
    el.modeBadge.className = 'mode-badge work';
    el.ringProgress.classList.remove('break-mode');
    document.title = '🍅 番茄钟 — 工作中';
  } else {
    el.modeBadge.textContent = '☕ 休息中';
    el.modeBadge.className = 'mode-badge break';
    el.ringProgress.classList.add('break-mode');
    document.title = '☕ 番茄钟 — 休息中';
  }
}

function updateStartButton() {
  if (ui.isSnoozing) {
    // During snooze, hide the play/pause toggle
    el.iconPlay.style.display = 'none';
    el.iconPause.style.display = 'none';
    el.btnStart.classList.add('paused');
    el.btnStart.style.visibility = 'hidden';
    el.timerDisplay.classList.remove('running');
  } else if (ui.isRunning) {
    el.btnStart.style.visibility = 'visible';
    el.iconPlay.style.display = 'none';
    el.iconPause.style.display = 'block';
    el.btnStart.classList.add('paused');
    el.timerDisplay.classList.add('running');
  } else {
    el.btnStart.style.visibility = 'visible';
    el.iconPlay.style.display = 'block';
    el.iconPause.style.display = 'none';
    el.btnStart.classList.remove('paused');
    el.timerDisplay.classList.remove('running');
  }
}

function applyState(state) {
  if (!state) return;

  const wasSnoozing = ui.isSnoozing;
  const wasRunning = ui.isRunning;
  const wasMode = ui.mode;

  ui.mode = state.mode;
  ui.isRunning = state.isRunning;
  ui.remainingSeconds = state.remainingSeconds;
  ui.totalSeconds = state.totalSeconds;

  // Handle snooze state from enriched timer-state
  if (state.snoozing) {
    ui.isSnoozing = true;
    ui.snoozeUntil = state.snoozeUntil;
    ui.snoozeRemainingSeconds = state.snoozeRemainingSeconds;
    if (!wasSnoozing) {
      startLocalSnoozeTick();
    }
  } else {
    if (ui.isSnoozing && !state.snoozing) {
      // Snooze just ended
      stopLocalSnoozeTick();
    }
    ui.isSnoozing = false;
    ui.snoozeUntil = null;
    ui.snoozeRemainingSeconds = 0;
  }

  // Track active task from state
  if (state.activeTaskId !== undefined) {
    ui.activeTaskId = state.activeTaskId;
    ui.activeTaskTitle = state.activeTaskTitle;
    updateTaskActiveBadge();
  }

  if (ui.mode !== wasMode) updateModeUI();
  if (ui.isRunning !== wasRunning || ui.isSnoozing !== wasSnoozing) updateStartButton();
  updateDisplay();

  // Sync character avatar with current state
  CharacterEngine.updateCharacterState(state);
}

// ── Alarm UI ──────────────────────────────────────────────────────────
function showAlarmPopup(data) {
  if (!data) return;

  ui.alarmActive = true;
  ui.isSnoozing = false;

  // Determine alert video and subtitle
  const isWorkComplete = data.reason === 'workComplete';
  const alertVideoName = isWorkComplete ? 'alert-rest' : 'alert-work';

  // Set alert video in popup
  if (el.alarmCardVideo && ui.alarmVideoUrls && ui.alarmVideoUrls[alertVideoName]) {
    el.alarmCardVideo.setAttribute('src', ui.alarmVideoUrls[alertVideoName]);
    el.alarmCardVideo.load();
    el.alarmCardVideo.play().catch(() => {});
  }

  // Small subtitle (does NOT duplicate the video's built-in text)
  if (el.alarmCardSubtitle) {
    el.alarmCardSubtitle.textContent = isWorkComplete ? '工作时间结束' : '休息时间结束';
  }

  // Update snooze button label
  const snoozeMin = data.snoozeMinutes || ui.alarmSettings.snoozeMinutes;
  el.btnAlarmSnooze.textContent = `延时 ${snoozeMin} 分钟`;

  // Show overlay
  el.alarmOverlay.style.display = 'flex';

  // Start alarm sound
  SoundEngine.setVolume(data.volume != null ? data.volume : ui.alarmSettings.volume);
  const continuous = data.continuous != null ? data.continuous : ui.alarmSettings.continuous;
  if (continuous) {
    SoundEngine.playLoop(data.sound || ui.alarmSettings.sound);
  } else {
    SoundEngine.playOnce(data.sound || ui.alarmSettings.sound);
  }

  // Update character to alarm state
  CharacterEngine.updateCharacterState({
    mode: ui.mode,
    isRunning: ui.isRunning,
    alarmActive: true,
    alarmReason: data.reason,
    snoozing: false,
  });
}

function hideAlarmPopup() {
  ui.alarmActive = false;
  ui.isSnoozing = false;
  el.alarmOverlay.style.display = 'none';
  SoundEngine.stop();

  // Clear alarm video
  if (el.alarmCardVideo) {
    el.alarmCardVideo.pause();
    el.alarmCardVideo.removeAttribute('src');
    el.alarmCardVideo.load();
  }

  // Reset character to idle (next timer-state will refine this)
  CharacterEngine.updateCharacterState({
    mode: ui.mode,
    isRunning: ui.isRunning,
    alarmActive: false,
    alarmReason: null,
    snoozing: false,
  });
}

// ── Listen for state pushed from main process ─────────────────────────
window.timerAPI.onTimerState((state) => {
  applyState(state);
});

// Legacy alarm trigger (non-continuous mode)
window.timerAPI.onPlayAlarm(() => {
  playAlarm();
});

// New alarm system events
window.timerAPI.onAlarmStart((data) => {
  showAlarmPopup(data);
});

window.timerAPI.onAlarmStop((data) => {
  hideAlarmPopup();
  // If alarm stopped with reason other than 'snooze', clear snooze state
  if (data.reason !== 'snooze') {
    ui.isSnoozing = false;
    ui.snoozeUntil = null;
    ui.snoozeRemainingSeconds = 0;
    stopLocalSnoozeTick();
    updateModeUI();
    updateStartButton();
  }
});

window.timerAPI.onAlarmSnoozed((data) => {
  ui.isSnoozing = true;
  ui.snoozeUntil = data.snoozeUntil;
  ui.snoozeRemainingSeconds = Math.max(0, Math.ceil((data.snoozeUntil - Date.now()) / 1000));

  // Snooze keeps current work/break mode — no "加点中"
  updateModeUI();
  updateStartButton();
  updateDisplay();

  // Start local snooze tick for countdown display
  startLocalSnoozeTick();
});

window.timerAPI.onAlarmSettingsUpdated((settings) => {
  ui.alarmSettings = { ...ui.alarmSettings, ...settings };
  syncAlarmSettingsUI();
});

// Listen for today stats updates
window.timerAPI.onTodayStats((stats) => {
  if (stats && typeof stats.workCount === 'number') {
    ui.todayWorkCount = stats.workCount;
    el.todayCount.textContent = stats.workCount;
  }
});

// ── Event Handlers ─────────────────────────────────────────────────────
// Start/Pause toggle
el.btnStart.addEventListener('click', () => {
  window.timerAPI.timerToggle();
});

// Reset
el.btnReset.addEventListener('click', () => {
  // Clear local snooze state before sending to main
  if (ui.isSnoozing) {
    stopLocalSnoozeTick();
    ui.isSnoozing = false;
    ui.snoozeUntil = null;
    ui.snoozeRemainingSeconds = 0;
  }
  window.timerAPI.timerReset();
  // If alarm was showing, hide it
  if (ui.alarmActive) {
    hideAlarmPopup();
  }
});

// Skip
el.btnSkip.addEventListener('click', () => {
  // Clear local snooze state before sending to main
  if (ui.isSnoozing) {
    stopLocalSnoozeTick();
    ui.isSnoozing = false;
    ui.snoozeUntil = null;
    ui.snoozeRemainingSeconds = 0;
  }
  window.timerAPI.timerSkip();
  if (ui.alarmActive) {
    hideAlarmPopup();
  }
});

// ── Alarm dismiss / snooze buttons ───────────────────────────────────
el.btnAlarmDismiss.addEventListener('click', async () => {
  SoundEngine.stop();
  await window.timerAPI.alarmDismiss();
  hideAlarmPopup();
});

el.btnAlarmSnooze.addEventListener('click', async () => {
  SoundEngine.stop();
  await window.timerAPI.alarmSnooze();
  // Popup will be hidden by alarmStop event from main
  el.alarmOverlay.style.display = 'none';
});

// ── Alarm preview button ──────────────────────────────────────────────
el.btnPreview.addEventListener('click', () => {
  if (ui.isPreviewing) {
    // Stop preview
    SoundEngine.stop();
    ui.isPreviewing = false;
    el.btnPreview.textContent = '🔊 试听';
    el.btnPreview.classList.remove('previewing');
    window.timerAPI.alarmPreviewStop();
  } else {
    // Don't allow preview while alarm is active
    if (ui.alarmActive) return;
    // Start preview
    SoundEngine.setVolume(ui.alarmSettings.volume);
    SoundEngine.preview(ui.alarmSettings.sound, 3000);
    ui.isPreviewing = true;
    el.btnPreview.textContent = '⏹ 停止';
    el.btnPreview.classList.add('previewing');
    window.timerAPI.alarmPreviewStart(ui.alarmSettings.sound);

    // Auto-reset preview button state after 3 seconds
    setTimeout(() => {
      ui.isPreviewing = false;
      el.btnPreview.textContent = '🔊 试听';
      el.btnPreview.classList.remove('previewing');
    }, 3100);
  }
});

// ── Alarm settings controls ───────────────────────────────────────────
el.alarmSound.addEventListener('change', async () => {
  // Stop any preview when switching sounds
  if (ui.isPreviewing) {
    SoundEngine.stop();
    ui.isPreviewing = false;
    el.btnPreview.textContent = '🔊 试听';
    el.btnPreview.classList.remove('previewing');
    window.timerAPI.alarmPreviewStop();
  }
  ui.alarmSettings.sound = el.alarmSound.value;
  await window.timerAPI.updateAlarmSettings(ui.alarmSettings);
});

el.alarmVolume.addEventListener('input', async () => {
  const val = parseInt(el.alarmVolume.value);
  el.volumeLabel.textContent = `${val}%`;
  ui.alarmSettings.volume = val / 100;
  SoundEngine.setVolume(ui.alarmSettings.volume);
  await window.timerAPI.updateAlarmSettings(ui.alarmSettings);
});

el.alarmContinuous.addEventListener('change', async () => {
  ui.alarmSettings.continuous = el.alarmContinuous.checked;
  await window.timerAPI.updateAlarmSettings(ui.alarmSettings);
});

el.snoozeMinutes.addEventListener('input', () => {
  // Update UI immediately on drag for real-time feedback
  const val = clampSnoozeMinutes(parseInt(el.snoozeMinutes.value));
  el.snoozeMinutesValue.textContent = `${val} 分钟`;
  el.btnAlarmSnooze.textContent = `延时 ${val} 分钟`;
  ui.alarmSettings.snoozeMinutes = val;
  // Update volume in case sound engine needs it
  SoundEngine.setVolume(ui.alarmSettings.volume);
});

// Save to store when user finishes dragging (reduces frequent writes)
el.snoozeMinutes.addEventListener('change', async () => {
  const val = clampSnoozeMinutes(parseInt(el.snoozeMinutes.value));
  el.snoozeMinutesValue.textContent = `${val} 分钟`;
  el.btnAlarmSnooze.textContent = `延时 ${val} 分钟`;
  ui.alarmSettings.snoozeMinutes = val;
  await window.timerAPI.updateAlarmSettings(ui.alarmSettings);
});

// ── Settings ───────────────────────────────────────────────────────────
el.settingsToggle.addEventListener('click', () => {
  const visible = el.settingsPanel.style.display !== 'none';
  el.settingsPanel.style.display = visible ? 'none' : 'block';
});

el.workDuration.addEventListener('input', () => {
  const val = parseInt(el.workDuration.value);
  el.workDurationLabel.textContent = `${val} 分钟`;
  ui.settings.workDuration = val;
  window.timerAPI.saveSettings({ workDuration: val, breakDuration: ui.settings.breakDuration });
});

el.breakDuration.addEventListener('input', () => {
  const val = parseInt(el.breakDuration.value);
  el.breakDurationLabel.textContent = `${val} 分钟`;
  ui.settings.breakDuration = val;
  window.timerAPI.saveSettings({ workDuration: ui.settings.workDuration, breakDuration: val });
});

// ── Window controls ───────────────────────────────────────────────────
el.btnMinimize.addEventListener('click', () => window.timerAPI.minimizeWindow());
el.btnClose.addEventListener('click', () => window.timerAPI.closeWindow());

// ── Keyboard Shortcuts ────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement ? document.activeElement.tagName : '';
  const isEditable = document.activeElement
    && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || document.activeElement.isContentEditable);

  if (e.code === 'Space') {
    if (!isEditable) {
      e.preventDefault();
      window.timerAPI.timerToggle();
    }
  } else if (e.code === 'KeyR') {
    if (!isEditable) {
      e.preventDefault();
      if (ui.isSnoozing) {
        stopLocalSnoozeTick();
        ui.isSnoozing = false;
        ui.snoozeUntil = null;
        ui.snoozeRemainingSeconds = 0;
      }
      window.timerAPI.timerReset();
    }
  } else if (e.code === 'KeyS') {
    if (!isEditable) {
      e.preventDefault();
      if (ui.isSnoozing) {
        stopLocalSnoozeTick();
        ui.isSnoozing = false;
        ui.snoozeUntil = null;
        ui.snoozeRemainingSeconds = 0;
      }
      window.timerAPI.timerSkip();
    }
  } else if (e.code === 'KeyD') {
    // Dismiss alarm via keyboard (works during alarm or snooze)
    if ((ui.alarmActive || ui.isSnoozing) && !isEditable) {
      e.preventDefault();
      SoundEngine.stop();
      window.timerAPI.alarmDismiss();
      hideAlarmPopup();
    }
  } else if (e.code === 'KeyZ') {
    // Snooze alarm via keyboard
    if (ui.alarmActive && !isEditable) {
      e.preventDefault();
      SoundEngine.stop();
      window.timerAPI.alarmSnooze();
      el.alarmOverlay.style.display = 'none';
    }
  }
});

// ── History ────────────────────────────────────────────────────────────
async function loadHistory() {
  const history = await window.timerAPI.getHistory();
  const dates = Object.keys(history).sort().reverse().slice(0, 7);

  if (dates.length === 0) {
    el.historyList.innerHTML = '<div style="padding:8px;color:var(--text-muted)">暂无记录</div>';
    return;
  }

  el.historyList.innerHTML = dates.map(date => {
    const records = history[date];
    const workCount = records.filter(r => r.type === 'work').length;
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const d = new Date(date);
    const dayName = dayNames[d.getDay()];

    const rows = records.map(r => {
      const taskRef = r.taskTitle
        ? `<span class="task-ref" title="${escapeHtml(r.taskTitle)}">📌 ${escapeHtml(r.taskTitle)}</span>`
        : '';
      return `
      <div class="history-row">
        <span class="${r.type === 'work' ? 'type-work' : 'type-break'}">
          ${r.type === 'work' ? '🍅 工作' : '☕ 休息'}
        </span>
        ${taskRef}
        <span>${r.duration} 分钟</span>
        <span>${r.completedAt || ''}</span>
      </div>
    `;
    }).join('');

    return `
      <div class="history-date-group">
        <div class="history-date-label">
          ${date} 周${dayName} · ${workCount} 个番茄
        </div>
        ${rows}
      </div>
    `;
  }).join('');
}

// ── Task Panel ────────────────────────────────────────────────────────
function updateTaskActiveBadge() {
  if (ui.activeTaskId && ui.activeTaskTitle) {
    el.taskActiveBadge.style.display = 'flex';
    el.taskActiveName.textContent = ui.activeTaskTitle;
  } else {
    el.taskActiveBadge.style.display = 'none';
    el.taskActiveName.textContent = '';
  }
  // Highlight active row
  const rows = el.taskList.querySelectorAll('.task-row');
  rows.forEach(row => {
    row.classList.toggle('active', row.dataset.taskId === ui.activeTaskId);
  });
}

async function refreshTaskList() {
  try {
    ui.tasks = await window.timerAPI.taskList();
    renderTaskList();
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
}

function renderTaskList() {
  if (!ui.tasks || ui.tasks.length === 0) {
    el.taskList.innerHTML = '<div style="padding:8px;color:var(--text-muted);font-size:12px;text-align:center">暂无任务，添加一个吧</div>';
    return;
  }

  el.taskList.innerHTML = ui.tasks.map(t => {
    const dots = [];
    const max = Math.max(t.estimatedPomodoros || 1, t.completedPomodoros || 0);
    for (let i = 0; i < max; i++) {
      const done = i < (t.completedPomodoros || 0);
      dots.push(`<span class="task-pomo-dot${done ? ' done' : ''}"></span>`);
    }

    return `
      <div class="task-row${ui.activeTaskId === t.id ? ' active' : ''}" data-task-id="${t.id}">
        <span class="task-row-indicator">✓</span>
        <span class="task-row-title">${escapeHtml(t.title)}</span>
        <span class="task-row-pomos">${dots.join('')}</span>
        <button class="task-row-delete" data-delete="${t.id}" title="删除">✕</button>
      </div>
    `;
  }).join('');

  // Click handlers for task rows
  el.taskList.querySelectorAll('.task-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't select if clicking delete button
      if (e.target.closest('.task-row-delete')) return;
      const taskId = row.dataset.taskId;
      setActiveTask(taskId);
    });
  });

  // Delete buttons
  el.taskList.querySelectorAll('.task-row-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.delete;
      await window.timerAPI.taskDelete(taskId);
      if (ui.activeTaskId === taskId) {
        ui.activeTaskId = null;
        ui.activeTaskTitle = null;
        updateTaskActiveBadge();
      }
      await refreshTaskList();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function setActiveTask(taskId) {
  const result = await window.timerAPI.taskSetActive(taskId);
  if (result !== null) {
    ui.activeTaskId = taskId;
    const task = ui.tasks.find(t => t.id === taskId);
    ui.activeTaskTitle = task ? task.title : null;
    updateTaskActiveBadge();
  }
}

async function clearActiveTask() {
  await window.timerAPI.taskSetActive(null);
  ui.activeTaskId = null;
  ui.activeTaskTitle = null;
  updateTaskActiveBadge();
}

// ── Task Panel Event Handlers ──────────────────────────────────────────
el.btnTaskAdd.addEventListener('click', async () => {
  const title = el.taskInput.value.trim();
  if (!title) return;
  const estimatedPomos = parseInt(el.taskEstimatedPomos.value) || 1;
  await window.timerAPI.taskCreate({ title, estimatedPomodoros: estimatedPomos });
  el.taskInput.value = '';
  el.taskEstimatedPomos.value = '1';
  await refreshTaskList();
});

el.taskInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const title = el.taskInput.value.trim();
    if (!title) return;
    const estimatedPomos = parseInt(el.taskEstimatedPomos.value) || 1;
    await window.timerAPI.taskCreate({ title, estimatedPomodoros: estimatedPomos });
    el.taskInput.value = '';
    el.taskEstimatedPomos.value = '1';
    await refreshTaskList();
  }
});

el.btnTaskClearActive.addEventListener('click', () => {
  clearActiveTask();
});

// ── Stats / History Tabs ──────────────────────────────────────────────
el.bottomTabs.forEach(tab => {
  tab.addEventListener('click', async () => {
    // Update active tab style
    el.bottomTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const tabName = tab.dataset.tab;
    if (tabName === 'stats') {
      el.statsPanel.style.display = 'block';
      el.historyPanel.style.display = 'none';
      await StatsEngine.loadStats();
    } else if (tabName === 'history') {
      el.statsPanel.style.display = 'none';
      el.historyPanel.style.display = 'block';
      await loadHistory();
    }
  });
});

// ── Sync alarm settings UI with current values ─────────────────────────
function syncAlarmSettingsUI() {
  const snoozeVal = clampSnoozeMinutes(ui.alarmSettings.snoozeMinutes);
  el.alarmSound.value = ui.alarmSettings.sound;
  el.alarmVolume.value = Math.round(ui.alarmSettings.volume * 100);
  el.volumeLabel.textContent = `${Math.round(ui.alarmSettings.volume * 100)}%`;
  el.alarmContinuous.checked = ui.alarmSettings.continuous;
  el.snoozeMinutes.value = snoozeVal;
  el.snoozeMinutesValue.textContent = `${snoozeVal} 分钟`;
  el.btnAlarmSnooze.textContent = `延时 ${snoozeVal} 分钟`;
  ui.alarmSettings.snoozeMinutes = snoozeVal;
  SoundEngine.setVolume(ui.alarmSettings.volume);
}

// ── Initialization ─────────────────────────────────────────────────────
async function init() {
  // Load timer settings
  try {
    const settings = await window.timerAPI.getSettings();
    if (settings) {
      ui.settings.workDuration = settings.workDuration || 25;
      ui.settings.breakDuration = settings.breakDuration || 5;
    }
  } catch (_) { /* use defaults */ }

  // Sync timer settings UI
  el.workDuration.value = ui.settings.workDuration;
  el.breakDuration.value = ui.settings.breakDuration;
  el.workDurationLabel.textContent = `${ui.settings.workDuration} 分钟`;
  el.breakDurationLabel.textContent = `${ui.settings.breakDuration} 分钟`;

  // Load alarm settings
  try {
    const alarmSettings = await window.timerAPI.getAlarmSettings();
    if (alarmSettings) {
      ui.alarmSettings = { ...ui.alarmSettings, ...alarmSettings };
    }
  } catch (_) { /* use defaults */ }
  syncAlarmSettingsUI();

  // Load today's stats
  try {
    const stats = await window.timerAPI.getTodayStats();
    if (stats) {
      ui.todayWorkCount = stats.workCount || 0;
      el.todayCount.textContent = ui.todayWorkCount;
    }
  } catch (_) { /* no stats yet */ }

  // Get initial timer state
  try {
    const state = await window.timerAPI.timerGetState();
    if (state) applyState(state);
  } catch (_) {
    ui.remainingSeconds = ui.settings.workDuration * 60;
    ui.totalSeconds = ui.remainingSeconds;
    updateDisplay();
  }

  // Check if there's a restored alarm state
  try {
    const alarmState = await window.timerAPI.getAlarmState();
    if (alarmState && alarmState.active) {
      // There's a restored active alarm — show the popup
      // (main will also send alarm-start via broadcastAlarmState)
      const sound = ui.alarmSettings.sound;
      const volume = ui.alarmSettings.volume;
      const continuous = ui.alarmSettings.continuous;
      showAlarmPopup({
        reason: alarmState.reason,
        sound,
        volume,
        continuous,
        snoozeMinutes: alarmState.snoozeMinutes || ui.alarmSettings.snoozeMinutes,
      });
    } else if (alarmState && alarmState.snoozeUntil && alarmState.snoozeUntil > Date.now()) {
      // Snoozing — restore snooze display
      ui.isSnoozing = true;
      ui.snoozeUntil = alarmState.snoozeUntil;
      ui.snoozeRemainingSeconds = Math.max(0, Math.ceil((alarmState.snoozeUntil - Date.now()) / 1000));
      updateModeUI();
      updateStartButton();
      updateDisplay();
      startLocalSnoozeTick();
    }
  } catch (_) { /* no alarm state */ }

  // Load tasks
  await refreshTaskList();

  // Load active task
  try {
    const activeTask = await window.timerAPI.taskGetActive();
    if (activeTask) {
      ui.activeTaskId = activeTask.id;
      ui.activeTaskTitle = activeTask.title;
      updateTaskActiveBadge();
    }
  } catch (_) { /* no active task */ }

  // Load initial stats
  await StatsEngine.loadStats();

  // Initialize character video engine
  CharacterEngine.init();

  // Load avatar video URLs via IPC (works in both dev and packaged)
  const mainVideoNames = ['work', 'break', 'snooze'];
  const alarmVideoNames = ['alert-rest', 'alert-work'];
  const videoUrls = {};
  try {
    for (const name of mainVideoNames) {
      const url = await window.timerAPI.getAssetUrl(`avatar/videos/${name}.mp4`);
      if (url) videoUrls[name] = url;
    }
    for (const name of alarmVideoNames) {
      const url = await window.timerAPI.getAssetUrl(`avatar/videos/${name}.mp4`);
      if (url) ui.alarmVideoUrls[name] = url;
    }
  } catch (_) { /* video paths unavailable */ }
  CharacterEngine.setVideoUrls(videoUrls);

  updateModeUI();
  updateStartButton();
}

init();
