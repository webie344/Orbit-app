/* ============================================================================
   COMPOUND CLASH  ·  Get better 3D arena  ·  gamers.js
   ----------------------------------------------------------------------------
   Last-one-standing shooter inside one big walled compound (Free Fire style):
   buildings with doors & windows, rooftops, container yards, watch towers,
   a shrinking safe zone, loot, and 15 bots that fight you AND each other.

   Needs (next to gamers.html):  Soldier.glb  +  Rifle.glb
   Soldier.glb animations used (all 24):
     Idle  Idle_Neutral  Idle_Gun  Idle_Gun_Pointing  Idle_Gun_Shoot  Idle_Sword
     Walk  Run  Run_Back  Run_Left  Run_Right  Run_Shoot  Gun_Shoot
     Roll  Interact  Wave  Punch_Left  Punch_Right  Kick_Left  Kick_Right
     Sword_Slash  HitRecieve  HitRecieve_2  Death

   Talks to the Get better games page with postMessage:
     {type:'gb-game-score', game:'compound', score, kills, place}   (when a run ends)
     {type:'gb-game-exit'}                                          (Exit button)
   ============================================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------ tunables ---------------------------------- */
const CFG = {
  SOLDIER: './Soldier.glb',
  RIFLE: './Rifle.glb',
  MODEL_YAW: 0,              // set to Math.PI if your soldier walks backwards
  HALF: 60,                  // compound is 120 x 120 m
  BOTS: 15,
  // movement (about 2x the old game)
  WALK: 4.8, RUN: 10.2, SPRINT: 15, AIM_SPEED: 4.4,
  JUMP: 9.4, GRAV: 28, STEP: 0.45, RADIUS: 0.42, HEIGHT: 1.85,
  ROLL_SPEED: 17, ROLL_TIME: 0.62, ROLL_CD: 2.6,
  BODY_H: 1.85,
  RIFLE_LEN: 0.95,
  GRIP: 0.36,      // where along the rifle the right hand holds it (0 = stock, 1 = muzzle)
  HAND_FWD: 0.1, HAND_UP: 0.02,   // nudge the rifle relative to the hand (metres)
};
const WEAPON = { dmg: 21, rate: 0.092, mag: 30, reload: 1.7, head: 2, range: 140 };
const MELEE = { punch: { dmg: 34, range: 2.3, delay: 0.16, cd: 0.45 }, kick: { dmg: 48, range: 2.5, delay: 0.26, cd: 0.8 }, sword: { dmg: 80, range: 3.1, delay: 0.22, cd: 0.7 } };
const qs = new URLSearchParams(location.search);
const PLAYER_NAME = (qs.get('name') || 'You').slice(0, 16);
if (qs.get('flip')) CFG.MODEL_YAW = Math.PI;
const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

/* ------------------------------- helpers ---------------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDelta = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const dampAng = (a, b, k, dt) => a + angDelta(a, b) * (1 - Math.exp(-k * dt));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = mulberry(20261114);   // fixed seed -> same compound every match
const store = { get: (k, d) => { try { const v = localStorage.getItem('cc_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('cc_' + k, JSON.stringify(v)); } catch {} } };

/* ---------------------------------- UI ------------------------------------ */
const CSS = `
:root{--cc-a:#7c5cff;--cc-b:#22d3ee;--cc-y:#fde047;--cc-r:#ff4d6d;--cc-g:#34d399;--cc-bg:rgba(12,10,32,.62);font-family:'Rajdhani','Segoe UI',system-ui,sans-serif}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}
html,body{margin:0;height:100%;overflow:hidden;background:#0b0920;color:#fff;touch-action:none;overscroll-behavior:none}
.cc-gl{position:fixed;inset:0;width:100%;height:100%;display:block}
.cc-vig{position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 55%,rgba(10,6,30,.55) 100%)}
.cc-hurt{position:fixed;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,transparent 35%,rgba(255,30,60,.75) 100%);transition:opacity .25s}
.cc-hud{position:fixed;inset:0;pointer-events:none;display:none}
.cc-hud.on{display:block}
.cc-top{position:absolute;top:calc(10px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;gap:8px}
.cc-pill{display:flex;align-items:center;gap:6px;background:var(--cc-bg);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:5px 12px;font-weight:700;font-size:17px;letter-spacing:.3px}
.cc-pill b{min-width:1.1em;text-align:center}.cc-pill small{opacity:.65;font-weight:600;font-size:12px;text-transform:uppercase}
.cc-pill.warn{background:rgba(255,40,80,.5);animation:ccp .6s infinite alternate}
@keyframes ccp{to{transform:scale(1.06)}}
.cc-map{position:absolute;top:calc(10px + env(safe-area-inset-top));left:10px;width:112px;height:112px;border-radius:50%;border:2px solid rgba(255,255,255,.35);box-shadow:0 4px 18px rgba(0,0,0,.45);background:rgba(10,8,30,.55)}
.cc-feed{position:absolute;top:calc(10px + env(safe-area-inset-top));right:10px;display:flex;flex-direction:column;gap:4px;align-items:flex-end;max-width:46vw}
.cc-feed div{background:var(--cc-bg);border-radius:8px;padding:3px 9px;font-size:14px;font-weight:600;animation:ccf .25s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.cc-feed .me{border-left:3px solid var(--cc-y)}
@keyframes ccf{from{opacity:0;transform:translateX(20px)}}
.cc-xh{position:absolute;left:50%;top:50%;width:0;height:0}
.cc-xh i{position:absolute;background:#fff;box-shadow:0 0 3px #000;width:2px;height:9px;left:-1px;top:-1px;transition:transform .08s}
.cc-xh i:nth-child(1){transform:translateY(calc(-14px - var(--s,0px)))}
.cc-xh i:nth-child(2){transform:translateY(calc(5px + var(--s,0px)))}
.cc-xh i:nth-child(3){width:9px;height:2px;left:auto;top:-1px;transform:translateX(calc(5px + var(--s,0px)))}
.cc-xh i:nth-child(4){width:9px;height:2px;left:-9px;top:-1px;transform:translateX(calc(-5px - var(--s,0px)))}
.cc-xh u{position:absolute;left:-14px;top:-14px;width:28px;height:28px;opacity:0;transform:scale(.6) rotate(45deg);transition:all .12s}
.cc-xh u:before,.cc-xh u:after{content:'';position:absolute;background:var(--cc-r);left:13px;top:0;width:2px;height:28px}.cc-xh u:after{transform:rotate(90deg)}
.cc-xh.hit u{opacity:1;transform:scale(1) rotate(45deg)}.cc-xh.head u:before,.cc-xh.head u:after{background:var(--cc-y)}
.cc-xh.ads i{opacity:.6}
.cc-bars{position:absolute;left:calc(12px + env(safe-area-inset-left));bottom:calc(14px + env(safe-area-inset-bottom));width:min(250px,40vw);display:flex;flex-direction:column;gap:5px}
.cc-bar{height:14px;background:rgba(0,0,0,.5);border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.2);position:relative}
.cc-bar i{display:block;height:100%;width:100%;border-radius:8px;transition:width .15s;background:linear-gradient(90deg,#10b981,#34d399)}
.cc-bar.ar i{background:linear-gradient(90deg,#3b82f6,#22d3ee)}.cc-bar.sp i{background:linear-gradient(90deg,#f59e0b,#fde047)}
.cc-bar.low i{background:linear-gradient(90deg,#ef4444,#ff7a90)}
.cc-bar span{position:absolute;left:8px;top:-1px;font-size:11px;font-weight:700;text-shadow:0 1px 2px #000}
.cc-gun{position:absolute;right:calc(14px + env(safe-area-inset-right));bottom:calc(14px + env(safe-area-inset-bottom));text-align:right;text-shadow:0 2px 6px #000}
.cc-gun b{font-size:44px;line-height:1;font-weight:700}.cc-gun small{font-size:20px;opacity:.7}.cc-gun div{font-size:13px;font-weight:700;letter-spacing:1px;opacity:.8;text-transform:uppercase}
.cc-gun.empty b{color:var(--cc-r)}
.cc-prompt{position:absolute;left:50%;bottom:26%;transform:translateX(-50%);background:var(--cc-bg);border:1px solid var(--cc-y);padding:6px 14px;border-radius:12px;font-weight:700;font-size:16px;display:none}
.cc-banner{position:absolute;left:50%;top:22%;transform:translate(-50%,0);font-size:34px;font-weight:700;letter-spacing:2px;text-shadow:0 4px 18px rgba(124,92,255,.9),0 2px 0 #000;opacity:0;text-align:center;white-space:nowrap}
.cc-banner.show{animation:ccb 2.2s forwards}
@keyframes ccb{0%{opacity:0;transform:translate(-50%,16px) scale(.8)}12%{opacity:1;transform:translate(-50%,0) scale(1.05)}20%{transform:translate(-50%,0) scale(1)}80%{opacity:1}100%{opacity:0}}
.cc-dmg{position:absolute;left:50%;top:50%;width:0;height:0}
.cc-arc{position:absolute;left:-90px;top:-90px;width:180px;height:180px;border-radius:50%;opacity:.9;animation:cca .9s forwards;background:conic-gradient(from -18deg,rgba(255,40,70,.9) 0 36deg,transparent 36deg);-webkit-mask:radial-gradient(circle,transparent 62%,#000 64%,#000 72%,transparent 74%);mask:radial-gradient(circle,transparent 62%,#000 64%,#000 72%,transparent 74%)}
@keyframes cca{to{opacity:0}}
.cc-num{position:absolute;font-weight:700;font-size:22px;text-shadow:0 2px 4px #000;animation:ccn .8s forwards;transform:translate(-50%,-50%)}
@keyframes ccn{to{opacity:0;margin-top:-50px}}
.cc-tag{position:absolute;transform:translate(-50%,-100%);font-size:12px;font-weight:700;text-shadow:0 1px 3px #000;text-align:center;display:none}
.cc-tag i{display:block;width:54px;height:5px;background:rgba(0,0,0,.6);border-radius:3px;margin:2px auto 0;overflow:hidden}.cc-tag i b{display:block;height:100%;background:#ff5d73}
.cc-pause{position:absolute;right:10px;top:calc(56px + env(safe-area-inset-top));pointer-events:auto;width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:var(--cc-bg);color:#fff;font-size:14px}
.cc-touch{position:fixed;inset:0;display:none;pointer-events:none}
.cc-touch.on{display:block}
.cc-joy{position:absolute;left:0;bottom:0;width:48%;height:58%;pointer-events:auto;touch-action:none}
.cc-joy .base{position:absolute;width:128px;height:128px;border-radius:50%;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.07);display:none}
.cc-joy .knob{position:absolute;left:34px;top:34px;width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.7)}
.cc-look{position:absolute;right:0;top:0;width:56%;height:100%;pointer-events:auto;touch-action:none}
.cc-btn{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;border:2px solid rgba(255,255,255,.55);background:rgba(20,16,50,.5);backdrop-filter:blur(4px);color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;flex-direction:column;font-size:11px;line-height:1.05;text-transform:uppercase;letter-spacing:.5px}
.cc-btn span{font-size:20px}
.cc-btn:active,.cc-btn.on{background:rgba(124,92,255,.75);transform:scale(.94)}
.cc-btn.cd{opacity:.45}
.cc-screen{position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;text-align:center;background:radial-gradient(ellipse at 50% 30%,rgba(60,40,140,.75),rgba(8,6,28,.94));z-index:5;padding:20px;overflow:auto;touch-action:pan-y}
.cc-screen.on{display:flex}
.cc-screen h1{margin:0;font-size:clamp(38px,9vw,72px);letter-spacing:3px;line-height:.95;font-weight:700;text-transform:uppercase;background:linear-gradient(180deg,#fff,#c4b5fd 60%,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 22px rgba(124,92,255,.7))}
.cc-screen h1 small{display:block;font-size:.34em;letter-spacing:8px;color:var(--cc-y);-webkit-text-fill-color:var(--cc-y)}
.cc-screen p{margin:0;opacity:.8;max-width:430px;font-size:16px}
.cc-b{pointer-events:auto;cursor:pointer;border:0;border-radius:14px;padding:13px 34px;font:700 20px/1 inherit;font-family:inherit;letter-spacing:2px;text-transform:uppercase;color:#fff;background:linear-gradient(135deg,#7c5cff,#c026d3);box-shadow:0 8px 24px rgba(124,92,255,.5);transition:transform .1s}
.cc-b:active{transform:scale(.96)}.cc-b.alt{background:rgba(255,255,255,.12);box-shadow:none;border:1px solid rgba(255,255,255,.25)}
.cc-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;align-items:center}
.cc-seg{display:flex;background:rgba(255,255,255,.1);border-radius:12px;padding:3px}.cc-seg button{border:0;background:none;color:#fff;font:700 15px inherit;font-family:inherit;padding:7px 14px;border-radius:9px;letter-spacing:1px;text-transform:uppercase;opacity:.7}.cc-seg button.on{background:var(--cc-a);opacity:1}
.cc-keys{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px 14px;max-width:540px;font-size:14px;opacity:.85;text-align:left}
.cc-keys b{color:var(--cc-y)}
.cc-load{width:min(320px,70vw);height:10px;border-radius:6px;background:rgba(255,255,255,.14);overflow:hidden}.cc-load i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7c5cff,#22d3ee);transition:width .2s}
.cc-stat{display:flex;gap:22px;justify-content:center}.cc-stat div{font-size:13px;text-transform:uppercase;letter-spacing:2px;opacity:.85}.cc-stat b{display:block;font-size:36px;letter-spacing:0;color:var(--cc-y)}
.cc-sens{display:flex;align-items:center;gap:8px;font-size:14px;opacity:.9}.cc-sens input{accent-color:#7c5cff;pointer-events:auto}
@media (max-height:470px){.cc-screen{gap:8px;padding:10px}.cc-screen h1{font-size:clamp(30px,7vw,50px)}.cc-keys{display:none}.cc-screen p{font-size:13px}.cc-b{padding:10px 26px;font-size:17px}}
`;

function buildUI() {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div');
  root.innerHTML = `
  <canvas class="cc-gl"></canvas><div class="cc-vig"></div><div class="cc-hurt"></div>
  <div class="cc-hud">
    <div class="cc-top"><div class="cc-pill">👥<b data-k="alive">16</b><small>alive</small></div><div class="cc-pill">🎯<b data-k="kills">0</b><small>kills</small></div><div class="cc-pill" data-k="zonep">🌀<b data-k="zone">--</b><small data-k="zonel">zone</small></div></div>
    <canvas class="cc-map" width="224" height="224"></canvas>
    <div class="cc-feed"></div>
    <div class="cc-xh"><i></i><i></i><i></i><i></i><u></u></div>
    <div class="cc-bars"><div class="cc-bar sp"><i data-k="stam"></i><span>STAMINA</span></div><div class="cc-bar ar"><i data-k="ar"></i><span>ARMOR</span></div><div class="cc-bar"><i data-k="hp"></i><span>HEALTH</span></div></div>
    <div class="cc-gun"><div data-k="wname">Rifle</div><b data-k="mag">30</b><small data-k="res">/ 120</small></div>
    <div class="cc-prompt"></div><div class="cc-banner"></div><div class="cc-dmg"></div><div class="cc-tags"></div>
    <button class="cc-pause" data-k="pause">❚❚</button>
  </div>
  <div class="cc-touch">
    <div class="cc-joy"><div class="base"><div class="knob"></div></div></div><div class="cc-look"></div>
    <button class="cc-btn" data-b="fire" style="right:18px;bottom:96px;width:92px;height:92px;font-size:13px"><span>🔥</span>Fire</button>
    <button class="cc-btn" data-b="aim" style="right:122px;bottom:58px;width:62px;height:62px"><span>◎</span>Aim</button>
    <button class="cc-btn" data-b="jump" style="right:22px;bottom:200px;width:64px;height:64px"><span>⤒</span>Jump</button>
    <button class="cc-btn" data-b="roll" style="right:96px;bottom:176px;width:56px;height:56px"><span>↻</span>Roll</button>
    <button class="cc-btn" data-b="reload" style="right:176px;bottom:128px;width:52px;height:52px"><span>⟲</span>Load</button>
    <button class="cc-btn" data-b="melee" style="right:164px;bottom:196px;width:52px;height:52px"><span>🥊</span>Hit</button>
    <button class="cc-btn" data-b="kick" style="right:228px;bottom:60px;width:48px;height:48px"><span>🦶</span>Kick</button>
    <button class="cc-btn" data-b="swap" style="right:230px;bottom:168px;width:46px;height:46px"><span>⇄</span>Swap</button>
    <button class="cc-btn" data-b="use" style="right:240px;bottom:228px;width:58px;height:58px;display:none"><span>✋</span>Use</button>
  </div>
  <div class="cc-screen on" data-s="menu">
    <h1><small>GET BETTER ARENA</small>Compound Clash</h1>
    <p>16 fighters. One walled compound. A shrinking zone. Be the last one standing.</p>
    <div class="cc-load"><i data-k="load"></i></div><p data-k="loadt" style="font-size:13px">Loading soldiers…</p>
    <div class="cc-row" data-k="menurow" style="display:none">
      <div class="cc-seg" data-k="diff"><button data-d="0.8">Easy</button><button data-d="1" class="on">Normal</button><button data-d="1.25">Hard</button></div>
    </div>
    <div class="cc-sens" data-k="sensrow" style="display:none">Look speed <input type="range" min="0.4" max="2.2" step="0.05" data-k="sens"></div>
    <div class="cc-row"><button class="cc-b" data-k="play" style="display:none">Deploy</button><button class="cc-b alt" data-k="exit1">Exit</button></div>
    <div class="cc-keys" data-k="keys"></div>
  </div>
  <div class="cc-screen" data-s="pause"><h1>Paused</h1><div class="cc-row"><button class="cc-b" data-k="resume">Resume</button><button class="cc-b alt" data-k="quit">Leave match</button></div></div>
  <div class="cc-screen" data-s="end"><h1 data-k="endt">Game over</h1><p data-k="endsub"></p>
    <div class="cc-stat"><div>Place<b data-k="eplace">#1</b></div><div>Kills<b data-k="ekills">0</b></div><div>Score<b data-k="escore">0</b></div></div>
    <div class="cc-row"><button class="cc-b" data-k="again">Play again</button><button class="cc-b alt" data-k="exit2">Exit</button></div></div>`;
  document.body.appendChild(root);
  const U = { root, canvas: root.querySelector('.cc-gl'), hud: root.querySelector('.cc-hud'), hurt: root.querySelector('.cc-hurt'), map: root.querySelector('.cc-map'), feed: root.querySelector('.cc-feed'), xh: root.querySelector('.cc-xh'), prompt: root.querySelector('.cc-prompt'), banner: root.querySelector('.cc-banner'), dmg: root.querySelector('.cc-dmg'), tags: root.querySelector('.cc-tags'), touch: root.querySelector('.cc-touch'), joy: root.querySelector('.cc-joy'), look: root.querySelector('.cc-look'), screens: {} };
  root.querySelectorAll('[data-k]').forEach((e) => { U[e.dataset.k] = e; });
  root.querySelectorAll('[data-s]').forEach((e) => { U.screens[e.dataset.s] = e; });
  U.btn = {}; root.querySelectorAll('[data-b]').forEach((e) => { U.btn[e.dataset.b] = e; });
  U.keys.innerHTML = TOUCH
    ? '<span><b>Left pad</b> move (push fully = sprint)</span><span><b>Drag right</b> look</span><span><b>Fire / Aim</b> shoot & zoom</span><span><b>Roll</b> dodge bullets</span><span><b>Hit / Kick</b> melee</span><span><b>Use</b> pick up loot</span>'
    : '<span><b>WASD</b> move</span><span><b>Mouse</b> look</span><span><b>Click</b> fire · <b>Right-click</b> aim</span><span><b>Shift</b> sprint</span><span><b>Space</b> jump</span><span><b>C</b> roll</span><span><b>R</b> reload</span><span><b>F</b> punch / slash</span><span><b>V</b> kick</span><span><b>E</b> pick up</span><span><b>1 / 2</b> rifle / sword</span><span><b>G</b> wave</span>';
  return U;
}

/* -------------------------------- audio ----------------------------------- */
const AU = {
  ctx: null, out: null, noise: null, on: true,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext; this.ctx = new C();
      this.out = this.ctx.createGain(); this.out.gain.value = 0.55; this.out.connect(this.ctx.destination);
      const len = this.ctx.sampleRate; const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = b;
    } catch { this.ctx = null; }
  },
  _n(dur, freq, q, vol, type = 'lowpass', f2 = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rnd(0.8, 1.2);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur); f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random() * 0.5, dur + 0.05);
  },
  _t(freq, f2, dur, vol, type = 'sine') {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  },
  shot(v = 1) { if (v < 0.03) return; this._n(0.22, 2600, 0.7, 0.9 * v, 'lowpass', 300); this._t(160, 45, 0.16, 0.8 * v, 'triangle'); },
  reload() { this._n(0.05, 3200, 3, 0.4, 'bandpass'); setTimeout(() => this._n(0.07, 1800, 3, 0.45, 'bandpass'), 650); setTimeout(() => this._n(0.05, 3600, 3, 0.5, 'bandpass'), 1300); },
  hit() { this._t(900, 500, 0.06, 0.35, 'square'); },
  head() { this._t(1500, 900, 0.1, 0.4, 'square'); this._t(2100, 1400, 0.12, 0.25, 'square'); },
  hurt() { this._t(140, 70, 0.18, 0.5, 'sawtooth'); },
  step(v = 1) { this._n(0.07, 420, 1, 0.12 * v, 'lowpass'); },
  swing() { this._n(0.18, 700, 1, 0.25, 'bandpass', 2600); },
  whack() { this._t(120, 50, 0.12, 0.7, 'triangle'); this._n(0.08, 900, 1, 0.4); },
  pick() { this._t(660, 990, 0.12, 0.3); setTimeout(() => this._t(990, 1320, 0.14, 0.3), 90); },
  zone() { this._t(300, 280, 0.35, 0.25, 'sawtooth'); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._t(f, f, 0.3, 0.35, 'triangle'), i * 140)); },
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._t(f, f * 0.9, 0.4, 0.35, 'triangle'), i * 220)); },
};

/* ========================================================================== */
/*  RENDERER · SKY · LIGHT                                                    */
/* ========================================================================== */
const U = buildUI();
const MOBILE = TOUCH;
const renderer = new THREE.WebGLRenderer({ canvas: U.canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const HORIZON = new THREE.Color('#ffd3a1');
scene.fog = new THREE.FogExp2(HORIZON, 0.0072);
const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 700);
scene.add(camera);

const sun = new THREE.DirectionalLight('#ffe2b8', 2.6);
sun.castShadow = true; sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
const SC = sun.shadow.camera; SC.left = -46; SC.right = 46; SC.top = 46; SC.bottom = -46; SC.near = 1; SC.far = 220; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.42).normalize();
scene.add(new THREE.HemisphereLight('#9fc8ff', '#7a5a3a', 1.05));
scene.add(new THREE.AmbientLight('#ffffff', 0.18));

const clouds = [];
(function sky() {
  const g = new THREE.SphereGeometry(450, 24, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#2b5fd9') }, mid: { value: new THREE.Color('#8ec5ff') }, hor: { value: HORIZON }, sunDir: { value: SUN_DIR } },
    vertexShader: 'varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 v;uniform vec3 top,mid,hor,sunDir;void main(){float h=clamp(v.y,0.,1.);vec3 c=mix(hor,mid,smoothstep(0.,.28,h));c=mix(c,top,smoothstep(.25,.9,h));float s=max(dot(normalize(v),normalize(sunDir)),0.);c+=vec3(1.,.75,.45)*pow(s,24.)*.55+vec3(1.,.95,.8)*pow(s,500.)*2.5;gl_FragColor=vec4(c,1.);}',
  });
  const s = new THREE.Mesh(g, m); s.renderOrder = -10; scene.add(s); window.__sky = s;
  // soft clouds
  const ct = document.createElement('canvas'); ct.width = 256; ct.height = 128; const x = ct.getContext('2d');
  for (let i = 0; i < 26; i++) { const px = rnd(30, 226), py = rnd(40, 90), r = rnd(14, 34), gr = x.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(px - r, py - r, r * 2, r * 2); }
  const cm = new THREE.CanvasTexture(ct);
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(190, 95), new THREE.MeshBasicMaterial({ map: cm, transparent: true, depthWrite: false, fog: false, opacity: rnd(0.5, 0.9) }));
    const a = rnd(0, 6.28), rr = rnd(220, 330); p.position.set(Math.cos(a) * rr, rnd(120, 190), Math.sin(a) * rr); p.lookAt(0, 0, 0); p.userData.sp = rnd(0.2, 0.6); clouds.push(p); scene.add(p);
  }
})();

/* ========================================================================== */
/*  TEXTURES & MATERIALS                                                      */
/* ========================================================================== */
function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
const speck = (g, s, n, cols, a = 0.18, mx = 3) => { for (let i = 0; i < n; i++) { g.globalAlpha = rnd(a * 0.3, a); g.fillStyle = pick(cols); const w = rnd(1, mx); g.fillRect(rnd(0, s), rnd(0, s), w, w); } g.globalAlpha = 1; };
const TEX = {
  concrete: canvasTex(256, (g, s) => { g.fillStyle = '#d5cec3'; g.fillRect(0, 0, s, s); speck(g, s, 2600, ['#fff', '#8a8378', '#b8b0a2'], 0.22); g.strokeStyle = 'rgba(70,60,50,.35)'; g.lineWidth = 2; g.strokeRect(1, 1, s - 2, s - 2); }),
  brick: canvasTex(256, (g, s) => { g.fillStyle = '#9c5b45'; g.fillRect(0, 0, s, s); for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) { const o = r % 2 ? 32 : 0; g.fillStyle = pick(['#b0654c', '#a35a42', '#bd7058', '#955239']); g.fillRect(c * 64 + o + 2, r * 32 + 2, 60, 28); } speck(g, s, 1200, ['#000', '#fff'], 0.1); }),
  metal: canvasTex(128, (g, s) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#e8e8ec' : '#c9c9d2'; g.fillRect(i * 8, 0, 8, s); } g.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 16; i++) g.fillRect(i * 8 + 7, 0, 1, s); speck(g, s, 400, ['#000', '#fff'], 0.1); }),
  wood: canvasTex(256, (g, s) => { for (let i = 0; i < 6; i++) { g.fillStyle = pick(['#b58650', '#a97a45', '#be9360', '#9d7340']); g.fillRect(0, i * 43, s, 42); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, i * 43 + 41, s, 2); } speck(g, s, 900, ['#5a3b1a', '#e5c08a'], 0.2, 6); }),
  asphalt: canvasTex(256, (g, s) => { g.fillStyle = '#3c3f4a'; g.fillRect(0, 0, s, s); speck(g, s, 3200, ['#000', '#8a8fa0', '#555'], 0.28); }),
  grass: canvasTex(256, (g, s) => { g.fillStyle = '#5a9a3e'; g.fillRect(0, 0, s, s); speck(g, s, 3500, ['#3e7a2a', '#7bbd54', '#4a8a33', '#a8d46a'], 0.3, 4); }),
  roof: canvasTex(256, (g, s) => { g.fillStyle = '#5c5766'; g.fillRect(0, 0, s, s); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, s); g.stroke(); } speck(g, s, 900, ['#000', '#fff'], 0.1); }),
  tile: canvasTex(256, (g, s) => { for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { g.fillStyle = (r + c) % 2 ? '#c9c0b3' : '#d9d1c4'; g.fillRect(c * 64, r * 64, 64, 64); } g.strokeStyle = 'rgba(80,70,60,.4)'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, s); g.moveTo(0, i * 64); g.lineTo(s, i * 64); g.stroke(); } speck(g, s, 1200, ['#000', '#fff'], 0.08); }),
  stripe: canvasTex(128, (g, s) => { g.fillStyle = '#f6c200'; g.fillRect(0, 0, s, s); g.fillStyle = '#1b1b1f'; for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 32, s); g.lineTo(i * 32 + 16, s); g.lineTo(i * 32 + 16 + s, 0); g.lineTo(i * 32 + s, 0); g.fill(); } }),
};
const std = (map, o = {}) => new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.88, metalness: 0.04, ...o });
const MAT = {
  concrete: std(TEX.concrete), brick: std(TEX.brick), metal: std(TEX.metal, { roughness: 0.5, metalness: 0.45 }), wood: std(TEX.wood),
  asphalt: std(TEX.asphalt, { roughness: 0.95 }), roof: std(TEX.roof), tile: std(TEX.tile, { roughness: 0.7 }), stripe: std(TEX.stripe, { roughness: 0.6 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
  paint: std(null, { roughness: 0.8 }),
};
MAT.paint.map = null;

/* ========================================================================== */
/*  PHYSICS WORLD  (axis-aligned boxes in a spatial hash)                     */
/* ========================================================================== */
const COL = [], GRID = new Map(), CELL = 8; let _q = 0;
const gkey = (cx, cz) => (cx + 40) * 100 + (cz + 40);
function addCol(c) {
  COL.push(c);
  for (let cx = Math.floor(c.x0 / CELL); cx <= Math.floor(c.x1 / CELL); cx++) for (let cz = Math.floor(c.z0 / CELL); cz <= Math.floor(c.z1 / CELL); cz++) {
    const k = gkey(cx, cz); let a = GRID.get(k); if (!a) GRID.set(k, (a = [])); a.push(c);
  }
}
function nearCols(x0, z0, x1, z1) {
  _q++; const out = [];
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
    const a = GRID.get(gkey(cx, cz)); if (!a) continue;
    for (let i = 0; i < a.length; i++) { const c = a[i]; if (c.q !== _q) { c.q = _q; out.push(c); } }
  }
  return out;
}
function groundAt(x, z, y) {
  let g = 0; const cols = nearCols(x - 0.2, z - 0.2, x + 0.2, z + 0.2), lim = y + CFG.STEP + 0.001;
  for (let i = 0; i < cols.length; i++) { const c = cols[i]; if (c.y1 <= lim && c.y1 > g && x > c.x0 - 0.12 && x < c.x1 + 0.12 && z > c.z0 - 0.12 && z < c.z1 + 0.12) g = c.y1; }
  return g;
}
function collideAxis(b, axis, d) {
  const r = CFG.RADIUS, H = CFG.HEIGHT, cols = nearCols(b.x - r - 0.1, b.z - r - 0.1, b.x + r + 0.1, b.z + r + 0.1);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.y1 <= b.y + CFG.STEP || c.y0 >= b.y + H) continue;
    if (b.x > c.x0 - r && b.x < c.x1 + r && b.z > c.z0 - r && b.z < c.z1 + r) {
      if (axis === 0) { b.x = d > 0 ? c.x0 - r : d < 0 ? c.x1 + r : (b.x < (c.x0 + c.x1) / 2 ? c.x0 - r : c.x1 + r); b.vx = 0; b.hitWall = true; }
      else { b.z = d > 0 ? c.z0 - r : d < 0 ? c.z1 + r : (b.z < (c.z0 + c.z1) / 2 ? c.z0 - r : c.z1 + r); b.vz = 0; b.hitWall = true; }
    }
  }
}
function moveBody(b, dt) {
  const lim = CFG.HALF - 0.9; b.hitWall = false;
  let dx = b.vx * dt, dz = b.vz * dt; const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.22));
  dx /= n; dz /= n;
  for (let i = 0; i < n; i++) { b.x += dx; collideAxis(b, 0, dx); b.z += dz; collideAxis(b, 2, dz); }
  b.x = clamp(b.x, -lim, lim); b.z = clamp(b.z, -lim, lim);
  const was = b.grounded;
  b.vy -= CFG.GRAV * dt; const ny = b.y + b.vy * dt;
  if (b.vy > 0) { // head bump
    const cols = nearCols(b.x - 0.3, b.z - 0.3, b.x + 0.3, b.z + 0.3);
    for (const c of cols) if (c.y0 >= b.y + CFG.HEIGHT - 0.05 && c.y0 < ny + CFG.HEIGHT && b.x > c.x0 - 0.3 && b.x < c.x1 + 0.3 && b.z > c.z0 - 0.3 && b.z < c.z1 + 0.3) { b.vy = 0; break; }
  }
  b.y += b.vy * dt;
  const gy = groundAt(b.x, b.z, b.y - 0.02);
  if (b.y <= gy) { b.y = gy; if (b.vy < 0) b.vy = 0; b.grounded = true; }
  else if (was && b.vy <= 0 && b.y - gy <= CFG.STEP) { b.y = gy; b.vy = 0; b.grounded = true; }
  else b.grounded = false;
}
function rayBox(ox, oy, oz, dx, dy, dz, c, maxT) {
  let tmin = 0, tmax = maxT;
  const sl = (o, d, lo, hi) => { if (Math.abs(d) < 1e-9) return o >= lo && o <= hi; let t1 = (lo - o) / d, t2 = (hi - o) / d; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; return tmin <= tmax; };
  if (!sl(ox, dx, c.x0, c.x1) || !sl(oy, dy, c.y0, c.y1) || !sl(oz, dz, c.z0, c.z1)) return Infinity;
  return tmin;
}
function rayWorld(ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  for (let i = 0; i < COL.length; i++) { const t = rayBox(ox, oy, oz, dx, dy, dz, COL[i], best); if (t < best) best = t; }
  if (dy < 0) { const t = -oy / dy; if (t > 0 && t < best) best = t; }
  return best;
}
function isFree(x, z, m) {
  if (Math.abs(x) > CFG.HALF - 2 || Math.abs(z) > CFG.HALF - 2) return false;
  const cols = nearCols(x - m, z - m, x + m, z + m);
  for (const c of cols) if (c.y1 > 0.6 && c.y0 < 1.8 && x > c.x0 - m && x < c.x1 + m && z > c.z0 - m && z < c.z1 + m) return false;
  return true;
}
function freePoint(m = 1.2, minD = 0, avoid = []) {
  for (let i = 0; i < 120; i++) {
    const x = rnd(-CFG.HALF + 4, CFG.HALF - 4), z = rnd(-CFG.HALF + 4, CFG.HALF - 4);
    if (isFree(x, z, m) && avoid.every((p) => Math.hypot(p.x - x, p.z - z) >= minD)) return { x, z };
  }
  return { x: 0, z: 0 };
}

/* ========================================================================== */
/*  THE COMPOUND                                                              */
/* ========================================================================== */
const batches = {};
function boxGeo(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile); }
  return g;
}
function pushGeo(mat, g, color) {
  const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  (batches[mat] || (batches[mat] = [])).push(g);
}
/** solid box from corner to corner. col=false -> decoration only */
function B(x0, y0, z0, x1, y1, z1, mat, color = '#ffffff', col = true, tile = 3) {
  if (x1 - x0 < 0.001 || z1 - z0 < 0.001 || y1 - y0 < 0.001) return;
  const g = boxGeo(x1 - x0, y1 - y0, z1 - z0, tile); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); pushGeo(mat, g, color);
  if (col) addCol({ x0, y0, z0, x1, y1, z1, q: 0 });
}
function cylinder(x, z, r, h, mat, color, y0 = 0, col = true) {
  const g = new THREE.CylinderGeometry(r, r, h, 12); g.translate(x, y0 + h / 2, z); pushGeo(mat, g, color);
  if (col) addCol({ x0: x - r * 0.85, z0: z - r * 0.85, x1: x + r * 0.85, z1: z + r * 0.85, y0, y1: y0 + h, q: 0 });
}
/** stairs: dir 'x+','x-','z+','z-' = direction you walk UP. (x,z) = bottom-front corner of the first step */
function stairs(x, z, dir, n, rise, run, width, mat = 'concrete', color = '#cfc6b8') {
  const L = n * run;
  for (let i = 0; i < n; i++) {
    const h = (i + 1) * rise;
    if (dir === 'x+') B(x + i * run, 0, z, x + L, h, z + width, mat, color);
    else if (dir === 'x-') B(x - L, 0, z, x - i * run, h, z + width, mat, color);
    else if (dir === 'z+') B(x, 0, z + i * run, x + width, h, z + L, mat, color);
    else B(x, 0, z - L, x + width, h, z - i * run, mat, color);
  }
}
/** wall run along an axis with door / window openings. a..b along the axis, `at` = the fixed coordinate */
function wallRun(axis, at, a, b, t, h, mat, color, openings, y0 = 0) {
  const seg = (s, e, lo, hi) => { if (e - s < 0.01 || hi - lo < 0.01) return; if (axis === 'x') B(s, y0 + lo, at - t / 2, e, y0 + hi, at + t / 2, mat, color); else B(at - t / 2, y0 + lo, s, at + t / 2, y0 + hi, e, mat, color); };
  const ops = openings.map((o) => ({ s: o.c - o.w / 2, e: o.c + o.w / 2, t: o.t })).sort((p, q) => p.s - q.s);
  let cur = a;
  for (const o of ops) {
    seg(cur, o.s, 0, h);
    if (o.t === 'door') seg(o.s, o.e, 3.1, h); else { seg(o.s, o.e, 0, 1.05); seg(o.s, o.e, 2.25, h); }
    cur = o.e;
  }
  seg(cur, b, 0, h);
}
function autoOps(center, len, doors, step = 6.5) {
  const ops = doors.map((c) => ({ c: center + c, w: 3.6, t: 'door' })), n = Math.max(1, Math.floor((len - 3) / step));
  for (let i = 0; i < n; i++) { const c = center - len / 2 + (len / (n + 1)) * (i + 1); if (ops.every((o) => Math.abs(o.c - c) > 3.4)) ops.push({ c, w: 2.2, t: 'win' }); }
  return ops;
}
/** hollow building with floor, walls, roof. doors: {n:[offsets],s:[],e:[],w:[]} */
function building(cx, cz, w, d, h, doors, o = {}) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, t = 0.55, wm = o.wall || 'brick', wc = o.color || '#ffffff';
  B(x0, 0, z0, x1, 0.2, z1, o.floor || 'tile', '#ffffff', true, 4);
  wallRun('x', z1, x0, x1, t, h, wm, wc, autoOps(cx, w, doors.n || []));
  wallRun('x', z0, x0, x1, t, h, wm, wc, autoOps(cx, w, doors.s || []));
  wallRun('z', x1, z0, z1, t, h, wm, wc, autoOps(cz, d, doors.e || []));
  wallRun('z', x0, z0, z1, t, h, wm, wc, autoOps(cz, d, doors.w || []));
  // roof with overhang + parapet (walkable)
  B(x0 - 0.5, h - 0.45, z0 - 0.5, x1 + 0.5, h, z1 + 0.5, 'roof', o.roof || '#ffffff');
  const p = 0.9, pt = 0.35, rx0 = x0 - 0.5, rx1 = x1 + 0.5, rz0 = z0 - 0.5, rz1 = z1 + 0.5;
  B(rx0, h, rz0, rx1, h + p, rz0 + pt, 'concrete', '#e9e2d6'); B(rx0, h, rz1 - pt, rx1, h + p, rz1, 'concrete', '#e9e2d6');
  B(rx0, h, rz0 + pt, rx0 + pt, h + p, rz1 - pt, 'concrete', '#e9e2d6'); B(rx1 - pt, h, rz0 + pt, rx1, h + p, rz1 - pt, 'concrete', '#e9e2d6');
  // skylight / roof props
  B(cx - 1.5, h, cz - 1.5, cx + 1.5, h + 0.9, cz + 1.5, 'metal', '#9aa3b5');
  return { x0, x1, z0, z1 };
}
function crate(x, z, s = 1.2, stack = 1) { for (let i = 0; i < stack; i++) B(x - s / 2, i * s, z - s / 2, x + s / 2, (i + 1) * s, z + s / 2, 'wood', pick(['#ffffff', '#f2dcc0', '#e0c49a']), true, 1.2); }
function container(x, z, along, color) {
  const L = 6.2, W = 2.5, H = 2.6, hx = along === 'x' ? L / 2 : W / 2, hz = along === 'x' ? W / 2 : L / 2;
  B(x - hx, 0, z - hz, x + hx, H, z + hz, 'metal', color, true, 2.4);
  B(x - hx - 0.02, H - 0.08, z - hz - 0.02, x + hx + 0.02, H, z + hz + 0.02, 'concrete', '#555a66', false);
}
function car(x, z, along, color) {
  const L = 4.3, W = 1.9, hx = along === 'x' ? L / 2 : W / 2, hz = along === 'x' ? W / 2 : L / 2;
  B(x - hx, 0.25, z - hz, x + hx, 1.0, z + hz, 'metal', color, true, 2);
  const cx = along === 'x' ? 0.3 : 0, cz = along === 'x' ? 0 : 0.3, sx = along === 'x' ? 1.1 : 0.9, sz = along === 'x' ? 0.9 : 1.1;
  B(x + cx - sx, 1.0, z + cz - sz, x + cx + sx, 1.55, z + cz + sz, 'glow', '#223344', false);
  B(x + cx - sx - 0.05, 1.5, z + cz - sz - 0.05, x + cx + sx + 0.05, 1.6, z + cz + sz + 0.05, 'metal', color, false);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(x + (along === 'x' ? a * 1.4 : b * 0.85) - 0.3, 0, z + (along === 'x' ? b * 0.85 : a * 1.4) - 0.3, x + (along === 'x' ? a * 1.4 : b * 0.85) + 0.3, 0.45, z + (along === 'x' ? b * 0.85 : a * 1.4) + 0.3, 'concrete', '#222', false);
}
function barrel(x, z, color) { cylinder(x, z, 0.42, 1.1, 'metal', color); }
function lamp(x, z) { B(x - 0.08, 0, z - 0.08, x + 0.08, 5.2, z + 0.08, 'metal', '#454b57', false); B(x - 0.5, 5.1, z - 0.18, x + 0.5, 5.25, z + 0.18, 'metal', '#454b57', false); B(x - 0.4, 5.02, z - 0.13, x + 0.4, 5.1, z + 0.13, 'glow', '#fff1b8', false); addCol({ x0: x - 0.1, z0: z - 0.1, x1: x + 0.1, z1: z + 0.1, y0: 0, y1: 5.2, q: 0 }); }
function sandbags(x0, z0, x1, z1) { B(x0, 0, z0, x1, 1.05, z1, 'wood', '#c7b07a', true, 1.1); B(x0 + 0.1, 1.05, z0 + 0.1, x1 - 0.1, 1.3, z1 - 0.1, 'wood', '#b9a26c', false, 1.1); }
function barrier(x, z, along) { const a = along === 'x'; B(x - (a ? 1.4 : 0.35), 0, z - (a ? 0.35 : 1.4), x + (a ? 1.4 : 0.35), 1.0, z + (a ? 0.35 : 1.4), 'stripe', '#ffffff', true, 1.4); }

const WORLD = { spawns: [], loot: [], trees: [], towers: [] };
function buildWorld() {
  const H = CFG.HALF;
  // ground
  const out = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ map: TEX.grass.clone(), roughness: 1, color: '#9fd27e' }));
  out.material.map.repeat.set(140, 140); out.material.map.needsUpdate = true; out.rotation.x = -Math.PI / 2; out.position.y = -0.06; out.receiveShadow = true; scene.add(out);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), new THREE.MeshStandardMaterial({ map: TEX.concrete.clone(), roughness: 0.95, color: '#d6cdbd' }));
  floor.material.map.repeat.set(H / 2.2, H / 2.2); floor.material.map.needsUpdate = true; floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // grass patches & asphalt roads (decor)
  for (let i = 0; i < 22; i++) { const x = rnd(-52, 52), z = rnd(-52, 52), s = rnd(5, 12); if (Math.abs(x) < 7 || Math.abs(z) < 7) continue; B(x - s / 2, 0, z - s / 2, x + s / 2, 0.03, z + s / 2, 'concrete', '#9bc27a', false, 20); }
  B(-H, 0, -4.2, H, 0.04, 4.2, 'asphalt', '#ffffff', false, 6); B(-4.2, 0, -H, 4.2, 0.04, H, 'asphalt', '#ffffff', false, 6);
  for (let i = -H + 3; i < H - 3; i += 5) { if (Math.abs(i) < 6) continue; B(i - 1, 0.04, -0.12, i + 1, 0.06, 0.12, 'concrete', '#f3f0e6', false, 4); B(-0.12, 0.04, i - 1, 0.12, 0.06, i + 1, 'concrete', '#f3f0e6', false, 4); }
  // plaza + fountain
  B(-11, 0, -11, 11, 0.12, 11, 'tile', '#ffffff', true, 3.5);
  B(-3.3, 0.12, -3.3, 3.3, 1.0, 3.3, 'concrete', '#bfb6a6'); B(-2.7, 1.0, -2.7, 2.7, 1.12, 2.7, 'glow', '#4fd0e8', false); B(-0.6, 1.0, -0.6, 0.6, 3.0, 0.6, 'concrete', '#d9d0c2'); B(-1.1, 3.0, -1.1, 1.1, 3.25, 1.1, 'concrete', '#e8dfd0');
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { sandbags(sx * 8 - 2.4, sz * 8 - 0.4, sx * 8 + 2.4, sz * 8 + 0.4); }
  // outer wall + gate + corner towers
  const wt = 1.7;
  B(-H - wt, 0, H, H + wt, 7.2, H + wt, 'brick', '#e8d7cd'); B(-H - wt, 0, -H - wt, H + wt, 7.2, -H, 'brick', '#e8d7cd');
  B(H, 0, -H, H + wt, 7.2, H, 'brick', '#e8d7cd'); B(-H - wt, 0, -H, -H, 7.2, H, 'brick', '#e8d7cd');
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const cx = sx * (H - 1), cz = sz * (H - 1);
    B(cx - 4.2, 0, cz - 4.2, cx + 4.2, 12, cz + 4.2, 'concrete', '#bdb4a6'); B(cx - 4.8, 12, cz - 4.8, cx + 4.8, 12.6, cz + 4.8, 'roof', '#ffffff', false); B(cx - 0.3, 12.6, cz - 0.3, cx + 0.3, 15, cz + 0.3, 'metal', '#8b93a3', false); B(cx - 0.6, 14.4, cz - 0.6, cx + 0.6, 15.2, cz + 0.6, 'glow', '#ff4d6d', false);
  }
  B(-6, 0, -H + 0.01, 6, 5.4, -H + 0.7, 'metal', '#5b6577', false, 2); B(-6.5, 0, -H - 0.1, -5.6, 6.4, -H + 1.0, 'concrete', '#c9c0b2', false); B(5.6, 0, -H - 0.1, 6.5, 6.4, -H + 1.0, 'concrete', '#c9c0b2', false); B(-6.5, 5.4, -H - 0.1, 6.5, 6.4, -H + 1.0, 'concrete', '#c9c0b2', false);
  for (let x = -H; x < H; x += 6) { B(x, 7.2, H, x + 3, 8.0, H + wt, 'brick', '#d9c5b8', false); B(x, 7.2, -H - wt, x + 3, 8.0, -H, 'brick', '#d9c5b8', false); }

  // ----- buildings -----
  building(-32, 34, 22, 16, 5.0, { s: [0], e: [-3], w: [3] }, { color: '#f0d6c8' });                    // HQ (roof via stairs)
  stairs(-52.6, 33, 'x+', 13, 0.385, 0.7, 2.2);
  building(30, 36, 26, 12, 4.6, { s: [-6, 6], w: [0] }, { color: '#dccaf0', wall: 'concrete' });         // Barracks
  stairs(20, 51.6, 'z-', 12, 0.383, 0.7, 2.2);
  building(-34, -34, 28, 18, 6.6, { n: [-8, 8], e: [0] }, { color: '#cbd5e8', wall: 'concrete', floor: 'concrete' }); // Warehouse
  building(32, -32, 20, 14, 4.4, { n: [-4], w: [0], e: [3] }, { color: '#f3e3b8', wall: 'brick' });       // Garage
  // interior dressing
  B(-36, 0.2, 40.5, -22.5, 3.2, 41.1, 'concrete', '#d9d0c2'); B(-27, 0.2, 29, -26.4, 3.2, 36, 'brick', '#e8d7cd'); crate(-38, 38); crate(-37.2, 30, 1.3); barrel(-24, 38, '#d24a3a'); barrel(-23.2, 37.2, '#d24a3a');
  B(22, 0.2, 38, 38, 1.0, 39, 'wood', '#9aa3b5', true, 2); B(22, 0.2, 34, 38, 1.0, 35, 'wood', '#9aa3b5', true, 2); crate(40, 33.6); crate(18.6, 40);
  for (let i = 0; i < 4; i++) B(-44 + i * 6.4, 0.2, -38.5, -41 + i * 6.4, 2.6, -37.7, 'metal', '#7a8aa8', true, 2); crate(-26, -29, 1.4, 2); crate(-46, -29); barrel(-28, -40, '#2b7a78');
  car(32, -33, 'x', '#d94c4c'); B(23, 0.2, -38.4, 29, 1.1, -37.2, 'wood', '#a58a68', true, 2); crate(40, -36);
  // sniper towers (stairs up, open platform + cover)
  for (const [tx, tz, dir, sx] of [[47, 6, 'x+', 1], [-47, -6, 'x-', -1]]) {
    const px0 = tx - 3.2, px1 = tx + 3.2, pz0 = tz - 3.2, pz1 = tz + 3.2;
    for (const [ax, az] of [[px0, pz0], [px1 - 0.9, pz0], [px0, pz1 - 0.9], [px1 - 0.9, pz1 - 0.9]]) B(ax, 0, az, ax + 0.9, 6, az + 0.9, 'concrete', '#bfb6a6');
    B(px0, 5.55, pz0, px1, 6, pz1, 'roof', '#ffffff');
    B(px0, 6, pz0, px1, 7.0, pz0 + 0.3, 'wood', '#a58a68', true, 1.2); B(px0, 6, pz1 - 0.3, px1, 7.0, pz1, 'wood', '#a58a68', true, 1.2);
    B(sx > 0 ? px1 - 0.3 : px0, 6, pz0, sx > 0 ? px1 : px0 + 0.3, 7.0, pz1, 'wood', '#a58a68', true, 1.2);
    B(tx - 1.2, 6, tz - 1.2, tx + 1.2, 7.7, tz + 1.2, 'wood', '#8d6b44', false); B(tx - 1.4, 7.7, tz - 1.4, tx + 1.4, 7.9, tz + 1.4, 'roof', '#ffffff', false);
    if (sx > 0) stairs(px0 - 0.1, tz - 1.1, 'x+', 14, 0.4, 0.7, 2.2); else stairs(px1 + 0.1, tz - 1.1, 'x-', 14, 0.4, 0.7, 2.2);
    WORLD.towers.push({ x: tx, z: tz });
  }
  // container yards (walk up the stairs, run across the roofs)
  const CC = ['#d94c4c', '#3a78d9', '#2fae6a', '#e89a2e', '#e8c42e', '#8d96a8', '#8a5bd9'];
  container(-20, 16, 'x', CC[0]); container(-13.6, 16, 'x', CC[1]); container(-20, 19.2, 'x', CC[2]); stairs(-27.5, 15.2, 'x+', 7, 0.371, 0.7, 2, 'metal', '#8d96a8');
  container(14, -8, 'z', CC[3]); container(14, -14.4, 'z', CC[4]); container(17.4, -8, 'z', CC[5]); stairs(13, -21.6, 'z+', 7, 0.371, 0.7, 2, 'metal', '#8d96a8');
  container(-28, 2, 'z', CC[6]); container(-28, 9, 'z', CC[0]); container(26, 14, 'x', CC[1]); container(26, 17.2, 'x', CC[3]); container(-12, -20, 'x', CC[2]); container(-12, -23.2, 'x', CC[4]);
  container(48, -22, 'z', CC[5]); container(-48, 22, 'z', CC[1]);
  // low cover & dressing
  for (const [x, z, a, c] of [[-8, -12, 'x', '#6a7288'], [8, 22, 'x', '#c74b4b'], [-14, 28, 'x', '#d8b04a'], [40, -8, 'x', '#5a9ae0'], [-42, 10, 'x', '#c74b4b']]) car(x, z, a, c);
  for (let i = 0; i < 14; i++) { const p = freePoint(2.2); barrier(p.x, p.z, R() > 0.5 ? 'x' : 'z'); }
  for (let i = 0; i < 34; i++) { const p = freePoint(1.5); crate(p.x, p.z, rnd(1, 1.4), R() > 0.78 ? 2 : 1); }
  for (let i = 0; i < 26; i++) { const p = freePoint(1.2); barrel(p.x, p.z, pick(['#d24a3a', '#2b7a78', '#d6a020', '#4c5aa8'])); }
  for (const [x, z] of [[-18, 6], [18, -6], [-18, -6], [18, 6], [-40, 0], [40, 0], [0, 28], [0, -28], [0, 48], [0, -48], [-48, 48], [48, -48]]) lamp(x, z);
  // trees (instanced) around the walls
  for (let tries = 0; WORLD.trees.length < 34 && tries < 400; tries++) { const p = freePoint(2.2); if (Math.abs(p.x) < 28 && Math.abs(p.z) < 28) continue; WORLD.trees.push({ x: p.x, z: p.z, s: rnd(0.85, 1.5) }); B(p.x - 0.3, 0, p.z - 0.3, p.x + 0.3, 3, p.z + 0.3, 'wood', '#6b4a2a', true, 1); }
  // flush merged batches
  for (const k of Object.keys(batches)) {
    const g = mergeGeometries(batches[k], false); const m = new THREE.Mesh(g, MAT[k]); m.castShadow = k !== 'glow'; m.receiveShadow = true; scene.add(m);
    batches[k].forEach((x) => x.dispose());
  }
  if (WORLD.trees.length) {
    const tg = new THREE.IcosahedronGeometry(1, 0), tm = new THREE.MeshStandardMaterial({ color: '#4f9a3c', roughness: 1, flatShading: true }), gm = new THREE.InstancedMesh(tg, tm, WORLD.trees.length * 2), dm = new THREE.Object3D(), tc = new THREE.Color();
    WORLD.trees.forEach((t, i) => { for (let k = 0; k < 2; k++) { dm.position.set(t.x, 3.4 + k * 1.5, t.z); const s = t.s * (k ? 1.4 : 2.1); dm.scale.set(s, s * 0.9, s); dm.rotation.y = i + k; dm.updateMatrix(); gm.setMatrixAt(i * 2 + k, dm.matrix); gm.setColorAt(i * 2 + k, tc.set(k ? '#5fb04a' : '#3f8c34')); } });
    gm.castShadow = true; gm.receiveShadow = true; scene.add(gm);
  }
  // distant hills
  const hm = new THREE.MeshStandardMaterial({ color: '#6a9a58', roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) { const a = (i / 26) * 6.283, r = rnd(150, 210), s = rnd(25, 60), m = new THREE.Mesh(new THREE.ConeGeometry(s, s * rnd(0.6, 1.1), 7), hm); m.position.set(Math.cos(a) * r, s * 0.25 - 2, Math.sin(a) * r); m.rotation.y = rnd(0, 6); scene.add(m); }
  // spawn points & loot
  for (let i = 0; i < 24; i++) WORLD.spawns.push(freePoint(1.4, 15, WORLD.spawns));
  const kinds = ['med', 'armor', 'ammo', 'ammo', 'med', 'armor'];
  for (let i = 0; i < 30; i++) { const p = freePoint(1.0, 7, WORLD.loot); WORLD.loot.push({ x: p.x, z: p.z, k: kinds[i % kinds.length] }); }
  // minimap backdrop
  const mm = document.createElement('canvas'); mm.width = mm.height = 248; const g = mm.getContext('2d');
  g.fillStyle = '#1e2a3a'; g.fillRect(0, 0, 248, 248); g.save(); g.scale(2, 2); g.translate(62, 62);
  g.fillStyle = '#2c3e55'; g.fillRect(-H, -H, H * 2, H * 2); g.fillStyle = '#34465e'; g.fillRect(-H, -4, H * 2, 8); g.fillRect(-4, -H, 8, H * 2);
  for (const c of COL) { if (c.y1 < 1.4 && c.y1 > 0.5) { g.fillStyle = '#4d6180'; } else if (c.y1 >= 1.4) { g.fillStyle = c.y1 > 6.5 ? '#9fb0cc' : '#7d90b0'; } else continue; g.fillRect(c.x0, -c.z1, c.x1 - c.x0, c.z1 - c.z0); }
  g.restore(); WORLD.mini = mm;
}

/* ========================================================================== */
/*  ANIMATION RIG — layered blending of all 24 Soldier.glb clips              */
/*                                                                            */
/*   lower body : Idle / Walk/Run/Run_Back/Run_Left/Run_Right blend tree       */
/*   upper body : weapon hold · aim · sprint arms · shoot recoil · melee ·    */
/*                reload (Interact) · flinch (HitRecieve / _2)                */
/*   full body  : Roll · Kick · Interact (loot) · Wave · Death                */
/*  Every bone always receives weights that add up to 1, so nothing T-poses.  */
/* ========================================================================== */
const LOCO = new Set(['walk', 'run', 'run_back', 'run_left', 'run_right']);
class Rig {
  constructor(model, clips, onStep) {
    this.model = model; this.mixer = new THREE.AnimationMixer(model); this.onStep = onStep;
    this.src = {}; clips.forEach((c) => { this.src[c.name.toLowerCase()] = c; });
    this.cache = {}; this.acts = {}; this.list = [];
    // find the bone that starts the upper body (Abdomen / Spine / Torso …) and collect its children
    const bones = []; model.traverse((o) => { if (o.isBone) bones.push(o); });
    let up = null, best = 1e9;
    for (const b of bones) if (/abdomen|spine|torso|chest/i.test(b.name)) { let d = 0, p = b; while (p.parent) { p = p.parent; d++; } if (d < best) { best = d; up = b; } }
    this.upper = new Set(); if (up) up.traverse((o) => { if (o.isBone) this.upper.add(THREE.PropertyBinding.sanitizeNodeName(o.name)); });
    this.split = this.upper.size > 0;
    const rootB = bones.find((b) => !(b.parent && b.parent.isBone)); this.rootName = rootB ? THREE.PropertyBinding.sanitizeNodeName(rootB.name) : 'Hips';
    // rest pose of every bone: bones may never change length or scale (stops stretched legs)
    this.rest = bones.map((b) => ({ b, p: b.position.clone(), s: b.scale.clone(), root: b === rootB }));
    const rp = rootB ? rootB.position : { x: 0, y: 1, z: 0 }; this.vAxis = Math.abs(rp.x) > Math.abs(rp.y) && Math.abs(rp.x) > Math.abs(rp.z) ? 'x' : Math.abs(rp.z) > Math.abs(rp.y) ? 'z' : 'y';
    this.clock = Math.random() * 3; this.phase = Math.random(); this.w = { idle: 1, F: 1, B: 0, L: 0, R: 0, k: 0, sp: 0, aim: 0, S: 0 };
    this.full = null; this.over = null; this.shootT = 9; this.shootHold = 0; this.shootName = 'Idle_Gun_Shoot'; this.dead = false;
  }
  has(name) { return !!this.src[name.toLowerCase()]; }
  dur(name) { const c = this.src[name.toLowerCase()]; return c ? c.duration : 0.8; }
  clip(name, part) {
    if (!this.split) { if (part === 'up') return null; part = 'full'; }
    const key = name.toLowerCase() + '|' + part; if (key in this.cache) return this.cache[key];
    const src = this.src[name.toLowerCase()]; if (!src) return (this.cache[key] = null);
    const tracks = [];
    for (const t of src.tracks) {
      const node = THREE.PropertyBinding.parseTrackName(t.name).nodeName, isUp = this.upper.has(node);
      if (part === 'lo' && isUp) continue; if (part === 'up' && !isUp) continue;
      const tr = t.clone();
      if (t.name.endsWith('.position')) { if (node !== this.rootName) continue; const v = tr.values; for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; } } // keep hip bounce, drop root drift
      if (t.name.endsWith('.scale')) continue;
      tracks.push(tr);
    }
    return (this.cache[key] = tracks.length ? new THREE.AnimationClip(name + '_' + part, src.duration, tracks) : null);
  }
  act(name, part) {
    const k = name.toLowerCase() + '|' + part; if (k in this.acts) return this.acts[k];
    const c = this.clip(name, part); if (!c) return (this.acts[k] = null);
    const a = this.mixer.clipAction(c); a.setEffectiveTimeScale(0); a.setEffectiveWeight(0); a.play(); this.list.push(a); return (this.acts[k] = a);
  }
  playFull(name, o = {}) {
    if (this.dead) return 0; const a = this.act(name, 'full'); if (!a) return 0;
    const cd = a.getClip().duration, d = o.dur || cd / (o.speed || 1);
    this.full = { a, t: 0, d, sp: cd / d, fin: o.fin ?? 0.07, fout: o.fout ?? 0.14, hold: !!o.hold }; if (o.hold) this.dead = true; return d;
  }
  playOver(name, o = {}) {
    if (this.dead) return 0;
    if (!this.split) return this.playFull(name, o);
    if (this.over && (o.prio || 1) < this.over.prio && this.over.t < this.over.d) return 0;
    const a = this.act(name, 'up'); if (!a) return 0; const cd = a.getClip().duration, d = o.dur || cd / (o.speed || 1);
    this.over = { name, t: 0, d, sp: cd / d, fin: o.fin ?? 0.05, fout: o.fout ?? 0.12, prio: o.prio || 1 }; return d;
  }
  fire(aim, moving) {
    this.shootName = aim ? 'Gun_Shoot' : moving ? 'Run_Shoot' : 'Idle_Gun_Shoot'; this.shootT = 0; this.shootHold = 0.16;
  }
  update(dt, p) {
    const w = this.w; this.clock += dt;
    const m = clamp(p.speed / CFG.RUN, 0, 1.5);
    // --- direction weights (4-way strafe blend) ---
    if (m > 0.08) {
      const ax = Math.abs(p.rgt), az = Math.abs(p.fwd), s = ax + az + 1e-5;
      w.F = damp(w.F, p.fwd > 0 ? az / s : 0, 12, dt); w.B = damp(w.B, p.fwd < 0 ? az / s : 0, 12, dt);
      w.R = damp(w.R, p.rgt > 0 ? ax / s : 0, 12, dt); w.L = damp(w.L, p.rgt < 0 ? ax / s : 0, 12, dt);
    }
    w.idle = damp(w.idle, 1 - smooth(0.03, 0.2, m), 13, dt); w.k = damp(w.k, smooth(0.34, 0.66, m), 10, dt);
    const dsum = w.F + w.B + w.L + w.R || 1, mv = 1 - w.idle;
    const loco = [['Walk', mv * (w.F / dsum) * (1 - w.k)], ['Run', mv * (w.F / dsum) * w.k], ['Run_Back', mv * w.B / dsum], ['Run_Left', mv * w.L / dsum], ['Run_Right', mv * w.R / dsum]];
    // --- phase (foot cycle) ---
    const hz = p.air ? 0.3 : clamp(p.speed / 5, 0, 2.5), p0 = this.phase; this.phase = (this.phase + hz * dt) % 1;
    if (!p.air && m > 0.2 && ((p0 < 0.25 && this.phase >= 0.25) || (p0 < 0.75 && this.phase >= 0.75) || p0 > this.phase)) this.onStep && this.onStep(m);
    // --- envelopes ---
    let Fw = 0, Ow = 0;
    if (this.full) {
      const f = this.full; f.t += dt; let e = clamp(f.t / f.fin, 0, 1); if (!f.hold) e = Math.min(e, clamp((f.d - f.t) / f.fout, 0, 1));
      Fw = e; if (!f.hold && f.t >= f.d) { this.full = null; Fw = 0; } else f.a.time = Math.min(f.t * f.sp, f.a.getClip().duration - 1e-3);
    }
    if (this.over) {
      const o = this.over; o.t += dt; let e = Math.min(clamp(o.t / o.fin, 0, 1), clamp((o.d - o.t) / o.fout, 0, 1)); Ow = e; if (o.t >= o.d) { this.over = null; Ow = 0; }
    }
    this.shootHold -= dt; this.shootT += dt; w.S = damp(w.S, this.shootHold > 0 ? 1 : 0, 26, dt);
    const K = 1 - Fw;
    // --- reset all, then assign ---
    for (const a of this.list) a.setEffectiveWeight(0);
    const set = (name, part, wt, time) => { if (wt <= 0.0005) return null; const a = this.act(name, part); if (!a) return null; a.setEffectiveWeight(a.getEffectiveWeight() + wt); a.time = time; return a; };
    const tm = (name) => (LOCO.has(name.toLowerCase()) ? this.phase : (this.clock / this.dur(name)) % 1) * this.dur(name);
    const apply = (entries, part, target) => {
      const used = []; let sum = 0;
      for (const [n, wt] of entries) { if (wt <= 0.0005) continue; const a = this.act(n, part); if (a) { used.push([n, wt, a]); sum += wt; } }
      if (!used.length || target <= 0.0005) return;
      for (const [n, wt, a] of used) { const ww = wt / sum * target; a.setEffectiveWeight(a.getEffectiveWeight() + ww); a.time = tm(n) % Math.max(a.getClip().duration - 1e-3, 1e-3); }
    };
    // lower body
    const lowIdle = p.stance === 'sword' ? 'Idle_Sword' : p.stance === 'relaxed' ? 'Idle' : 'Idle_Gun';
    const lower = [[lowIdle, w.idle], ...loco];
    apply(lower, this.split ? 'lo' : 'full', K);
    // upper body
    if (this.split) {
      const sprinting = p.sprint && !p.aim ? 1 : 0; w.sp = damp(w.sp, sprinting * 0.75, 9, dt); w.aim = damp(w.aim, p.aim ? 1 : 0, 12, dt);
      let ups = [];
      if (p.stance === 'rifle') { ups = [['Idle_Gun', (1 - w.sp) * (1 - w.aim)], ['Idle_Gun_Pointing', (1 - w.sp) * w.aim]]; }
      else if (p.stance === 'sword') { ups = [['Idle_Sword', 1 - w.sp]]; }
      else { ups = [['Idle_Neutral', (1 - w.sp)]]; }
      const locoUp = [['Idle_Neutral', w.idle * w.sp], ...loco.map(([n, x]) => [n, x * w.sp])];
      // relaxed stance: arms swing naturally, so full loco on top (idle handled by Idle_Neutral above)
      let base = [...ups.map(([n, x]) => [n, x * (1 - w.S)]), ...locoUp.map(([n, x]) => [n, x * (1 - w.S)])];
      if (w.S > 0.002 && p.stance === 'rifle') base.push([this.shootName, w.S]);
      else if (w.S > 0.002) base = base.map(([n, x]) => [n, x / (1 - w.S + 1e-5) * (1 - w.S) ]);
      const tail = Ow;
      base = base.map(([n, x]) => [n, x * (1 - tail)]);
      if (this.over && tail > 0.002) base.push([this.over.name, tail]);
      // shoot / over actions have their own clocks
      const sumB = base.reduce((s, [n, x]) => { const a = this.act(n, 'up'); return s + (a && x > 0.0005 ? x : 0); }, 0);
      if (sumB > 0.0005) for (const [n, x] of base) {
        if (x <= 0.0005) continue; const a = this.act(n, 'up'); if (!a) continue; const ww = x / sumB * K; a.setEffectiveWeight(a.getEffectiveWeight() + ww);
        const dd = Math.max(a.getClip().duration - 1e-3, 1e-3);
        if (n === this.shootName) a.time = Math.min(this.shootT * 1.8, dd);
        else if (this.over && n === this.over.name) a.time = Math.min(this.over.t * this.over.sp, dd);
        else a.time = tm(n) % dd;
      }
    }
    if (this.full && Fw > 0.001) { this.full.a.setEffectiveWeight(this.full.a.getEffectiveWeight() + Fw); }
    this.mixer.update(0);
    for (const r of this.rest) {
      r.b.scale.copy(r.s);
      if (!r.root) r.b.position.copy(r.p);
      else { const v = r.b.position[this.vAxis], lo = r.p[this.vAxis] * 0.12, hi = r.p[this.vAxis] * 1.25; r.b.position.copy(r.p); r.b.position[this.vAxis] = clamp(v, Math.min(lo, hi), Math.max(lo, hi)); }
    }
  }
  get busy() { return !!this.full; }
}

/* fallback when Soldier.glb is missing: blocky soldier + simple procedural moves */
class FakeRig {
  constructor(parts) { this.p = parts; this.t = 0; this.dead = false; this.fall = 0; this.over = 0; this.full = null; this.split = false; }
  has() { return true; } dur() { return 0.7; }
  playFull(name, o = {}) { if (this.dead) return 0; if (o.hold) { this.dead = true; return 1; } this.full = { n: name, t: 0, d: o.dur || 0.7 }; return this.full.d; }
  playOver(name, o = {}) { this.over = o.dur || 0.3; return this.over; }
  fire() { this.kick = 0.08; }
  update(dt, p) {
    this.t += dt * clamp(p.speed / 2.2, 0, 7); const s = Math.sin(this.t) * clamp(p.speed / 8, 0, 1) * 0.9;
    this.p.legL.rotation.x = s; this.p.legR.rotation.x = -s; this.p.armL.rotation.x = -s * 0.5;
    this.p.armR.rotation.x = -1.2 + (this.kick > 0 ? 0.25 : 0); this.kick = (this.kick || 0) - dt;
    if (this.over > 0) { this.over -= dt; this.p.armR.rotation.x = -2.2 * Math.sin((1 - this.over / 0.3) * 3.14); }
    if (this.full) { this.full.t += dt; this.p.root.rotation.x = this.full.n === 'Roll' ? this.full.t * 11 : 0; if (this.full.t > this.full.d) { this.full = null; this.p.root.rotation.x = 0; } }
    this.fall = this.dead ? Math.min(1.5, this.fall + dt * 4) : 0; this.p.root.rotation.z = this.fall;
    this.p.root.position.y = Math.abs(Math.sin(this.t)) * 0.06 * clamp(p.speed / 8, 0, 1);
  }
  get busy() { return !!this.full; }
}

/* ========================================================================== */
/*  MODELS                                                                    */
/* ========================================================================== */
const ASSETS = { soldier: null, rifle: null };
const findBone = (root, re) => { let f = null; root.traverse((o) => { if (!f && o.isBone && re.test(o.name)) f = o; }); return f; };
function makeSword(len) {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, len, 0.018), new THREE.MeshStandardMaterial({ color: '#e8eefc', metalness: 0.9, roughness: 0.25, emissive: '#3a4a7a', emissiveIntensity: 0.4 })); blade.position.y = len / 2 + 0.16;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.06), new THREE.MeshStandardMaterial({ color: '#d9b34a', metalness: 0.8, roughness: 0.3 })); guard.position.y = 0.14;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.28, 8), new THREE.MeshStandardMaterial({ color: '#3b2a1a' })); grip.position.y = 0;
  g.add(blade, guard, grip); g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g;
}
function makeProcSoldier(tint) {
  const root = new THREE.Group(), mk = (w, h, d, c, y, x = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })); m.position.set(x, y, 0); m.castShadow = true; return m; };
  const col = tint ? tint.getStyle() : '#4a6b3a';
  const pivot = (x, y) => { const g = new THREE.Group(); g.position.set(x, y, 0); root.add(g); return g; };
  const legL = pivot(-0.14, 0.9), legR = pivot(0.14, 0.9), armL = pivot(-0.38, 1.5), armR = pivot(0.38, 1.5);
  legL.add(mk(0.2, 0.9, 0.22, '#2b3340', -0.45)); legR.add(mk(0.2, 0.9, 0.22, '#2b3340', -0.45)); armL.add(mk(0.16, 0.6, 0.16, col, -0.28)); armR.add(mk(0.16, 0.6, 0.16, col, -0.28));
  root.add(mk(0.5, 0.65, 0.3, col, 1.25), mk(0.26, 0.26, 0.26, '#e2b48a', 1.78), mk(0.3, 0.14, 0.3, '#2a3a24', 1.95));
  return { root, legL, legR, armL, armR };
}
function makeModel(tint, onStep) {
  const group = new THREE.Group(), pivot = new THREE.Group(); pivot.rotation.y = CFG.MODEL_YAW; group.add(pivot);
  const out = { group, pivot, rig: null, muzzle: null, rifle: null, sword: null };
  if (ASSETS.soldier) {
    const model = skClone(ASSETS.soldier.scene);
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        if (tint) { const ms = (Array.isArray(o.material) ? o.material : [o.material]).map((mt) => { const c = mt.clone(); if (c.color) c.color.lerp(tint, 0.42); return c; }); o.material = Array.isArray(o.material) ? ms : ms[0]; }
      }
    });
    pivot.add(model); group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model), hgt = Math.max(0.1, box.max.y - box.min.y), s = CFG.BODY_H / hgt;
    model.position.y = -box.min.y; pivot.scale.setScalar(s); group.updateMatrixWorld(true);
    out.rig = new Rig(model, ASSETS.soldier.animations, onStep);
    const bone = findBone(model, /^wrist.?r$/i) || findBone(model, /wrist.?r|hand.?r|right.?hand|palm.?r/i);
    var swAxis = null;
    if (bone) {
      const ws = new THREE.Vector3(); bone.getWorldScale(ws); const sc = 1 / Math.max(ws.x, 1e-4);
      // The rifle is NOT glued to the wrist bone (its orientation is unknown and floated / pointed down).
      // It lives in world space: grip at the right hand, barrel along the aim direction (see placeRifle).
      const root = new THREE.Group(); let r, mz = new THREE.Object3D(), ai = 'z', sign = 1, upV = new THREE.Vector3(0, 1, 0);
      if (ASSETS.rifle) {
        r = ASSETS.rifle.scene.clone(true); r.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        const rb = new THREE.Box3().setFromObject(r), sz = rb.getSize(new THREE.Vector3()), ctr = rb.getCenter(new THREE.Vector3()), mx = Math.max(sz.x, sz.y, sz.z), s = CFG.RIFLE_LEN / mx;
        ai = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.y >= sz.z ? 'y' : 'z'; sign = Math.abs(rb.max[ai]) >= Math.abs(rb.min[ai]) ? 1 : -1; if (qs.get('rflip')) sign = -sign;
        const dims = ['x', 'y', 'z'].filter((k) => k !== ai).sort((a, b) => sz[b] - sz[a]); upV = new THREE.Vector3(); upV[dims[0]] = 1; // taller of the two short axes = "up" (sights / magazine)
        const back = sign > 0 ? rb.min[ai] : rb.max[ai], front = sign > 0 ? rb.max[ai] : rb.min[ai], grip = ctr.clone(); grip[ai] = back + (front - back) * CFG.GRIP;
        const tip = ctr.clone(); tip[ai] = front; mz.position.copy(tip); r.add(mz); r.scale.setScalar(s); r.position.copy(grip).multiplyScalar(-s); root.add(r);
      } else {
        r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.9), new THREE.MeshStandardMaterial({ color: '#2a2f38', metalness: 0.6, roughness: 0.4 })); r.castShadow = true; r.position.z = 0.25; mz.position.set(0, 0, 0.45); r.add(mz); root.add(r);
      }
      const axis = new THREE.Vector3(); axis[ai] = ASSETS.rifle ? sign : 1; scene.add(root);
      out.rifle = root; out.muzzle = mz; out.world = true; out.hand = bone; out.axis = axis; out.up = upV;
      const axisS = axis.clone();
      axis.copy(axisS);
      var swAxis = axisS;
      const sw = makeSword(0.95); sw.scale.setScalar(sc); sw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), swAxis || new THREE.Vector3(0, 1, 0)); sw.position.set(0, 0.05, 0.05); bone.add(sw); sw.visible = false; out.sword = sw;
    }
  } else {
    const p = makeProcSoldier(tint); pivot.add(p.root); out.rig = new FakeRig(p);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.85), new THREE.MeshStandardMaterial({ color: '#222' })); r.position.set(0.38, 1.2, 0.4); p.root.add(r); out.rifle = r;
    const mz = new THREE.Object3D(); mz.position.set(0, 0, 0.45); r.add(mz); out.muzzle = mz;
    const sw = makeSword(0.9); sw.position.set(0.38, 1.1, 0.2); sw.rotation.x = Math.PI / 2; p.root.add(sw); sw.visible = false; out.sword = sw;
  }
  return out;
}

const _hand = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _want = new THREE.Vector3(), _cr = new THREE.Vector3(), _rq = new THREE.Quaternion(), _rq2 = new THREE.Quaternion();
function placeRifle(f) {
  const m = f.m; if (!m.world) return;
  const vis = f.alive && f.stance === 'rifle'; m.rifle.visible = vis; if (!vis) return;
  f.group.updateMatrixWorld(true); m.hand.getWorldPosition(_hand);
  const p = f.aimPitch || 0, cp = Math.cos(p);
  _fwd.set(Math.sin(f.yaw) * cp, Math.sin(p), Math.cos(f.yaw) * cp);
  _rq.setFromUnitVectors(m.axis, _fwd);                                  // barrel -> aim direction
  _up.copy(m.up).applyQuaternion(_rq); _want.set(0, 1, 0).addScaledVector(_fwd, -_fwd.y).normalize();
  _cr.crossVectors(_up, _want); _rq2.setFromAxisAngle(_fwd, Math.atan2(_fwd.dot(_cr), _up.dot(_want))); _rq.premultiply(_rq2); // sights up
  m.rifle.quaternion.copy(_rq);
  m.rifle.position.copy(_hand).addScaledVector(_fwd, CFG.HAND_FWD - (f.kick || 0)); m.rifle.position.y += CFG.HAND_UP;
  m.rifle.updateMatrixWorld(true);
}

/* ========================================================================== */
/*  FIGHTERS                                                                  */
/* ========================================================================== */
const timers = []; const later = (t, fn) => timers.push({ t, fn });
const fighters = [];
class Fighter {
  constructor(name, isPlayer, tint) {
    Object.assign(this, { name, isPlayer, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, hp: 100, armor: 0, alive: true, grounded: true, kills: 0, stance: 'rifle', mag: WEAPON.mag, reserve: isPlayer ? 120 : 9999, reloadT: 0, fireCd: 0, rollT: 0, rollCd: 0, lockT: 0, meleeCd: 0, iframe: 0, aiming: false, stam: 100, stamWait: 0, coyote: 0, jumpBuf: 0, dispY: 0, rollYaw: 0, punchSide: 0, kickSide: 0, hitWall: false, lastHit: -9, inp: { mx: 0, mz: 0, speed: 0, sprint: false, jump: false }, tint, deadT: 0 });
    const m = makeModel(tint, () => { if (this.isPlayer) AU.step(clamp(this.speed / CFG.RUN, 0.3, 1)); });
    this.m = m; this.group = m.group; this.rig = m.rig; this.speed = 0; scene.add(this.group); fighters.push(this); this.setStance('rifle');
  }
  setStance(s) { this.stance = s; if (this.m.rifle) this.m.rifle.visible = s === 'rifle'; if (this.m.sword) this.m.sword.visible = s === 'sword'; }
  spawnAt(x, z) { this.x = x; this.z = z; this.y = groundAt(x, z, 0.3); this.dispY = this.y; this.vx = this.vy = this.vz = 0; this.group.position.set(x, this.y, z); }
  get head() { return { x: this.x, y: this.y + 1.62, z: this.z }; }
  get eye() { return { x: this.x, y: this.y + 1.5, z: this.z }; }
  doRoll() {
    if (!this.alive || this.rollCd > 0 || this.rollT > 0 || this.lockT > 0) return false;
    let dx = this.inp.mx, dz = this.inp.mz; if (Math.hypot(dx, dz) < 0.1) { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); }
    const l = Math.hypot(dx, dz); this.rollDX = dx / l; this.rollDZ = dz / l; this.rollYaw = Math.atan2(dx, dz);
    this.rollT = CFG.ROLL_TIME; this.rollCd = CFG.ROLL_CD; this.iframe = CFG.ROLL_TIME * 0.85; this.reloadT = 0;
    this.rig.playFull('Roll', { dur: CFG.ROLL_TIME, fin: 0.05, fout: 0.12 }); AU.swing(); return true;
  }
  startReload() {
    if (!this.alive || this.reloadT > 0 || this.mag >= WEAPON.mag || this.reserve <= 0 || this.stance !== 'rifle' || this.rollT > 0) return;
    this.reloadT = WEAPON.reload; this.rig.playOver('Interact', { dur: WEAPON.reload, prio: 2, fin: 0.12, fout: 0.2 }); if (this.isPlayer) AU.reload();
  }
  melee(kind) {
    const M = MELEE[kind]; if (!this.alive || this.meleeCd > 0 || this.rollT > 0) return false;
    this.meleeCd = M.cd; this.reloadT = 0;
    if (kind === 'punch') { this.rig.playOver(this.punchSide++ % 2 ? 'Punch_Right' : 'Punch_Left', { dur: 0.42, prio: 3, fin: 0.04, fout: 0.1 }); }
    else if (kind === 'kick') { this.rig.playFull(this.kickSide++ % 2 ? 'Kick_Right' : 'Kick_Left', { dur: 0.8, fin: 0.06, fout: 0.16 }); this.lockT = 0.5; }
    else this.rig.playOver('Sword_Slash', { dur: 0.6, prio: 3, fin: 0.04, fout: 0.12 });
    AU.swing(); later(M.delay, () => meleeHit(this, kind)); return true;
  }
  flinch() { this.rig.playOver(Math.random() < 0.5 ? 'HitRecieve' : 'HitRecieve_2', { dur: 0.4, prio: 1, fin: 0.03, fout: 0.14 }); }
  interact(cb) { if (!this.alive || this.rollT > 0) return; this.rig.playFull('Interact', { dur: 0.9, fin: 0.1, fout: 0.2 }); this.lockT = 0.9; later(0.45, cb); }
  wave() { if (this.alive) this.rig.playFull('Wave', { dur: Math.min(2.4, this.rig.dur('Wave')), fin: 0.15, fout: 0.2 }); }
  update(dt) {
    if (!this.alive) { this.deadT += dt; this.vx = damp(this.vx, 0, 8, dt); this.vz = damp(this.vz, 0, 8, dt); moveBody(this, dt); this.group.position.set(this.x, this.y, this.z); this.rig.update(dt, { fwd: 0, rgt: 0, speed: 0, air: false, stance: this.stance, aim: false, sprint: false }); placeRifle(this); return; }
    this.fireCd -= dt; this.meleeCd -= dt; this.rollCd -= dt; this.iframe -= dt; this.lockT -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const t = Math.min(WEAPON.mag - this.mag, this.reserve); this.mag += t; if (this.isPlayer) this.reserve -= t; } }
    this.coyote = this.grounded ? 0.1 : this.coyote - dt;
    if (this.inp.jump) { this.jumpBuf = 0.12; this.inp.jump = false; } this.jumpBuf -= dt;
    if (this.rollT > 0) { this.rollT -= dt; this.vx = this.rollDX * CFG.ROLL_SPEED; this.vz = this.rollDZ * CFG.ROLL_SPEED; this.yaw = this.rollYaw; }
    else {
      let sp = this.inp.speed; if (this.lockT > 0) sp *= 0.2;
      const k = this.grounded ? 15 : 3.2; this.vx = damp(this.vx, this.inp.mx * sp, k, dt); this.vz = damp(this.vz, this.inp.mz * sp, k, dt);
      if (this.jumpBuf > 0 && this.coyote > 0 && this.lockT <= 0) { this.vy = CFG.JUMP; this.grounded = false; this.coyote = 0; this.jumpBuf = 0; this.y += 0.02; }
    }
    moveBody(this, dt);
    this.dispY = this.grounded ? damp(this.dispY, this.y, 24, dt) : this.y; if (Math.abs(this.dispY - this.y) > 0.9) this.dispY = this.y;
    this.group.position.set(this.x, this.dispY, this.z); this.group.rotation.y = this.yaw;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    this.speed = Math.hypot(this.vx, this.vz); this.kick = Math.max(0, (this.kick || 0) - dt * 0.9);
    this.rig.update(dt, { fwd: this.vx * fx + this.vz * fz, rgt: this.vx * rx + this.vz * rz, speed: this.speed, air: !this.grounded, stance: this.relax && this.stance !== 'sword' ? 'relaxed' : this.stance, aim: this.aiming && this.stance === 'rifle', sprint: this.inp.sprint && this.speed > CFG.RUN * 0.92 });
    placeRifle(this);
  }
}

/* ========================================================================== */
/*  GAME STATE · FX                                                           */
/* ========================================================================== */
const G = { state: 'loading', paused: false, t: 0, player: null, alive: 0, diff: 1, cam: { yaw: 0, pitch: 0.12, recoil: 0, shake: 0, fov: 72, aim: 0, dist: 3.6 }, bloom: 0, over: false, startAt: 0, streak: 0, lastKillT: -9, sens: store.get('sens', 1), showcase: null };
const ALL_CLIPS = ['Death', 'Gun_Shoot', 'HitRecieve', 'HitRecieve_2', 'Idle', 'Idle_Gun', 'Idle_Gun_Pointing', 'Idle_Gun_Shoot', 'Idle_Neutral', 'Idle_Sword', 'Interact', 'Kick_Left', 'Kick_Right', 'Punch_Left', 'Punch_Right', 'Roll', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Run_Shoot', 'Sword_Slash', 'Walk', 'Wave'];
const BOT_NAMES = ['Shadow', 'Blaze', 'Ghost', 'Viper', 'Nova', 'Rogue', 'Titan', 'Echo', 'Raven', 'Havoc', 'Spark', 'Ace', 'Bolt', 'Rex', 'Zed', 'Maverick'];
const tmpV = new THREE.Vector3();

// --- tracers / flashes / particles ---
const FX = { tracers: [], flashes: [], parts: null };
(function initFX() {
  const tm = new THREE.BoxGeometry(0.03, 0.03, 1);
  for (let i = 0; i < 28; i++) { const m = new THREE.Mesh(tm, new THREE.MeshBasicMaterial({ color: '#ffe3a0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.visible = false; m.frustumCulled = false; scene.add(m); FX.tracers.push({ m, t: 0 }); }
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,220,120,.9)'); gr.addColorStop(1, 'rgba(255,120,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,240,180,.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 2); g.lineTo(32, 62); g.moveTo(2, 32); g.lineTo(62, 32); g.stroke();
  const ft = new THREE.CanvasTexture(c);
  for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ft, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); s.visible = false; scene.add(s); FX.flashes.push({ s, t: 0 }); }
  const N = 700, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })); pts.frustumCulled = false; scene.add(pts);
  FX.parts = { pts, N, i: 0, life: new Float32Array(N), vel: new Float32Array(N * 3), col: new Float32Array(N * 3) };
})();
function fxTracer(a, b, color = '#ffe3a0') {
  const T = FX.tracers.find((t) => t.t <= 0) || FX.tracers[0]; const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz); if (L < 0.2) return;
  T.m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); T.m.scale.set(1, 1, L); T.m.lookAt(b.x, b.y, b.z); T.m.material.color.set(color); T.m.material.opacity = 0.9; T.m.visible = true; T.t = 0.075;
}
function fxFlash(p, size = 0.7) {
  const F = FX.flashes.find((f) => f.t <= 0) || FX.flashes[0]; F.s.position.set(p.x, p.y, p.z); F.s.scale.setScalar(size * rnd(0.8, 1.3)); F.s.material.rotation = rnd(0, 6); F.s.visible = true; F.t = 0.05;
}
function fxBurst(p, color, n = 8, speed = 4, up = 1.5) {
  const P = FX.parts, c = new THREE.Color(color), pos = P.pts.geometry.attributes.position, col = P.pts.geometry.attributes.color;
  for (let k = 0; k < n; k++) {
    const i = P.i++ % P.N; pos.setXYZ(i, p.x, p.y, p.z); P.life[i] = rnd(0.25, 0.6); P.vel[i * 3] = rnd(-1, 1) * speed; P.vel[i * 3 + 1] = rnd(0.2, 1) * speed + up; P.vel[i * 3 + 2] = rnd(-1, 1) * speed;
    P.col[i * 3] = c.r; P.col[i * 3 + 1] = c.g; P.col[i * 3 + 2] = c.b; col.setXYZ(i, c.r, c.g, c.b);
  }
}
function fxUpdate(dt) {
  for (const T of FX.tracers) if (T.t > 0) { T.t -= dt; T.m.material.opacity = clamp(T.t / 0.075, 0, 1) * 0.9; if (T.t <= 0) T.m.visible = false; }
  for (const F of FX.flashes) if (F.t > 0) { F.t -= dt; if (F.t <= 0) F.s.visible = false; }
  const P = FX.parts, pos = P.pts.geometry.attributes.position, col = P.pts.geometry.attributes.color;
  for (let i = 0; i < P.N; i++) {
    if (P.life[i] <= 0) continue; P.life[i] -= dt; const l = Math.max(0, P.life[i]);
    P.vel[i * 3 + 1] -= 14 * dt; pos.setXYZ(i, pos.getX(i) + P.vel[i * 3] * dt, Math.max(0.02, pos.getY(i) + P.vel[i * 3 + 1] * dt), pos.getZ(i) + P.vel[i * 3 + 2] * dt);
    const f = Math.min(1, l * 3); col.setXYZ(i, P.col[i * 3] * f, P.col[i * 3 + 1] * f, P.col[i * 3 + 2] * f);
  }
  pos.needsUpdate = true; col.needsUpdate = true;
}

/* ========================================================================== */
/*  HUD helpers                                                               */
/* ========================================================================== */
const setT = (e, v) => { if (e._v !== v) { e._v = v; e.textContent = v; } };
const setW = (e, v) => { v = Math.round(v); if (e._v !== v) { e._v = v; e.style.width = v + '%'; } };
function feed(html, me) { const d = document.createElement('div'); d.innerHTML = html; if (me) d.className = 'me'; U.feed.appendChild(d); while (U.feed.children.length > 5) U.feed.firstChild.remove(); setTimeout(() => d.remove(), 5200); }
function banner(text, color = '#fff') { const b = U.banner; b.textContent = text; b.style.color = color; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
function toScreen(x, y, z) { tmpV.set(x, y, z).project(camera); return { x: (tmpV.x * 0.5 + 0.5) * innerWidth, y: (-tmpV.y * 0.5 + 0.5) * innerHeight, v: tmpV.z < 1 }; }
function dmgNumber(x, y, z, n, head) {
  const s = toScreen(x, y, z); if (!s.v) return; const d = document.createElement('div'); d.className = 'cc-num'; d.textContent = Math.round(n); d.style.cssText = `left:${s.x}px;top:${s.y}px;position:fixed;color:${head ? '#fde047' : '#fff'};font-size:${head ? 28 : 22}px`; U.root.appendChild(d); setTimeout(() => d.remove(), 800);
}
function hurtArc(from) {
  const P = G.player; if (!from) return; const rel = Math.atan2(from.x - P.x, from.z - P.z) - G.cam.yaw; const d = document.createElement('div'); d.className = 'cc-arc'; d.style.transform = `rotate(${-rel}rad)`; U.dmg.appendChild(d); setTimeout(() => d.remove(), 900);
}
let hitTO = 0;
function hitMarker(head) { U.xh.classList.add('hit'); U.xh.classList.toggle('head', !!head); clearTimeout(hitTO); hitTO = setTimeout(() => U.xh.classList.remove('hit', 'head'), 140); }

/* ========================================================================== */
/*  COMBAT                                                                    */
/* ========================================================================== */
function rayFighter(ox, oy, oz, dx, dy, dz, f, maxT) {
  const roll = f.rollT > 0, top = roll ? 0.95 : 1.45, hy = f.y + (roll ? 0.8 : 1.66), hr = 0.27;
  let tH = Infinity, tB = Infinity;
  { const lx = ox - f.x, ly = oy - hy, lz = oz - f.z, b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - hr * hr, disc = b * b - c; if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < maxT) tH = t; } }
  { const lx = ox - f.x, lz = oz - f.z, a = dx * dx + dz * dz; if (a > 1e-8) { const b = lx * dx + lz * dz, c = lx * lx + lz * lz - 0.2809, disc = b * b - a * c; if (disc >= 0) { const t = (-b - Math.sqrt(disc)) / a, y = oy + dy * t; if (t > 0 && t < maxT && y >= f.y && y <= f.y + top) tB = t; } } }
  return tH <= tB + 0.04 ? { t: tH, head: tH < Infinity } : { t: tB, head: false };
}
function castBullet(o, d, range, shooter) {
  let best = rayWorld(o.x, o.y, o.z, d.x, d.y, d.z, range), who = null, head = false;
  for (const f of fighters) { if (!f.alive || f === shooter) continue; const r = rayFighter(o.x, o.y, o.z, d.x, d.y, d.z, f, best); if (r.t < best) { best = r.t; who = f; head = r.head; } }
  return { t: best, who, head };
}
function muzzlePos(f, out) { if (f.m.muzzle) { f.m.muzzle.getWorldPosition(tmpV); out.x = tmpV.x; out.y = tmpV.y; out.z = tmpV.z; } else { out.x = f.x + Math.sin(f.yaw) * 0.6; out.y = f.y + 1.35; out.z = f.z + Math.cos(f.yaw) * 0.6; } return out; }
const distToPlayer = (x, z) => (G.player ? Math.hypot(G.player.x - x, G.player.z - z) : 99);
function damage(target, amt, attacker, o = {}) {
  if (!target.alive || target.iframe > 0 || G.over) return false;
  let a = amt; if (target.armor > 0) { const ab = Math.min(target.armor, a * 0.5); target.armor -= ab; a -= ab; }
  target.relax = false; target.hp -= a; target.lastHit = G.t; target.lastAttacker = attacker;
  if (a > 7 && Math.random() < 0.6) target.flinch();
  if (target.isPlayer) { G.cam.shake = Math.min(1, G.cam.shake + 0.25); U.hurt.style.opacity = 0.9; setTimeout(() => { U.hurt.style.opacity = 0; }, 160); AU.hurt(); if (attacker) hurtArc(attacker); }
  if (attacker && attacker.isPlayer) { hitMarker(o.head); o.head ? AU.head() : AU.hit(); dmgNumber(target.x, target.y + 2, target.z, amt, o.head); }
  if (target.ai && Math.random() < 0.22) target.ai.dodge = 0.05;
  if (target.hp <= 0) kill(target, attacker, o.kind || 'rifle');
  return true;
}
function kill(t, by, kind) {
  t.alive = false; t.hp = 0; t.rig.playFull('Death', { hold: true, fin: 0.08 }); G.alive--; t.aimingBackup = t.aiming; t.aiming = false;
  if (by && by !== t) by.kills++;
  const icon = { rifle: '🔫', punch: '🥊', kick: '🦶', sword: '⚔️', zone: '🌀' }[kind] || '🔫';
  feed(`<b>${by && by !== t ? by.name : 'Zone'}</b> ${icon} ${t.name}`, (by && by.isPlayer) || t.isPlayer);
  if (!t.isPlayer) { const k = pick(['med', 'ammo', 'armor']); addPickup(t.x, t.z, k, true); }
  if (by && by.isPlayer && t !== by) {
    G.streak = G.t - G.lastKillT < 9 ? G.streak + 1 : 1; G.lastKillT = G.t;
    banner(G.streak >= 3 ? `${['', '', '', 'TRIPLE KILL', 'QUAD KILL', 'RAMPAGE'][Math.min(G.streak, 5)]}!` : `ELIMINATED ${t.name.toUpperCase()}`, G.streak >= 3 ? '#fde047' : '#fff');
  }
  if (t.isPlayer) { G.aliveAtDeath = G.alive + 1; later(2.4, () => endMatch(false, by)); }
  else if (G.alive === 1 && G.player.alive) later(1.4, () => endMatch(true));
}
function meleeHit(f, kind) {
  if (!f.alive || G.over) return; const M = MELEE[kind]; let hitAny = false;
  const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
  for (const t of fighters) {
    if (t === f || !t.alive) continue; const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz); if (d > M.range || Math.abs(t.y - f.y) > 1.6) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.3) continue;
    if (damage(t, M.dmg, f, { kind })) { hitAny = true; t.vx += (dx / (d || 1)) * 7; t.vz += (dz / (d || 1)) * 7; fxBurst({ x: t.x, y: t.y + 1.2, z: t.z }, '#ff6b6b', 10, 3.5); }
    if (kind !== 'sword') break;
  }
  if (hitAny && (f.isPlayer || distToPlayer(f.x, f.z) < 20)) AU.whack();
}
function shootBullet(f, o, d, isBot) {
  const m = muzzlePos(f, {}), r = castBullet(o, d, WEAPON.range, f);
  const end = { x: o.x + d.x * r.t, y: o.y + d.y * r.t, z: o.z + d.z * r.t };
  fxTracer(m, end, f.isPlayer ? '#fff2b0' : '#ffb07a'); fxFlash(m, f.isPlayer ? 0.9 : 0.7);
  if (r.who) {
    const dmg = (isBot ? rnd(5.5, 8.5) * G.diff : WEAPON.dmg) * (r.head ? (isBot ? 1.5 : WEAPON.head) : 1) * (isBot ? 1 : 1 - clamp((r.t - 45) / 160, 0, 0.35));
    damage(r.who, dmg, f, { head: r.head, kind: 'rifle' }); fxBurst(end, '#ff5d73', 6, 3);
  } else fxBurst(end, '#ffd9a0', 5, 3.2, 1);
  return r;
}
function playerFire() {
  const P = G.player; if (!P.alive || P.stance !== 'rifle' || P.fireCd > 0 || P.rollT > 0 || P.lockT > 0) return;
  if (P.reloadT > 0) return; if (P.mag <= 0) { P.startReload(); return; }
  P.mag--; P.fireCd = WEAPON.rate;
  const moving = clamp(P.speed / CFG.RUN, 0, 1.4), spread = (P.aiming ? 0.0035 : 0.011) + moving * 0.012 + (P.grounded ? 0 : 0.02) + G.bloom;
  const d = camDir(G.cam.yaw + rnd(-1, 1) * spread, G.cam.pitch + G.cam.recoil + rnd(-1, 1) * spread), o = { x: camera.position.x + d.x * G.cam.dist, y: camera.position.y + d.y * G.cam.dist, z: camera.position.z + d.z * G.cam.dist };
  shootBullet(P, o, d, false);
  P.rig.fire(P.aiming, moving > 0.25); P.kick = 0.07; AU.shot(1);
  G.bloom = Math.min(0.03, G.bloom + 0.0035); G.cam.recoil += P.aiming ? 0.006 : 0.011; G.cam.yaw += rnd(-0.0025, 0.0025); G.cam.shake = Math.min(1, G.cam.shake + 0.05);
  if (P.mag <= 0 && P.reserve > 0) later(0.25, () => P.startReload());
}
const camDir = (yaw, pitch) => ({ x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) });

/* ========================================================================== */
/*  PICKUPS                                                                   */
/* ========================================================================== */
const pickups = [];
const PK = {
  med: { color: '#34d399', name: 'Medkit', geo: null }, armor: { color: '#38bdf8', name: 'Armor plate', geo: null }, ammo: { color: '#facc15', name: 'Ammo box', geo: null },
};
function addPickup(x, z, k, drop) {
  const c = PK[k].color, g = new THREE.Group();
  const body = new THREE.Mesh(k === 'armor' ? new THREE.OctahedronGeometry(0.42) : new THREE.BoxGeometry(0.62, 0.42, 0.42), new THREE.MeshStandardMaterial({ color: k === 'med' ? '#f4f4f4' : c, emissive: c, emissiveIntensity: 0.45, roughness: 0.5 }));
  body.castShadow = true; g.add(body);
  if (k === 'med') { const cr = new THREE.MeshBasicMaterial({ color: '#ef4444' }); const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.44), cr), b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.44, 0.44), cr); g.add(a, b); }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 7, 6, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })); beam.position.y = 3.2; g.add(beam);
  const y = groundAt(x, z, 0.3); g.position.set(x, y + 0.7, z); scene.add(g); pickups.push({ g, body, x, z, y, k, t: rnd(0, 6), taken: false });
}
function applyPickup(f, k) {
  if (k === 'med') f.hp = Math.min(100, f.hp + 45); else if (k === 'armor') f.armor = Math.min(100, f.armor + 50); else if (f.isPlayer) f.reserve += 60;
}
function takePickup(p, f) { if (p.taken) return; p.taken = true; scene.remove(p.g); applyPickup(f, p.k); if (f.isPlayer) { AU.pick(); feed(`+ ${PK[p.k].name}`, true); } }
const pickupWanted = (f, k) => (k === 'med' ? f.hp < 85 : k === 'armor' ? f.armor < 60 : f.isPlayer && f.reserve < 200);
function nearestPickup(f, maxD, onlyWanted) { let b = null, bd = maxD; for (const p of pickups) { if (p.taken || (onlyWanted && !pickupWanted(f, p.k))) continue; const d = Math.hypot(p.x - f.x, p.z - f.z); if (d < bd) { bd = d; b = p; } } return b; }

/* ========================================================================== */
/*  SAFE ZONE                                                                 */
/* ========================================================================== */
const ZPH = [{ wait: 30, shrink: 22, r: 58, dps: 3 }, { wait: 24, shrink: 18, r: 36, dps: 5 }, { wait: 18, shrink: 15, r: 20, dps: 8 }, { wait: 12, shrink: 12, r: 9, dps: 12 }, { wait: 8, shrink: 10, r: 3, dps: 20 }];
const Z = { cx: 0, cz: 0, r: 90, ph: 0, state: 'wait', timer: 30, nx: 0, nz: 0, nr: 58, fx: 0, fz: 0, fr: 90, dps: 3, mesh: null };
(function zoneMesh() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(160,90,255,0)'); gr.addColorStop(1, 'rgba(160,90,255,.8)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
  g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 8; i++) g.fillRect(i * 8, 0, 2, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(48, 1);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 96, 1, true), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: '#b58cff' }));
  m.position.y = 26; m.frustumCulled = false; scene.add(m); Z.mesh = m; Z.tex = t;
})();
function zonePlan(i) {
  const P = ZPH[Math.min(i, ZPH.length - 1)], off = Math.max(0, Z.r - P.r) * 0.7, a = rnd(0, 6.283), d = rnd(0, off);
  Z.nr = P.r; Z.nx = clamp(Z.cx + Math.cos(a) * d, -40, 40); Z.nz = clamp(Z.cz + Math.sin(a) * d, -40, 40); Z.dps = P.dps; Z.timer = P.wait; Z.state = 'wait';
}
function zoneReset() { Z.cx = Z.cz = 0; Z.r = 90; Z.ph = 0; zonePlan(0); }
function zoneUpdate(dt) {
  Z.timer -= dt;
  if (Z.state === 'wait' && Z.timer <= 0) { Z.state = 'shrink'; Z.fx = Z.cx; Z.fz = Z.cz; Z.fr = Z.r; Z.timer = ZPH[Math.min(Z.ph, ZPH.length - 1)].shrink; Z.dur = Z.timer; banner('ZONE CLOSING', '#c4a1ff'); AU.zone(); }
  else if (Z.state === 'shrink') {
    const k = 1 - clamp(Z.timer / Z.dur, 0, 1); Z.r = lerp(Z.fr, Z.nr, k); Z.cx = lerp(Z.fx, Z.nx, k); Z.cz = lerp(Z.fz, Z.nz, k);
    if (Z.timer <= 0) { Z.r = Z.nr; Z.cx = Z.nx; Z.cz = Z.nz; Z.ph++; if (Z.ph < ZPH.length) zonePlan(Z.ph); else { Z.state = 'final'; Z.timer = 999; } }
  }
  Z.mesh.scale.set(Z.r, 1, Z.r); Z.mesh.position.x = Z.cx; Z.mesh.position.z = Z.cz; Z.tex.offset.x += dt * 0.02; Z.tex.offset.y -= dt * 0.05;
  for (const f of fighters) if (f.alive && f !== G.showcase && Math.hypot(f.x - Z.cx, f.z - Z.cz) > Z.r) { f.hp -= Z.dps * dt; if (f.isPlayer) { U.hurt.style.opacity = 0.35 + Math.sin(G.t * 8) * 0.1; } if (f.hp <= 0) kill(f, null, 'zone'); }
  if (G.player && G.player.alive && Math.hypot(G.player.x - Z.cx, G.player.z - Z.cz) <= Z.r && U.hurt.style.opacity === '0.35') U.hurt.style.opacity = 0;
}

/* ========================================================================== */
/*  BOTS                                                                      */
/* ========================================================================== */
function makeBot(i) {
  const tint = new THREE.Color().setHSL(rnd(0, 1), 0.55, 0.64), f = new Fighter(BOT_NAMES[i % BOT_NAMES.length], false, tint);
  f.ai = { target: null, seen: false, lastSeen: -9, think: rnd(0, 0.3), goal: null, goalT: 0, strafe: 1, strafeT: 0, burst: 0, burstCd: rnd(0.3, 1), react: 0.6, stuckT: 0, lx: 0, lz: 0, stuckCk: 0.5, detour: 0, detourDir: 1, dodge: 0, skill: rnd(0.85, 1.15) };
  return f;
}
function retarget(f) {
  const a = f.ai; let best = null, bd = 58;
  for (const c of fighters) {
    if (c === f || !c.alive || c === G.showcase) continue; const dx = c.x - f.x, dz = c.z - f.z, d = Math.hypot(dx, dz); if (d > bd) continue;
    const e = f.eye, h = c.head, dy = h.y - e.y, L = Math.hypot(dx, dy, dz), t = rayWorld(e.x, e.y, e.z, dx / L, dy / L, dz / L, L); if (t >= L - 0.4) { best = c; bd = d; }
  }
  const was = a.seen; a.seen = !!best;
  if (best) { if (a.target !== best || !was) a.react = rnd(0.35, 0.8) / (G.diff * a.skill); a.target = best; a.lastSeen = G.t; }
  else if (f.lastAttacker && f.lastAttacker.alive && G.t - f.lastHit < 3.5) { a.target = f.lastAttacker; a.lastSeen = G.t - 1.5; }
  else if (a.target && (!a.target.alive || G.t - a.lastSeen > 3)) a.target = null;
}
function botThink(f, dt) {
  const a = f.ai, D = G.diff; a.think -= dt; if (a.think <= 0) { a.think = 0.18 + Math.random() * 0.14; retarget(f); }
  if (f.lockT > 0 || f.rollT > 0) { f.inp.mx = f.inp.mz = 0; return; }
  const T = a.target; let mx = 0, mz = 0, speed = 0, yawTo = f.yaw, sprint = false, engaged = false;
  const dz0 = Math.hypot(f.x - Z.cx, f.z - Z.cz), danger = dz0 > Z.r - 4 || ((Z.state === 'shrink' || Z.timer < 10) && Math.hypot(f.x - Z.nx, f.z - Z.nz) > Z.nr - 3);
  a.goalT -= dt; a.strafeT -= dt; a.detour -= dt; a.burstCd -= dt;
  if (danger && !(T && a.seen && f.hp > 50 && dz0 < Z.r - 1)) {
    const gx = Z.nx + Math.sin(f.x) * 3, gz = Z.nz + Math.cos(f.z) * 3, dx = gx - f.x, dz = gz - f.z, d = Math.hypot(dx, dz) || 1; mx = dx / d; mz = dz / d; speed = CFG.SPRINT * 0.8; sprint = true; yawTo = Math.atan2(dx, dz);
    if (T && a.seen && d > 6) { engaged = false; }
  } else if (T && (a.seen || G.t - a.lastSeen < 2.5)) {
    engaged = true; const dx = T.x - f.x, dz = T.z - f.z, d = Math.hypot(dx, dz) || 1; yawTo = Math.atan2(dx, dz);
    if (a.strafeT <= 0) { a.strafe = Math.random() < 0.5 ? -1 : 1; a.strafeT = rnd(0.7, 1.9); }
    const fwdI = d > 28 ? 1 : d < 9 ? -0.8 : 0.2, fx = dx / d, fz = dz / d, rx = -fz, rz = fx;
    mx = fx * fwdI + rx * a.strafe * 0.85; mz = fz * fwdI + rz * a.strafe * 0.85; const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l; speed = d > 28 ? CFG.RUN : CFG.RUN * 0.66;
    if (d < 2.5 && f.meleeCd <= 0) f.melee(Math.random() < 0.3 ? 'kick' : 'punch');
    if (a.dodge > 0 && f.rollCd <= 0) { f.inp.mx = rx * a.strafe; f.inp.mz = rz * a.strafe; f.doRoll(); a.dodge = 0; }
    if (a.seen && d < 58) {
      a.react -= dt; const err = Math.abs(angDelta(f.yaw, yawTo));
      if (a.react <= 0 && err < 0.2) {
        if (f.mag <= 0) f.startReload();
        else if (f.reloadT <= 0 && f.fireCd <= 0) {
          if (a.burst <= 0 && a.burstCd <= 0) a.burst = 3 + ((Math.random() * 6) | 0);
          if (a.burst > 0) { botShoot(f, T, d); a.burst--; if (a.burst <= 0) a.burstCd = rnd(0.5, 1.4) / D; }
        }
      }
    }
  } else {
    if (!a.goal || a.goalT <= 0 || Math.hypot(a.goal.x - f.x, a.goal.z - f.z) < 2.5) {
      const loot = f.hp < 75 || Math.random() < 0.3 ? nearestPickup(f, 40, true) : null; a.goal = loot ? { x: loot.x, z: loot.z } : freePoint(1.2); a.goalT = rnd(8, 16);
    }
    const dx = a.goal.x - f.x, dz = a.goal.z - f.z, d = Math.hypot(dx, dz) || 1; mx = dx / d; mz = dz / d; speed = CFG.RUN * rnd(0.55, 0.7) * (f._wp || (f._wp = rnd(0.9, 1.1))); yawTo = Math.atan2(dx, dz);
  }
  if (a.detour > 0) { const px = -mz * a.detourDir, pz = mx * a.detourDir; mx = mx * 0.3 + px; mz = mz * 0.3 + pz; const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l; }
  a.stuckCk -= dt; if (a.stuckCk <= 0) { a.stuckCk = 0.5; const moved = Math.hypot(f.x - a.lx, f.z - a.lz); a.lx = f.x; a.lz = f.z; if (speed > 0 && moved < 0.5) { a.stuckT += 0.5; if (a.stuckT >= 1) { a.detour = 1; a.detourDir = Math.random() < 0.5 ? -1 : 1; a.stuckT = 0; a.goal = null; } } else a.stuckT = 0; }
  if (f.hitWall && f.grounded && speed > 0) f.inp.jump = true;
  f.inp.mx = mx; f.inp.mz = mz; f.inp.speed = speed; f.inp.sprint = sprint;
  { const tp = engaged && T ? clamp(Math.atan2(T.y + 1.1 - (f.y + 1.3), Math.hypot(T.x - f.x, T.z - f.z) || 1), -0.5, 0.6) : 0; f.aimPitch = damp(f.aimPitch || 0, tp, 8, dt); }
  f.relax = !engaged && !danger && G.t - a.lastSeen > 4 && G.t - f.lastHit > 4;
  const face = engaged ? yawTo : speed > 0.1 ? yawTo : f.yaw; f.yaw = dampAng(f.yaw, face, engaged ? 8 * D * a.skill : 9, dt); f.aiming = engaged && a.seen && Math.hypot(T.x - f.x, T.z - f.z) > 14;
  // auto loot
  if (!engaged) { const p = nearestPickup(f, 1.4, true); if (p) takePickup(p, f); }
}
function botShoot(f, T, dist) {
  f.relax = false; f.mag--; f.fireCd = WEAPON.rate * 1.55; const m = muzzlePos(f, {}), e = f.eye, tx = T.x, ty = T.y + 1.1, tz = T.z;
  const moving = clamp(T.speed / CFG.RUN, 0, 1.2), p = clamp(0.8 - dist * 0.012 - moving * 0.18, 0.1, 0.68) * G.diff * f.ai.skill * (T.rollT > 0 ? 0.3 : 1);
  const hit = Math.random() < p, j = hit ? 0.05 : rnd(0.8, 2.2);
  let dx = tx + rnd(-1, 1) * j - e.x, dy = ty + rnd(-0.5, 0.5) * j - e.y, dz = tz + rnd(-1, 1) * j - e.z; const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
  const r = shootBulletSoft(f, e, { x: dx, y: dy, z: dz }, T, hit);
  f.rig.fire(f.aiming, f.speed > 3); f.kick = 0.06; AU.shot(Math.pow(clamp(1 - distToPlayer(f.x, f.z) / 95, 0, 1), 2));
}
function shootBulletSoft(f, o, d, T, forceHit) {
  // bots: world blocks bullets; hits land on the target only when the roll succeeded
  const m = muzzlePos(f, {}), w = rayWorld(o.x, o.y, o.z, d.x, d.y, d.z, WEAPON.range); let t = w, who = null, head = false;
  for (const c of fighters) { if (!c.alive || c === f || c === G.showcase) continue; const r = rayFighter(o.x, o.y, o.z, d.x, d.y, d.z, c, t); if (r.t < t) { t = r.t; who = c; head = r.head; } }
  const end = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
  fxTracer(m, end, '#ffb07a'); fxFlash(m, 0.6);
  if (who && (forceHit || who !== T)) { damage(who, rnd(5.5, 8.5) * (who.isPlayer ? G.diff : 0.5) * (head && Math.random() < 0.15 ? 1.6 : 1), f, { head, kind: 'rifle' }); fxBurst(end, '#ff5d73', 4, 3); }
  else if (!who) fxBurst(end, '#ffd9a0', 4, 3, 1);
  return t;
}

/* ========================================================================== */
/*  INPUT                                                                     */
/* ========================================================================== */
const keys = {}; let fireHeld = false, aimHeld = false, exhausted = false, idleT = 0;
const joy = { x: 0, y: 0, id: null }; const tb = { fire: false, aim: false };
const lookAcc = { x: 0, y: 0 };
const lookBy = (dx, dy, k, smooth) => { const P = G.player; if (!P) return; const s = k * G.sens * (P.aiming ? 0.55 : 1); if (smooth) { lookAcc.x += dx * s; lookAcc.y += dy * s; } else { G.cam.yaw -= dx * s; G.cam.pitch = clamp(G.cam.pitch - dy * s, -0.75, 1.1); } };
function lockPointer() { try { const r = U.canvas.requestPointerLock?.(); r && r.catch && r.catch(() => {}); } catch {} }
const playing = () => G.state === 'playing' && !G.paused && G.player;
const meleeKey = () => { const P = G.player; P.melee(P.stance === 'sword' ? 'sword' : 'punch'); };
function doUse() {
  const P = G.player, p = nearestPickup(P, 2.4, false); if (!p || !P.alive) return;
  P.interact(() => { if (!p.taken) takePickup(p, P); });
}
function act(name) {
  const P = G.player; if (!playing() || !P.alive) return;
  if (name === 'jump') P.inp.jump = true; else if (name === 'roll') P.doRoll(); else if (name === 'reload') P.startReload();
  else if (name === 'melee') meleeKey(); else if (name === 'kick') P.melee('kick'); else if (name === 'use') doUse();
  else if (name === 'rifle') { P.setStance('rifle'); P.reloadT = 0; } else if (name === 'sword') { P.setStance('sword'); P.reloadT = 0; }
  else if (name === 'swap') { P.setStance(P.stance === 'rifle' ? 'sword' : 'rifle'); P.reloadT = 0; }
  else if (name === 'wave') { if (P.speed < 1) P.wave(); }
  idleT = 0;
}
addEventListener('keydown', (e) => {
  if (e.repeat) return; keys[e.code] = true; if (!playing()) return;
  const m = { Space: 'jump', KeyC: 'roll', KeyR: 'reload', KeyF: 'melee', KeyV: 'kick', KeyE: 'use', Digit1: 'rifle', Digit2: 'sword', KeyG: 'wave' }[e.code];
  if (m) { act(m); e.preventDefault(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; fireHeld = aimHeld = false; });
U.canvas.addEventListener('click', () => { if (!TOUCH && G.state === 'playing' && !G.paused && document.pointerLockElement !== U.canvas) lockPointer(); });
addEventListener('mousedown', (e) => { if (!playing() || document.pointerLockElement !== U.canvas) return; if (e.button === 0) fireHeld = true; if (e.button === 2) aimHeld = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) fireHeld = false; if (e.button === 2) aimHeld = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => { if (playing() && document.pointerLockElement === U.canvas) lookBy(e.movementX, e.movementY, 0.0022); });
document.addEventListener('pointerlockchange', () => { if (!TOUCH && G.state === 'playing' && !G.over && document.pointerLockElement !== U.canvas) setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'playing' && !G.over) setPaused(true); });
// touch: joystick
(function touchUI() {
  const base = U.joy.querySelector('.base'), knob = U.joy.querySelector('.knob'); let cx = 0, cy = 0;
  U.joy.addEventListener('pointerdown', (e) => { if (joy.id !== null) return; joy.id = e.pointerId; U.joy.setPointerCapture(e.pointerId); const r = U.joy.getBoundingClientRect(); cx = e.clientX; cy = e.clientY; base.style.display = 'block'; base.style.left = (cx - r.left - 64) + 'px'; base.style.top = (cy - r.top - 64) + 'px'; knob.style.transform = ''; });
  U.joy.addEventListener('pointermove', (e) => { if (e.pointerId !== joy.id) return; let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy), R = 56; if (l > R) { dx = dx / l * R; dy = dy / l * R; } joy.x = dx / R; joy.y = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`; });
  const up = (e) => { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; base.style.display = 'none'; };
  U.joy.addEventListener('pointerup', up); U.joy.addEventListener('pointercancel', up);
  let lid = null, lx = 0, ly = 0;
  U.look.addEventListener('pointerdown', (e) => { if (lid !== null) return; lid = e.pointerId; U.look.setPointerCapture(e.pointerId); lx = e.clientX; ly = e.clientY; });
  U.look.addEventListener('pointermove', (e) => { if (e.pointerId !== lid) return; if (playing()) lookBy(e.clientX - lx, e.clientY - ly, 0.0052, true); lx = e.clientX; ly = e.clientY; });
  const lup = (e) => { if (e.pointerId === lid) lid = null; }; U.look.addEventListener('pointerup', lup); U.look.addEventListener('pointercancel', lup);
  for (const [name, b] of Object.entries(U.btn)) {
    const hold = name === 'fire' || name === 'aim';
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('on'); if (name === 'fire') fireHeld = true; else if (name === 'aim') aimHeld = true; else act(name); });
    const end = () => { b.classList.remove('on'); if (name === 'fire') fireHeld = false; if (name === 'aim') aimHeld = false; };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  }
})();

/* ========================================================================== */
/*  PLAYER · CAMERA                                                           */
/* ========================================================================== */
function playerControl(dt) {
  const P = G.player, c = G.cam; c.recoil = damp(c.recoil, 0, 9, dt);
  { const k = 1 - Math.exp(-24 * dt); c.yaw -= lookAcc.x * k; c.pitch = clamp(c.pitch - lookAcc.y * k, -0.75, 1.1); lookAcc.x *= 1 - k; lookAcc.y *= 1 - k; }  // touch look: eased so swipes glide G.bloom = Math.max(0, G.bloom - dt * 0.045);
  if (!P.alive) return;
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), mag = 0, analog = false;
  const jl = Math.hypot(joy.x, joy.y);
  if (jl > 0.08) { ix = joy.x; iz = -joy.y; mag = Math.min(1, jl); analog = true; } else { const l = Math.hypot(ix, iz); if (l > 0) { ix /= l; iz /= l; mag = 1; } }
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw);
  let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix; const ml = Math.hypot(mx, mz); if (ml > 0) { mx /= ml; mz /= ml; }
  P.aiming = (aimHeld || tb.aim) && P.stance === 'rifle' && P.rollT <= 0;
  const wantSprint = (keys.ShiftLeft || keys.ShiftRight || (analog && jl > 0.93)) && iz > 0.25 && !P.aiming && !exhausted && mag > 0;
  const sprinting = wantSprint && P.speed > CFG.RUN * 0.8 || (wantSprint && P.speed < CFG.RUN * 0.8);
  if (wantSprint) P.stam = Math.max(0, P.stam - 26 * dt); else P.stam = Math.min(100, P.stam + 17 * dt);
  if (P.stam <= 0) exhausted = true; if (exhausted && P.stam > 28) exhausted = false;
  let base = P.aiming ? CFG.AIM_SPEED : wantSprint ? CFG.SPRINT : CFG.RUN; if (analog) base = lerp(CFG.WALK, base, smooth(0.28, 0.92, mag));
  P.inp.mx = mx; P.inp.mz = mz; P.inp.speed = mag > 0 ? base : 0; P.inp.sprint = wantSprint;
  if (P.rollT <= 0) P.yaw = dampAng(P.yaw, c.yaw, 20, dt);
  P.aimPitch = clamp(c.pitch + c.recoil, -0.5, 0.7);
  if (fireHeld) { idleT = 0; if (P.stance === 'rifle') playerFire(); else meleeKey(); }
  idleT = mag > 0 || P.aiming || fireHeld ? 0 : idleT + dt; P.relax = idleT > 5;
  if (mag > 0) P.relax = false;
  // pickup prompt
  const pk = nearestPickup(P, 2.4, false);
  if (pk) { U.prompt.style.display = 'block'; const t = TOUCH ? `Tap USE: ${PK[pk.k].name}` : `E  ·  ${PK[pk.k].name}`; setT(U.prompt, t); } else U.prompt.style.display = 'none';
  if (U.btn.use) U.btn.use.style.display = pk && TOUCH ? 'flex' : 'none';
  if (U.btn.roll) U.btn.roll.classList.toggle('cd', P.rollCd > 0);
}
const _ro = { x: 0, y: 0, z: 0 };
function updateCamera(dt) {
  const P = G.player, c = G.cam; if (!P) return;
  const dead = !P.alive || G.over; if (dead) { c.yaw += dt * 0.28; c.pitch = lerp(c.pitch, 0.3, dt * 2); }
  c.aim = damp(c.aim, P.aiming ? 1 : 0, 12, dt);
  const shoulder = lerp(0.6, 0.78, c.aim), dist = dead ? 5.2 : lerp(3.7, 2.1, c.aim), pit = c.pitch + c.recoil;
  const d = camDir(c.yaw, pit), rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw);
  const px = P.x, py = P.dispY + 1.5 + (P.rollT > 0 ? -0.5 : 0), pz = P.z;
  const ox = px + rx * shoulder, oy = py, oz = pz + rz * shoulder;
  let dx = -d.x * dist, dy = -d.y * dist + 0.25, dz = -d.z * dist; const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
  const t = rayWorld(ox, oy, oz, dx, dy, dz, L + 0.4), cl = clamp(t - 0.4, 0.35, L);
  c.dist = cl; c.shake = damp(c.shake, 0, 9, dt); const sh = c.shake * 0.05;
  camera.position.set(ox + dx * cl + rnd(-sh, sh), oy + dy * cl + rnd(-sh, sh), oz + dz * cl + rnd(-sh, sh));
  camera.rotation.order = 'YXZ'; camera.rotation.set(pit - (dy < 0 ? 0 : 0), c.yaw + Math.PI, 0);
  const aspect = innerWidth / innerHeight, baseFov = aspect < 1 ? 86 : 72;
  const tf = baseFov - c.aim * 24 + (P.inp.sprint && P.speed > 11 ? 7 : 0) + (P.rollT > 0 ? 6 : 0) + Math.min(10, c.shake * 6);
  c.fov = damp(c.fov, tf, 10, dt); if (Math.abs(camera.fov - c.fov) > 0.01) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
  // light follows player (snapped to avoid shimmering)
  const sx = Math.round(P.x), sz = Math.round(P.z); sun.position.set(sx + SUN_DIR.x * 90, SUN_DIR.y * 90, sz + SUN_DIR.z * 90); sun.target.position.set(sx, 0, sz);
}

/* ========================================================================== */
/*  HUD · MINIMAP · NAME TAGS                                                 */
/* ========================================================================== */
const mctx = U.map.getContext('2d'); let mapTick = 0; const tags = [];
function drawHUD(dt) {
  const P = G.player; if (!P) return;
  setT(U.alive, G.alive); setT(U.kills, P.kills);
  setW(U.hp, P.hp); U.hp.parentElement.classList.toggle('low', P.hp < 30); setW(U.ar, P.armor); setW(U.stam, P.stam);
  setT(U.mag, P.reloadT > 0 ? '…' : P.stance === 'sword' ? '⚔' : P.mag); setT(U.res, P.stance === 'sword' ? '' : `/ ${P.reserve}`); setT(U.wname, P.stance === 'sword' ? 'Blade' : P.reloadT > 0 ? 'Reloading' : 'Assault Rifle');
  U.mag.parentElement.classList.toggle('empty', P.stance === 'rifle' && P.mag === 0);
  const t = Math.max(0, Math.ceil(Z.timer)), zt = Z.state === 'final' ? 'FINAL' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  setT(U.zone, zt); setT(U.zonel, Z.state === 'shrink' ? 'closing' : Z.state === 'final' ? 'zone' : 'next'); U.zonep.classList.toggle('warn', Z.state === 'shrink' || Math.hypot(P.x - Z.cx, P.z - Z.cz) > Z.r);
  const sp = (P.aiming ? 0 : 3) + (P.speed / CFG.RUN) * 8 + G.bloom * 600 + (P.grounded ? 0 : 8); U.xh.style.setProperty('--s', sp.toFixed(1) + 'px'); U.xh.classList.toggle('ads', P.aiming);
  // minimap (every other frame)
  if ((mapTick++ & 1) === 0) {
    const g = mctx, W = U.map.width, S = 1.75;
    g.save(); g.clearRect(0, 0, W, W); g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, 6.283); g.clip();
    g.translate(W / 2, W / 2); g.rotate(-G.cam.yaw); g.scale(S, S); g.translate(-P.x, P.z);
    g.drawImage(WORLD.mini, -62, -62, 124, 124);
    g.lineWidth = 1.2; g.strokeStyle = '#c4a1ff'; g.beginPath(); g.arc(Z.cx, -Z.cz, Z.r, 0, 6.283); g.stroke();
    if (Z.state !== 'final') { g.strokeStyle = 'rgba(255,255,255,.8)'; g.setLineDash([3, 3]); g.beginPath(); g.arc(Z.nx, -Z.nz, Z.nr, 0, 6.283); g.stroke(); g.setLineDash([]); }
    for (const p of pickups) if (!p.taken) { g.fillStyle = PK[p.k].color; g.fillRect(p.x - 0.9, -p.z - 0.9, 1.8, 1.8); }
    for (const f of fighters) { if (f === P || !f.alive || f === G.showcase) continue; const d = Math.hypot(f.x - P.x, f.z - P.z); if (d > 34 && G.t - f.lastShot > 1.2) continue; g.fillStyle = '#ff4d6d'; g.beginPath(); g.arc(f.x, -f.z, 1.9, 0, 6.283); g.fill(); }
    g.restore(); g.save(); g.translate(W / 2, W / 2); g.fillStyle = '#fde047'; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.restore();
  }
  // name tags (closest few, on screen, with line of sight)
  const list = fighters.filter((f) => f !== P && f.alive && f !== G.showcase && Math.hypot(f.x - P.x, f.z - P.z) < 34).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z)).slice(0, 5);
  while (tags.length < 5) { const d = document.createElement('div'); d.className = 'cc-tag'; d.innerHTML = '<span></span><i><b></b></i>'; U.tags.appendChild(d); tags.push(d); }
  tags.forEach((d, i) => {
    const f = list[i]; if (!f) { d.style.display = 'none'; return; }
    const s = toScreen(f.x, f.y + 2.15, f.z); const e = camera.position, dx = f.x - e.x, dy = f.y + 1.6 - e.y, dz = f.z - e.z, L = Math.hypot(dx, dy, dz);
    if (!s.v || rayWorld(e.x, e.y, e.z, dx / L, dy / L, dz / L, L) < L - 0.5) { d.style.display = 'none'; return; }
    d.style.display = 'block'; d.style.left = s.x + 'px'; d.style.top = s.y + 'px'; d.firstChild.textContent = f.name; d.querySelector('b').style.width = f.hp + '%';
  });
}

/* ========================================================================== */
/*  MATCH FLOW                                                                */
/* ========================================================================== */
function clearWorld() {
  for (const f of fighters) { scene.remove(f.group); if (f.m.world) scene.remove(f.m.rifle); } fighters.length = 0; for (const p of pickups) scene.remove(p.g); pickups.length = 0; timers.length = 0;
  for (const T of FX.tracers) { T.t = 0; T.m.visible = false; } U.feed.innerHTML = ''; G.showcase = null;
}
function startMatch() {
  AU.init(); clearWorld(); G.over = false; G.t = 0; G.paused = false; G.streak = 0; G.lastKillT = -9; G.bloom = 0; exhausted = false; idleT = 0;
  const sp = WORLD.spawns.slice().sort(() => Math.random() - 0.5);
  const P = new Fighter(PLAYER_NAME, true, null); G.player = P; P.spawnAt(sp[0].x, sp[0].z); P.lastShot = -9;
  for (let i = 0; i < CFG.BOTS; i++) { const b = makeBot(i); const s = sp[(i + 1) % sp.length]; b.spawnAt(s.x, s.z); b.yaw = rnd(0, 6.28); b.lastShot = -9; }
  P.yaw = Math.atan2(-P.x, -P.z); G.cam.yaw = P.yaw; G.cam.pitch = 0.12; G.cam.recoil = 0;
  G.alive = fighters.length; zoneReset();
  for (const l of WORLD.loot) addPickup(l.x, l.z, l.k);
  G.diff = Number(U.diff.querySelector('.on')?.dataset.d || 1); store.set('diff', G.diff);
  for (const s of Object.values(U.screens)) s.classList.remove('on'); U.hud.classList.add('on'); if (TOUCH) U.touch.classList.add('on');
  G.state = 'playing'; setTimeout(() => P.wave(), 150); banner(`DROP IN · ${G.alive} FIGHTERS`, '#fde047');
  try { if (TOUCH) { document.documentElement.requestFullscreen?.().catch(() => {}); screen.orientation?.lock?.('landscape').catch(() => {}); } else lockPointer(); } catch {}
}
function endMatch(won, by) {
  if (G.over) return; G.over = true; const P = G.player, place = won ? 1 : (G.aliveAtDeath || 16), total = CFG.BOTS + 1;
  const score = P.kills * 100 + (total + 1 - place) * 30 + (won ? 500 : 0);
  if (won) { P.wave(); AU.win(); } else AU.lose();
  fireHeld = aimHeld = false; try { document.exitPointerLock?.(); } catch {}
  later(won ? 2.6 : 0.3, () => {
    U.hud.classList.remove('on'); U.touch.classList.remove('on');
    setT(U.endt, won ? 'WINNER WINNER!' : by ? `Eliminated by ${by.name}` : 'Eliminated'); setT(U.endsub, won ? 'Last fighter standing in the compound.' : `You finished #${place} of ${total}.`);
    setT(U.eplace, '#' + place); setT(U.ekills, P.kills); setT(U.escore, score); U.screens.end.classList.add('on'); G.state = 'end';
  });
  try { parent !== window && parent.postMessage({ type: 'gb-game-score', game: 'compound', score, kills: P.kills, place }, '*'); } catch {}
}
function setPaused(p) {
  if (G.over || G.state !== 'playing') return; G.paused = p; U.screens.pause.classList.toggle('on', p); fireHeld = aimHeld = false;
  if (!p && !TOUCH) lockPointer();
}
function toMenu() { try { parent !== window && parent.postMessage({ type: 'gb-game-exit' }, '*'); } catch {} if (parent === window) location.href = qs.get('back') || './'; }
U.pause.addEventListener('click', () => setPaused(true)); U.resume.addEventListener('click', () => setPaused(false));
U.quit.addEventListener('click', () => { G.over = true; try { document.exitPointerLock?.(); } catch {} toMenu(); });
U.exit1.addEventListener('click', toMenu); U.exit2.addEventListener('click', toMenu);
U.again.addEventListener('click', () => { U.screens.end.classList.remove('on'); startMatch(); });
U.play.addEventListener('click', startMatch);
U.diff.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; U.diff.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
U.sens.value = G.sens; U.sens.addEventListener('input', () => { G.sens = Number(U.sens.value); store.set('sens', G.sens); });
{ const d = String(store.get('diff', 1)); U.diff.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.d === d || (d === '1' && x.dataset.d === '1'))); }

/* ========================================================================== */
/*  LOADING · MENU · MAIN LOOP                                                */
/* ========================================================================== */
async function loadAssets() {
  const mgr = new THREE.LoadingManager(), L = new GLTFLoader(mgr); let got = 0;
  const load = (url) => new Promise((res) => L.load(url, (g) => { got++; U.load.style.width = (got * 45) + '%'; res(g); }, undefined, () => res(null)));
  const [s, r] = await Promise.all([load(CFG.SOLDIER), load(CFG.RIFLE)]); ASSETS.soldier = s; ASSETS.rifle = r; U.load.style.width = '100%';
  if (s) { const have = new Set(s.animations.map((a) => a.name.toLowerCase())), miss = ALL_CLIPS.filter((n) => !have.has(n.toLowerCase())); if (miss.length) console.warn('[Compound Clash] clips missing in Soldier.glb:', miss.join(', ')); }
  U.loadt.textContent = s ? (r ? 'Soldiers armed and ready.' : 'Rifle.glb not found – using a basic rifle.') : 'Soldier.glb not found – using a basic soldier. Put Soldier.glb next to gamers.html.';
}
function showcaseInit() {
  const sc = new Fighter('Hero', false, null); G.showcase = sc; sc.spawnAt(0, 15); sc.yaw = Math.PI; sc.relax = true; sc.setStance('rifle');
  const loop = () => { if (G.showcase === sc) { sc.wave(); setTimeout(loop, 4200); } }; setTimeout(loop, 900);
}
function menuCam(dt) {
  G.menuA = (G.menuA || 0) + dt * 0.18; const a = G.menuA, cx = 0, cz = 15;
  camera.position.set(cx + Math.sin(a) * 6.5, 2.1 + Math.sin(a * 0.7) * 0.25, cz + Math.cos(a) * 6.5); camera.lookAt(cx, 1.25, cz);
  camera.rotation.order = 'XYZ'; if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
  sun.position.set(SUN_DIR.x * 90, SUN_DIR.y * 90, 15 + SUN_DIR.z * 90); sun.target.position.set(0, 0, 15);
}
function step(dt) {
  G.t += dt; for (let i = timers.length - 1; i >= 0; i--) { const t = timers[i]; t.t -= dt; if (t.t <= 0) { timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } } }
  playerControl(dt);
  for (const f of fighters) if (f.ai && f.alive) botThink(f, dt);
  for (const f of fighters) f.update(dt);
  const P = G.player; P.lastShot = P.fireCd > WEAPON.rate * 0.6 ? G.t : P.lastShot; for (const f of fighters) if (f.ai && f.fireCd > WEAPON.rate) f.lastShot = G.t;
  for (const p of pickups) { if (p.taken) continue; p.t += dt; p.g.position.y = p.y + 0.75 + Math.sin(p.t * 2.2) * 0.12; p.body.rotation.y = p.t * 1.6; }
  zoneUpdate(dt);
  updateCamera(dt); fxUpdate(dt); drawHUD(dt);
  for (const c of clouds) { c.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.004 * c.userData.sp); c.lookAt(0, 0, 0); }
}
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  try {
    if (G.state === 'playing' && !G.paused) step(dt);
    else if (G.state === 'end') { for (const f of fighters) f.update(dt); G.t += dt; for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const t = timers.splice(i, 1)[0]; t.fn(); } } updateCamera(dt); fxUpdate(dt); }
    else if (G.state === 'menu' || G.state === 'loading') { if (G.showcase) G.showcase.update(dt); menuCam(dt); }
  } catch (e) { console.error(e); }
  renderer.render(scene, camera);
}
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

(async function boot() {
  buildWorld(); requestAnimationFrame(frame);
  if (TOUCH && innerHeight > innerWidth) U.loadt.insertAdjacentHTML('afterend', '<p style="color:#fde047;font-size:14px">📱 Turn your phone sideways for the best view.</p>');
  U.sensrow.style.display = 'flex'; U.menurow.style.display = 'flex';
  await loadAssets(); G.state = 'menu'; showcaseInit(); U.play.style.display = ''; U.load.parentElement.style.display = 'none'; U.loadt.style.display = TOUCH || ASSETS.soldier ? 'none' : '';
  if (qs.get('auto')) startMatch();
})();
window.__cc = { G, fighters, COL, scene, camera, renderer, startMatch, step, WORLD, Z, pickups, act };
