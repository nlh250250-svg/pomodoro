// ═══════════════════════════════════════════════════════════════════════
// Background Video Engine — full-screen state-driven video background
// ═══════════════════════════════════════════════════════════════════════

const CharacterEngine = (() => {
  let bgVideo, modeBadge;
  let currentVideoName = null;
  let videoUrls = {};
  let inited = false;

  const REQUIRED_VIDEOS = ['work', 'break', 'snooze'];

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    bgVideo   = document.getElementById('backgroundVideo');
    modeBadge = document.getElementById('modeBadge');

    if (bgVideo) {
      bgVideo.onerror = () => {
        const src = bgVideo.getAttribute('src') || '';
        console.error(`[BG Video] failed to load: ${src}`);
      };
    }
    inited = true;
  }

  // ── Load video URLs ───────────────────────────────────────────────
  function setVideoUrls(urls) {
    videoUrls = urls || {};
    const missing = REQUIRED_VIDEOS.filter(name => !videoUrls[name]);
    if (missing.length > 0) {
      console.warn(`[BG Video] missing: ${missing.map(v => v + '.mp4').join(', ')}`);
    }
  }

  // ── Main update entry ─────────────────────────────────────────────
  function updateCharacterState(state) {
    if (!inited || !bgVideo) return;
    if (!state) return;

    let videoName, modeText;

    const isAlarm  = state.alarmActive;
    const isSnooze = state.snoozing;
    const mode     = state.mode;
    const running  = state.isRunning;

    if (isSnooze) {
      // ── Snoozing: keep work/break video per completedMode ──────
      const reason = state.alarmReason || '';
      if (reason === 'workComplete' || mode === 'work') {
        videoName = 'work'; modeText = '🍅 工作中';
      } else if (reason === 'breakComplete' || mode === 'break') {
        videoName = 'break'; modeText = '☕ 休息中';
      } else {
        videoName = 'snooze'; modeText = '🍅 准备开始';
      }
    } else if (isAlarm) {
      // ── Alarm: keep current video, keep mode text ─────────────
      videoName = currentVideoName || 'work';
      modeText = mode === 'work' ? '🍅 工作中' : '☕ 休息中';
    } else if (mode === 'work' && running) {
      videoName = 'work'; modeText = '🍅 工作中';
    } else if (mode === 'break' && running) {
      videoName = 'break'; modeText = '☕ 休息中';
    } else {
      videoName = 'snooze'; modeText = '🍅 准备开始';
    }

    // ── Update mode badge ───────────────────────────────────────
    if (modeBadge) modeBadge.textContent = modeText;

    // ── Switch background video (only if changed) ───────────────
    if (videoName !== currentVideoName) {
      currentVideoName = videoName;
      const url = videoUrls[videoName];
      if (url) {
        bgVideo.setAttribute('src', url);
        bgVideo.load();
        bgVideo.play().catch(() => {});
      }
    }
  }

  return { init, setVideoUrls, updateCharacterState };
})();
