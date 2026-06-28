# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

桌面番茄钟 — a Windows desktop Pomodoro timer built with Electron. Features work/break cycles, system tray integration, alarm notifications, snooze with configurable duration, daily history tracking, animated character backgrounds, and full state persistence across restarts.

## Commands

```bash
npm install          # Install dependencies (first run)
npm start            # Run in development mode
npm run dist         # Build NSIS installer + portable .exe into dist/
npm run pack         # Build unpacked dir (no installer)
```

There is no test suite or linter configured.

## Architecture

**Electron 41** with context isolation enabled (`nodeIntegration: false`, `contextIsolation: true`). A single `BrowserWindow` (420×620, frameless, transparent) that hides to the system tray on close (never quits until explicit exit).

### Three-process structure

| Process | File(s) | Responsibility |
|---------|---------|---------------|
| Main | `main.js` (~1200 lines) | All timer logic, alarm state machine, persistence, tray, notifications, power monitor, IPC handlers |
| Preload | `preload.js` (~80 lines) | `contextBridge.exposeInMainWorld('timerAPI', …)` — the only bridge between main and renderer |
| Renderer | `renderer/*` | Display only: reads state pushed from main, renders UI, plays alarm sounds via Web Audio API |

### timerAPI surface (preload.js)

The renderer accesses ALL main-process capabilities through `window.timerAPI`:

- **Timer controls**: `timerStart`, `timerPause`, `timerToggle`, `timerReset`, `timerSkip`, `timerGetState`
- **State events**: `onTimerState(cb)` — main pushes `{mode, isRunning, remainingSeconds, totalSeconds, alarmActive, alarmReason, snoozing, snoozeUntil, snoozeRemainingSeconds}` every 250ms while ticking
- **Alarm events**: `onAlarmStart`, `onAlarmStop`, `onAlarmSnoozed`, `onAlarmSettingsUpdated`
- **Alarm controls**: `alarmDismiss`, `alarmSnooze`, `alarmPreviewStart/Stop`, `updateAlarmSettings`, `getAlarmSettings`, `getAlarmState`
- **Data**: `getHistory`, `getTodayStats`, `getSettings`, `saveSettings`
- **Window/tray**: `minimizeWindow`, `closeWindow`, `setTrayTooltip`, `sendNotification`
- **Assets**: `getAssetUrl(path)` — resolves asset paths in both dev and packaged builds

### Timer design (main.js)

Wall-clock based using `Date.now()`. The timer stores `endAt` (absolute timestamp) rather than decrementing a counter — this makes it immune to `setInterval` drift, window throttling, and system suspend/resume.

- `timer` object in main process is the single source of truth
- A 250ms `setInterval` tick checks `(endAt - Date.now())` and broadcasts state to renderer
- State is persisted to `electron-store` on every change (start, pause, reset, skip, complete)
- On app restart, `loadTimerState()` reads saved state. If the timer was running and has since expired, it auto-completes. If still running, it recalculates remaining and resumes the tick.

### Alarm state machine (main.js)

Two modes controlled by `alarmSettings.continuous`:

**Continuous mode** (default): When timer completes → `alarmState.active = true` → alarm sound loops + popup overlay shown. User can:
- **Dismiss**: clears alarm, switches mode (work→break or break→work). Work→break auto-starts the break timer. Break→work waits for manual start.
- **Snooze**: pauses alarm for `snoozeMinutes` (1-20, default 9). A `setTimeout` re-activates the alarm. A 500ms tick broadcasts snooze countdown to renderer.

**Non-continuous mode**: Legacy one-shot beep + auto-switch mode (no popup, no snooze).

Guard rules: `handleStart` is blocked while alarm is active. `handlePause` is blocked if timer isn't running. Multiple rapid snoozes are prevented.

### Power monitor (main.js)

Listens to `powerMonitor` events:
- `suspend`: stops tick, saves state
- `resume`: recalculates timer remaining from wall clock. If snooze/timer expired during sleep, triggers completion. If snooze still active, restarts the snooze timer.
- `lock-screen` / `unlock-screen`: logged but no special handling

### Persistence (electron-store)

`electron-store` v8 stores:
- `settings`: `{workDuration, breakDuration}`
- `timerState`: full timer snapshot for restart recovery
- `alarmSettings`: `{sound, volume, continuous, snoozeMinutes}`
- `alarmState`: `{active, reason, snoozeUntil}`
- `history`: `{ "YYYY-MM-DD": [{type, duration, completedAt}] }`

### Renderer structure

| File | Purpose |
|------|---------|
| `index.html` | UI layout: title bar, timer ring (SVG circle + overlay text), control buttons, settings panel, alarm overlay popup, history section |
| `style.css` | Main styles: CSS custom properties for warm cream/brown theme, frosted glass effects, animations |
| `avatar.css` | Background video positioning and frosted backdrop for timer ring |
| `renderer.js` | UI state management: receives main process state, updates DOM, handles button clicks, keyboard shortcuts, history rendering |
| `sounds.js` | `SoundEngine` (IIFE): Web Audio API synthesis — 4 ringtones (classic, bright, digital, soft) with loop/preview/stop, zero external audio dependencies |
| `avatar.js` | `CharacterEngine` (IIFE): State-driven background video switcher — maps timer state to video files (work.mp4, break.mp4, snooze.mp4) |

### Keyboard shortcuts (renderer, only when not in input fields)

| Key | Action |
|-----|--------|
| Space | Toggle start/pause |
| R | Reset |
| S | Skip |
| D | Dismiss alarm (when alarm/snooze active) |
| Z | Snooze alarm (when alarm active) |

### Asset path resolution

`getAssetPath(filename)` in main.js checks `app.isPackaged` to resolve paths to either `process.resourcesPath/assets/` (packaged) or `__dirname/assets/` (dev). The renderer gets asset URLs via the `get-asset-url` IPC handler rather than constructing paths directly.

### Build configuration

electron-builder targets Windows x64 only:
- NSIS installer: customizable install path, desktop/start menu shortcuts
- Portable: single .exe, no installation needed
- Extra resources: `assets/` directory is bundled into the package
- Icon: `assets/icon.ico`

## Git workflow

This project follows `GITHUB_SUBMIT_SKILL.md` — a strict commit/push protocol. Key rules:
- Never `--force` push
- Never commit `node_modules/`, `dist/`, `.exe`, `.log`, secrets
- Always check `git status`, `git diff`, remote before committing
- Use `git pull --rebase` when remote has new commits
- Commit message format: `type: description` (feat/fix/docs/style/refactor/perf/test/build/chore)
- Dist artifacts belong in GitHub Releases, not ordinary commits
