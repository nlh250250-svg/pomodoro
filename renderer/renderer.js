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
  historyToggle: document.getElementById('historyToggle'),
  historyList: document.getElementById('historyList'),
  historyArrow: document.getElementById('historyArrow'),
  btnMinimize: document.getElementById('btnMinimize'),
  btnClose: document.getElementById('btnClose'),
  titleBar: document.getElementById('titleBar'),
};

// ── Constants ─────────────────────────────────────────────────────────
const RING_CIRCUMFERENCE = 2 * Math.PI * 90; // r=90 → ~565.49
el.ringProgress.style.strokeDasharray = RING_CIRCUMFERENCE;
el.ringProgress.style.strokeDashoffset = '0';

// ── Local UI state (mirrors main process state) ─────────────────────────
const ui = {
  mode: 'work',
  isRunning: false,
  remainingSeconds: 0,
  totalSeconds: 0,
  todayWorkCount: 0,
  settings: { workDuration: 25, breakDuration: 5 },
};

// ── Audio Context (for beep sound) ────────────────────────────────────
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playBeep(frequency = 800, duration = 200, type = 'sine') {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gainNode.gain.value = 0.3;
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration / 1000);
  } catch (_) { /* audio not available */ }
}

function playAlarm() {
  playBeep(880, 150, 'square');
  setTimeout(() => playBeep(1100, 200, 'square'), 200);
  setTimeout(() => playBeep(1320, 300, 'square'), 450);
}

// ── UI Update ─────────────────────────────────────────────────────────
function updateDisplay() {
  const remaining = ui.remainingSeconds;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  el.timerMinutes.textContent = String(mins).padStart(2, '0');
  el.timerSeconds.textContent = String(secs).padStart(2, '0');

  // Update progress ring
  const total = ui.totalSeconds || 1;
  const progress = remaining / total;
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  el.ringProgress.style.strokeDashoffset = offset;

  // Update tray tooltip
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
  if (ui.isRunning) {
    el.iconPlay.style.display = 'none';
    el.iconPause.style.display = 'block';
    el.btnStart.classList.add('paused');
    el.timerDisplay.classList.add('running');
  } else {
    el.iconPlay.style.display = 'block';
    el.iconPause.style.display = 'none';
    el.btnStart.classList.remove('paused');
    el.timerDisplay.classList.remove('running');
  }
}

function applyState(state) {
  if (!state) return;

  const wasRunning = ui.isRunning;
  const wasMode = ui.mode;

  ui.mode = state.mode;
  ui.isRunning = state.isRunning;
  ui.remainingSeconds = state.remainingSeconds;
  ui.totalSeconds = state.totalSeconds;

  if (ui.mode !== wasMode) {
    updateModeUI();
  }
  if (ui.isRunning !== wasRunning) {
    updateStartButton();
  }
  updateDisplay();
}

// ── Listen for state pushed from main process ─────────────────────────
window.timerAPI.onTimerState((state) => {
  applyState(state);
});

// Listen for alarm trigger from main process
window.timerAPI.onPlayAlarm(() => {
  playAlarm();
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
  window.timerAPI.timerReset();
});

// Skip
el.btnSkip.addEventListener('click', () => {
  window.timerAPI.timerSkip();
});

// Settings
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

// History toggle
el.historyToggle.addEventListener('click', async () => {
  const visible = el.historyList.style.display !== 'none';
  if (visible) {
    el.historyList.style.display = 'none';
    el.historyArrow.classList.remove('open');
  } else {
    await loadHistory();
    el.historyList.style.display = 'block';
    el.historyArrow.classList.add('open');
  }
});

// Window controls
el.btnMinimize.addEventListener('click', () => window.timerAPI.minimizeWindow());
el.btnClose.addEventListener('click', () => window.timerAPI.closeWindow());

// ── Keyboard Shortcuts ────────────────────────────────────────────────
// Only work when the window is focused AND the user is NOT typing in an input
document.addEventListener('keydown', (e) => {
  // Ignore if user is typing in a text field, contenteditable, etc.
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
      window.timerAPI.timerReset();
    }
  } else if (e.code === 'KeyS') {
    if (!isEditable) {
      e.preventDefault();
      window.timerAPI.timerSkip();
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

    const rows = records.map(r => `
      <div class="history-row">
        <span class="${r.type === 'work' ? 'type-work' : 'type-break'}">
          ${r.type === 'work' ? '🍅 工作' : '☕ 休息'}
        </span>
        <span>${r.duration} 分钟</span>
        <span>${r.completedAt || ''}</span>
      </div>
    `).join('');

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

// ── Initialization ─────────────────────────────────────────────────────
async function init() {
  // Load settings
  try {
    const settings = await window.timerAPI.getSettings();
    if (settings) {
      ui.settings.workDuration = settings.workDuration || 25;
      ui.settings.breakDuration = settings.breakDuration || 5;
    }
  } catch (_) {
    // Use defaults
  }

  // Sync settings UI
  el.workDuration.value = ui.settings.workDuration;
  el.breakDuration.value = ui.settings.breakDuration;
  el.workDurationLabel.textContent = `${ui.settings.workDuration} 分钟`;
  el.breakDurationLabel.textContent = `${ui.settings.breakDuration} 分钟`;

  // Load today's stats
  try {
    const stats = await window.timerAPI.getTodayStats();
    if (stats) {
      ui.todayWorkCount = stats.workCount || 0;
      el.todayCount.textContent = ui.todayWorkCount;
    }
  } catch (_) {
    // No stats yet
  }

  // Get initial timer state from main process
  try {
    const state = await window.timerAPI.timerGetState();
    if (state) {
      applyState(state);
    }
  } catch (_) {
    // Use defaults — already set in ui
    ui.remainingSeconds = ui.settings.workDuration * 60;
    ui.totalSeconds = ui.remainingSeconds;
    updateDisplay();
  }

  updateModeUI();
  updateStartButton();
}

init();
