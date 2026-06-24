// ── DOM Elements ──────────────────────────────────────────────
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

// ── State ─────────────────────────────────────────────────────
const RING_CIRCUMFERENCE = 2 * Math.PI * 90; // r=90 → ~565.49
el.ringProgress.style.strokeDasharray = RING_CIRCUMFERENCE;
el.ringProgress.style.strokeDashoffset = '0';

const state = {
  mode: 'work',           // 'work' | 'break'
  running: false,
  workDuration: 25,       // minutes
  breakDuration: 5,       // minutes
  timeLeft: 25 * 60,      // seconds
  totalTime: 25 * 60,     // seconds — for progress ring
  intervalId: null,
  todayWorkCount: 0,
};

// ── Audio Context (for beep sound) ────────────────────────────
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
  // Play a sequence of beeps
  playBeep(880, 150, 'square');
  setTimeout(() => playBeep(1100, 200, 'square'), 200);
  setTimeout(() => playBeep(1320, 300, 'square'), 450);
}

// ── Timer Logic ───────────────────────────────────────────────
function updateDisplay() {
  const mins = Math.floor(state.timeLeft / 60);
  const secs = state.timeLeft % 60;
  el.timerMinutes.textContent = String(mins).padStart(2, '0');
  el.timerSeconds.textContent = String(secs).padStart(2, '0');

  // Update progress ring
  const progress = state.timeLeft / state.totalTime;
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  el.ringProgress.style.strokeDashoffset = offset;

  // Update tray tooltip
  const modeText = state.mode === 'work' ? '工作中' : '休息中';
  window.timerAPI.setTrayTooltip(`番茄钟 — ${modeText} ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
}

function updateModeUI() {
  if (state.mode === 'work') {
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

function resetTimer() {
  state.running = false;
  state.timeLeft = state.mode === 'work' ? state.workDuration * 60 : state.breakDuration * 60;
  state.totalTime = state.timeLeft;
  clearInterval(state.intervalId);
  state.intervalId = null;

  updateDisplay();
  updateStartButton();
  el.timerDisplay.classList.remove('running');
}

function switchMode() {
  state.mode = state.mode === 'work' ? 'break' : 'work';
  state.timeLeft = state.mode === 'work' ? state.workDuration * 60 : state.breakDuration * 60;
  state.totalTime = state.timeLeft;
  updateModeUI();
  updateDisplay();
}

function startTimer() {
  if (state.running) return;

  // Initialize timeLeft if not set
  if (state.timeLeft <= 0) {
    state.timeLeft = state.mode === 'work' ? state.workDuration * 60 : state.breakDuration * 60;
    state.totalTime = state.timeLeft;
  }

  state.running = true;
  updateStartButton();
  el.timerDisplay.classList.add('running');

  state.intervalId = setInterval(() => {
    state.timeLeft--;

    if (state.timeLeft <= 0) {
      // Timer finished
      clearInterval(state.intervalId);
      state.intervalId = null;
      state.running = false;

      playAlarm();

      // Save record
      const duration = state.mode === 'work' ? state.workDuration : state.breakDuration;
      window.timerAPI.saveRecord({ type: state.mode, duration }).then(stats => {
        if (stats && state.mode === 'work') {
          state.todayWorkCount = stats.workCount;
          el.todayCount.textContent = stats.workCount;
        }
      });

      // Send notification
      if (state.mode === 'work') {
        window.timerAPI.sendNotification('🍅 番茄钟', '工作时间结束！休息一下吧~');
      } else {
        window.timerAPI.sendNotification('☕ 番茄钟', '休息时间结束！开始新的番茄吧~');
      }

      // Switch mode and reset
      switchMode();
      resetTimer();
      updateDisplay();
    }

    updateDisplay();
  }, 1000);
}

function pauseTimer() {
  state.running = false;
  clearInterval(state.intervalId);
  state.intervalId = null;
  updateStartButton();
  el.timerDisplay.classList.remove('running');
}

function toggleTimer() {
  if (state.running) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function updateStartButton() {
  if (state.running) {
    el.iconPlay.style.display = 'none';
    el.iconPause.style.display = 'block';
    el.btnStart.classList.add('paused');
  } else {
    el.iconPlay.style.display = 'block';
    el.iconPause.style.display = 'none';
    el.btnStart.classList.remove('paused');
  }
}

// ── Event Handlers ────────────────────────────────────────────
el.btnStart.addEventListener('click', toggleTimer);
el.btnReset.addEventListener('click', resetTimer);
el.btnSkip.addEventListener('click', () => {
  if (state.running) {
    pauseTimer();
  }
  switchMode();
  resetTimer();
  updateDisplay();
});

// Settings
el.settingsToggle.addEventListener('click', () => {
  const visible = el.settingsPanel.style.display !== 'none';
  el.settingsPanel.style.display = visible ? 'none' : 'block';
});

el.workDuration.addEventListener('input', () => {
  const val = parseInt(el.workDuration.value);
  el.workDurationLabel.textContent = `${val} 分钟`;
  state.workDuration = val;
  if (!state.running && state.mode === 'work') {
    state.timeLeft = val * 60;
    state.totalTime = val * 60;
    updateDisplay();
  }
  window.timerAPI.saveSettings({ workDuration: state.workDuration, breakDuration: state.breakDuration });
});

el.breakDuration.addEventListener('input', () => {
  const val = parseInt(el.breakDuration.value);
  el.breakDurationLabel.textContent = `${val} 分钟`;
  state.breakDuration = val;
  if (!state.running && state.mode === 'break') {
    state.timeLeft = val * 60;
    state.totalTime = val * 60;
    updateDisplay();
  }
  window.timerAPI.saveSettings({ workDuration: state.workDuration, breakDuration: state.breakDuration });
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

// Tray actions
window.timerAPI.onTrayAction((action) => {
  switch (action) {
    case 'start': if (!state.running) startTimer(); break;
    case 'pause': if (state.running) pauseTimer(); break;
    case 'reset': resetTimer(); break;
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    toggleTimer();
  } else if (e.code === 'KeyR') {
    resetTimer();
  } else if (e.code === 'KeyS') {
    if (state.running) pauseTimer();
    switchMode();
    resetTimer();
    updateDisplay();
  }
});

// ── History ───────────────────────────────────────────────────
async function loadHistory() {
  const history = await window.timerAPI.getHistory();
  const dates = Object.keys(history).sort().reverse().slice(0, 7); // last 7 days

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

// ── Initialization ────────────────────────────────────────────
async function init() {
  // Load settings
  try {
    const settings = await window.timerAPI.getSettings();
    if (settings) {
      state.workDuration = settings.workDuration || 25;
      state.breakDuration = settings.breakDuration || 5;
    }
  } catch (_) {
    // Use defaults
  }

  // Sync UI with settings
  el.workDuration.value = state.workDuration;
  el.breakDuration.value = state.breakDuration;
  el.workDurationLabel.textContent = `${state.workDuration} 分钟`;
  el.breakDurationLabel.textContent = `${state.breakDuration} 分钟`;

  // Load today's stats
  try {
    const stats = await window.timerAPI.getTodayStats();
    if (stats) {
      state.todayWorkCount = stats.workCount || 0;
      el.todayCount.textContent = state.todayWorkCount;
    }
  } catch (_) {
    // No stats yet
  }

  // Initialize timer state
  state.timeLeft = state.workDuration * 60;
  state.totalTime = state.timeLeft;
  updateModeUI();
  updateDisplay();
  updateStartButton();
}

init();
