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
  WALK: 5.6, RUN: 12.5, SPRINT: 18, AIM_SPEED: 6.2,
  JUMP: 9.8, GRAV: 30, STEP: 0.45, RADIUS: 0.42, HEIGHT: 1.85,
  ROLL_SPEED: 21, ROLL_TIME: 0.62, ROLL_CD: 2.6,
  BODY_H: 1.85,
  LOCK_RANGE: 42, LOCK_CONE: 0.45,   // auto-aim: how far / how wide (radians) an enemy can be and still be locked
  RIFLE_LEN: 0.95,
  // AK-47 two-hand hold: stock in the right shoulder, hands go to the pistol grip and the handguard
  STOCK_FWD: 0.06, STOCK_SIDE: 0.1, STOCK_DOWN: 0.1, GRIP_R: 0.3, GRIP_L: 0.56,
};
const WEAPON = { dmg: 21, rate: 0.092, mag: 30, reload: 1.7, head: 2, range: 140 };
const MELEE = { punch: { dmg: 34, range: 2.3, delay: 0.16, cd: 0.45 }, kick: { dmg: 48, range: 2.5, delay: 0.26, cd: 0.8 }, sword: { dmg: 80, range: 3.1, delay: 0.22, cd: 0.7 } };
const qs = new URLSearchParams(location.search);
const PLAYER_NAME = (qs.get('name') || 'You').slice(0, 16);
if (qs.get('flip')) CFG.MODEL_YAW = Math.PI;
const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
const BOX = qs.get('mode') === 'box';   // Boxing Arena mode (same engine, same soldier)
if (BOX) { CFG.ROLL_SPEED = 11; CFG.ROLL_TIME = 0.5; CFG.ROLL_CD = 1.4; MELEE.punch = { dmg: 6, range: 2.15, delay: 0.12, cd: 0.34, cost: 6 }; MELEE.heavy = { dmg: 17, range: 2.4, delay: 0.3, cd: 0.95, cost: 22 }; }

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
.cc-scope{position:fixed;inset:0;pointer-events:none;opacity:0;transition:opacity .15s;background:radial-gradient(circle at 50% 50%,transparent 34%,rgba(0,0,0,.35) 60%,rgba(0,0,0,.72) 100%)}.cc-scope.on{opacity:1}.cc-scope.l2{background:radial-gradient(circle at 50% 50%,transparent 24%,rgba(0,0,0,.55) 46%,rgba(0,0,0,.9) 100%)}
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
.cc-lock{position:absolute;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border:2px solid var(--cc-r);border-radius:50%;display:none;box-shadow:0 0 12px var(--cc-r),inset 0 0 8px rgba(255,60,90,.5);animation:ccl .5s infinite alternate}.cc-lock:before,.cc-lock:after{content:'';position:absolute;background:var(--cc-r);left:50%;top:50%}.cc-lock:before{width:2px;height:62px;margin:-31px 0 0 -1px}.cc-lock:after{width:62px;height:2px;margin:-1px 0 0 -31px}
@keyframes ccl{to{transform:scale(1.12)}}
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
  <canvas class="cc-gl"></canvas><div class="cc-scope"></div><div class="cc-vig"></div><div class="cc-hurt"></div>
  <div class="cc-hud">
    <div class="cc-top"><div class="cc-pill">👥<b data-k="alive">16</b><small>alive</small></div><div class="cc-pill">🎯<b data-k="kills">0</b><small>kills</small></div><div class="cc-pill" data-k="netp" style="display:none">🌐<b data-k="netn">1</b><small>online</small></div><div class="cc-pill" data-k="zonep">🌀<b data-k="zone">--</b><small data-k="zonel">zone</small></div></div>
    <canvas class="cc-map" width="224" height="224"></canvas>
    <div class="cc-feed"></div>
    <div class="cc-xh"><i></i><i></i><i></i><i></i><u></u></div>
    <div class="cc-bars"><div class="cc-bar sp"><i data-k="stam"></i><span>STAMINA</span></div><div class="cc-bar ar"><i data-k="ar"></i><span>ARMOR</span></div><div class="cc-bar"><i data-k="hp"></i><span>HEALTH</span></div></div>
    <div class="cc-gun"><div data-k="wname">Rifle</div><b data-k="mag">30</b><small data-k="res">/ 120</small></div>
    <div class="cc-lock"></div><div class="cc-prompt"></div><div class="cc-banner"></div><div class="cc-dmg"></div><div class="cc-tags"></div>
    <button class="cc-pause" data-k="pause">❚❚</button>
  </div>
  <div class="cc-touch">
    <div class="cc-joy"><div class="base"><div class="knob"></div></div></div><div class="cc-look"></div>
    <button class="cc-btn" data-b="fire" style="right:18px;bottom:96px;width:92px;height:92px;font-size:13px"><span>🔥</span>Fire</button>
    <button class="cc-btn" data-b="aim" style="right:122px;bottom:58px;width:62px;height:62px"><span>◎</span><i data-k="zoomt" style="font-style:normal">Zoom</i></button>
    <button class="cc-btn" data-b="jump" style="right:22px;bottom:200px;width:64px;height:64px"><span>⤒</span>Jump</button>
    <button class="cc-btn" data-b="roll" style="left:14px;bottom:calc(58% + 8px);width:60px;height:60px"><span>↻</span>Roll</button>
    <button class="cc-btn" data-b="reload" style="left:146px;bottom:calc(58% + 10px);width:54px;height:54px"><span>⟲</span>Load</button>
    <button class="cc-btn" data-b="melee" style="right:164px;bottom:196px;width:52px;height:52px"><span>🥊</span>Hit</button>
    <button class="cc-btn" data-b="kick" style="right:228px;bottom:60px;width:48px;height:48px"><span>🦶</span>Kick</button>
    <button class="cc-btn" data-b="view" style="left:82px;bottom:calc(58% + 12px);width:50px;height:50px"><span>👁</span>View</button>
    <button class="cc-btn" data-b="swap" style="left:210px;bottom:calc(58% + 12px);width:50px;height:50px"><span>⇄</span>Swap</button>
    <button class="cc-btn" data-b="use" style="right:240px;bottom:228px;width:58px;height:58px;display:none"><span>✋</span>Use</button>
  </div>
  <div class="cc-screen on" data-s="menu">
    <h1><small>GET BETTER ARENA</small>Compound Clash</h1>
    <p>16 fighters. One walled compound. A shrinking zone. Be the last one standing.</p>
    <div class="cc-load"><i data-k="load"></i></div><p data-k="loadt" style="font-size:13px">Loading soldiers…</p>
    <div class="cc-row" data-k="menurow" style="display:none">
      <div class="cc-seg" data-k="diff"><button data-d="0.8">Easy</button><button data-d="1" class="on">Normal</button><button data-d="1.25">Hard</button></div>
    </div>
    <div class="cc-row" data-k="menurow2" style="display:none"><div class="cc-seg" data-k="assist"><button data-a="1" class="on">Auto-aim on</button><button data-a="0">Auto-aim off</button></div></div>
    <div class="cc-row" data-k="menurow3" style="display:none"><div class="cc-seg" data-k="online"><button data-o="1" class="on">Online players + bots</button><button data-o="0">Solo (bots only)</button></div></div>
    <p data-k="netst" style="font-size:13px;opacity:.8;margin:2px 0"></p>
    <div class="cc-sens" data-k="sensrow" style="display:none">Look speed <input type="range" min="0.4" max="2.2" step="0.05" data-k="sens"></div>
    <div class="cc-row"><button class="cc-b" data-k="play" style="display:none">Deploy</button><button class="cc-b alt" data-k="exit1">Exit</button></div>
    <div class="cc-keys" data-k="keys"></div>
  </div>
  <div class="cc-screen" data-s="pause"><h1>Paused</h1><div class="cc-row"><button class="cc-b" data-k="resume">Resume</button><button class="cc-b alt" data-k="quit">Leave match</button></div></div>
  <div class="cc-screen" data-s="end"><h1 data-k="endt">Game over</h1><p data-k="endsub"></p>
    <div class="cc-stat"><div>Place<b data-k="eplace">#1</b></div><div>Kills<b data-k="ekills">0</b></div><div>Score<b data-k="escore">0</b></div></div>
    <div class="cc-row"><button class="cc-b" data-k="again">Play again</button><button class="cc-b alt" data-k="exit2">Exit</button></div></div>`;
  document.body.appendChild(root);
  const U = { root, canvas: root.querySelector('.cc-gl'), hud: root.querySelector('.cc-hud'), hurt: root.querySelector('.cc-hurt'), scope: root.querySelector('.cc-scope'), map: root.querySelector('.cc-map'), feed: root.querySelector('.cc-feed'), xh: root.querySelector('.cc-xh'), prompt: root.querySelector('.cc-prompt'), lock: root.querySelector('.cc-lock'), banner: root.querySelector('.cc-banner'), dmg: root.querySelector('.cc-dmg'), tags: root.querySelector('.cc-tags'), touch: root.querySelector('.cc-touch'), joy: root.querySelector('.cc-joy'), look: root.querySelector('.cc-look'), screens: {} };
  root.querySelectorAll('[data-k]').forEach((e) => { U[e.dataset.k] = e; });
  root.querySelectorAll('[data-s]').forEach((e) => { U.screens[e.dataset.s] = e; });
  U.btn = {}; root.querySelectorAll('[data-b]').forEach((e) => { U.btn[e.dataset.b] = e; });
  U.keys.innerHTML = TOUCH
    ? '<span><b>Left pad</b> move (push fully = sprint)</span><span><b>Drag right</b> look</span><span><b>Fire / Zoom</b> shoot, tap Zoom for 2x / 4x scope</span><span><b>Roll</b> dodge bullets</span><span><b>Hit / Kick</b> melee</span><span><b>Use</b> pick up loot</span>'
    : '<span><b>WASD</b> move</span><span><b>Mouse</b> look</span><span><b>Click</b> fire · <b>Right-click</b> aim · <b>Z / wheel</b> 2x-4x</span><span><b>Shift</b> sprint</span><span><b>Space</b> jump</span><span><b>C</b> roll</span><span><b>R</b> reload</span><span><b>F</b> punch / slash</span><span><b>V</b> kick</span><span><b>E</b> pick up</span><span><b>1 / 2</b> rifle / sword</span><span><b>G</b> wave</span>';
  return U;
}

/* -------------------------------- audio ----------------------------------- */
const AU = {
  ctx: null, out: null, noise: null, rev: null, on: true, _crowd: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext, c = this.ctx = new C(), sr = c.sampleRate;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.15;
      this.out = c.createGain(); this.out.gain.value = 0.8; this.out.connect(comp); comp.connect(c.destination);
      const len = sr * 2, b = c.createBuffer(1, len, sr), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = b;
      // generated room/outdoor reverb: exponentially decaying stereo noise
      const rl = Math.floor(sr * 1.7), ib = c.createBuffer(2, rl, sr);
      for (let ch = 0; ch < 2; ch++) { const x = ib.getChannelData(ch); for (let i = 0; i < rl; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2); }
      const cv = c.createConvolver(); cv.buffer = ib; this.rev = c.createGain(); this.rev.gain.value = 0.5; this.rev.connect(cv); cv.connect(this.out);
    } catch { this.ctx = null; }
  },
  // a sound "bus": v = loudness/closeness 0..1 ; distant sounds are darker and wetter
  _bus(v = 1, wet = 0.25) {
    const c = this.ctx, g = c.createGain(); g.gain.value = Math.max(0.0001, v);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200 + 17000 * Math.pow(Math.min(1, v), 0.6); g.connect(f); f.connect(this.out);
    const w = c.createGain(); w.gain.value = wet + (1 - Math.min(1, v)) * 0.5; f.connect(w); w.connect(this.rev); return g;
  },
  // filtered noise burst (attack ~1.5 ms, exponential decay)
  _n(dur, freq, q, vol, type = 'lowpass', f2 = 0, at = 0, dest = null, rate = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate || rnd(0.85, 1.15);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur); f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.out); s.start(t, Math.random() * 0.8, dur + 0.05);
  },
  _t(freq, f2, dur, vol, type = 'sine', at = 0, dest = null) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0005, t + dur); o.connect(g); g.connect(dest || this.out); o.start(t); o.stop(t + dur + 0.03);
  },
  // voice-like grunt / shout: sawtooth through two vowel formants
  _voice(f0, dur, vol, at = 0, f1 = 650, f2 = 1100) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    for (const [fr, q, m] of [[f1, 5, 1], [f2, 6, 0.6]]) { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = fr; b.Q.value = q; const gg = c.createGain(); gg.gain.value = m; o.connect(b); b.connect(gg); gg.connect(g); }
    g.connect(this.out); o.start(t); o.stop(t + dur + 0.03);
  },
  /* ---- gunfire ---- v = closeness (1 = your own weapon) */
  shot(v = 1) {
    if (v < 0.02 || !this.ctx) return; const d = this._bus(v, v > 0.9 ? 0.22 : 0.35), own = v > 0.9;
    this._n(0.05, 2200, 0.5, 1.0, 'highpass', 0, 0, d);                        // supersonic crack
    this._n(0.16, 1800, 0.8, 0.9, 'bandpass', 260, 0, d);                      // muzzle blast body
    this._n(0.34, 900, 0.7, 0.55, 'lowpass', 120, 0.01, d);                    // gas roar
    this._t(150, 42, 0.2, own ? 1.0 : 0.8, 'sine', 0, d);                      // low thump
    this._t(95, 35, 0.3, 0.5, 'triangle', 0.005, d);
    if (own) { this._n(0.025, 3500, 2, 0.35, 'bandpass', 0, 0.045, d); this._n(0.04, 1500, 2, 0.2, 'bandpass', 0, 0.09, d); }   // action clack + brass
    this._n(0.55, 500, 0.6, 0.35 * (1 - v * 0.4), 'lowpass', 100, 0.1, d);    // distant slap-back echo
  },
  reload() {
    this._n(0.03, 2800, 4, 0.5, 'bandpass'); this._t(900, 400, 0.04, 0.2, 'square');                                   // mag release
    this._n(0.12, 1400, 1.5, 0.25, 'bandpass', 500, 0.12);                                                           // mag slides out
    this._n(0.05, 900, 2, 0.5, 'bandpass', 0, 0.62); this._t(210, 90, 0.07, 0.5, 'triangle', 0.62); this._n(0.03, 3600, 4, 0.4, 'bandpass', 0, 0.68); // mag seats
    this._n(0.04, 2400, 3, 0.45, 'bandpass', 0, 1.1); this._t(1400, 600, 0.05, 0.25, 'square', 1.1);                  // charging handle back
    this._n(0.05, 1800, 3, 0.55, 'bandpass', 0, 1.3); this._t(300, 120, 0.06, 0.4, 'triangle', 1.3);                  // bolt forward
  },
  dry() { this._n(0.02, 3000, 5, 0.35, 'bandpass'); this._t(1800, 900, 0.03, 0.15, 'square'); },
  whiz(v = 1) { if (!this.ctx) return; const p = rnd(0.9, 1.3); this._n(0.2, 5200 * p, 3, 0.35 * v, 'bandpass', 1500 * p); },
  impact(v = 1, soft = false) { if (v < 0.03 || !this.ctx) return; const d = this._bus(v, 0.15); this._n(0.05, soft ? 500 : 2600, 1, 0.7, soft ? 'lowpass' : 'bandpass', 0, 0, d); this._t(soft ? 120 : 260, 80, 0.06, 0.3, 'sine', 0, d); if (!soft && Math.random() < 0.4) this._n(0.35, 3800, 6, 0.18, 'bandpass', 1400, 0.03, d); },  // dirt thud / ricochet zing
  hit() { this._t(260, 110, 0.06, 0.45, 'sine'); this._n(0.045, 2000, 1.5, 0.5, 'bandpass'); },                           // you hit someone: meaty tick
  head() { this._t(1900, 1500, 0.22, 0.28, 'sine'); this._t(2850, 2400, 0.16, 0.14, 'sine'); this._t(220, 90, 0.08, 0.5, 'sine'); this._n(0.05, 3200, 2, 0.5, 'bandpass'); },
  hurt() { this._t(110, 50, 0.16, 0.7, 'sine'); this._n(0.09, 700, 1, 0.5, 'lowpass', 200); this._voice(rnd(105, 135), 0.28, 0.35, 0.02, 600, 1000); },
  step(v = 1) { this._n(0.06, rnd(300, 520), 1.2, 0.2 * v, 'lowpass', 120); this._t(rnd(70, 95), 45, 0.07, 0.18 * v, 'sine'); },
  swing(heavy) { const d = heavy ? 0.3 : 0.2; this._n(d, 450, 1.2, heavy ? 0.4 : 0.28, 'bandpass', 2600, 0, null, 1); this._n(d * 0.8, 3000, 1.5, 0.12, 'bandpass', 800, d * 0.3); },   // air whoosh
  whack(heavy) { // fist/leather on body
    const k = heavy ? 1 : 0.7; this._t(heavy ? 130 : 160, 48, heavy ? 0.22 : 0.14, 0.95 * k, 'sine'); this._n(0.06, 2400, 1.2, 0.55 * k, 'bandpass');
    this._n(heavy ? 0.16 : 0.1, 700, 0.8, 0.6 * k, 'lowpass', 150); this._voice(rnd(90, 120), heavy ? 0.3 : 0.18, 0.22 * k, 0.02, 520, 900);
  },
  punch(heavy) { this.whack(heavy); },
  block() { this._t(110, 60, 0.1, 0.55, 'sine'); this._n(0.07, 500, 1, 0.5, 'lowpass', 180); this._n(0.03, 1800, 2, 0.25, 'bandpass'); },
  ko() { this._t(80, 30, 0.7, 1.0, 'sine'); this._n(0.5, 500, 0.7, 0.7, 'lowpass', 90); this._t(150, 45, 0.3, 0.8, 'sine', 0.05); this._voice(120, 0.5, 0.3, 0.05, 500, 850); },
  pick() { this._t(660, 660, 0.09, 0.28, 'triangle'); this._t(990, 990, 0.12, 0.28, 'triangle', 0.08); this._t(1320, 1320, 0.2, 0.22, 'sine', 0.16); },
  zone() { for (let i = 0; i < 3; i++) { this._t(440, 440, 0.18, 0.2, 'sawtooth', i * 0.3); this._t(330, 330, 0.18, 0.2, 'sawtooth', i * 0.3 + 0.15); } },
  win() { [523, 659, 784, 1046].forEach((f, i) => { this._t(f, f, 0.45, 0.3, 'triangle', i * 0.15); this._t(f * 2, f * 2, 0.4, 0.1, 'sine', i * 0.15); }); },
  lose() { [392, 330, 262].forEach((f, i) => { this._t(f, f * 0.92, 0.5, 0.32, 'triangle', i * 0.25); this._t(f / 2, f / 2, 0.5, 0.2, 'sine', i * 0.25); }); },
  bell() { if (!this.ctx) return; const d = this._bus(1, 0.4); for (let k = 0; k < 3; k++) for (const [m, a, dc] of [[1, 0.35, 1.8], [2.76, 0.25, 1.2], [5.4, 0.15, 0.8], [8.9, 0.08, 0.5]]) this._t(1050 * m, 1040 * m, dc, a, 'sine', k * 0.18, d); this._n(0.03, 4000, 2, 0.4, 'highpass', 0, 0, d); },
  cheer() { if (!this.ctx) return; const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.7; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.3); g.gain.linearRampToValueAtTime(0.35, t + 1.0); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2); s.connect(f); f.connect(g); g.connect(this.out); s.start(t); s.stop(t + 2.3); for (let i = 0; i < 12; i++) this._n(0.04, 2200, 1, 0.12, 'bandpass', 0, 0.1 + Math.random() * 1.4); },   // roar + claps
  crowd(on) { // looping arena murmur
    if (!this.ctx) return; const c = this.ctx;
    if (!on) { if (this._crowd) { try { this._crowd.g.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.6); this._crowd.s.stop(c.currentTime + 0.7); } catch {} this._crowd = null; } return; }
    if (this._crowd) return; const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.5; const g = c.createGain(); g.gain.value = 0.0001; g.gain.linearRampToValueAtTime(0.07, c.currentTime + 1.5);
    const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.23; lg.gain.value = 0.03; l.connect(lg); lg.connect(g.gain); l.start(); s.connect(f); f.connect(g); g.connect(this.out); s.start(); this._crowd = { s, g };
  },
};
for (const k of Object.keys(AU)) if (typeof AU[k] === 'function' && k !== 'init') { const fn = AU[k]; AU[k] = function (...a) { try { return fn.apply(this, a); } catch (e) { return undefined; } }; }

/* ========================================================================== */
/*  RENDERER · SKY · LIGHT                                                    */
/* ========================================================================== */
const U = buildUI();
const MOBILE = TOUCH;
const renderer = new THREE.WebGLRenderer({ canvas: U.canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.25 : 2));
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
/* One whole animation at a time with a short crossfade (the way your old gamers.js did it).
   Walk / Run / Run_Left / Run_Right / Run_Back follow your movement direction, Run_Shoot / Gun_Shoot / Idle_Gun_Shoot play while firing,
   Roll / Kick / Wave / Interact / Death / Punch / Sword_Slash are one-shots. Clips are used exactly as authored (no splitting, no edits). */
class Rig {
  constructor(model, clips, onStep) {
    this.model = model; this.mixer = new THREE.AnimationMixer(model); this.onStep = onStep; this.clips = {}; this.acts = {};
    clips.forEach((c) => { this.clips[c.name.toLowerCase()] = c; });
    this.cur = null; this.curName = ''; this.clock = 0; this.dead = false; this.one = null; this.full = null; this.over = null; this.shootUntil = 0; this.dist = 0;
  }
  has(n) { return !!this.clips[n.toLowerCase()]; }
  dur(n) { const c = this.clips[n.toLowerCase()]; return c ? c.duration : 0.8; }
  act(n) { const k = n.toLowerCase(); if (!(k in this.acts)) this.acts[k] = this.clips[k] ? this.mixer.clipAction(this.clips[k]) : null; return this.acts[k]; }
  go(name, o = {}) {
    const a = this.act(name); if (!a) return false; const { loop = true, fade = 0.14, speed = 1, clamp = false, force = false } = o;
    if (this.curName === name && !force) { a.timeScale = speed; return true; }
    const prev = this.cur; if (prev && prev !== a) prev.fadeOut(fade);
    a.reset(); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1); a.clampWhenFinished = clamp; a.timeScale = speed; a.fadeIn(fade).play();
    this.cur = a; this.curName = name; return true;
  }
  oneShot(name, o, melee) {
    if (this.dead || !this.has(name)) return 0; const prio = o.prio || (melee ? 3 : 5);
    if (this.one && this.one.prio > prio && this.clock < this.one.until) return 0;
    const d = o.dur || this.dur(name) / (o.speed || 1);
    this.go(name, { loop: false, clamp: true, fade: o.fin ?? 0.08, speed: this.dur(name) / d, force: true });
    this.one = { until: this.clock + d, prio, hold: !!o.hold, melee }; this.full = melee ? null : this.one; this.over = melee ? { until: this.clock + d, prio } : null; if (o.hold) this.dead = true; return d;
  }
  playFull(name, o = {}) { return this.oneShot(name, o, false); }
  playOver(name, o = {}) {
    if ((o.prio || 1) >= 3) return this.oneShot(name, o, true);
    if (this.dead) return 0; const d = o.dur || 0.4; this.over = { until: this.clock + d, prio: o.prio || 1 }; return d;   // reload / flinch: no clip, the body keeps moving
  }
  fire() { this.shootUntil = this.clock + 0.16; }
  update(dt, p) {
    this.clock += dt;
    if (this.over && this.clock >= this.over.until) this.over = null;
    if (this.one && !this.one.hold && this.clock >= this.one.until) { this.one = null; this.full = null; this.curName = ''; }
    if (!this.one) {
      const sp = p.speed, st = p.stance, shooting = this.clock < this.shootUntil && st === 'rifle'; let name, ts = 1;
      if (sp > 0.6) {
        if (shooting) name = 'Run_Shoot';
        else if (Math.abs(p.rgt) > Math.abs(p.fwd) * 1.15) name = p.rgt > 0 ? 'Run_Right' : 'Run_Left';
        else if (p.fwd < -0.1) name = 'Run_Back';
        else name = sp < CFG.RUN * 0.5 ? 'Walk' : 'Run';
        ts = clamp(sp / (name === 'Walk' ? 5.5 : CFG.RUN * 0.9), 0.6, 1.9); if (p.air) ts = Math.min(ts, 0.8);
      } else if (shooting) name = p.aim ? 'Gun_Shoot' : 'Idle_Gun_Shoot';
      else name = st === 'sword' ? 'Idle_Sword' : st === 'relaxed' || st === 'fist' ? 'Idle_Neutral' : p.aim ? 'Idle_Gun_Pointing' : 'Idle_Gun';
      if (!this.has(name)) name = this.has('Run') && sp > 0.6 ? 'Run' : 'Idle';
      this.go(name, { fade: 0.12, speed: ts });
      this.dist += sp * dt; if (this.dist > 2.6) { this.dist = 0; if (!p.air && sp > 3) this.onStep && this.onStep(clamp(sp / CFG.RUN, 0.3, 1)); }
    }
    this.mixer.update(dt);
  }
  revive() { this.dead = false; this.one = null; this.full = null; this.over = null; this.curName = ''; }
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
    out.head = findBone(model, /^head$/i) || findBone(model, /head/i);
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
        const back = sign > 0 ? rb.min[ai] : rb.max[ai], front = sign > 0 ? rb.max[ai] : rb.min[ai], grip = ctr.clone(); grip[ai] = back; // origin of the rifle root = the butt of the stock
        const tip = ctr.clone(); tip[ai] = front; mz.position.copy(tip); r.add(mz); r.scale.setScalar(s); r.position.copy(grip).multiplyScalar(-s); root.add(r);
      } else {
        r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.9), new THREE.MeshStandardMaterial({ color: '#2a2f38', metalness: 0.6, roughness: 0.4 })); r.castShadow = true; r.position.z = 0.45; mz.position.set(0, 0, 0.45); r.add(mz); root.add(r);
      }
      const axis = new THREE.Vector3(); axis[ai] = ASSETS.rifle ? sign : 1; scene.add(root);
      out.rifle = root; out.muzzle = mz; out.world = true; out.hand = bone; out.axis = axis; out.up = upV;
      // two-hand hold: find both arm chains (wrist -> forearm -> upper arm) for IK
      const chain = (w) => { const l = w && w.parent && w.parent.isBone ? w.parent : null, u = l && l.parent && l.parent.isBone ? l.parent : null; return u && l ? { u, l, w } : null; };
      const wL = findBone(model, /^wrist.?l$/i) || findBone(model, /wrist.?l|hand.?l|left.?hand|palm.?l/i);
      out.armR = chain(bone); out.armL = chain(wL);
      const axisS = axis.clone();
      axis.copy(axisS);
      var swAxis = axisS;
      const sw = makeSword(0.95); sw.scale.setScalar(sc); sw.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), swAxis || new THREE.Vector3(0, 1, 0)); sw.position.set(0, 0.05, 0.05); bone.add(sw); sw.visible = false; out.sword = sw;
      out.gloves = [];   // boxing gloves on both wrists (only shown in 'fist' stance)
      for (const wb of [bone, wL]) if (wb) { const gm = new THREE.Mesh(new THREE.SphereGeometry(0.15 * sc, 14, 10), new THREE.MeshStandardMaterial({ color: '#e11d48', roughness: 0.45, metalness: 0.05 })); gm.scale.set(1, 1, 1.18); gm.castShadow = true; gm.visible = false; wb.add(gm); out.gloves.push(gm); }
    }
  } else {
    const p = makeProcSoldier(tint); pivot.add(p.root); out.rig = new FakeRig(p);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.85), new THREE.MeshStandardMaterial({ color: '#222' })); r.position.set(0.38, 1.2, 0.4); p.root.add(r); out.rifle = r;
    const mz = new THREE.Object3D(); mz.position.set(0, 0, 0.45); r.add(mz); out.muzzle = mz;
    const sw = makeSword(0.9); sw.position.set(0.38, 1.1, 0.2); sw.rotation.x = Math.PI / 2; p.root.add(sw); sw.visible = false; out.sword = sw;
  }
  return out;
}

const _fwd = new THREE.Vector3(), _hf = new THREE.Vector3(), _rt = new THREE.Vector3(), _up = new THREE.Vector3(), _want = new THREE.Vector3(), _cr = new THREE.Vector3(), _S = new THREE.Vector3(), _gp = new THREE.Vector3(), _pole = new THREE.Vector3();
const _rq = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3(), _B2 = new THREE.Vector3(), _T = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _ax = new THREE.Vector3();
function rotBone(bone, from, to) {                         // rotate a bone in WORLD space so `from` direction points along `to`
  _dq.setFromUnitVectors(from, to); bone.getWorldQuaternion(_wq); _wq.premultiply(_dq);
  bone.parent.getWorldQuaternion(_pq); _pq.invert(); bone.quaternion.copy(_pq.multiply(_wq)); bone.updateMatrixWorld(true);
}
/** two-bone IK: put the wrist on `target`, elbow pushed toward `pole`. w = blend with the animation (0..1) */
function solveArm(arm, target, pole, w) {
  if (!arm || w < 0.01) return;
  const { u, l, w: wr } = arm, qu = u.quaternion.clone(), ql = l.quaternion.clone();
  u.getWorldPosition(_A); l.getWorldPosition(_B); wr.getWorldPosition(_C);
  const L1 = _A.distanceTo(_B), L2 = _B.distanceTo(_C); if (L1 < 1e-4 || L2 < 1e-4) return;
  _T.copy(target).sub(_A); const D0 = _T.length() || 1e-4, D = clamp(D0, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3); _ax.copy(_T).divideScalar(D0);
  const x = (L1 * L1 - L2 * L2 + D * D) / (2 * D), h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  _pole.copy(pole).addScaledVector(_ax, -pole.dot(_ax)); if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0); _pole.normalize();
  _B2.copy(_A).addScaledVector(_ax, x).addScaledVector(_pole, h);
  _d1.copy(_B).sub(_A).normalize(); _d2.copy(_B2).sub(_A).normalize(); rotBone(u, _d1, _d2);
  l.getWorldPosition(_B); wr.getWorldPosition(_C); _d1.copy(_C).sub(_B).normalize(); _d2.copy(_A).addScaledVector(_ax, D).sub(_B).normalize(); rotBone(l, _d1, _d2);
  if (w < 0.999) { const nu = u.quaternion.clone(), nl = l.quaternion.clone(); u.quaternion.copy(qu).slerp(nu, w); l.quaternion.copy(ql).slerp(nl, w); }
  u.updateMatrixWorld(true);
}
function placeRifle(f) {
  const m = f.m; if (!m.world) return;
  const dt = f.dt || 0.016, rg = f.rig, melee = rg.over && rg.over.prio >= 3, show = f.alive && f.stance === 'rifle' && !rg.full && !melee;
  f.ikW = damp(f.ikW || 0, show ? 1 : 0, 16, dt); m.rifle.visible = show; if (!show) return;
  f.group.updateMatrixWorld(true);
  let p = f.aimPitch || 0; if (f.reloadT > 0) p = -0.4; else if (f.inp.sprint && f.speed > CFG.RUN * 0.9 && f.fireCd < -0.3) p = -0.5;
  f._pit = f._pit === undefined ? p : damp(f._pit, p, 12, dt); p = f._pit;
  const cp = Math.cos(p), sy = Math.sin(f.yaw), cyw = Math.cos(f.yaw);
  _fwd.set(sy * cp, Math.sin(p), cyw * cp); _hf.set(sy, 0, cyw); _rt.set(-cyw, 0, sy);
  _rq.setFromUnitVectors(m.axis, _fwd);                                                       // barrel -> aim direction
  _up.copy(m.up).applyQuaternion(_rq); _want.set(0, 1, 0).addScaledVector(_fwd, -_fwd.y).normalize();
  _cr.crossVectors(_up, _want); _rq2.setFromAxisAngle(_fwd, Math.atan2(_fwd.dot(_cr), _up.dot(_want))); _rq.premultiply(_rq2); // sights up
  m.rifle.quaternion.copy(_rq); _up.copy(m.up).applyQuaternion(_rq);
  // butt of the stock sits in the shoulder pocket
  (m.armR ? m.armR.u : m.hand).getWorldPosition(_S);
  m.rifle.position.copy(_S).addScaledVector(_hf, CFG.STOCK_FWD).addScaledVector(_rt, -CFG.STOCK_SIDE).addScaledVector(_fwd, -(f.kick || 0)); m.rifle.position.y -= CFG.STOCK_DOWN;
  m.rifle.updateMatrixWorld(true);
  const L = CFG.RIFLE_LEN, rp = m.rifle.position;
  if (m.armR) { _gp.copy(rp).addScaledVector(_fwd, L * CFG.GRIP_R).addScaledVector(_up, -0.07); _pole.copy(_rt).multiplyScalar(0.6).y -= 1; solveArm(m.armR, _gp, _pole, f.ikW); }
  if (m.armL) {
    if (f.reloadT > 0) _gp.copy(rp).addScaledVector(_fwd, L * 0.36).addScaledVector(_up, -(0.26 + Math.sin(f.reloadT * 16) * 0.04));   // hand dips to the magazine
    else _gp.copy(rp).addScaledVector(_fwd, L * CFG.GRIP_L).addScaledVector(_up, -0.03);
    _pole.copy(_rt).multiplyScalar(-0.6).y -= 1; solveArm(m.armL, _gp, _pole, f.ikW);
  }
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
    this.m = m; this.group = m.group; this.rig = m.rig; this.speed = 0; scene.add(this.group); fighters.push(this); this.setStance(BOX ? 'fist' : 'rifle');
  }
  setStance(s) { this.stance = s; if (this.m.rifle) this.m.rifle.visible = s === 'rifle'; if (this.m.sword) this.m.sword.visible = s === 'sword'; if (this.m.gloves) for (const g of this.m.gloves) g.visible = s === 'fist'; }
  glove(col) { if (this.m.gloves) for (const g of this.m.gloves) g.material.color.set(col); }
  spawnAt(x, z) { this.x = x; this.z = z; this.y = groundAt(x, z, 0.3); this.dispY = this.y; this.vx = this.vy = this.vz = 0; this.group.position.set(x, this.y, z); }
  get head() { return { x: this.x, y: this.y + 1.62, z: this.z }; }
  get eye() { return { x: this.x, y: this.y + 1.5, z: this.z }; }
  doRoll() {
    if (!this.alive || this.rollCd > 0 || this.rollT > 0 || this.lockT > 0) return false;
    if (BOX) { if (this.stun > 0 || this.stam < 18) return false; this.stam -= 18; this.blocking = false; }
    let dx = this.inp.mx, dz = this.inp.mz; if (Math.hypot(dx, dz) < 0.1) { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); }
    const l = Math.hypot(dx, dz); this.rollDX = dx / l; this.rollDZ = dz / l; this.rollYaw = Math.atan2(dx, dz);
    this.rollT = CFG.ROLL_TIME; this.rollCd = CFG.ROLL_CD; this.iframe = CFG.ROLL_TIME * 0.85; this.reloadT = 0;
    this.rig.playFull('Roll', { dur: CFG.ROLL_TIME, fin: 0.05, fout: 0.12 }); AU.swing(); if (this.isPlayer) netEmit('roll'); return true;
  }
  startReload() {
    if (!this.alive || this.reloadT > 0 || this.mag >= WEAPON.mag || this.reserve <= 0 || this.stance !== 'rifle' || this.rollT > 0) return;
    this.reloadT = WEAPON.reload; this.rig.playOver('Interact', { dur: WEAPON.reload, prio: 2, fin: 0.12, fout: 0.2 }); if (this.isPlayer) AU.reload();
  }
  melee(kind) {
    const M = MELEE[kind]; if (!this.alive || this.meleeCd > 0 || this.rollT > 0) return false;
    if (BOX) { if (this.stun > 0 || this.blocking || this.stam < M.cost) return false; this.stam -= M.cost; this.lastAtk = G.t; }
    this.atkT = G.t; this.atkK = kind; this.atkSide = kind === 'heavy' ? 1 : this.punchSide % 2; this.meleeCd = M.cd * (BOX && this.spd > 0 ? 0.7 : 1); this.reloadT = 0;
    if (kind === 'heavy') { this.rig.playOver('Punch_Right', { dur: 0.58, prio: 3, fin: 0.05, fout: 0.12 }); }
    else if (kind === 'punch') { this.rig.playOver(this.punchSide++ % 2 ? 'Punch_Right' : 'Punch_Left', { dur: BOX ? 0.3 : 0.42, prio: 3, fin: 0.04, fout: 0.1 }); }
    else if (kind === 'kick') { this.rig.playFull(this.kickSide++ % 2 ? 'Kick_Right' : 'Kick_Left', { dur: 0.8, fin: 0.06, fout: 0.16 }); this.lockT = 0.5; }
    else this.rig.playOver('Sword_Slash', { dur: 0.6, prio: 3, fin: 0.04, fout: 0.12 });
    AU.swing(kind === 'heavy'); if (this.isPlayer) netEmit(kind); later(M.delay, () => meleeHit(this, kind)); return true;
  }
  flinch() { this.rig.playOver(Math.random() < 0.5 ? 'HitRecieve' : 'HitRecieve_2', { dur: 0.4, prio: 1, fin: 0.03, fout: 0.14 }); }
  interact(cb) { if (!this.alive || this.rollT > 0) return; this.rig.playFull('Interact', { dur: 0.9, fin: 0.1, fout: 0.2 }); this.lockT = 0.9; later(0.45, cb); }
  wave() { if (this.alive && this.isPlayer) netEmit('wave'); if (this.alive) this.rig.playFull('Wave', { dur: Math.min(2.4, this.rig.dur('Wave')), fin: 0.15, fout: 0.2 }); }
  update(dt) {
    if (this.remote) return this.updateRemote(dt);
    if (!this.alive) { this.dt = dt; this.deadT += dt; this.vx = damp(this.vx, 0, 8, dt); this.vz = damp(this.vz, 0, 8, dt); moveBody(this, dt); this.group.position.set(this.x, this.y, this.z); this.rig.update(dt, { fwd: 0, rgt: 0, speed: 0, air: false, stance: this.stance, aim: false, sprint: false }); placeRifle(this); return; }
    this.fireCd -= dt; this.meleeCd -= dt; this.rollCd -= dt; this.iframe -= dt; this.lockT -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const t = Math.min(WEAPON.mag - this.mag, this.reserve); this.mag += t; if (this.isPlayer) this.reserve -= t; } }
    this.coyote = this.grounded ? 0.1 : this.coyote - dt;
    if (this.inp.jump) { this.jumpBuf = 0.12; this.inp.jump = false; } this.jumpBuf -= dt;
    if (this.rollT > 0) { this.rollT -= dt; this.vx = this.rollDX * CFG.ROLL_SPEED; this.vz = this.rollDZ * CFG.ROLL_SPEED; this.yaw = this.rollYaw; }
    else {
      let sp = this.inp.speed; if (this.lockT > 0) sp *= 0.2;
      const k = this.grounded ? 24 : 4.5; this.vx = damp(this.vx, this.inp.mx * sp, k, dt); this.vz = damp(this.vz, this.inp.mz * sp, k, dt);
      if (this.jumpBuf > 0 && this.coyote > 0 && this.lockT <= 0) { this.vy = CFG.JUMP; this.grounded = false; this.coyote = 0; this.jumpBuf = 0; this.y += 0.02; }
    }
    moveBody(this, dt);
    this.dispY = this.grounded ? damp(this.dispY, this.y, 24, dt) : this.y; if (Math.abs(this.dispY - this.y) > 0.9) this.dispY = this.y;
    this.group.position.set(this.x, this.dispY, this.z); this.group.rotation.y = this.yaw;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    this.speed = Math.hypot(this.vx, this.vz); this.dt = dt; this.kick = Math.max(0, (this.kick || 0) - dt * 0.9);
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
  if (target.remote) {   // a real player: only a real hit from you counts; their own client applies the damage
    if (!attacker || !attacker.isPlayer || !target.uid) return false;
    netQueueHit(target, amt, o); if (BOX) G.bx.dealt += amt; hitMarker(o.head); o.head ? AU.head() : AU.hit(); dmgNumber(target.x, target.y + 2, target.z, amt, o.head); target.hp = Math.max(1, target.hp - amt); return true;
  }
  if (BOX) return bxHit(target, amt, attacker, o);
  let a = amt; if (target.armor > 0) { const ab = Math.min(target.armor, a * 0.5); target.armor -= ab; a -= ab; }
  target.relax = false; target.hp -= a; target.lastHit = G.t; target.lastAttacker = attacker;
  if (a > 7 && Math.random() < 0.6 && !target.isPlayer) target.flinch();
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
  if (t.isPlayer) { G.aliveAtDeath = G.alive + 1; netDeath(by, kind); later(2.4, () => endMatch(false, by)); }
}
function meleeHit(f, kind) {
  if (BOX) return bxMeleeHit(f, kind);
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
  } else { fxBurst(end, '#ffd9a0', 5, 3.2, 1); AU.impact(Math.pow(clamp(1 - distToPlayer(end.x, end.z) / 40, 0, 1), 1.5)); }
  if (isBot && !r.who) { const dp = distToPlayer(f.x, f.z); if (dp < 45 && Math.random() < 0.35) AU.whiz(1 - dp / 60); }
  return r;
}
function playerFire() {
  const P = G.player; if (!P.alive || P.stance !== 'rifle' || P.fireCd > 0 || P.rollT > 0 || P.lockT > 0) return;
  if (P.reloadT > 0) return; if (P.mag <= 0) { P.startReload(); return; }
  P.mag--; P.fireCd = WEAPON.rate; NET.fs++; NET.sendT = Math.min(NET.sendT, 0.05);
  P.lastFire = G.t; const zl = zoomLevel(), moving = clamp(P.speed / CFG.RUN, 0, 1.4), spread = (P.aiming ? 0.0035 / Math.max(1, zl) : 0.011) + moving * 0.012 + (P.grounded ? 0 : 0.02) + G.bloom;
  const d = camDir(G.cam.yaw + rnd(-1, 1) * spread, G.cam.pitch + G.cam.recoil + rnd(-1, 1) * spread), o = { x: camera.position.x + d.x * G.cam.dist, y: camera.position.y + d.y * G.cam.dist, z: camera.position.z + d.z * G.cam.dist };
  if (G.lock && G.lock.alive && G.assist) { const T = G.lock, tx = T.x - o.x, ty = T.y + 1.35 - o.y, tz = T.z - o.z, tl = Math.hypot(tx, ty, tz) || 1, dot = (d.x * tx + d.y * ty + d.z * tz) / tl; if (dot > 0.985) { d.x = lerp(d.x, tx / tl, 0.6); d.y = lerp(d.y, ty / tl, 0.6); d.z = lerp(d.z, tz / tl, 0.6); const dl = Math.hypot(d.x, d.y, d.z); d.x /= dl; d.y /= dl; d.z /= dl; } }   // bullet magnetism toward the locked enemy
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
  for (const f of fighters) if (f.alive && !f.remote && f !== G.showcase && Math.hypot(f.x - Z.cx, f.z - Z.cz) > Z.r) { f.hp -= Z.dps * dt; if (f.isPlayer) { U.hurt.style.opacity = 0.35 + Math.sin(G.t * 8) * 0.1; } if (f.hp <= 0) kill(f, null, 'zone'); }
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
    if (c === f || !c.alive || c.remote || c === G.showcase) continue; const dx = c.x - f.x, dz = c.z - f.z, d = Math.hypot(dx, dz); if (d > bd) continue;
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
  for (const c of fighters) { if (!c.alive || c === f || c.remote || c === G.showcase) continue; const r = rayFighter(o.x, o.y, o.z, d.x, d.y, d.z, c, t); if (r.t < t) { t = r.t; who = c; head = r.head; } }
  const end = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
  fxTracer(m, end, '#ffb07a'); fxFlash(m, 0.6);
  if (who && (forceHit || who !== T)) { damage(who, rnd(5.5, 8.5) * (who.isPlayer ? G.diff : 0.5) * (head && Math.random() < 0.15 ? 1.6 : 1), f, { head, kind: 'rifle' }); fxBurst(end, '#ff5d73', 4, 3); }
  else if (!who) fxBurst(end, '#ffd9a0', 4, 3, 1);
  return t;
}

/* ========================================================================== */
/*  ONLINE PLAYERS  (Firebase, loaded lazily so the game still works solo)    */
/*  Hybrid model: every client runs its own bots + zone; real players appear  */
/*  as "ghost" fighters driven by their position doc. Shooters detect hits;   */
/*  the victim's client applies damage and announces kills.                   */
/* ========================================================================== */
const FBCFG = { apiKey: 'AIzaSyC9jF-ocy6HjsVzWVVlAyXW-4aIFgA79-A', authDomain: 'crypto-6517d.firebaseapp.com', projectId: 'crypto-6517d', storageBucket: 'crypto-6517d.firebasestorage.app', messagingSenderId: '60263975159', appId: '1:60263975159:web:bd53dcaad86d6ed9592bf2' };
const NET = {
  on: store.get('online', 1) !== 0, ready: false, joined: false, initP: null, token: 0, uid: null, fsm: null, db: null, unsubs: [],
  remotes: new Map(), sendT: 0, hbT: 0, hb: 0, last: '', fs: 0, ev: '', evs: 0, hitQ: new Map(), hitT: 0, msg: '', warned: false,
};
const r2 = (v) => Math.round(v * 100) / 100;
function netStatus(t) { NET.msg = t; if (U.netst) U.netst.textContent = t; }
function netErr(e) {
  const c = (e && e.code) || '';
  if (!NET.warned) { NET.warned = true; feed(c === 'permission-denied' ? '🌐 Online blocked — Firestore rules not added yet' : '🌐 Online connection problem — bots only', true); }
  netStatus(c === 'permission-denied' ? 'Online blocked: add the Firestore rules (see README)' : 'Online unavailable right now — playing with bots');
}
function netInit() {
  if (NET.initP) return NET.initP;
  return (NET.initP = (async () => {
    try {
      if (navigator.onLine === false) throw new Error('offline');
      const B = 'https://www.gstatic.com/firebasejs/10.13.2/';
      const [A, AU_, FS] = await Promise.race([Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))]);
      const app = A.getApps().length ? A.getApp() : A.initializeApp(FBCFG), auth = AU_.getAuth(app);
      const user = await new Promise((res) => { let d = false; const fin = (u) => { if (!d) { d = true; res(u); } }; setTimeout(() => fin(auth.currentUser || null), 4500); AU_.onAuthStateChanged(auth, fin); });
      if (!user) { netStatus('Sign in to Get better to play with other people (bots only for now)'); return false; }
      NET.uid = user.uid; NET.fsm = FS; NET.db = FS.getFirestore(app); NET.ready = true; netStatus(`Online as ${PLAYER_NAME} · other players + bots`); return true;
    } catch (e) { netStatus('Offline — playing with bots'); return false; }
  })());
}
function netOff() { NET.initP = null; }
async function netJoin() {
  netLeave(); NET.warned = false; NET.failed = false;
  if (!NET.on) { netStatus('Solo mode'); return; }
  const tk = ++NET.token; netStatus('Connecting…');
  const ok = await netInit(); if (tk !== NET.token) return;
  if (!ok) { NET.failed = true; if (!NET.ready) { NET.initP = null; } feed('🌐 ' + NET.msg, true); return; }
  const { collection, doc, onSnapshot, query, where, deleteDoc } = NET.fsm, db = NET.db, uid = NET.uid;
  NET.joined = true; NET.sendT = 0; NET.hbT = 0; NET.last = ''; NET.hitQ.clear();
  let firstP = true, firstH = true, firstK = true;
  NET.unsubs.push(onSnapshot(collection(db, 'cc_players'), (snap) => {
    if (tk !== NET.token) return; const now = Date.now();
    snap.docChanges().forEach((ch) => {
      if (ch.doc.id === uid) return;
      if (ch.type === 'removed') { netRemove(ch.doc.id); return; }
      const d = ch.doc.data(); if (firstP && ch.type === 'added' && Math.abs(now - (d.ts || 0)) > 60000) return;   // leftovers from a crashed tab
      netUpsert(ch.doc.id, d);
    }); firstP = false;
  }, netErr));
  NET.unsubs.push(onSnapshot(query(collection(db, 'cc_hits'), where('to', '==', uid)), (snap) => {
    if (tk !== NET.token) return;
    snap.docChanges().forEach((ch) => { if (ch.type !== 'added') return; const d = ch.doc.data(); deleteDoc(ch.doc.ref).catch(() => {}); if (!firstH) netApplyHit(d); }); firstH = false;
  }, netErr));
  NET.unsubs.push(onSnapshot(collection(db, 'cc_kills'), (snap) => {
    if (tk !== NET.token) return;
    snap.docChanges().forEach((ch) => { if (ch.type !== 'added' || firstK) return; const d = ch.doc.data(); if (d.victim !== uid) netKillFeed(d); }); firstK = false;
  }, netErr));
  netWriteState(true); feed('🌐 Online — other players can join this match', true);
}
function netLeave() {
  NET.token++; for (const u of NET.unsubs) { try { u(); } catch {} } NET.unsubs = [];
  for (const id of [...NET.remotes.keys()]) netRemove(id);
  if (NET.joined && NET.ready) { try { NET.fsm.deleteDoc(NET.fsm.doc(NET.db, 'cc_players', NET.uid)).catch(() => {}); } catch {} }
  NET.joined = false;
}
function netRemove(id) {
  const r = NET.remotes.get(id); if (!r) return; NET.remotes.delete(id); const f = r.f;
  scene.remove(f.group); if (f.m.world && f.m.rifle) scene.remove(f.m.rifle); const i = fighters.indexOf(f); if (i >= 0) fighters.splice(i, 1);
  if (G.lock === f) G.lock = null;
}
function netUpsert(id, d) {
  let r = NET.remotes.get(id);
  if (BOX ? d.mode !== 'box' : d.mode === 'box') return;   // boxers and soldiers never mix
  if (!r) {
    if (d.alive === false || G.state !== 'playing') return;
    if (BOX && !bxAccept(id, d)) return;
    let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const f = new Fighter(String(d.name || 'Player').slice(0, 16), false, new THREE.Color().setHSL((h % 360) / 360, 0.6, 0.62));
    f.remote = true; f.uid = id; f.lastShot = -9; f.shootT = 0; f.lastFs = d.fs || 0; f.lastEvs = d.evs || 0; f.spawnAt(d.x, d.z); f.y = d.y; f.dispY = d.y; f.yaw = d.yaw || 0; f.net = d;
    r = { f, recv: performance.now() }; NET.remotes.set(id, r); if (BOX) bxPaired(f, id); else feed(`<b>${f.name}</b> joined the match`, false);
  }
  r.f.net = d; r.recv = performance.now();
}
function netWriteState(force) {
  if (!NET.joined || !G.player) return; const P = G.player;
  const s = { name: PLAYER_NAME, x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r2(P.yaw), pitch: r2(clamp(G.cam.pitch, -0.75, 1.1)), hp: Math.max(0, Math.round(P.hp)), armor: Math.round(P.armor), alive: P.alive, st: P.stance, aim: P.aiming ? 1 : 0, fs: NET.fs, ev: NET.ev, evs: NET.evs, kills: P.kills, mode: BOX ? 'box' : 'cc' };
  if (BOX) { s.blk = P.blocking ? 1 : 0; s.bs = G.bx ? G.bx.net : 'search'; s.op = G.bx ? G.bx.oppUid || '' : ''; }
  const key = JSON.stringify(s); if (!force && key === NET.last && NET.hbT > 0) return;
  NET.last = key; NET.hbT = 2; s.hb = ++NET.hb; s.ts = Date.now();
  NET.fsm.setDoc(NET.fsm.doc(NET.db, 'cc_players', NET.uid), s).catch(netErr);
}
function netEmit(ev) { NET.ev = ev; NET.evs++; NET.sendT = Math.min(NET.sendT, 0.05); }
function netQueueHit(target, amt, o) {
  const q = NET.hitQ.get(target.uid) || { dmg: 0, head: false, kind: 'rifle', fn: PLAYER_NAME }; q.dmg += amt; q.head = q.head || !!o.head; q.kind = o.kind || 'rifle'; NET.hitQ.set(target.uid, q);
}
function netApplyHit(d) {
  const P = G.player; if (!P || !P.alive || G.over || G.state !== 'playing') return;
  const r = NET.remotes.get(d.from), by = r ? r.f : { name: String(d.fn || 'Player'), x: P.x, z: P.z - 1, kills: 0, remote: true, isPlayer: false, uid: d.from };
  damage(P, clamp(Number(d.dmg) || 0, 0, 70), by, { head: !!d.head, kind: d.kind || 'rifle' });
}
const KICON = { ko: '🥊', heavy: '🥊', rifle: '🔫', punch: '🥊', kick: '🦶', sword: '⚔️', zone: '🌀' };
function netKillFeed(d) {
  const P = G.player; if (!P) return; if (BOX) { bxNetKO(d); return; } const me = d.killer === NET.uid;
  feed(`<b>${d.kn || 'Zone'}</b> ${KICON[d.kind] || '🔫'} ${d.vn}`, me);
  const v = NET.remotes.get(d.victim); if (v && v.f.alive) { v.f.alive = false; v.f.hp = 0; v.f.rig.playFull('Death', { hold: true, fin: 0.08 }); v.f.aiming = false; }
  if (me && P.alive) { P.kills++; G.streak = G.t - G.lastKillT < 9 ? G.streak + 1 : 1; G.lastKillT = G.t; banner(G.streak >= 3 ? `${['', '', '', 'TRIPLE KILL', 'QUAD KILL', 'RAMPAGE'][Math.min(G.streak, 5)]}!` : `ELIMINATED ${String(d.vn).toUpperCase()}`, G.streak >= 3 ? '#fde047' : '#fff'); }
}
function netDeath(by, kind) {
  if (!NET.joined) return; netWriteState(true);
  const k = { victim: NET.uid, killer: by && by.remote ? by.uid : '', vn: PLAYER_NAME, kn: by && by !== G.player ? by.name : 'Zone', kind: kind || 'rifle', ts: Date.now() };
  NET.fsm.addDoc(NET.fsm.collection(NET.db, 'cc_kills'), k).then((ref) => { setTimeout(() => NET.fsm.deleteDoc(ref).catch(() => {}), 20000); }).catch(netErr);
}
function netTick(dt) {
  if (!NET.joined) return;
  NET.sendT -= dt; NET.hbT -= dt; NET.hitT -= dt;
  if (NET.sendT <= 0) { NET.sendT = 0.2; netWriteState(false); }
  if (NET.hitT <= 0 && NET.hitQ.size) {
    NET.hitT = 0.15;
    for (const [to, q] of NET.hitQ) NET.fsm.addDoc(NET.fsm.collection(NET.db, 'cc_hits'), { to, from: NET.uid, dmg: Math.round(q.dmg), head: q.head, kind: q.kind, fn: q.fn }).catch(netErr);
    NET.hitQ.clear();
  }
  const now = performance.now();
  for (const [id, r] of [...NET.remotes]) if (now - r.recv > 6000 || (!r.f.alive && r.f.deadT > 10)) netRemove(id);
  if (U.netn) { setT(U.netn, NET.remotes.size + 1); U.netp.style.display = ''; }
}

/* A remote player's body: smooth toward the last received state, replay their events */
Fighter.prototype.updateRemote = function (dt) {
  const n = this.net, k = 1 - Math.exp(-12 * dt), px = this.x, pz = this.z;
  if (BOX && n.alive !== false && !this.alive) { this.alive = true; this.deadT = 0; this.rig.revive(); }
  this.blocking = !!n.blk;
  if (n.alive === false && this.alive) { this.alive = false; this.hp = 0; this.aiming = false; this.rig.playFull('Death', { hold: true, fin: 0.08 }); }
  if (!this.alive) {
    this.deadT += dt; this.group.position.set(this.x, this.y, this.z); this.group.rotation.y = this.yaw;
    this.rig.update(dt, { fwd: 0, rgt: 0, speed: 0, air: false, stance: this.stance, aim: false, sprint: false }); placeRifle(this); return;
  }
  if (Math.hypot(n.x - this.x, n.z - this.z) > 14) { this.x = n.x; this.z = n.z; this.y = n.y; } else { this.x = lerp(this.x, n.x, k); this.z = lerp(this.z, n.z, k); this.y = lerp(this.y, n.y, k); }
  this.yaw = dampAng(this.yaw, n.yaw || 0, 14, dt); this.hp = n.hp; this.armor = n.armor || 0; this.aiming = !!n.aim; this.aimPitch = clamp(n.pitch || 0, -0.5, 0.6);
  if (n.st && n.st !== this.stance) this.setStance(n.st);
  this.vx = damp(this.vx, (this.x - px) / dt, 10, dt); this.vz = damp(this.vz, (this.z - pz) / dt, 10, dt); this.speed = Math.hypot(this.vx, this.vz); this.dt = dt;
  this.rollT = Math.max(0, this.rollT - dt); this.kick = Math.max(0, (this.kick || 0) - dt * 0.9);
  this.dispY = this.y; this.group.position.set(this.x, this.y, this.z); this.group.rotation.y = this.yaw;
  if (n.evs !== this.lastEvs) { this.lastEvs = n.evs; this.netEvent(n.ev); }
  const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw), air = this.y > groundAt(this.x, this.z, this.y) + 0.45;
  this.rig.update(dt, { fwd: this.vx * fx + this.vz * fz, rgt: this.vx * rx + this.vz * rz, speed: this.speed, air, stance: this.stance, aim: this.aiming && this.stance === 'rifle', sprint: this.speed > CFG.RUN * 0.95 });
  placeRifle(this);
  if (n.fs !== this.lastFs) { this.lastFs = n.fs; this.shootT = 0.32; }
  if (this.shootT > 0 && this.alive && this.stance === 'rifle') {
    this.shootT -= dt; this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.fireCd = WEAPON.rate * 1.5; const m = muzzlePos(this, {}), d = camDir(this.yaw, this.aimPitch), t = Math.min(70, rayWorld(m.x, m.y, m.z, d.x, d.y, d.z, 70));
      fxTracer(m, { x: m.x + d.x * t, y: m.y + d.y * t, z: m.z + d.z * t }, '#ffb07a'); fxFlash(m, 0.7); this.rig.fire(this.aiming, this.speed > 3); this.kick = 0.06; this.lastShot = G.t;
      AU.shot(Math.pow(clamp(1 - distToPlayer(this.x, this.z) / 95, 0, 1), 2));
    }
  }
};
Fighter.prototype.netEvent = function (ev) {
  if (ev === 'roll') { this.rollT = CFG.ROLL_TIME; this.rig.playFull('Roll', { dur: CFG.ROLL_TIME, fin: 0.05, fout: 0.12 }); }
  else if (ev === 'heavy') this.rig.playOver('Punch_Right', { dur: 0.58, prio: 3, fin: 0.05, fout: 0.12 });
  else if (ev === 'punch') this.rig.playOver(this.punchSide++ % 2 ? 'Punch_Right' : 'Punch_Left', { dur: BOX ? 0.3 : 0.42, prio: 3, fin: 0.04, fout: 0.1 });
  else if (ev === 'kick') this.rig.playFull(this.kickSide++ % 2 ? 'Kick_Right' : 'Kick_Left', { dur: 0.8, fin: 0.06, fout: 0.16 });
  else if (ev === 'sword') this.rig.playOver('Sword_Slash', { dur: 0.6, prio: 3, fin: 0.04, fout: 0.12 });
  else if (ev === 'wave') this.wave();
};
addEventListener('pagehide', () => { try { netLeave(); } catch {} });

/* ========================================================================== */
/*  BOXING ARENA  (open gamers.html?mode=box)                                 */
/*  Same soldier, same engine. Best of 3 rounds in a ring. Jab / heavy punch, */
/*  block, dodge-roll, stamina and power-ups. Opponent = a real player if one */
/*  is searching at the same time, otherwise a bot.                           */
/* ========================================================================== */
const BXC = { RS: 8, WIN: 2, RTIME: 60, SEARCH: 8, INTRO: 3.2, WALK: 3.2, RUN: 5.6 };
const BXNAMES = ['Iron Mike', 'Rumble', 'The Hammer', 'Kid Lightning', 'Bruiser', 'Smokin’ Joe', 'Rocky', 'Jab Jab', 'Big Dre', 'El Toro'];
Object.assign(PK, {
  rage: { color: '#ef4444', name: 'RAGE · 1.8x damage' }, shield: { color: '#38bdf8', name: 'SHIELD · half damage' }, speed: { color: '#facc15', name: 'SPEED · faster' },
  heal: { color: '#34d399', name: 'HEAL +35' }, iron: { color: '#a855f7', name: 'IRON FIST · 3 mega punches' },
});
const PKI = { rage: '🔥', shield: '🛡️', speed: '⚡', heal: '❤️', iron: '💥' };

/* ---------------------------------- ring ---------------------------------- */
function buildArena() {
  const RS = BXC.RS;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ map: TEX.concrete.clone(), roughness: 1, color: '#2d3140' }));
  floor.material.map.repeat.set(160, 160); floor.material.map.needsUpdate = true; floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true; scene.add(floor);
  MAT.crowd = std(canvasTex(256, (g, s) => { g.fillStyle = '#1b1e2c'; g.fillRect(0, 0, s, s); speck(g, s, 2600, ['#e11d48', '#f59e0b', '#38bdf8', '#a78bfa', '#f4f4f5', '#22c55e', '#fb7185'], 0.7, 5); }));
  // canvas for the ring mat
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const g = cv.getContext('2d');
  g.fillStyle = '#16327a'; g.fillRect(0, 0, 512, 512); g.strokeStyle = '#ffffff'; g.lineWidth = 14; g.strokeRect(22, 22, 468, 468);
  g.fillStyle = '#e11d48'; g.beginPath(); g.arc(256, 256, 150, 0, 6.283); g.fill(); g.fillStyle = '#16327a'; g.beginPath(); g.arc(256, 256, 128, 0, 6.283); g.fill();
  g.fillStyle = '#fff'; g.font = '900 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GET', 256, 232); g.fillText('BETTER', 256, 292);
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(RS * 2, RS * 2), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.8 }));
  mat.rotation.x = -Math.PI / 2; mat.position.y = 0.352; mat.receiveShadow = true; scene.add(mat);
  // platform + skirt
  B(-RS - 1.2, 0, -RS - 1.2, RS + 1.2, 0.35, RS + 1.2, 'paint', '#20233a', true);
  // corner posts + ropes (decoration) and invisible walls (collision)
  const post = (x, z, c) => B(x - 0.18, 0.35, z - 0.18, x + 0.18, 2.0, z + 0.18, 'paint', c, false);
  post(-RS, -RS, '#e11d48'); post(RS, -RS, '#2563eb'); post(-RS, RS, '#2563eb'); post(RS, RS, '#e11d48');
  const ropeCol = ['#f8fafc', '#e11d48', '#f8fafc'];
  for (let i = 0; i < 3; i++) {
    const y = 0.35 + 0.55 + i * 0.4;
    B(-RS, y, -RS - 0.03, RS, y + 0.07, -RS + 0.03, 'paint', ropeCol[i], false); B(-RS, y, RS - 0.03, RS, y + 0.07, RS + 0.03, 'paint', ropeCol[i], false);
    B(-RS - 0.03, y, -RS, -RS + 0.03, y + 0.07, RS, 'paint', ropeCol[i], false); B(RS - 0.03, y, -RS, RS + 0.03, y + 0.07, RS, 'paint', ropeCol[i], false);
  }
  addCol({ x0: -RS - 2, z0: RS, x1: RS + 2, z1: RS + 0.5, y0: 0.3, y1: 4, q: 0 }); addCol({ x0: -RS - 2, z0: -RS - 0.5, x1: RS + 2, z1: -RS, y0: 0.3, y1: 4, q: 0 });
  addCol({ x0: RS, z0: -RS - 2, x1: RS + 0.5, z1: RS + 2, y0: 0.3, y1: 4, q: 0 }); addCol({ x0: -RS - 0.5, z0: -RS - 2, x1: -RS, z1: RS + 2, y0: 0.3, y1: 4, q: 0 });
  // stands with a crowd on all four sides
  for (let t = 0; t < 4; t++) {
    const o = RS + 5 + t * 2.6, h = 1.2 + t * 1.3, L = RS + 16;
    B(-L, 0, o, L, h, o + 2.6, 'crowd', '#ffffff', false, 3); B(-L, 0, -o - 2.6, L, h, -o, 'crowd', '#ffffff', false, 3);
    B(o, 0, -L, o + 2.6, h, L, 'crowd', '#ffffff', false, 3); B(-o - 2.6, 0, -L, -o, h, L, 'crowd', '#ffffff', false, 3);
  }
  // overhead rig: glowing light panels + a banner
  for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6], [0, 0]]) B(x - 1.6, 12, z - 1.6, x + 1.6, 12.3, z + 1.6, 'glow', '#fff3c4', false);
  B(-10, 7.5, -RS - 4, 10, 10, -RS - 3.6, 'glow', '#7c3aed', false); B(-10, 7.5, RS + 3.6, 10, 10, RS + 4, 'glow', '#e11d48', false);
  WORLD.spawns = [{ x: -4, z: 0 }, { x: 4, z: 0 }]; WORLD.mini = null;
  for (const k of Object.keys(batches)) {
    const gm = mergeGeometries(batches[k], false); const m = new THREE.Mesh(gm, MAT[k]); m.castShadow = k !== 'glow' && k !== 'crowd'; m.receiveShadow = true; scene.add(m); batches[k].forEach((x) => x.dispose());
  }
}

/* ----------------------------------- UI ----------------------------------- */
const BXCSS = `
.cc-box .cc-top,.cc-box .cc-gun,.cc-box .cc-xh,.cc-box .cc-map,.cc-box .cc-bar.ar,.cc-box .cc-tags,.cc-box [data-b=reload],.cc-box [data-b=kick],.cc-box [data-b=swap],.cc-box [data-b=use]{display:none!important}
.cc-vs{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);left:50%;transform:translateX(-50%);width:min(760px,84vw);display:flex;align-items:flex-start;gap:12px;pointer-events:none;font-family:inherit}
.cc-vs .sd{flex:1;min-width:0}.cc-vs .sd.r{text-align:right}
.cc-vs .nm{font-weight:800;font-size:16px;letter-spacing:.6px;text-shadow:0 2px 6px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-vs .hb{height:16px;border-radius:9px;background:rgba(0,0,0,.55);border:2px solid rgba(255,255,255,.55);overflow:hidden;margin-top:3px}
.cc-vs .hb i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#f43f5e,#fb923c);transition:width .18s}
.cc-vs .sd.r .hb{transform:scaleX(-1)}.cc-vs .sd.r .hb i{background:linear-gradient(90deg,#2563eb,#38bdf8)}
.cc-vs .pp{font-size:15px;letter-spacing:3px;margin-top:2px;text-shadow:0 2px 4px #000;height:20px}
.cc-vs .md{text-align:center;min-width:84px}.cc-vs .md .rd{font-size:12px;font-weight:800;letter-spacing:2px;opacity:.85}
.cc-vs .md .tm{font-size:30px;font-weight:800;line-height:1;text-shadow:0 3px 10px #000}
.cc-bxmsg{position:absolute;left:50%;top:34%;transform:translateX(-50%);font-size:20px;font-weight:700;text-shadow:0 2px 10px #000;text-align:center;white-space:nowrap;pointer-events:none}
.cc-buffs{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 92px);transform:translateX(-50%);display:flex;gap:8px;pointer-events:none}
.cc-buffs span{background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:3px 10px;font-weight:800;font-size:15px}
`;
function bxInitUI() {
  const st = document.createElement('style'); st.textContent = BXCSS; document.head.appendChild(st); U.root.classList.add('cc-box');
  U.hud.insertAdjacentHTML('beforeend', `<div class="cc-vs"><div class="sd"><div class="nm" data-k="bxn1">You</div><div class="hb"><i data-k="bxh1"></i></div><div class="pp" data-k="bxp1"></div></div>
    <div class="md"><div class="rd" data-k="bxrd">ROUND 1</div><div class="tm" data-k="bxtm">60</div></div>
    <div class="sd r"><div class="nm" data-k="bxn2">…</div><div class="hb"><i data-k="bxh2"></i></div><div class="pp" data-k="bxp2"></div></div></div>
    <div class="cc-buffs" data-k="bxbuf"></div><div class="cc-bxmsg" data-k="bxmsg"></div>`);
  U.hud.querySelectorAll('[data-k^="bx"]').forEach((e) => { U[e.dataset.k] = e; });
  U.screens.menu.querySelector('h1').innerHTML = '<small>GET BETTER ARENA</small>Boxing';
  const ps = U.screens.menu.querySelectorAll('p'); ps[0].textContent = 'Best of 3 rounds in the ring. Jab, heavy punch, block and dodge — and grab power-ups. We look for a real challenger first, bots if nobody is around.';
  ps[0].insertAdjacentHTML('afterend', '<p style="font-size:13px;opacity:.85;margin:2px 0">🔥 Rage · 🛡️ Shield · ⚡ Speed · ❤️ Heal · 💥 Iron Fist</p>');
  U.menurow2.style.display = 'none'; U.play.textContent = 'Enter the ring';
  U.online.querySelectorAll('button')[0].textContent = 'Real players + bots'; U.online.querySelectorAll('button')[1].textContent = 'Bots only';
  U.eplace.parentElement.firstChild.textContent = 'Rounds'; U.ekills.parentElement.firstChild.textContent = 'KOs';
  U.btn.fire.innerHTML = '<span>🥊</span>Jab'; U.btn.aim.innerHTML = '<span>🛡️</span>Block'; U.btn.roll.innerHTML = '<span>↻</span>Dodge'; U.btn.melee.innerHTML = '<span>💥</span>Heavy';
  U.keys.innerHTML = TOUCH
    ? '<span><b>Left pad</b> move / circle</span><span><b>Jab</b> hold to keep punching</span><span><b>Heavy</b> big slow punch</span><span><b>Block</b> hold</span><span><b>Dodge</b> roll away</span>'
    : '<span><b>WASD</b> move / circle</span><span><b>Click</b> jab (hold)</span><span><b>F / V</b> heavy punch</span><span><b>Right-click / Shift</b> block</span><span><b>C</b> dodge roll</span><span><b>Space</b> jump</span>';
}
const bxMsg = (t) => { if (U.bxmsg && U.bxmsg._t !== t) { U.bxmsg._t = t; U.bxmsg.textContent = t; } };

/* --------------------------------- opponents ------------------------------ */
function bxSpawnBot() {
  const b = G.bx, f = new Fighter(pick(BXNAMES), false, new THREE.Color('#9db4ff'));
  f.ai = { atkCd: 1, blockT: 0, strafe: 1, strafeT: 0, dodgeCd: 0, seenAtk: -9, combo: 0, skill: rnd(0.9, 1.1) };
  f.setStance('fist'); f.glove('#2563eb'); f.lastShot = -9; b.opp = f; b.oppUid = ''; b.pvp = false; b.net = 'fight';
  return f;
}
function bxAccept(id, d) { const b = G.bx; return !!b && !b.opp && b.phase === 'search' && (d.bs === 'search' || d.op === NET.uid); }
function bxPaired(f, id) {
  const b = G.bx, P = G.player; b.opp = f; b.oppUid = id; b.pvp = true; b.net = 'fight'; f.setStance('fist'); f.glove('#2563eb'); f.isRemoteBoxer = true;
  b.seed = [NET.uid, id].sort().join('|').split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  feed(`🥊 Challenger found: <b>${f.name}</b>`, true); if (b.phase === 'search') bxBeginRound(1);
}
function bxPlaceFighters() {
  const b = G.bx, P = G.player, left = b.pvp ? NET.uid < b.oppUid : true;
  P.spawnAt(left ? -4 : 4, 0); P.yaw = left ? Math.PI / 2 : -Math.PI / 2; G.cam.yaw = P.yaw;
  if (b.opp && !b.opp.remote) { b.opp.spawnAt(left ? 4 : -4, 0); b.opp.yaw = left ? -Math.PI / 2 : Math.PI / 2; }
}
function bxResetFighter(f) {
  f.hp = 100; f.stam = 100; f.alive = true; f.deadT = 0; f.stun = 0; f.rage = f.shield = f.spd = f.pow = 0; f.blocking = false; f.rollT = 0; f.iframe = 0; f.meleeCd = 0; f.rollCd = 0; f.lockT = 0; f.pushV = 0;
  f.rig.revive(); f.rig.over = null; f.inp.mx = f.inp.mz = 0; f.inp.speed = 0;
}
function bxBeginRound(n) {
  const b = G.bx, P = G.player; b.round = n; b.phase = 'intro'; b.pt = BXC.INTRO; b.time = BXC.RTIME; b.spawnN = 0; b.spawnT = 5; b.decided = false;
  for (const p of pickups) scene.remove(p.g); pickups.length = 0;
  bxResetFighter(P); if (b.opp && !b.opp.remote) bxResetFighter(b.opp); bxPlaceFighters(); P.lockT = 0;
  banner(`ROUND ${n}`, '#fde047'); AU.bell(); AU.crowd(true); bxMsg('');
}

/* ----------------------------------- match -------------------------------- */
function startBoxing() {
  AU.init(); netLeave(); clearWorld(); G.over = false; G.t = 0; G.paused = false; G.zoom = 0; G.lock = null; G.cam.pitch = 0.22; G.cam.recoil = 0; G.cam.len = undefined; NET.fs = 0; NET.evs = 0; NET.ev = '';
  const P = new Fighter(PLAYER_NAME, true, null); G.player = P; P.glove('#e11d48'); P.lastShot = -9; P.lastAtk = -9;
  G.diff = Number(U.diff.querySelector('.on')?.dataset.d || 1); store.set('diff', G.diff);
  NET.on = U.online.querySelector('.on')?.dataset.o !== '0'; store.set('online', NET.on ? 1 : 0);
  G.bx = { phase: 'search', pt: BXC.SEARCH, round: 1, wins: [0, 0], time: BXC.RTIME, opp: null, oppUid: '', net: 'search', dealt: 0, ko: 0, pvp: false, seed: (Math.random() * 1e9) >>> 0, spawnN: 0, spawnT: 5, decided: false, buffT: 0 };
  P.spawnAt(-4, 0); P.yaw = Math.PI / 2; G.cam.yaw = P.yaw;
  for (const s of Object.values(U.screens)) s.classList.remove('on'); U.hud.classList.add('on'); if (TOUCH) U.touch.classList.add('on'); U.bxmsg._t = null;
  G.state = 'playing';
  if (NET.on) netJoin(); else { bxSpawnBot(); bxBeginRound(1); }
  try { if (TOUCH) { document.documentElement.requestFullscreen?.().catch(() => {}); screen.orientation?.lock?.('landscape').catch(() => {}); } else lockPointer(); } catch {}
}
function bxEnd(won, why) {
  const b = G.bx; if (b.phase === 'over') return; b.phase = 'over'; G.over = true; AU.crowd(false); const P = G.player;
  const score = Math.round(b.wins[0] * 300 + b.dealt * 2 + (won ? 400 : 0) + b.ko * 150 + (won && b.pvp ? 250 : 0));
  if (won) AU.win(); else AU.lose(); fireHeld = aimHeld = false; try { document.exitPointerLock?.(); } catch {}
  later(0.6, netLeave);
  later(1.8, () => {
    U.hud.classList.remove('on'); U.touch.classList.remove('on');
    setT(U.endt, won ? 'CHAMPION!' : 'DEFEATED'); setT(U.endsub, why || (b.pvp ? `You ${won ? 'beat' : 'lost to'} ${b.opp ? b.opp.name : 'your opponent'}.` : `${won ? 'You beat' : 'You lost to'} ${b.opp ? b.opp.name : 'the bot'}.`));
    setT(U.eplace, `${b.wins[0]}-${b.wins[1]}`); setT(U.ekills, b.ko); setT(U.escore, score); U.screens.end.classList.add('on'); G.state = 'end';
  });
  try { parent !== window && parent.postMessage({ type: 'gb-game-score', game: 'boxing', score, kills: b.ko, place: won ? 1 : 2 }, '*'); } catch {}
}
function bxRoundOver(iWon, why) {
  const b = G.bx; if (b.phase !== 'fight') return; b.phase = 'between'; b.pt = 4.4; b.wins[iWon ? 0 : 1]++; if (iWon && why === 'KO') b.ko++;
  banner(why === 'KO' ? 'K.O.!' : 'TIME!', iWon ? '#fde047' : '#fb7185'); AU.cheer(); G.cam.shake = Math.min(1, G.cam.shake + 0.5);
  if (b.wins[0] >= BXC.WIN || b.wins[1] >= BXC.WIN) { b.decided = true; const won = b.wins[0] > b.wins[1]; later(2.2, () => bxEnd(won)); }
}
function bxTimeUp() {
  const b = G.bx, P = G.player, o = b.opp; if (!o) return; let win;
  if (Math.round(P.hp) !== Math.round(o.hp)) win = P.hp > o.hp; else win = b.pvp ? ((NET.uid < b.oppUid ? 1 : 0) ^ (b.round & 1)) === 1 : true;
  bxRoundOver(win, 'time');
}
function bxKO(t, att, kind) {
  t.alive = false; t.hp = 0; t.blocking = false; t.rig.playFull('Death', { hold: true, fin: 0.08 }); AU.ko();
  feed(`<b>${att && att !== t ? att.name : 'Knockout'}</b> 🥊 ${t.name}`, true);
  if (t.isPlayer) { if (G.bx.pvp) netDeath(att, 'ko'); bxRoundOver(false, 'KO'); } else bxRoundOver(true, 'KO');
}
function bxNetKO(d) {
  const b = G.bx; if (!b) return; feed(`<b>${d.kn || 'Knockout'}</b> 🥊 ${d.vn}`, d.killer === NET.uid);
  if (d.killer === NET.uid && b.phase === 'fight' && b.opp && b.opp.uid === d.victim) bxRoundOver(true, 'KO');
}

/* ----------------------------------- combat ------------------------------- */
function bxHit(t, amt, att, o) {
  const b = G.bx; if (!t.alive || G.over || !b || b.phase !== 'fight') return false;
  const kind = o.kind || 'punch', heavy = kind === 'heavy' || kind === 'kick' || amt >= 14; let a = amt, blocked = false;
  const ax = att ? att.x : t.x - Math.sin(t.yaw), az = att ? att.z : t.z - Math.cos(t.yaw), dx = ax - t.x, dz = az - t.z, dl = Math.hypot(dx, dz) || 1;
  if (t.blocking && (dx * Math.sin(t.yaw) + dz * Math.cos(t.yaw)) / dl > 0.15) { blocked = true; a *= 0.18; t.stam -= 7 + amt * 0.9; if (t.stam <= 0) { t.stam = 0; t.blocking = false; t.stun = 1.0; blocked = false; a = amt * 0.8; } }
  if (t.shield > 0) a *= 0.5;
  t.hp = Math.max(0, t.hp - a); t.lastHit = G.t; t.pushX = -dx / dl; t.pushZ = -dz / dl; t.pushV = blocked ? 3 : heavy ? 11 : 5;
  if (!blocked) { t.stun = Math.max(t.stun || 0, heavy ? 0.35 : 0.05); t.rig.playOver(Math.random() < 0.5 ? 'HitRecieve' : 'HitRecieve_2', { dur: heavy ? 0.5 : 0.26, prio: heavy ? 4 : 3, fin: 0.03, fout: 0.12 }); }
  fxBurst({ x: t.x - dx / dl * 0.3, y: t.y + 1.45, z: t.z - dz / dl * 0.3 }, blocked ? '#7dd3fc' : heavy ? '#fde047' : '#ff6b6b', blocked ? 6 : heavy ? 16 : 9, 3);
  blocked ? AU.block() : AU.whack(heavy);
  if (att && att.isPlayer) { b.dealt += a; dmgNumber(t.x, t.y + 2, t.z, Math.round(a), heavy && !blocked); G.cam.shake = Math.min(1, G.cam.shake + (heavy ? 0.45 : 0.18)); }
  if (t.isPlayer) { G.cam.shake = Math.min(1, G.cam.shake + (heavy ? 0.5 : 0.2)); if (!blocked) { U.hurt.style.opacity = 0.8; setTimeout(() => { U.hurt.style.opacity = 0; }, 150); AU.hurt(); } }
  if (t.ai && !blocked && Math.random() < 0.35) t.ai.blockT = 0.5;
  if (t.hp <= 0) bxKO(t, att, kind);
  return true;
}
function bxMeleeHit(f, kind) {
  const b = G.bx; if (!b || !f.alive || G.over || b.phase !== 'fight' || f.stun > 0) return;
  const M = MELEE[kind], fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
  for (const t of fighters) {
    if (t === f || !t.alive || t === G.showcase) continue; const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz);
    if (d > M.range + 0.2 || Math.abs(t.y - f.y) > 1.6 || (dx * fx + dz * fz) / (d || 1) < 0.2 || t.rollT > 0) continue;
    let mul = f.rage > 0 ? 1.8 : 1, k = kind; if (f.pow > 0) { mul *= 2.2; f.pow--; k = 'heavy'; } if (f.ai) mul *= clamp(0.85 * G.diff, 0.6, 1.1);
    damage(t, M.dmg * mul, f, { kind: k }); break;
  }
}

/* ------------------------------------ bot --------------------------------- */
function bxBot(f, dt) {
  const b = G.bx, P = G.player, a = f.ai; f.inp.mx = f.inp.mz = 0; f.inp.speed = 0;
  if (!f.alive) return; const dx = P.x - f.x, dz = P.z - f.z, d = Math.hypot(dx, dz) || 1;
  if (f.rollT <= 0) f.yaw = dampAng(f.yaw, Math.atan2(dx, dz), 10, dt);
  if (b.phase !== 'fight' || !P.alive) { f.blocking = false; return; }
  const sk = G.diff; a.atkCd -= dt; a.blockT -= dt; a.strafeT -= dt; a.dodgeCd -= dt;
  const fx = dx / d, fz = dz / d, rx = fz, rz = -fx;
  if (P.lastAtk > a.seenAtk && G.t - P.lastAtk < 0.2 && d < 3) {
    a.seenAtk = P.lastAtk; const r = Math.random();
    if (r < 0.34 * sk && f.stam > 10) a.blockT = 0.35 + Math.random() * 0.4;
    else if (r < 0.34 * sk + 0.1 * sk && a.dodgeCd <= 0) { f.inp.mx = rx * a.strafe + -fx * 0.4; f.inp.mz = rz * a.strafe - fz * 0.4; if (f.doRoll()) a.dodgeCd = 3; }
  }
  f.blocking = a.blockT > 0 && f.rollT <= 0 && f.stun <= 0;
  if (a.strafeT <= 0) { a.strafe = Math.random() < 0.5 ? -1 : 1; a.strafeT = rnd(0.8, 2.2); }
  const want = f.hp < 30 ? 2.7 : 1.7; let mx = 0, mz = 0;
  const pk = d > 2.6 ? nearestPickup(f, 7, false) : null;
  if (pk) { const px = pk.x - f.x, pz = pk.z - f.z, pl = Math.hypot(px, pz) || 1; mx = px / pl; mz = pz / pl; }
  else { if (d > want + 0.5) { mx += fx; mz += fz; } else if (d < want - 0.5) { mx -= fx * 0.8; mz -= fz * 0.8; } mx += rx * a.strafe * 0.55; mz += rz * a.strafe * 0.55; }
  const l = Math.hypot(mx, mz); if (l > 0) { f.inp.mx = mx / l; f.inp.mz = mz / l; f.inp.speed = BXC.RUN * 0.8 * clamp(sk, 0.85, 1.1) * a.skill; }
  if (d < 2.25 && a.atkCd <= 0 && !f.blocking && f.stun <= 0 && f.rollT <= 0) {
    if (Math.random() < 0.14 && f.stam > 24) { f.melee('heavy'); a.atkCd = rnd(1.0, 1.7) / sk; a.combo = 0; }
    else if (f.melee('punch')) { a.combo++; a.atkCd = a.combo % 3 === 0 ? rnd(0.9, 1.6) / sk : rnd(0.42, 0.66) / sk; }
  }
}

/* ------------------------------ player control ---------------------------- */
function bxControl(dt) {
  const P = G.player, c = G.cam, b = G.bx, o = b.opp; P.inp.mx = P.inp.mz = 0; P.inp.speed = 0;
  const live = b.phase === 'fight' || b.phase === 'search';
  if (o && o.alive !== undefined) { const ty = Math.atan2(o.x - P.x, o.z - P.z); c.yaw += angDelta(c.yaw, ty) * (1 - Math.exp(-6 * dt)); if (P.rollT <= 0 && P.alive) P.yaw = dampAng(P.yaw, ty, 18, dt); }
  c.pitch = damp(c.pitch, 0.22, 4, dt); c.recoil = damp(c.recoil, 0, 9, dt); P.aiming = false;
  if (!P.alive) { P.blocking = false; return; }
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), mag = 0, analog = false;
  joy.sx = damp(joy.sx || 0, joy.x, 22, dt); joy.sy = damp(joy.sy || 0, joy.y, 22, dt); const jl = Math.hypot(joy.sx, joy.sy);
  if (jl > 0.08) { ix = joy.sx; iz = -joy.sy; mag = Math.min(1, jl); analog = true; } else { const l = Math.hypot(ix, iz); if (l > 0) { ix /= l; iz /= l; mag = 1; } }
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw); let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix; const ml = Math.hypot(mx, mz); if (ml > 0) { mx /= ml; mz /= ml; }
  P.blocking = live && !!(aimHeld || keys.ShiftLeft || keys.ShiftRight || keys.KeyB) && P.rollT <= 0 && P.stun <= 0;
  let base = BXC.RUN; if (analog) base = lerp(BXC.WALK, BXC.RUN, smooth(0.28, 0.92, mag));
  if (live) { P.inp.mx = mx; P.inp.mz = mz; P.inp.speed = mag > 0 ? base : 0; if (fireHeld && b.phase === 'fight') P.melee('punch'); }
  if (!o) P.yaw = dampAng(P.yaw, P.yaw, 1, dt);
}

/* --------------------------------- per-frame ------------------------------ */
function bxSpawnPickup() {
  const b = G.bx, rng = mulberry(b.seed + b.spawnN * 7919 + b.round * 104729), lim = BXC.RS - 2.6; b.spawnN++;
  const k = ['rage', 'shield', 'speed', 'heal', 'iron'][Math.floor(rng() * 5)], x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
  const live = pickups.filter((p) => !p.taken); if (live.length >= 3) { live[0].taken = true; scene.remove(live[0].g); }
  const c = PK[k].color, g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, roughness: 0.3 })); body.castShadow = true; g.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 24), new THREE.MeshBasicMaterial({ color: c })); ring.rotation.x = Math.PI / 2; g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 6, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })); beam.position.y = 2.7; g.add(beam);
  const y = groundAt(x, z, 0.3); g.position.set(x, y + 0.8, z); scene.add(g); pickups.push({ g, body, x, z, y, k, t: rnd(0, 6), taken: false });
  b.spawnT = 7;
}
function bxApply(f, k) {
  if (k === 'rage') f.rage = 8; else if (k === 'shield') f.shield = 8; else if (k === 'speed') f.spd = 8; else if (k === 'heal') f.hp = Math.min(100, f.hp + 35); else if (k === 'iron') f.pow = 3;
  f.stam = Math.min(100, f.stam + 25);
}
function bxFighterTick(f, dt) {
  f.stun = Math.max(0, (f.stun || 0) - dt); f.rage = Math.max(0, (f.rage || 0) - dt); f.shield = Math.max(0, (f.shield || 0) - dt); f.spd = Math.max(0, (f.spd || 0) - dt);
  f.stam = Math.min(100, f.stam + (f.blocking ? 7 : 24) * dt);
  if (f.pushV > 0.2) { const s = f.pushV * dt, RS = BXC.RS - 0.55; f.x = clamp(f.x + f.pushX * s, -RS, RS); f.z = clamp(f.z + f.pushZ * s, -RS, RS); f.pushV = damp(f.pushV, 0, 9, dt); }
  f.inp.speed *= (f.blocking ? 0.45 : 1) * (f.stun > 0 ? 0.15 : 1) * (f.spd > 0 ? 1.35 : 1);
  const gl = f.rage > 0 ? '#ff2d20' : f.pow > 0 ? '#c084fc' : '#000000'; if (f.m.gloves && f._gl !== gl) { f._gl = gl; for (const g of f.m.gloves) g.material.emissive && g.material.emissive.set(gl); }
}
function bxBubble(f) {
  if (!f.bub) { f.bub = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 12), new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.22, depthWrite: false })); f.bub.scale.set(1, 1.3, 1); f.bub.position.y = 1; f.bub.visible = false; f.group.add(f.bub); }
  const on = f.alive && (f.blocking || f.shield > 0); f.bub.visible = on; if (on) f.bub.material.color.set(f.shield > 0 ? '#fde047' : '#7dd3fc');
}
function bxHUD(dt) {
  const b = G.bx, P = G.player, o = b.opp;
  setT(U.bxn1, PLAYER_NAME); setT(U.bxn2, o ? o.name : '…'); setW(U.bxh1, P.hp); setW(U.bxh2, o ? o.hp : 100); setW(U.hp, P.hp); setW(U.stam, P.stam); U.hp.parentElement.classList.toggle('low', P.hp < 30);
  setT(U.bxrd, `ROUND ${b.round}`); setT(U.bxtm, b.phase === 'fight' ? Math.ceil(b.time) : '--');
  const pips = (n) => '●'.repeat(n) + '○'.repeat(Math.max(0, BXC.WIN - n)); setT(U.bxp1, pips(b.wins[0])); setT(U.bxp2, pips(b.wins[1]));
  b.buffT -= dt; if (b.buffT <= 0) {
    b.buffT = 0.2; const bf = []; if (P.rage > 0) bf.push(`${PKI.rage} ${Math.ceil(P.rage)}s`); if (P.shield > 0) bf.push(`${PKI.shield} ${Math.ceil(P.shield)}s`); if (P.spd > 0) bf.push(`${PKI.speed} ${Math.ceil(P.spd)}s`); if (P.pow > 0) bf.push(`${PKI.iron} x${P.pow}`);
    const h = bf.map((t) => `<span>${t}</span>`).join(''); if (U.bxbuf._h !== h) { U.bxbuf._h = h; U.bxbuf.innerHTML = h; }
  }
  if (b.phase === 'search') bxMsg(b.opp ? '' : `Looking for a challenger… ${Math.ceil(b.pt)}s  (bot if nobody shows up)`);
  else if (b.phase === 'intro') bxMsg(Math.ceil(b.pt - 0.2) > 0 ? String(Math.ceil(b.pt - 0.2)) : 'FIGHT!');
  else if (b.phase === 'between' && !b.decided) bxMsg(`Next round in ${Math.ceil(b.pt)}…`); else bxMsg('');
}
function stepBox(dt) {
  const b = G.bx, P = G.player; G.t += dt;
  for (let i = timers.length - 1; i >= 0; i--) { const t = timers[i]; t.t -= dt; if (t.t <= 0) { timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } } }
  netTick(dt);
  if (b.phase === 'search') { b.pt -= dt; if (!b.opp && (!NET.on || NET.failed || b.pt <= 0)) { bxSpawnBot(); bxBeginRound(1); } }
  else if (b.phase === 'intro') { b.pt -= dt; if (b.pt <= 0) { b.phase = 'fight'; banner('FIGHT!', '#fff'); AU.bell(); } }
  else if (b.phase === 'fight') { b.time -= dt; if (b.time <= 0) bxTimeUp(); }
  else if (b.phase === 'between' && !b.decided) { b.pt -= dt; if (b.pt <= 0) bxBeginRound(b.round + 1); }
  if (b.pvp && b.opp && b.phase !== 'over' && !fighters.includes(b.opp)) { b.opp = null; bxEnd(true, 'Your opponent left the ring.'); }
  bxControl(dt); if (b.opp && b.opp.ai) bxBot(b.opp, dt);
  for (const f of fighters) if (!f.remote && f !== G.showcase) bxFighterTick(f, dt);
  // keep boxers from standing inside each other
  if (b.opp && b.opp.alive && P.alive) { const dx = b.opp.x - P.x, dz = b.opp.z - P.z, d = Math.hypot(dx, dz); if (d < 0.9 && d > 0.001) { const push = (0.9 - d) / 2; P.x -= dx / d * push; P.z -= dz / d * push; if (!b.opp.remote) { b.opp.x += dx / d * push; b.opp.z += dz / d * push; } } }
  for (const f of fighters) f.update(dt);
  for (const f of fighters) bxBubble(f);
  // power-ups: spawn on a shared schedule, collect by walking over them
  if (b.phase === 'fight') { b.spawnT -= dt; if (b.spawnT <= 0) bxSpawnPickup(); }
  for (const p of pickups) {
    if (p.taken) continue; p.t += dt; p.g.position.y = p.y + 0.85 + Math.sin(p.t * 2.4) * 0.12; p.body.rotation.y = p.t * 1.8;
    for (const f of fighters) if (!f.remote && f.alive && f !== G.showcase && Math.hypot(p.x - f.x, p.z - f.z) < 1.15) {
      p.taken = true; scene.remove(p.g); bxApply(f, p.k); fxBurst({ x: p.x, y: p.y + 1, z: p.z }, PK[p.k].color, 14, 4);
      if (f.isPlayer) { AU.pick(); feed(`${PKI[p.k]} ${PK[p.k].name}`, true); banner(`${PKI[p.k]} ${p.k === 'iron' ? 'IRON FIST' : p.k.toUpperCase()}`, PK[p.k].color); } break;
    }
  }
  for (let i = pickups.length - 1; i >= 0; i--) if (pickups[i].taken) pickups.splice(i, 1);
  updateCamera(dt); fxUpdate(dt); bxHUD(dt);
}

/* ========================================================================== */
/*  FIRST-PERSON VIEW  (camera at the eyes; you only see your hands + weapon) */
/* ========================================================================== */
G.fpv = store.get(BOX ? 'fpv_box' : 'fpv_cc', BOX); G.fp = false;
if (sun.shadow && sun.shadow.camera && sun.shadow.camera.layers) sun.shadow.camera.layers.enable(1);   // body is hidden from the camera (layer 1) but still casts its shadow
const VM = { grp: new THREE.Group(), hands: [], k: [0, 0], bob: 0, pos: [new THREE.Vector3(), new THREE.Vector3()], sleeve: new THREE.MeshStandardMaterial({ color: '#3a4538', roughness: 0.85 }), glove: new THREE.MeshStandardMaterial({ color: '#1c222b', roughness: 0.6 }), boxg: new THREE.MeshStandardMaterial({ color: '#e11d48', roughness: 0.4, metalness: 0.05 }), boxs: new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.6 }) };
for (let i = 0; i < 2; i++) {
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.052, 1, 10), VM.sleeve), hand = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), VM.glove);
  fore.frustumCulled = hand.frustumCulled = false; VM.grp.add(fore, hand); VM.hands.push({ fore, hand });
}
VM.grp.visible = false; scene.add(VM.grp);
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(), _fy = new THREE.Vector3(0, 1, 0), _fup = new THREE.Vector3(), _ffw = new THREE.Vector3(), _frt = new THREE.Vector3(), _fq = new THREE.Quaternion();
function fpSetLayers(P, on) {
  if (P._fpL === on) return; P._fpL = on;
  P.group.traverse((o) => { if (o.layers && o.layers.set) o.layers.set(on ? 1 : 0); });   // whole soldier -> invisible to the camera, shadow remains
}
function fpLimb(i, a, b, hr, glove, sleeve) {   // forearm from a (off-screen) to b (hand/glove)
  const h = VM.hands[i]; _fb.copy(b).sub(a); const len = _fb.length() || 0.01; _fb.multiplyScalar(1 / len);
  h.fore.position.copy(a).addScaledVector(_fb, len * 0.5); h.fore.scale.set(1, len, 1); h.fore.quaternion.setFromUnitVectors(_fy, _fb); h.fore.material = sleeve;
  h.hand.position.copy(b); h.hand.scale.set(hr, hr, hr * 1.15); h.hand.material = glove; h.fore.visible = h.hand.visible = true;
}
function fpHead(P, hide) {   // first-person uses the soldier's REAL arms, gloves and AK: only the head is collapsed so it never blocks the camera
  const h = P.m && P.m.head; if (!h) return; const v = hide ? 0.001 : 1; if (h.scale.x !== v) h.scale.setScalar(v);
}
function fpFrame(P, dt, eye, yaw, pit) {
  if (BOX) { VM.grp.visible = false; fpHead(P, true); return; }   // boxing: the model's real arms/gloves, head hidden
  // Compound: only the gun is visible (body is on a hidden layer, rifle held at the shoulder like a shooter's viewmodel)
  VM.grp.visible = false; const c = G.cam; if (!P.alive || !P.m.rifle || !P.m.rifle.visible) return;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  _ffw.set(sy * cp, sp, cy * cp); _frt.set(-cy, 0, sy); _fup.crossVectors(_frt, _ffw); if (_fup.y < 0) _fup.negate();
  VM.bob = (VM.bob || 0) + dt * (4 + P.speed * 0.9); const mv = clamp(P.speed / CFG.RUN, 0, 1.2), bx = Math.sin(VM.bob) * 0.004 * mv, by = Math.abs(Math.cos(VM.bob)) * 0.005 * mv + Math.sin(G.t * 1.8) * 0.002, a = c.aim, r = P.m.rifle;
  r.position.copy(eye).addScaledVector(_ffw, lerp(0.02, 0.22, a) - (P.kick || 0) * 1.4).addScaledVector(_frt, lerp(0.25, 0.0, a) + bx).addScaledVector(_fup, lerp(-0.3, -0.125, a) + by); r.updateMatrixWorld(true);
}
function fpToggle() {
  G.fpv = !G.fpv; store.set(BOX ? 'fpv_box' : 'fpv_cc', G.fpv); VM.init = false; feed(G.fpv ? '👁 First-person view' : '🎥 Third-person view', true);
}

/* ========================================================================== */
/*  INPUT                                                                     */
/* ========================================================================== */
const keys = {}; let fireHeld = false, aimHeld = false, exhausted = false, idleT = 0;
const joy = { x: 0, y: 0, id: null }; const tb = { fire: false, aim: false };
const lookAcc = { x: 0, y: 0 };
const zoomLevel = () => (G.player && G.player.stance === 'rifle' ? Math.max(G.zoom, aimHeld ? 1 : 0) : 0);
G.zoom = 0;
const lookBy = (dx, dy, k, smooth) => { const P = G.player; if (!P || BOX) return; const s = k * G.sens * clamp(G.cam.fov / 72, 0.3, 1.15); if (smooth) { lookAcc.x += dx * s; lookAcc.y += dy * s; } else { G.cam.yaw -= dx * s; G.cam.pitch = clamp(G.cam.pitch - dy * s, -0.75, 1.1); } };
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
  else if (name === 'melee') { if (BOX) P.melee('heavy'); else meleeKey(); } else if (name === 'kick') { if (BOX) P.melee('heavy'); else P.melee('kick'); } else if (name === 'use') { if (!BOX) doUse(); }
  else if (name === 'rifle') { P.setStance('rifle'); P.reloadT = 0; } else if (name === 'sword') { P.setStance('sword'); P.reloadT = 0; G.zoom = 0; }
  else if (name === 'swap') { P.setStance(P.stance === 'rifle' ? 'sword' : 'rifle'); P.reloadT = 0; G.zoom = 0; }
  else if (name === 'zoom') { if (P.stance === 'rifle') G.zoom = (G.zoom + 1) % 3; }
  else if (name === 'view') fpToggle();
  else if (name === 'wave') { if (P.speed < 1) P.wave(); }
  idleT = 0;
}
addEventListener('keydown', (e) => {
  if (e.repeat) return; keys[e.code] = true; if (!playing()) return;
  const m = { Space: 'jump', KeyC: 'roll', KeyR: 'reload', KeyF: 'melee', KeyV: 'kick', KeyE: 'use', Digit1: 'rifle', Digit2: 'sword', KeyG: 'wave', KeyZ: 'zoom', KeyT: 'view' }[e.code];
  if (m) { act(m); e.preventDefault(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; fireHeld = aimHeld = false; });
U.canvas.addEventListener('click', () => { if (!TOUCH && G.state === 'playing' && !G.paused && document.pointerLockElement !== U.canvas) lockPointer(); });
addEventListener('mousedown', (e) => { if (!playing() || document.pointerLockElement !== U.canvas) return; if (e.button === 0) fireHeld = true; if (e.button === 2) aimHeld = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) fireHeld = false; if (e.button === 2) aimHeld = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
let _wh = 0; addEventListener('wheel', (e) => { if (!TOUCH && playing() && performance.now() - _wh > 180) { _wh = performance.now(); act('zoom'); } }, { passive: true });
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
  let lid = null, lx = 0, ly = 0;   // look: drag anywhere on the right side (even between buttons), like Free Fire
  addEventListener('pointerdown', (e) => { if (!TOUCH || lid !== null || !playing() || e.target.closest('.cc-btn,.cc-pause,.cc-joy,.cc-screen')) return; if (e.clientX < innerWidth * 0.36) return; lid = e.pointerId; lx = e.clientX; ly = e.clientY; });
  addEventListener('pointermove', (e) => { if (e.pointerId !== lid) return; if (playing()) lookBy(e.clientX - lx, e.clientY - ly, 0.0058, false); lx = e.clientX; ly = e.clientY; });
  const lup = (e) => { if (e.pointerId === lid) lid = null; }; addEventListener('pointerup', lup); addEventListener('pointercancel', lup);
  for (const [name, b] of Object.entries(U.btn)) {
    let bx = 0, by = 0, bid = null;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('on'); bid = e.pointerId; bx = e.clientX; by = e.clientY; if (name === 'fire') fireHeld = true; else if (name === 'aim' && BOX) aimHeld = true; else act(name === 'aim' ? 'zoom' : name); });
    b.addEventListener('pointermove', (e) => { if ((name === 'fire' || name === 'aim') && e.pointerId === bid) { if (playing()) lookBy(e.clientX - bx, e.clientY - by, 0.0058, false); bx = e.clientX; by = e.clientY; } });  // slide on Fire / Zoom to look
    const end = () => { b.classList.remove('on'); bid = null; if (name === 'fire') fireHeld = false; if (name === 'aim' && BOX) aimHeld = false; };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  }
})();

/* ========================================================================== */
/*  PLAYER · CAMERA                                                           */
/* ========================================================================== */
function updateLock(dt) {
  const P = G.player, c = G.cam; G.lock = G.lock && G.lock.alive ? G.lock : null;
  if (!G.assist || !P.alive || P.stance !== 'rifle') { G.lock = null; return; }
  const e = P.eye; let best = null, bs = 1e9;
  for (const f of fighters) {
    if (f === P || !f.alive || f === G.showcase) continue; const dx = f.x - P.x, dz = f.z - P.z, dist = Math.hypot(dx, dz); if (dist > CFG.LOCK_RANGE || dist < 0.5) continue;
    const dy = angDelta(c.yaw, Math.atan2(dx, dz)), dp = Math.atan2(f.y + 1.35 - e.y, dist) - c.pitch, ang = Math.hypot(dy, dp * 0.8); if (ang > CFG.LOCK_CONE) continue;
    const L = Math.hypot(dx, f.y + 1.35 - e.y, dz); if (rayWorld(e.x, e.y, e.z, dx / L, (f.y + 1.35 - e.y) / L, dz / L, L) < L - 0.6) continue;
    const sc = ang + dist * 0.004 - (f === G.lock ? 0.12 : 0); if (sc < bs) { bs = sc; best = f; }
  }
  G.lock = best;
  if (best && (fireHeld || P.aiming)) {                          // soft lock: the view glides onto the enemy
    const dx = best.x - P.x, dz = best.z - P.z, dist = Math.hypot(dx, dz), near = 1 - clamp(dist / CFG.LOCK_RANGE, 0, 1);
    const user = clamp(1 - (Math.abs(lookAcc.x) + Math.abs(lookAcc.y)) * 25, 0.3, 1), k = 1 - Math.exp(-(5 + near * 14) * user * dt);
    c.yaw += angDelta(c.yaw, Math.atan2(dx, dz)) * k; c.pitch += (Math.atan2(best.y + 1.3 - e.y, dist) - (c.pitch + c.recoil)) * k;
  }
}
function playerControl(dt) {
  const P = G.player, c = G.cam; c.recoil = damp(c.recoil, 0, 9, dt);
  { const k = 1 - Math.exp(-24 * dt); c.yaw -= lookAcc.x * k; c.pitch = clamp(c.pitch - lookAcc.y * k, -0.75, 1.1); lookAcc.x *= 1 - k; lookAcc.y *= 1 - k; }  // touch look: eased so swipes glide G.bloom = Math.max(0, G.bloom - dt * 0.045);
  if (!P.alive) { G.lock = null; U.lock.style.display = 'none'; return; }
  updateLock(dt);
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), mag = 0, analog = false;
  joy.sx = damp(joy.sx || 0, joy.x, 22, dt); joy.sy = damp(joy.sy || 0, joy.y, 22, dt);
  const jl = Math.hypot(joy.sx, joy.sy);
  if (jl > 0.08) { ix = joy.sx; iz = -joy.sy; mag = Math.min(1, jl); analog = true; } else { const l = Math.hypot(ix, iz); if (l > 0) { ix /= l; iz /= l; mag = 1; } }
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw);
  let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix; const ml = Math.hypot(mx, mz); if (ml > 0) { mx /= ml; mz /= ml; }
  const zl = zoomLevel(); P.aiming = zl > 0 && P.rollT <= 0;
  const wantSprint = (keys.ShiftLeft || keys.ShiftRight || (analog && jl > 0.93)) && iz > 0.25 && !P.aiming && !exhausted && mag > 0;
  const sprinting = wantSprint && P.speed > CFG.RUN * 0.8 || (wantSprint && P.speed < CFG.RUN * 0.8);
  if (wantSprint) P.stam = Math.max(0, P.stam - 26 * dt); else P.stam = Math.min(100, P.stam + 17 * dt);
  if (P.stam <= 0) exhausted = true; if (exhausted && P.stam > 28) exhausted = false;
  let base = P.aiming ? CFG.AIM_SPEED : wantSprint ? CFG.SPRINT : CFG.RUN; if (analog) base = lerp(CFG.WALK, base, smooth(0.28, 0.92, mag));
  P.inp.mx = mx; P.inp.mz = mz; P.inp.speed = mag > 0 ? base : 0; P.inp.sprint = wantSprint;
  // Free-Fire style: run facing where you go; face the camera while aiming / shooting
  const firing = fireHeld || G.t - (P.lastFire || -9) < 0.7;
  if (P.rollT <= 0) { const ty = G.fp || P.aiming || firing ? c.yaw : mag > 0.05 ? Math.atan2(mx, mz) : P.yaw; P.yaw = dampAng(P.yaw, ty, P.aiming || firing ? 26 : 16, dt); }
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
  const dead = !P.alive || G.over; if (dead) { c.yaw += dt * 0.28; c.pitch = lerp(c.pitch, -0.5, dt * 2); }   // look DOWN on the body from above
  c.aim = damp(c.aim, P.aiming ? 1 : 0, 12, dt);
  const zl = zoomLevel(), shoulder = BOX ? 0.55 : lerp(0.6, 0.78, c.aim), dist = dead ? 6 : BOX ? 5.2 : lerp(3.7, zl > 1 ? 1.7 : 2.2, c.aim), pit = c.pitch + c.recoil;
  G.fp = !!(G.fpv && P.alive && !G.over && P.stance !== 'sword'); try { if (!G.fp) fpHead(P, false); fpSetLayers(P, G.fp && !BOX); } catch (e) { console.error('fp', e); }
  const d = camDir(c.yaw, pit), rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw);
  const px = P.x, py = P.dispY + 1.5 + (P.rollT > 0 ? -0.5 : 0), pz = P.z;
  const ox = px + rx * shoulder, oy = py, oz = pz + rz * shoulder;
  if (G.fp) {
    let ex = P.x + d.x * 0.1, ey = P.dispY + 1.62 + (P.rollT > 0 ? -0.55 : 0), ez = P.z + d.z * 0.1;
    if (c.fx === undefined || Math.hypot(c.fx - ex, c.fz - ez) > 1.5) { c.fx = ex; c.fy = ey; c.fz = ez; } else { c.fx = damp(c.fx, ex, 38, dt); c.fy = damp(c.fy, ey, 22, dt); c.fz = damp(c.fz, ez, 38, dt); } ex = c.fx; ey = c.fy; ez = c.fz; c.shake = damp(c.shake, 0, 9, dt); const shk = c.shake * 0.02;
    camera.position.set(ex + rnd(-shk, shk), ey + rnd(-shk, shk), ez + rnd(-shk, shk)); camera.rotation.order = 'YXZ'; camera.rotation.set(pit, c.yaw + Math.PI, 0); c.dist = 0.4; c.len = undefined;
    try { fpFrame(P, dt, camera.position, c.yaw, pit); } catch (e) { console.error('fp', e); G.fpv = false; }
  } else { VM.grp.visible = false; c.fx = undefined;
  let dx = -d.x * dist, dy = -d.y * dist + 0.25, dz = -d.z * dist; const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
  const t = rayWorld(ox, oy, oz, dx, dy, dz, L + 0.4), cl0 = clamp(t - 0.4, 1.25, L);   // never closer than ~1.2 m: a lens right behind the soldier makes legs look huge
  c.len = c.len === undefined || cl0 < c.len ? cl0 : damp(c.len, cl0, 6, dt); const cl = c.len;
  c.dist = cl; c.shake = damp(c.shake, 0, 9, dt); const sh = c.shake * 0.05;
  camera.position.set(ox + dx * cl + rnd(-sh, sh), oy + dy * cl + rnd(-sh, sh), oz + dz * cl + rnd(-sh, sh));
  camera.rotation.order = 'YXZ'; camera.rotation.set(pit - (dy < 0 ? 0 : 0), c.yaw + Math.PI, 0); }
  { const nr = G.fp ? 0.05 : 0.1; if (camera.near !== nr) { camera.near = nr; camera.updateProjectionMatrix(); } }
  const aspect = innerWidth / innerHeight, baseFov = aspect < 1 ? 80 : 70, zf = zl > 1 ? 0.3 : 0.55;
  const tf = lerp(baseFov, baseFov * zf, c.aim) + (P.inp.sprint && P.speed > 11 ? 7 : 0) + (P.rollT > 0 ? 6 : 0) + Math.min(10, c.shake * 6);
  c.fov = damp(c.fov, tf, 12, dt); if (Math.abs(camera.fov - c.fov) > 0.01) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
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
  setT(U.mag, P.reloadT > 0 ? '…' : P.stance === 'sword' ? '⚔' : P.mag); setT(U.res, P.stance === 'sword' ? '' : `/ ${P.reserve}`); setT(U.wname, P.stance === 'sword' ? 'Blade' : P.reloadT > 0 ? 'Reloading' : 'AK-47');
  { const zl = zoomLevel(); U.scope.classList.toggle('on', zl > 0); U.scope.classList.toggle('l2', zl > 1); if (U.zoomt) setT(U.zoomt, zl ? zl * 2 + 'x' : 'Zoom'); }
  U.mag.parentElement.classList.toggle('empty', P.stance === 'rifle' && P.mag === 0);
  const t = Math.max(0, Math.ceil(Z.timer)), zt = Z.state === 'final' ? 'FINAL' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  setT(U.zone, zt); setT(U.zonel, Z.state === 'shrink' ? 'closing' : Z.state === 'final' ? 'zone' : 'next'); U.zonep.classList.toggle('warn', Z.state === 'shrink' || Math.hypot(P.x - Z.cx, P.z - Z.cz) > Z.r);
  const sp = (P.aiming ? 0 : 3) + (P.speed / CFG.RUN) * 8 + G.bloom * 600 + (P.grounded ? 0 : 8); U.xh.style.setProperty('--s', sp.toFixed(1) + 'px'); U.xh.classList.toggle('ads', P.aiming);
  if (G.lock && G.lock.alive) { const s = toScreen(G.lock.x, G.lock.y + 1.3, G.lock.z); U.lock.style.display = s.v ? 'block' : 'none'; U.lock.style.left = s.x + 'px'; U.lock.style.top = s.y + 'px'; } else U.lock.style.display = 'none';
  // minimap (every other frame)
  if ((mapTick++ & 1) === 0) {
    const g = mctx, W = U.map.width, S = 1.75;
    g.save(); g.clearRect(0, 0, W, W); g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, 6.283); g.clip();
    g.translate(W / 2, W / 2); g.rotate(-G.cam.yaw); g.scale(S, S); g.translate(-P.x, P.z);
    g.drawImage(WORLD.mini, -62, -62, 124, 124);
    g.lineWidth = 1.2; g.strokeStyle = '#c4a1ff'; g.beginPath(); g.arc(Z.cx, -Z.cz, Z.r, 0, 6.283); g.stroke();
    if (Z.state !== 'final') { g.strokeStyle = 'rgba(255,255,255,.8)'; g.setLineDash([3, 3]); g.beginPath(); g.arc(Z.nx, -Z.nz, Z.nr, 0, 6.283); g.stroke(); g.setLineDash([]); }
    for (const p of pickups) if (!p.taken) { g.fillStyle = PK[p.k].color; g.fillRect(p.x - 0.9, -p.z - 0.9, 1.8, 1.8); }
    for (const f of fighters) { if (f === P || !f.alive || f === G.showcase) continue; const d = Math.hypot(f.x - P.x, f.z - P.z); if (d > 34 && G.t - f.lastShot > 1.2 && !(f.remote && d < 80)) continue; g.fillStyle = '#ff4d6d'; g.beginPath(); g.arc(f.x, -f.z, 1.9, 0, 6.283); g.fill(); }
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
  if (BOX) return startBoxing();
  AU.init(); netLeave(); clearWorld(); G.total = 0; G._winT = 0; NET.fs = 0; NET.evs = 0; NET.ev = ''; G.over = false; G.t = 0; G.paused = false; G.streak = 0; G.lastKillT = -9; G.bloom = 0; exhausted = false; idleT = 0;
  const sp = WORLD.spawns.slice().sort(() => Math.random() - 0.5);
  const P = new Fighter(PLAYER_NAME, true, null); G.player = P; P.spawnAt(sp[0].x, sp[0].z); P.lastShot = -9;
  for (let i = 0; i < CFG.BOTS; i++) { const b = makeBot(i); const s = sp[(i + 1) % sp.length]; b.spawnAt(s.x, s.z); b.yaw = rnd(0, 6.28); b.lastShot = -9; }
  P.yaw = Math.atan2(-P.x, -P.z); G.cam.yaw = P.yaw; G.cam.pitch = 0.12; G.cam.recoil = 0; G.zoom = 0; G.cam.len = undefined;
  G.alive = fighters.length; zoneReset();
  for (const l of WORLD.loot) addPickup(l.x, l.z, l.k);
  NET.on = U.online.querySelector('.on')?.dataset.o !== '0'; store.set('online', NET.on ? 1 : 0); netJoin();
  G.diff = Number(U.diff.querySelector('.on')?.dataset.d || 1); G.assist = U.assist.querySelector('.on')?.dataset.a !== '0'; store.set('assist', G.assist ? 1 : 0); G.lock = null; store.set('diff', G.diff);
  for (const s of Object.values(U.screens)) s.classList.remove('on'); U.hud.classList.add('on'); if (TOUCH) U.touch.classList.add('on');
  G.state = 'playing'; setTimeout(() => P.wave(), 150); banner(`DROP IN · ${G.alive} FIGHTERS`, '#fde047');
  try { if (TOUCH) { document.documentElement.requestFullscreen?.().catch(() => {}); screen.orientation?.lock?.('landscape').catch(() => {}); } else lockPointer(); } catch {}
}
function endMatch(won, by) {
  if (G.over) return; G.over = true; const P = G.player, place = won ? 1 : (G.aliveAtDeath || 16), total = Math.max(G.total || 0, CFG.BOTS + 1);
  const score = P.kills * 100 + (total + 1 - place) * 30 + (won ? 500 : 0);
  if (won) { P.wave(); AU.win(); } else AU.lose();
  fireHeld = aimHeld = false; try { document.exitPointerLock?.(); } catch {}
  later(won ? 0.5 : 3, netLeave);
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
function toMenu() { netLeave(); try { parent !== window && parent.postMessage({ type: 'gb-game-exit' }, '*'); } catch {} if (parent === window) location.href = qs.get('back') || './'; }
U.pause.addEventListener('click', () => setPaused(true)); U.resume.addEventListener('click', () => setPaused(false));
U.quit.addEventListener('click', () => { G.over = true; netLeave(); try { document.exitPointerLock?.(); } catch {} toMenu(); });
U.exit1.addEventListener('click', toMenu); U.exit2.addEventListener('click', toMenu);
U.again.addEventListener('click', () => { U.screens.end.classList.remove('on'); startMatch(); });
U.play.addEventListener('click', startMatch);
U.diff.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; U.diff.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
U.online.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { U.online.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); NET.on = b.dataset.o !== '0'; if (NET.on) netInit(); else netStatus('Solo mode'); } });
U.assist.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) U.assist.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
{ const a = store.get('assist', 1); U.assist.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.a === String(a))); G.assist = a !== 0; }
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
  const sc = new Fighter('Hero', false, null); G.showcase = sc; sc.spawnAt(0, BOX ? 0 : 15); sc.yaw = Math.PI; sc.relax = true; sc.setStance(BOX ? 'fist' : 'rifle'); if (BOX) sc.glove('#e11d48');
  const loop = () => { if (G.showcase === sc) { sc.wave(); setTimeout(loop, 4200); } }; setTimeout(loop, 900);
}
function menuCam(dt) {
  G.menuA = (G.menuA || 0) + dt * 0.18; const a = G.menuA, cx = 0, cz = BOX ? 0 : 15;
  camera.position.set(cx + Math.sin(a) * 6.5, 2.1 + Math.sin(a * 0.7) * 0.25, cz + Math.cos(a) * 6.5); camera.lookAt(cx, 1.25, cz);
  camera.rotation.order = 'XYZ'; if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
  sun.position.set(SUN_DIR.x * 90, SUN_DIR.y * 90, 15 + SUN_DIR.z * 90); sun.target.position.set(0, 0, cz);
}
function step(dt) {
  if (BOX) return stepBox(dt);
  G.t += dt; for (let i = timers.length - 1; i >= 0; i--) { const t = timers[i]; t.t -= dt; if (t.t <= 0) { timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } } }
  playerControl(dt);
  { let n = 0; for (const f of fighters) if (f.alive && f !== G.showcase) n++; G.alive = n; G.total = Math.max(G.total || 0, fighters.length); if (n === 1 && G.player.alive && !G.over && !G._winT) { G._winT = 1; later(1.4, () => endMatch(true)); } }
  netTick(dt);
  for (const f of fighters) if (f.ai && f.alive) botThink(f, dt);
  for (const f of fighters) f.update(dt);
  const P = G.player; P.lastShot = P.fireCd > WEAPON.rate * 0.6 ? G.t : P.lastShot; for (const f of fighters) if (f.ai && f.fireCd > WEAPON.rate) f.lastShot = G.t;
  for (const p of pickups) { if (p.taken) continue; p.t += dt; p.g.position.y = p.y + 0.75 + Math.sin(p.t * 2.2) * 0.12; p.body.rotation.y = p.t * 1.6; }
  zoneUpdate(dt);
  updateCamera(dt); fxUpdate(dt); drawHUD(dt);
  for (const c of clouds) { c.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.004 * c.userData.sp); c.lookAt(0, 0, 0); }
}
let last = performance.now(), fcount = 0, ema = 1 / 60, qLevel = 0, qTimer = 0;
renderer.shadowMap.autoUpdate = false;
function lowerQuality() {
  qLevel++;
  if (qLevel === 1) { renderer.setPixelRatio(1); resize(); }
  else if (qLevel === 2) { renderer.shadowMap.enabled = false; sun.castShadow = false; scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } }); }
  else if (qLevel === 3) { renderer.setPixelRatio(0.75); resize(); }
}
function frame(now) {
  requestAnimationFrame(frame); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  try {
    if (G.state === 'playing' && !G.paused) step(dt);
    else if (G.state === 'end') { for (const f of fighters) f.update(dt); G.t += dt; for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const t = timers.splice(i, 1)[0]; t.fn(); } } updateCamera(dt); fxUpdate(dt); }
    else if (G.state === 'menu' || G.state === 'loading') { if (G.showcase) G.showcase.update(dt); menuCam(dt); }
  } catch (e) { console.error(e); }
  ema = lerp(ema, dt, 0.05); qTimer += dt; if (G.state === 'playing' && qTimer > 2.5) { qTimer = 0; if (ema > 1 / 40 && qLevel < 3) lowerQuality(); }
  renderer.shadowMap.needsUpdate = (fcount++ & 1) === 0;
  renderer.render(scene, camera);
}
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

(async function boot() {
  { const t = document.createElement('div'); t.textContent = 'build v40 · ' + (BOX ? 'boxing' : 'compound'); t.style.cssText = 'position:fixed;left:8px;bottom:4px;font:10px sans-serif;color:#fff;opacity:.35;z-index:5;pointer-events:none'; document.body.appendChild(t); }
  if (BOX) buildArena(); else buildWorld(); requestAnimationFrame(frame);
  if (TOUCH && innerHeight > innerWidth) U.loadt.insertAdjacentHTML('afterend', '<p style="color:#fde047;font-size:14px">📱 Turn your phone sideways for the best view.</p>');
  U.sensrow.style.display = 'flex'; U.menurow.style.display = 'flex'; U.menurow2.style.display = 'flex'; U.menurow3.style.display = 'flex'; if (!NET.on) { U.online.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.o === '0')); }
  await loadAssets(); if (BOX) bxInitUI(); G.state = 'menu'; showcaseInit(); U.play.style.display = ''; U.load.parentElement.style.display = 'none'; U.loadt.style.display = TOUCH || ASSETS.soldier ? 'none' : '';
  if (NET.on && !qs.get('auto')) netInit();
  if (qs.get('auto')) startMatch();
})();
window.__cc = { G, fighters, COL, scene, camera, renderer, startMatch, step, WORLD, Z, pickups, act, NET, rayWorld, playerFire, damage, Fighter };
