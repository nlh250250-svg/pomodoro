// ── Sound Engine (Web Audio API) ───────────────────────────────────────
// Generates 4 synthetic ringtones without external audio files.
// Supports: play (one-shot), loop (continuous alarm), preview (3s), stop.

const SoundEngine = (() => {
  let _ctx = null;
  let _gainNode = null;
  let _loopTimer = null;
  let _previewTimer = null;
  let _activeOscillators = [];
  let _volume = 0.7;

  // ── Audio context management ────────────────────────────────────────
  function _getCtx() {
    if (!_ctx || _ctx.state === 'closed') {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
      _gainNode = _ctx.createGain();
      _gainNode.gain.value = _volume;
      _gainNode.connect(_ctx.destination);
    }
    if (_ctx.state === 'suspended') {
      _ctx.resume();
    }
    return _ctx;
  }

  function _closeCtx() {
    if (_loopTimer) { clearTimeout(_loopTimer); _loopTimer = null; }
    if (_previewTimer) { clearTimeout(_previewTimer); _previewTimer = null; }
    _activeOscillators.forEach(o => { try { o.stop(); } catch (_) { /* already stopped */ } });
    _activeOscillators = [];
    if (_ctx && _ctx.state !== 'closed') {
      _ctx.close();
    }
    _ctx = null;
    _gainNode = null;
  }

  // ── Schedule a single tone ──────────────────────────────────────────
  function _scheduleTone(freq, startTime, duration, type) {
    const ctx = _getCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type || 'sine';
    osc.frequency.value = freq;

    // Quick attack, then sustain at 0.35, exponential decay at end
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(0.35, startTime + 0.008);
    g.gain.setValueAtTime(0.35, startTime + duration - 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(g);
    g.connect(_gainNode);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);

    _activeOscillators.push(osc);

    // Clean up oscillator reference after it stops
    const stopTime = (startTime + duration + 0.1) * 1000;
    setTimeout(() => {
      const idx = _activeOscillators.indexOf(osc);
      if (idx >= 0) _activeOscillators.splice(idx, 1);
    }, Math.max(0, stopTime - _ctx.currentTime * 1000 + 50));
  }

  // ── Sound pattern definitions ────────────────────────────────────────
  // Each pattern: array of { freq, dur, type, gap } where gap is silence after
  const PATTERNS = {
    // 经典提示音 — three ascending square-wave beeps
    classic: [
      { freq: 880,  dur: 0.15, type: 'square', gap: 0.05 },
      { freq: 1100, dur: 0.15, type: 'square', gap: 0.05 },
      { freq: 1320, dur: 0.25, type: 'square', gap: 0 },
    ],
    // 清脆铃声 — four quick triangle-wave dings
    bright: [
      { freq: 1200, dur: 0.08, type: 'triangle', gap: 0.04 },
      { freq: 1600, dur: 0.08, type: 'triangle', gap: 0.04 },
      { freq: 2000, dur: 0.08, type: 'triangle', gap: 0.04 },
      { freq: 1600, dur: 0.14, type: 'triangle', gap: 0 },
    ],
    // 电子闹钟 — alternating two-tone square wave alarm, 2 repeats
    digital: [
      { freq: 1000, dur: 0.20, type: 'square', gap: 0.08 },
      { freq: 800,  dur: 0.20, type: 'square', gap: 0.08 },
      { freq: 1000, dur: 0.20, type: 'square', gap: 0.08 },
      { freq: 800,  dur: 0.20, type: 'square', gap: 0.08 },
      { freq: 1000, dur: 0.20, type: 'square', gap: 0.08 },
      { freq: 800,  dur: 0.25, type: 'square', gap: 0 },
    ],
    // 柔和提醒 — gentle sine-wave ascending melody
    soft: [
      { freq: 523,  dur: 0.30, type: 'sine', gap: 0.06 },
      { freq: 659,  dur: 0.30, type: 'sine', gap: 0.06 },
      { freq: 784,  dur: 0.45, type: 'sine', gap: 0 },
    ],
  };

  // Cycle durations in ms (pattern + silence until next repeat)
  const CYCLE_MS = {
    classic: 2000,
    bright: 2000,
    digital: 2200,
    soft: 2200,
  };

  // ── Play a pattern once (returns total duration in seconds) ──────────
  function _playOnce(name) {
    const pattern = PATTERNS[name];
    if (!pattern) return 0;

    const ctx = _getCtx();
    const now = ctx.currentTime;
    let t = now;

    for (const tone of pattern) {
      _scheduleTone(tone.freq, t, tone.dur, tone.type);
      t += tone.dur + (tone.gap || 0);
    }

    return t - now; // total pattern duration in seconds
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Set master volume (0.0 – 1.0) */
  function setVolume(v) {
    _volume = Math.max(0, Math.min(1, v));
    if (_gainNode) {
      _gainNode.gain.value = _volume;
    }
  }

  /** Stop all audio immediately and clean up */
  function stop() {
    if (_loopTimer) { clearTimeout(_loopTimer); _loopTimer = null; }
    if (_previewTimer) { clearTimeout(_previewTimer); _previewTimer = null; }
    _activeOscillators.forEach(o => { try { o.stop(); } catch (_) { /* ok */ } });
    _activeOscillators = [];
    // Close context to fully silence; it will be recreated on next play
    if (_ctx && _ctx.state !== 'closed') {
      _ctx.close();
    }
    _ctx = null;
    _gainNode = null;
  }

  /** Play alarm sound once */
  function playOnce(name) {
    stop();
    _playOnce(name || 'classic');
  }

  /** Start looping alarm sound continuously */
  function playLoop(name) {
    stop();
    const soundName = name || 'classic';
    const cycleMs = CYCLE_MS[soundName] || 2000;

    function loop() {
      _playOnce(soundName);
      _loopTimer = setTimeout(loop, cycleMs);
    }
    loop();
  }

  /** Preview a sound for `durationMs` (default 3000ms) */
  function preview(name, durationMs) {
    stop();
    const soundName = name || 'classic';
    const cycleMs = CYCLE_MS[soundName] || 2000;

    function previewLoop() {
      _playOnce(soundName);
      _previewTimer = setTimeout(previewLoop, cycleMs);
    }
    previewLoop();

    // Auto-stop after durationMs
    setTimeout(() => {
      stop();
    }, durationMs || 3000);
  }

  return { setVolume, stop, playOnce, playLoop, preview };
})();
