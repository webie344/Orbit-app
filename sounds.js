// =========================================================================
// Orbit — sounds.js
// Synthesised UI sounds via Web Audio API — no external files needed.
// Import the named exports you need and call them on user interactions.
// =========================================================================

let _ac = null;
const _getAC = () => {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
};

let _vol = parseFloat(localStorage.getItem("orbit:sfx_vol") ?? "0.55");

export const setSfxVolume = (v) => {
  _vol = Math.max(0, Math.min(1, v));
  localStorage.setItem("orbit:sfx_vol", String(_vol));
};
export const getSfxVolume = () => _vol;

const _play = (fn) => {
  if (_vol === 0) return;
  try {
    const ac = _getAC();
    if (ac.state === "suspended") ac.resume();
    fn(ac);
  } catch {}
};

// ── Typing key click (very subtle) ───────────────────────────────────────
export const sfxTyping = () => _play(ac => {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type = "sine";
  o.frequency.value = 780 + Math.random() * 180;
  g.gain.setValueAtTime(_vol * 0.035, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.045);
  o.start(); o.stop(ac.currentTime + 0.045);
});

// ── Message sent (quick upward chirp) ────────────────────────────────────
export const sfxSend = () => _play(ac => {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type = "sine";
  o.frequency.setValueAtTime(560, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(920, ac.currentTime + 0.13);
  g.gain.setValueAtTime(_vol * 0.2, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.18);
  o.start(); o.stop(ac.currentTime + 0.18);
});

// ── Notification / incoming message (two-tone ding) ──────────────────────
export const sfxNotification = () => _play(ac => {
  [[0, 880], [0.11, 1100]].forEach(([t, freq]) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(_vol * 0.22, ac.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.18);
    o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2);
  });
});

// ── Comment posted (soft pop-down) ───────────────────────────────────────
export const sfxComment = () => _play(ac => {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type = "triangle";
  o.frequency.setValueAtTime(720, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(480, ac.currentTime + 0.11);
  g.gain.setValueAtTime(_vol * 0.16, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.13);
  o.start(); o.stop(ac.currentTime + 0.13);
});

// ── Orbit / like (3-note rising sparkle) ─────────────────────────────────
export const sfxOrbit = () => _play(ac => {
  [[0, 880], [0.065, 1100], [0.13, 1320]].forEach(([t, freq]) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(_vol * 0.16, ac.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.14);
    o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.15);
  });
});

// ── New post published (satisfying whoosh-up) ─────────────────────────────
export const sfxPost = () => _play(ac => {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type = "sine";
  o.frequency.setValueAtTime(380, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(1240, ac.currentTime + 0.24);
  g.gain.setValueAtTime(_vol * 0.2, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.27);
  o.start(); o.stop(ac.currentTime + 0.27);
});

// ── Incoming call ringtone (loops until stopFn is called) ─────────────────
export const sfxCallRing = () => {
  let _stopped = false;
  const _tick = () => _play(ac => {
    if (_stopped) return;
    [[0, 1000], [0.22, 1000]].forEach(([t, freq]) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(_vol * 0.3, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.19);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2);
    });
    setTimeout(() => { if (!_stopped) _tick(); }, 2200);
  });
  _tick();
  return () => { _stopped = true; };
};

// ── Call connected (two ascending tones) ─────────────────────────────────
export const sfxCallConnect = () => _play(ac => {
  [[0, 660], [0.13, 880]].forEach(([t, freq]) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(_vol * 0.22, ac.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.18);
    o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2);
  });
});

// ── Call ended (two descending tones) ────────────────────────────────────
export const sfxCallEnd = () => _play(ac => {
  [[0, 520], [0.12, 380]].forEach(([t, freq]) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(_vol * 0.22, ac.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.18);
    o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2);
  });
});

// ── Story tap / navigation (light tick) ──────────────────────────────────
export const sfxTap = () => _play(ac => {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type = "sine";
  o.frequency.value = 1050;
  g.gain.setValueAtTime(_vol * 0.09, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.055);
  o.start(); o.stop(ac.currentTime + 0.055);
});

// ── Expose on window so non-module scripts (chat.js etc.) can call them ──
Object.assign(window, {
  sfxTyping, sfxSend, sfxNotification, sfxComment,
  sfxOrbit, sfxPost, sfxCallRing, sfxCallConnect, sfxCallEnd, sfxTap,
});
