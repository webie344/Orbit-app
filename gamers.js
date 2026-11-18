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
  HALF: 84,                  // town is 168 x 168 m
  BOTS: 17,
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
const LIFE = qs.get('mode') === 'life';   // Get Better World (social life mode)
const BOX = qs.get('mode') === 'box';   // Boxing Arena mode (same engine, same soldier)
if (LIFE) { CFG.HALF = 700; CFG.RUN = 6.5; CFG.SPRINT = 10.5; CFG.WALK = 3; }
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
  cannon(v = 1) { if (v < 0.02 || !this.ctx) return; const d = this._bus(v, 0.5); this._n(0.08, 2500, 0.5, 1, 'highpass', 0, 0, d); this._n(0.45, 1200, 0.7, 1, 'bandpass', 120, 0, d); this._t(90, 28, 0.6, 1.2, 'sine', 0, d); this._t(55, 25, 0.9, 0.8, 'triangle', 0.02, d); this._n(1.2, 420, 0.6, 0.5, 'lowpass', 70, 0.08, d); },
  boom(v = 1) { if (v < 0.02 || !this.ctx) return; const d = this._bus(v, 0.45); this._n(0.1, 3000, 0.5, 0.9, 'highpass', 0, 0, d); this._n(0.9, 1500, 0.6, 1, 'lowpass', 90, 0, d); this._t(70, 22, 1.1, 1.3, 'sine', 0, d); this._t(45, 20, 1.4, 0.9, 'triangle', 0.03, d); this._n(1.6, 350, 0.7, 0.6, 'lowpass', 60, 0.15, d); for (let i = 0; i < 5; i++) this._n(0.05, rnd(1500, 4000), 2, 0.25, 'bandpass', 0, 0.25 + Math.random() * 0.9, d); },
  engine(spd = 0, thr = 0) {
    if (!this.ctx) return; const c = this.ctx;
    if (!this._eng) {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; const g = c.createGain(); g.gain.value = 0.0001; lp.connect(g); g.connect(this.out);
      const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; o1.connect(lp); o2.connect(lp); o1.start(); o2.start();
      const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; const nb = c.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 120; nb.Q.value = 0.8; const ng = c.createGain(); ng.gain.value = 0.25; s.connect(nb); nb.connect(ng); ng.connect(g); s.start();
      this._eng = { o1, o2, g, lp, s };
    }
    const e = this._eng, t = c.currentTime, f = 34 + Math.abs(spd) * 3.2 + Math.abs(thr) * 9;
    e.o1.frequency.setTargetAtTime(f, t, 0.1); e.o2.frequency.setTargetAtTime(f * 0.5 + 1.3, t, 0.1); e.lp.frequency.setTargetAtTime(220 + Math.abs(spd) * 22, t, 0.15); e.g.gain.setTargetAtTime(0.16 + Math.abs(thr) * 0.08 + Math.abs(spd) * 0.006, t, 0.12);
  },
  engineOff() { const e = this._eng; if (!e || !this.ctx) return; const t = this.ctx.currentTime; e.g.gain.setTargetAtTime(0.0001, t, 0.12); const x = e; this._eng = null; setTimeout(() => { try { x.o1.stop(); x.o2.stop(); x.s.stop(); } catch {} }, 700); },
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
const COL = [], GRID = new Map(), CELL = 8, DYN = []; let _q = 0;
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
  for (let i = 0; i < DYN.length; i++) { const c = DYN[i]; if (!c.off && c.x1 > x0 && c.x0 < x1 && c.z1 > z0 && c.z0 < z1) out.push(c); }
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
  for (let i = 0; i < COL.length; i++) { if (COL[i].off) continue; const t = rayBox(ox, oy, oz, dx, dy, dz, COL[i], best); if (t < best) best = t; }
  if (dy < 0) { const t = -oy / dy; if (t > 0 && t < best) best = t; }
  return best;
}
function isFree(x, z, m) {
  if (Math.abs(x) > CFG.HALF - 2 || Math.abs(z) > CFG.HALF - 2) return false;
  for (const r of WORLD.res) if (Math.hypot(r.x - x, r.z - z) < r.r) return false;
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
    if (o.t === 'door') seg(o.s, o.e, 3.1, h); else if (o.t === 'hole') seg(o.s, o.e, 0, 0.7); else { seg(o.s, o.e, 0, 1.05); seg(o.s, o.e, 2.25, h); }
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

const WORLD = { spawns: [], loot: [], trees: [], towers: [], res: [], rooms: [] };
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
/*  WAR-TORN TOWN  (enterable two-storey buildings, mountains, ruins)         */
/* ========================================================================== */
const TANK_SPOTS = [{ x: 0, z: -22, yaw: 0 }, { x: -50, z: 0, yaw: Math.PI / 2 }, { x: 0, z: 50, yaw: Math.PI }, { x: 50, z: 0, yaw: -Math.PI / 2 }];
const WARC = ['#d9c9a6', '#cbbf9f', '#c2b8a4', '#d6bfa0', '#b9b2a2', '#cfc3ad'];
function opsFor(c0, len, doorList, holes) {
  const ops = autoOps(c0, len, doorList).filter((o) => o.t === 'door' || (holes || []).every((c) => Math.abs(o.c - c) > 3));
  (holes || []).forEach((c) => ops.push({ c, w: 3.2, t: 'hole' })); return ops;
}
function rubble(x, z, n = 6, spread = 2.2) {
  for (let i = 0; i < n; i++) {
    const rx = x + rnd(-spread, spread), rz = z + rnd(-spread, spread), s = rnd(0.35, 1.1), h = rnd(0.25, 0.95);
    B(rx - s / 2, 0, rz - s / 2, rx + s / 2, h, rz + s / 2, 'concrete', pick(['#a49b8c', '#8f877a', '#b3a994', '#7d766b']), h > 0.55, 2);
  }
}
function wallPatches(x0, z0, x1, z1, h, n = 5) {   // exposed brick / scorch marks on the outside of walls
  for (let i = 0; i < n; i++) {
    const side = (R() * 4) | 0, w = rnd(1.2, 2.6), hh = rnd(0.9, 1.8), y = rnd(0.5, h - 2), dark = R() > 0.55;
    const mat = dark ? 'paint' : 'brick', col = dark ? '#2e2a26' : '#ffffff';
    if (side < 2) { const x = rnd(x0 + 1, x1 - 1 - w), zz = side ? z1 + 0.27 : z0 - 0.27 - 0.06; B(x, y, zz, x + w, y + hh, zz + 0.06, mat, col, false, 1.5); }
    else { const z = rnd(z0 + 1, z1 - 1 - w), xx = side === 2 ? x1 + 0.27 : x0 - 0.27 - 0.06; B(xx, y, z, xx + 0.06, y + hh, z + w, mat, col, false, 1.5); }
  }
}
/** two-storey house: doors on ground floor, windows both floors, inner stairs, partition walls, furnished, roof */
function house2(cx, cz, w, d, doors, o = {}) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, t = 0.5, F = 3.5, h = F * 2, wm = o.wall || 'concrete', wc = o.color || pick(WARC);
  const gh = o.holes || {}, uh = o.uholes || {};
  B(x0, 0, z0, x1, 0.2, z1, 'concrete', '#bdb3a2', true, 4);
  for (const [ax, at, a, b, c0, len, k] of [['x', z1, x0, x1, cx, w, 'n'], ['x', z0, x0, x1, cx, w, 's'], ['z', x1, z0, z1, cz, d, 'e'], ['z', x0, z0, z1, cz, d, 'w']]) {
    wallRun(ax, at, a, b, t, F, wm, wc, opsFor(c0, len, (doors || {})[k] || [], gh[k]));
    wallRun(ax, at, a, b, t, F, wm, wc, opsFor(c0, len, [], uh[k]), F);
  }
  const side = doors && doors.s && doors.s.length ? 'n' : 's', sx = x0 + 0.8, sz = side === 's' ? z0 + 0.8 : z1 - 0.8 - 2.2, L = 9 * 0.7;
  stairs(sx, sz, 'x+', 9, F / 9, 0.7, 2.2, 'concrete', '#c9bfae');
  B(x0, F - 0.3, z0, sx, F, z1, 'concrete', '#b9af9e'); B(sx + L, F - 0.3, z0, x1, F, z1, 'concrete', '#b9af9e');
  B(sx, F - 0.3, z0, sx + L, F, sz, 'concrete', '#b9af9e'); B(sx, F - 0.3, sz + 2.2, sx + L, F, z1, 'concrete', '#b9af9e');
  if (d >= 11) for (const y0 of [0, F]) wallRun('x', cz + (side === 'n' ? -0.5 : 0.5), x0 + 0.3, x1 - 0.3, 0.3, F, 'brick', '#e4d4c4', [{ c: cx + w * 0.2, w: 3, t: 'door' }], y0);
  // roof (partly blown off on ruins) + parapet
  const rx1 = o.ruin ? x0 + w * 0.55 : x1 + 0.4;
  B(x0 - 0.4, h - 0.4, z0 - 0.4, rx1, h, z1 + 0.4, 'roof', '#ffffff');
  B(x0 - 0.4, h, z0 - 0.4, rx1, h + 0.8, z0 - 0.05, 'concrete', '#d6cdbf'); B(x0 - 0.4, h, z1 + 0.05, rx1, h + 0.8, z1 + 0.4, 'concrete', '#d6cdbf'); B(x0 - 0.4, h, z0 - 0.05, x0 - 0.05, h + 0.8, z1 + 0.05, 'concrete', '#d6cdbf');
  if (!o.ruin) B(x1 + 0.05, h, z0 - 0.05, x1 + 0.4, h + 0.8, z1 + 0.05, 'concrete', '#d6cdbf');
  // furniture on both floors (right half, away from the stairs)
  for (const y of [0.2, F]) {
    const yy = y;
    B(x1 - 1.9, yy, z1 - 1.9, x1 - 0.7, yy + 1.1, z1 - 0.7, 'wood', pick(['#ffffff', '#f2dcc0']), true, 1.2);
    B(x1 - 1.9, yy, z0 + 0.7, x1 - 0.7, yy + 1.1, z0 + 1.9, 'wood', '#e0c49a', true, 1.2);
    B(cx + 1.2, yy, cz - 3.3, cx + 3.0, yy + 0.9, cz - 2.3, 'wood', '#9b7b52', true, 1.5);
    if (!(doors && doors.e && doors.e.length) && R() > 0.4) B(x1 - 0.9, yy, cz - 1.2, x1 - 0.4, yy + 2.0, cz + 1.2, 'wood', '#6d5436', true, 1.5);
  }
  wallPatches(x0, z0, x1, z1, h, o.ruin ? 8 : 4);
  if (o.ruin) { rubble(x1 + 1.8, cz, 9, 2.6); rubble(cx, z1 + 2, 5, 3); }
  WORLD.rooms.push({ x: cx + 2.2, z: cz + 2.6 }, { x: cx - 2.5, z: cz - 3 });
  return { x0, x1, z0, z1 };
}
function snipeTower(tx, tz, east) {
  const px0 = tx - 3.2, px1 = tx + 3.2, pz0 = tz - 3.2, pz1 = tz + 3.2, sx = east ? 1 : -1;
  for (const [ax, az] of [[px0, pz0], [px1 - 0.9, pz0], [px0, pz1 - 0.9], [px1 - 0.9, pz1 - 0.9]]) B(ax, 0, az, ax + 0.9, 6, az + 0.9, 'concrete', '#a79e8e');
  B(px0, 5.55, pz0, px1, 6, pz1, 'roof', '#ffffff');
  B(px0, 6, pz0, px1, 7.0, pz0 + 0.3, 'wood', '#a58a68', true, 1.2); B(px0, 6, pz1 - 0.3, px1, 7.0, pz1, 'wood', '#a58a68', true, 1.2);
  B(sx > 0 ? px1 - 0.3 : px0, 6, pz0, sx > 0 ? px1 : px0 + 0.3, 7.0, pz1, 'wood', '#a58a68', true, 1.2);
  B(tx - 1.2, 6, tz - 1.2, tx + 1.2, 7.7, tz + 1.2, 'wood', '#8d6b44', false); B(tx - 1.4, 7.7, tz - 1.4, tx + 1.4, 7.9, tz + 1.4, 'roof', '#ffffff', false);
  if (sx > 0) stairs(px0 - 0.1, tz - 1.1, 'x+', 14, 0.4, 0.7, 2.2); else stairs(px1 + 0.1, tz - 1.1, 'x-', 14, 0.4, 0.7, 2.2);
  WORLD.towers.push({ x: tx, z: tz });
}
function mountains(H, sea) {
  const geos = [], tmp = new THREE.Color();
  const peak = (x, z, r, h, snow) => {
    if (sea && z < -H * 0.35) return;
    const g = new THREE.ConeGeometry(r, h, 9, 4, true); g.translate(0, h / 2 - 3, 0);
    const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), sd = rnd(0, 99);
    for (let i = 0; i < n; i++) {
      let px = p.getX(i), py = p.getY(i), pz = p.getZ(i); const k = clamp((py + 3) / h, 0, 1), j = Math.sin(px * 0.21 + sd) * Math.cos(pz * 0.17 + sd * 1.3) + Math.sin((px + pz) * 0.09 + sd);
      if (k < 0.98) { px += j * r * 0.06; pz += j * r * 0.05; py += j * h * 0.03; p.setXYZ(i, px, py, pz); }
      tmp.set(k > (snow ? 0.72 : 2) ? '#f1f3f7' : k > 0.5 ? '#8c8a86' : k > 0.22 ? '#716c62' : '#5d6a46'); tmp.offsetHSL(0, 0, j * 0.02);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.rotateY(rnd(0, 6)); g.translate(x, 0, z); geos.push(g);
  };
  const N = 46;
  for (let i = 0; i < N; i++) { const a = (i / N) * 6.2832 + rnd(-0.06, 0.06), r = rnd(55, 90), rr = H + 14 + r * 0.9 + rnd(0, 40), h = rnd(60, 125); peak(Math.cos(a) * rr, Math.sin(a) * rr, r, h, h > 85); }     // main range
  for (let i = 0; i < 34; i++) { const a = (i / 34) * 6.2832 + rnd(-0.1, 0.1), r = rnd(80, 130), rr = H + 14 + r * 0.9 + rnd(60, 140), h = rnd(120, 210); peak(Math.cos(a) * rr, Math.sin(a) * rr, r, h, true); }          // far snowy peaks
  for (let i = 0; i < 40; i++) { const a = (i / 40) * 6.2832 + rnd(-0.08, 0.08), r = rnd(16, 28), rr = H + 8 + r * 0.9 + rnd(0, 14), h = rnd(14, 30); peak(Math.cos(a) * rr, Math.sin(a) * rr, r, h, false); }                // foothills
  const m = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
  m.receiveShadow = false; scene.add(m); geos.forEach((g) => g.dispose());
}
function buildTown() {
  const H = CFG.HALF;
  scene.fog.density = 0.0036;
  // ground: dusty dirt town, wide grass/rock skirt outside
  const out = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: TEX.grass.clone(), roughness: 1, color: '#7d8a5a' }));
  out.material.map.repeat.set(180, 180); out.material.map.needsUpdate = true; out.rotation.x = -Math.PI / 2; out.position.y = -0.06; out.receiveShadow = true; scene.add(out);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), new THREE.MeshStandardMaterial({ map: TEX.concrete.clone(), roughness: 0.97, color: '#b9a98a' }));
  floor.material.map.repeat.set(H / 2.6, H / 2.6); floor.material.map.needsUpdate = true; floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // roads
  B(-H, 0, -4.6, H, 0.04, 4.6, 'asphalt', '#ffffff', false, 6); B(-4.6, 0, -H, 4.6, 0.04, H, 'asphalt', '#ffffff', false, 6);
  B(-H, 0, 37.5, H, 0.04, 42.5, 'asphalt', '#d8d8d8', false, 6); B(-H, 0, -42.5, H, 0.04, -37.5, 'asphalt', '#d8d8d8', false, 6);
  B(37.5, 0, -H, 42.5, 0.04, H, 'asphalt', '#d8d8d8', false, 6); B(-42.5, 0, -H, -37.5, 0.04, H, 'asphalt', '#d8d8d8', false, 6);
  for (let i = -H + 3; i < H - 3; i += 6) { if (Math.abs(i) < 7) continue; B(i - 1.2, 0.04, -0.12, i + 1.2, 0.06, 0.12, 'concrete', '#e8dfb0', false, 4); B(-0.12, 0.04, i - 1.2, 0.12, 0.06, i + 1.2, 'concrete', '#e8dfb0', false, 4); }
  for (let i = 0; i < 26; i++) { const x = rnd(-76, 76), z = rnd(-76, 76), s = rnd(5, 14); if (Math.abs(x) < 8 || Math.abs(z) < 8) continue; B(x - s / 2, 0, z - s / 2, x + s / 2, 0.03, z + s / 2, 'concrete', pick(['#8a9764', '#7a8a58', '#a29a6a']), false, 20); }
  // plaza with a wrecked monument
  B(-12, 0, -12, 12, 0.12, 12, 'tile', '#cfc6b4', true, 3.5);
  B(-3.3, 0.12, -3.3, 3.3, 0.9, 3.3, 'concrete', '#a59c8c'); B(-0.7, 0.9, -0.7, 0.7, 3.4, 0.7, 'concrete', '#c8bfae'); B(-1.2, 2.6, -0.6, 0.2, 4.3, 0.6, 'concrete', '#bdb4a3', false);
  rubble(0, 0, 8, 4.5);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) sandbags(sx * 9 - 2.4, sz * 9 - 0.4, sx * 9 + 2.4, sz * 9 + 0.4);

  // ---------- enterable buildings ----------
  // north-east
  house2(22, 21, 14, 12, { s: [0], w: [0] }, {});
  house2(46, 20, 13, 12, { s: [0], e: [0] }, { holes: { n: [-1] }, uholes: { e: [1] } });
  house2(24, 56, 22, 13, { s: [-5, 5] }, { holes: { e: [0] } });
  house2(62, 60, 14, 12, { w: [0], s: [0] }, { ruin: true, uholes: { n: [0], s: [3] }, holes: { n: [2] } });
  // north-west
  house2(-27, 22, 22, 14, { s: [-4, 5], e: [0] }, { wall: 'brick', color: '#e8d5c2' });
  house2(-52, 22, 13, 12, { s: [0] }, { holes: { w: [0] } });
  house2(-60, 58, 14, 12, { s: [0] }, { ruin: true, uholes: { s: [-2], e: [2] }, holes: { e: [-2] } });
  // south-west
  house2(-27, -22, 22, 14, { n: [-5, 5], e: [0] }, { wall: 'brick', color: '#d9c3b0' });
  house2(-54, -22, 13, 12, { n: [0], e: [0] }, {});
  house2(-26, -58, 14, 12, { n: [0] }, { uholes: { w: [0] } });
  house2(-62, -60, 16, 12, { n: [0], e: [0] }, { ruin: true, holes: { w: [0], s: [3] }, uholes: { n: [3] } });
  // south-east
  house2(22, -22, 13, 12, { n: [0], w: [0] }, { holes: { e: [-1] } });
  house2(50, -22, 14, 12, { n: [0], w: [0] }, { uholes: { s: [0] } });
  house2(28, -58, 18, 12, { n: [-4, 4] }, { holes: { w: [0] } });
  house2(60, -56, 14, 14, { n: [0], w: [0] }, { ruin: true, uholes: { e: [0], n: [3] }, holes: { s: [2] } });
  // church (large hall with pews, tall bell tower)
  { const cx = 66, cz = 24; building(cx, cz, 16, 26, 10, { s: [0], w: [4] }, { color: '#d7ccb6', wall: 'concrete', floor: 'tile' });
    B(cx - 3, 0.2, cz - 12, cx + 3, 0.5, cz - 10, 'wood', '#6d5436', true, 1.5);                                   // altar
    for (let r = 0; r < 6; r++) { B(cx - 6.5, 0.2, cz - 6 + r * 2.4, cx - 1.6, 1.0, cz - 5.4 + r * 2.4, 'wood', '#7b5c3a', true, 1.2); B(cx + 1.6, 0.2, cz - 6 + r * 2.4, cx + 6.5, 1.0, cz - 5.4 + r * 2.4, 'wood', '#7b5c3a', true, 1.2); }
    B(cx - 2.5, 10, cz + 10.5, cx + 2.5, 19, cz + 15.5, 'concrete', '#c4b9a5'); B(cx - 3, 19, cz + 10, cx + 3, 19.6, cz + 16, 'roof', '#ffffff', false); B(cx - 0.15, 19.6, cz + 12.8, cx + 0.15, 22.4, cz + 13.2, 'metal', '#b9b2a2', false); B(cx - 0.8, 21, cz + 12.85, cx + 0.8, 21.3, cz + 13.15, 'metal', '#b9b2a2', false);
    rubble(cx - 9.5, cz, 6, 1.6); }
  // warehouse / factory (containers inside, stairs to the roof)
  building(70, -37, 18, 16, 8, { w: [0], s: [-4] }, { color: '#b9bfc9', wall: 'concrete', floor: 'concrete' });
  container(72, -40, 'x', '#6a7a5a'); container(72, -34, 'x', '#8a5a4a'); crate(66, -33, 1.3, 2); crate(66.2, -41, 1.3, 2); barrel(64.5, -38, '#2b7a78');
  // gas station
  { const gx = -24, gz = 62; for (const [px, pz] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) B(gx + px - 0.3, 0, gz + pz - 0.3, gx + px + 0.3, 5.2, gz + pz + 0.3, 'concrete', '#c9c0b0');
    B(gx - 8, 5.2, gz - 6, gx + 8, 5.8, gz + 6, 'metal', '#c44a3a', false, 3); B(gx - 8.2, 5.2, gz - 6.2, gx + 8.2, 5.4, gz + 6.2, 'metal', '#e8e4d8', false, 3);
    for (const px of [-3, 3]) { B(gx + px - 0.4, 0, gz - 0.35, gx + px + 0.4, 1.5, gz + 0.35, 'metal', '#c9382e'); B(gx + px - 0.3, 1.5, gz - 0.3, gx + px + 0.3, 1.9, gz + 0.3, 'glow', '#3a4a5a', false); }
    building(gx, gz + 12, 10, 6, 4, { s: [0] }, { color: '#e2d8c0', wall: 'brick' }); car(gx + 8, gz - 1, 'z', '#2a2724'); }
  // water tower
  { const wx = 14, wz = 70; for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) B(wx + a - 0.3, 0, wz + b - 0.3, wx + a + 0.3, 16, wz + b + 0.3, 'metal', '#6d6f72'); cylinder(wx, wz, 3.6, 5, 'metal', '#8a7a62', 16, false); B(wx - 2.4, 15.6, wz - 2.4, wx + 2.4, 16.2, wz + 2.4, 'metal', '#5d5f62', false); }
  // sniper towers
  snipeTower(78, 10, true); snipeTower(-78, -10, false);
  // road blocks / checkpoints with burned wrecks, hedgehogs, sandbags
  for (const [rx, rz, along] of [[0, 62, 'x'], [0, -62, 'x'], [62, 0, 'z'], [-62, 0, 'z']]) {
    const a = along === 'x';
    for (let i = -1; i <= 1; i += 2) { if (a) sandbags(rx + i * 6 - 2, rz - 0.5, rx + i * 6 + 2, rz + 0.5); else sandbags(rx - 0.5, rz + i * 6 - 2, rx + 0.5, rz + i * 6 + 2); }
    barrier(rx, rz, along); car(rx + (a ? 0 : 3.2), rz + (a ? 3.2 : 0), a ? 'z' : 'x', '#2a2724');
    for (let k = -1; k <= 1; k++) B((a ? rx + k * 2.2 : rx - 2.6) - 0.5, 0, (a ? rz - 2.6 : rz + k * 2.2) - 0.5, (a ? rx + k * 2.2 : rx - 2.6) + 0.5, 1.0, (a ? rz - 2.6 : rz + k * 2.2) + 0.5, 'concrete', '#8b8478', true, 1);
  }
  for (const s of TANK_SPOTS) WORLD.res.push({ x: s.x, z: s.z, r: 9 });
  // street wrecks, cover, craters, lamps
  for (const [x, z, a, c] of [[-14, 3, 'x', '#2a2724'], [16, -3, 'x', '#6b4a3a'], [3, 22, 'z', '#2a2724'], [-3, -30, 'z', '#4a5a6a'], [40, 14, 'z', '#2a2724'], [-40, -14, 'z', '#6a6a52'], [30, 40, 'x', '#2a2724'], [-34, -40, 'x', '#5a3a2a'], [-8, 40, 'x', '#6a6a6a'], [10, -40, 'x', '#2a2724']]) car(x, z, a, c);
  for (let i = 0; i < 16; i++) { const p = freePoint(2.4); barrier(p.x, p.z, R() > 0.5 ? 'x' : 'z'); }
  for (let i = 0; i < 40; i++) { const p = freePoint(1.6); crate(p.x, p.z, rnd(1, 1.4), R() > 0.8 ? 2 : 1); }
  for (let i = 0; i < 22; i++) { const p = freePoint(1.3); barrel(p.x, p.z, pick(['#d24a3a', '#2b7a78', '#d6a020', '#4c5aa8', '#5a5f4a'])); }
  for (let i = 0; i < 18; i++) { const p = freePoint(3); rubble(p.x, p.z, 4, 1.8); }
  for (let i = 0; i < 14; i++) { const p = freePoint(3.5), r = rnd(1.6, 3.2); cylinder(p.x, p.z, r, 0.05, 'asphalt', '#1d1a17', 0, false); }
  for (const [x, z] of [[-20, 6], [20, -6], [-20, -6], [20, 6], [0, 30], [0, -30], [30, 0], [-30, 0], [44, 38], [-44, -38]]) lamp(x, z);
  // market stalls on the north-east square
  for (let i = 0; i < 4; i++) { const sx = 6 + i * 6, sz = 31; B(sx, 0, sz, sx + 4, 1.0, sz + 1.2, 'wood', '#a58a68', true, 1.5); B(sx - 0.2, 2.5, sz - 0.4, sx + 4.2, 2.65, sz + 2.2, 'paint', pick(['#b24a3a', '#3a6aa0', '#c9a23a', '#4a8a5a']), false); B(sx, 0, sz + 1.2, sx + 0.2, 2.5, sz + 1.4, 'wood', '#6d5436', false); B(sx + 3.8, 0, sz + 1.2, sx + 4, 2.5, sz + 1.4, 'wood', '#6d5436', false); }
  // cliff ring that closes the town in (invisible walls would feel fake)
  const rk = '#756e62';
  B(-H - 14, 0, H, H + 14, 16, H + 14, 'concrete', rk, true, 6); B(-H - 14, 0, -H - 14, H + 14, 16, -H, 'concrete', rk, true, 6); B(H, 0, -H, H + 14, 16, H, 'concrete', rk, true, 6); B(-H - 14, 0, -H, -H, 16, H, 'concrete', rk, true, 6);
  for (let i = 0; i < 70; i++) { const a = rnd(0, 6.283), r = H + rnd(2, 10), s = rnd(3, 9); const rx = clamp(Math.cos(a) * 1.5, -1, 1) * r, rz = clamp(Math.sin(a) * 1.5, -1, 1) * r; B(rx - s / 2, 0, rz - s / 2, rx + s / 2, rnd(5, 14), rz + s / 2, 'concrete', pick(['#6d675c', '#7d766a', '#625c52']), false, 5); }
  // trees along the edge
  for (let tries = 0; WORLD.trees.length < 46 && tries < 500; tries++) { const p = freePoint(2.2); if (Math.abs(p.x) < 48 && Math.abs(p.z) < 48) continue; WORLD.trees.push({ x: p.x, z: p.z, s: rnd(0.9, 1.6) }); B(p.x - 0.3, 0, p.z - 0.3, p.x + 0.3, 3, p.z + 0.3, 'wood', '#5b4128', true, 1); }
  // flush merged batches
  for (const k of Object.keys(batches)) {
    const g = mergeGeometries(batches[k], false); const m = new THREE.Mesh(g, MAT[k]); m.castShadow = k !== 'glow'; m.receiveShadow = true; scene.add(m);
    batches[k].forEach((x) => x.dispose());
  }
  if (WORLD.trees.length) {
    const tg = new THREE.IcosahedronGeometry(1, 0), tm = new THREE.MeshStandardMaterial({ color: '#56803f', roughness: 1, flatShading: true }), gm = new THREE.InstancedMesh(tg, tm, WORLD.trees.length * 2), dm = new THREE.Object3D(), tc = new THREE.Color();
    WORLD.trees.forEach((t, i) => { for (let k = 0; k < 2; k++) { dm.position.set(t.x, 3.4 + k * 1.5, t.z); const s = t.s * (k ? 1.4 : 2.1); dm.scale.set(s, s * 0.9, s); dm.rotation.y = i + k; dm.updateMatrix(); gm.setMatrixAt(i * 2 + k, dm.matrix); gm.setColorAt(i * 2 + k, tc.set(k ? '#6a9448' : '#4a7436')); } });
    gm.castShadow = true; gm.receiveShadow = true; scene.add(gm);
  }
  mountains(H);
  // columns of smoke rising from the ruins
  { const sm = new THREE.MeshBasicMaterial({ color: '#33302c', transparent: true, opacity: 0.32, depthWrite: false, fog: true, side: THREE.DoubleSide }); WORLD.smoke = [];
    for (const [x, z] of [[62, 60], [-60, 58], [-62, -60], [60, -56], [0, 0]]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 6.5, 46, 10, 1, true), sm); m.position.set(x, 23, z); scene.add(m); WORLD.smoke.push(m); } }
  // spawn points & loot (more of it inside the buildings)
  for (let i = 0; i < 26; i++) WORLD.spawns.push(freePoint(1.4, 16, WORLD.spawns));
  const kinds = ['med', 'armor', 'ammo', 'ammo', 'med', 'armor'];
  WORLD.rooms.forEach((r, i) => { if (isFree(r.x, r.z, 0.5)) WORLD.loot.push({ x: r.x, z: r.z, k: kinds[i % kinds.length] }); });
  for (let i = 0; i < 24; i++) { const p = freePoint(1.0, 8, WORLD.loot); WORLD.loot.push({ x: p.x, z: p.z, k: kinds[i % kinds.length] }); }
  // minimap backdrop
  const MH = H + 4, mm = document.createElement('canvas'); mm.width = mm.height = 248; const g = mm.getContext('2d'); WORLD.mh = MH;
  g.fillStyle = '#1e2a3a'; g.fillRect(0, 0, 248, 248); g.save(); g.scale(248 / (MH * 2), 248 / (MH * 2)); g.translate(MH, MH);
  g.fillStyle = '#2c3e55'; g.fillRect(-H, -H, H * 2, H * 2); g.fillStyle = '#3b4d66'; g.fillRect(-H, -4.6, H * 2, 9.2); g.fillRect(-4.6, -H, 9.2, H * 2);
  for (const c of COL) { if (c.y1 > 16 || c.tank) continue; if (c.y1 < 1.4 && c.y1 > 0.5) g.fillStyle = '#4d6180'; else if (c.y1 >= 1.4) g.fillStyle = c.y1 > 6.5 ? '#9fb0cc' : '#7d90b0'; else continue; g.fillRect(c.x0, -c.z1, c.x1 - c.x0, c.z1 - c.z0); }
  g.restore(); WORLD.mini = mm;
}

/* ========================================================================== */
/*  GET BETTER WORLD — spacious city (streets, parks, shops, claimable houses) */
/* ========================================================================== */
const LC = { R: 150 };
const PLOTS = [], LSIGNS = [], LTREES = [], LBUSH = [], LCARS = [];
const HW = ['#f4ead6', '#ead3a8', '#cfe0ee', '#efd6d6', '#d9ebd2', '#f3e4b3', '#d9d9e2', '#ecdccb'], HR = ['#8a3b2b', '#4a4f5a', '#6b3f2a', '#3d5a6b', '#7a2e2e', '#55603f'], HD = ['#b23a3a', '#2f6aa8', '#2f8a5a', '#d6a020', '#6a4a9a', '#222831', '#c96a2a'];
function lifeSign(text, x, y, z, rotY, w = 5.2, h = 1.2, bg = '#1f2937', fg = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w); const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.fillStyle = fg; g.font = `800 ${Math.round(c.height * 0.52)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = rotY; scene.add(m); return m;
}
function gable(x0, z0, x1, z1, y, h, color, ridgeX, over = 0.7) {   // pitched roof (triangular prism)
  const w = (ridgeX ? (z1 - z0) : (x1 - x0)) / 2 + over, len = (ridgeX ? (x1 - x0) : (z1 - z0)) + over * 2;
  const g = new THREE.CylinderGeometry(1, 1, len, 4, 1); g.rotateX(Math.PI / 2); g.scale(w, h, 1); if (ridgeX) g.rotateY(Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); pushGeo('roof', g, color);
}
function winZ(cx, y, wd, ht, zf, face) {   // window on a wall that faces ±z
  const a = zf, b = zf + face * 0.05, c = zf + face * 0.09; B(cx - wd / 2 - 0.12, y - 0.12, Math.min(a, b), cx + wd / 2 + 0.12, y + ht + 0.12, Math.max(a, b), 'paint', '#ffffff', false);
  B(cx - wd / 2, y, Math.min(b, c), cx + wd / 2, y + ht, Math.max(b, c), 'glow', '#9cc4e6', false);
}
function winX(cz, y, wd, ht, xf, face) {   // window on a wall that faces ±x
  const a = xf, b = xf + face * 0.05, c = xf + face * 0.09; B(Math.min(a, b), y - 0.12, cz - wd / 2 - 0.12, Math.max(a, b), y + ht + 0.12, cz + wd / 2 + 0.12, 'paint', '#ffffff', false);
  B(Math.min(b, c), y, cz - wd / 2, Math.max(b, c), y + ht, cz + wd / 2, 'glow', '#9cc4e6', false);
}
function lifeHouse(i, px, pz, face) {
  const hw = 6.5, hd = 5.5, H = 6.0, x0 = px - hw, x1 = px + hw, z0 = pz - hd, z1 = pz + hd, wall = HW[i % HW.length], rc = HR[(i * 3 + 1) % HR.length], zf = pz + face * hd;
  B(x0, 0, z0, x1, H, z1, 'paint', wall, true, 6); B(x0 - 0.15, 0, z0 - 0.15, x1 + 0.15, 0.5, z1 + 0.15, 'concrete', '#bdb5a6', false, 4); B(x0 - 0.1, 2.95, z0 - 0.1, x1 + 0.1, 3.12, z1 + 0.1, 'paint', '#ffffff', false);
  gable(x0, z0, x1, z1, H, 2.7, rc, true); B(x1 - 2.2, H, pz - 0.5, x1 - 1.4, H + 3.2, pz + 0.3, 'brick', '#c9a58f', false);   // chimney
  for (const dx of [-3.8, 3.8]) winZ(px + dx, 1.15, 1.7, 1.5, zf, face); for (const dx of [-3.9, 0, 3.9]) winZ(px + dx, 3.7, 1.5, 1.5, zf, face);
  for (const dx of [-3.6, 0, 3.6]) { winZ(px + dx, 1.15, 1.7, 1.5, pz - face * hd, -face); winZ(px + dx, 3.7, 1.5, 1.5, pz - face * hd, -face); }
  for (const s of [-1, 1]) for (const dz of [-1.8, 1.8]) { winX(pz + dz, 1.15, 1.4, 1.5, px + s * hw, s); winX(pz + dz, 3.7, 1.4, 1.5, px + s * hw, s); }
  B(px - 1.7, 0, Math.min(zf, zf + face * 2.0), px + 1.7, 0.22, Math.max(zf, zf + face * 2.0), 'concrete', '#cfc7b8', false);                 // porch
  B(px - 2.0, 3.1, Math.min(zf, zf + face * 2.2), px + 2.0, 3.28, Math.max(zf, zf + face * 2.2), 'roof', rc, false);                       // porch canopy
  for (const s of [-1.8, 1.8]) B(px + s - 0.09, 0.22, zf + face * 2.0 - 0.09, px + s + 0.09, 3.1, zf + face * 2.0 + 0.09, 'paint', '#ffffff', false);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.7, 0.16), new THREE.MeshStandardMaterial({ color: HD[i % HD.length], roughness: 0.6 })); door.position.set(px, 0.22 + 1.35, zf + face * 0.07); scene.add(door);
  B(px + 0.55, 1.1, zf + face * 0.14 - 0.03, px + 0.7, 1.25, zf + face * 0.14 + 0.03, 'metal', '#e8d27a', false);
  B(px + hw + 0.4, 0, pz - 0.3, px + hw + 0.9, 0.9, pz + 0.3, 'wood', '#9a7a52', false);   // side shed bit (garden box)
  B(px + 2.6, 0, zf + face * 4.6 - 0.12, px + 2.72, 1.1, zf + face * 4.6 + 0.12, 'metal', '#555', false); B(px + 2.3, 1.1, zf + face * 4.6 - 0.3, px + 3.0, 1.5, zf + face * 4.6 + 0.3, 'paint', '#c0392b', false);   // mailbox
  B(px - 1.0, 0.02, Math.min(zf + face * 2.0, zf + face * 9.5), px + 1.0, 0.05, Math.max(zf + face * 2.0, zf + face * 9.5), 'tile', '#cfc8b8', false, 2);   // garden path
  // low white fence round the plot with a gate gap at the front
  const fx0 = px - 11.5, fx1 = px + 11.5, fz0 = pz - 11.5, fz1 = pz + 11.5, fy = 0.9, ft = 0.07;
  for (const yy of [0.3, 0.75]) {
    B(fx0, yy, fz0, fx1, yy + 0.08, fz0 + ft, 'paint', '#ffffff', false); B(fx0, yy, fz1 - ft, fx1, yy + 0.08, fz1, 'paint', '#ffffff', false);
    B(fx0, yy, fz0, fx0 + ft, yy + 0.08, fz1, 'paint', '#ffffff', false); B(fx1 - ft, yy, fz0, fx1, yy + 0.08, fz1, 'paint', '#ffffff', false);
  }
  for (const [qx, qz] of [[fx0, fz0], [fx1, fz0], [fx0, fz1], [fx1, fz1], [px - 1.6, face > 0 ? fz1 : fz0], [px + 1.6, face > 0 ? fz1 : fz0]]) B(qx - 0.1, 0, qz - 0.1, qx + 0.1, fy + 0.15, qz + 0.1, 'paint', '#ffffff', false);
  LTREES.push({ x: px - 9, z: pz - face * 8.5, s: rnd(0.9, 1.3) }, { x: px + 8.5, z: pz - face * 9.5, s: rnd(0.8, 1.2) });
  for (let k = -2; k <= 2; k++) if (k) LBUSH.push({ x: px + k * 2.1 + (k > 0 ? 1 : -1), z: zf + face * 1.2, s: rnd(0.55, 0.8), c: R() > 0.5 ? '#3f7d3a' : pick(['#d94a7a', '#e8b030', '#b04ad9']) });
  PLOTS.push({ i, x: px, z: pz, face, sx: px, sz: zf + face * 2.9, door });
}
function lifeShop(cx, cz, w, d, h, side, wall, roof, name, accent = '#1f2937') {
  const doors = {}; doors[side] = [0]; building(cx, cz, w, d, h, doors, { wall: 'paint', color: wall, floor: 'tile', roof });
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, sg = { s: [cx, h - 1.0, z0 - 0.35, Math.PI], n: [cx, h - 1.0, z1 + 0.35, 0], e: [x1 + 0.35, h - 1.0, cz, Math.PI / 2], w: [x0 - 0.35, h - 1.0, cz, -Math.PI / 2] }[side];
  B(sg[0] - 3, 0, sg[2], sg[0] + 3, 0, sg[2], 'paint', '#fff', false);
  if (side === 's' || side === 'n') lifeSign(name, sg[0], sg[1], sg[2], sg[3], Math.min(w - 1, 6.5), 1.2, accent); else lifeSign(name, sg[0], sg[1], sg[2], sg[3], Math.min(d - 1, 6.5), 1.2, accent);
  // simple counter + shelves inside
  const ix = side === 'e' || side === 'w';
  if (!ix) { B(x0 + 1, 0.2, z1 - 1.3, x1 - 1, 2.2, z1 - 0.7, 'wood', '#c4a070', true, 1.5); B(cx - 3.5, 0.2, cz - 0.5, cx + 3.5, 1.1, cz + 0.4, 'wood', '#8d6b44', true, 1.5); }
  else { B(x1 - 1.3, 0.2, z0 + 1, x1 - 0.7, 2.2, z1 - 1, 'wood', '#c4a070', true, 1.5); B(cx - 0.5, 0.2, cz - 3.5, cx + 0.4, 1.1, cz + 3.5, 'wood', '#8d6b44', true, 1.5); }
}
function lifeTreeAt(x, z, s = 1, trunkCol = true) { LTREES.push({ x, z, s }); if (trunkCol) B(x - 0.3, 0, z - 0.3, x + 0.3, 3.2, z + 0.3, 'wood', '#6b4a2c', true, 1); else B(x - 0.3, 0, z - 0.3, x + 0.3, 3.2, z + 0.3, 'wood', '#6b4a2c', false, 1); }
function bench(x, z, alongX) { const hx = alongX ? 1.0 : 0.3, hz = alongX ? 0.3 : 1.0; B(x - hx, 0.35, z - hz, x + hx, 0.5, z + hz, 'wood', '#9a7048', true, 1); B(x - hx, 0, z - hz, x - hx + 0.1, 0.35, z + hz, 'metal', '#333', false); B(x + hx - 0.1, 0, z - hz, x + hx, 0.35, z + hz, 'metal', '#333', false); if (alongX) B(x - hx, 0.5, z + 0.25, x + hx, 1.0, z + 0.32, 'wood', '#9a7048', false); else B(x + 0.25, 0.5, z - hz, x + 0.32, 1.0, z + hz, 'wood', '#9a7048', false); }
function lifeCarMesh(m, hex) { const g = makeCarMesh(m, hex); return g; }
function lifeStaticCar(x, z, yaw, m, hex) {
  const g = lifeCarMesh(m, hex); g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g); const s = Math.abs(Math.sin(yaw)), c = Math.abs(Math.cos(yaw)), hl = 2.3, hw2 = 1.0;
  addCol({ x0: x - (s * hl + c * hw2), x1: x + (s * hl + c * hw2), z0: z - (c * hl + s * hw2), z1: z + (c * hl + s * hw2), y0: 0, y1: 1.4, q: 0 }); LCARS.push(g);
}
function pondCol(cx, cz, r) { addCol({ x0: cx - r, x1: cx + r, z0: cz - r * 0.7, z1: cz + r * 0.7, y0: 0, y1: 1.2, q: 0 }); addCol({ x0: cx - r * 0.7, x1: cx + r * 0.7, z0: cz - r, z1: cz + r, y0: 0, y1: 1.2, q: 0 }); }
function water(cx, cz, r, sy = 1) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.08, 28), new THREE.MeshStandardMaterial({ color: '#3d9bd6', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.88 })); m.scale.z = sy; m.position.set(cx, 0.1, cz); scene.add(m); return m; }
function buildCity() {
  const R = LC.R, RD = [-120, -60, 0, 60, 120], BC = [-90, -30, 30, 90];
  scene.fog.density = 0.0026;
  const out = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ map: TEX.grass.clone(), roughness: 1, color: '#8fc46a' })); out.material.map.repeat.set(260, 260); out.material.map.needsUpdate = true; out.rotation.x = -Math.PI / 2; out.position.y = -0.06; out.receiveShadow = true; scene.add(out);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), new THREE.MeshStandardMaterial({ map: TEX.grass.clone(), roughness: 1, color: '#a3d47a' })); lawn.material.map.repeat.set(R / 2, R / 2); lawn.material.map.needsUpdate = true; lawn.rotation.x = -Math.PI / 2; lawn.position.y = -0.02; lawn.receiveShadow = true; scene.add(lawn);
  // streets: asphalt, sidewalks, lane markings, crosswalks
  for (const rd of RD) {
    B(-R, 0, rd - 5, R, 0.04, rd + 5, 'asphalt', '#ffffff', false, 6); B(rd - 5, 0, -R, rd + 5, 0.04, R, 'asphalt', '#ffffff', false, 6);
    for (const s of [-1, 1]) { const a = rd + s * 5, b = rd + s * 7.2; B(-R, 0, Math.min(a, b), R, 0.13, Math.max(a, b), 'tile', '#ddd8cc', false, 3); B(Math.min(a, b), 0, -R, Math.max(a, b), 0.13, R, 'tile', '#ddd8cc', false, 3); }
    for (let t = -R + 4; t < R - 4; t += 7) { if (RD.some((o) => Math.abs(t - o) < 9)) continue; B(t - 1.6, 0.04, rd - 0.12, t + 1.6, 0.06, rd + 0.12, 'paint', '#f1e7a8', false); B(rd - 0.12, 0.04, t - 1.6, rd + 0.12, 0.06, t + 1.6, 'paint', '#f1e7a8', false); }
  }
  for (const a of RD) for (const b of RD) for (const s of [-1, 1]) for (let k = -3; k <= 3; k += 1.4) {   // zebra crossings
    B(a + k - 0.4, 0.04, b + s * 6.6 - 0.9, a + k + 0.4, 0.06, b + s * 6.6 + 0.9, 'paint', '#f4f4f4', false); B(a + s * 6.6 - 0.9, 0.04, b + k - 0.4, a + s * 6.6 + 0.9, 0.06, b + k + 0.4, 'paint', '#f4f4f4', false);
  }
  // roundabout + fountain in the centre
  cylinder(0, 0, 9, 0.35, 'tile', '#d9d2c2', 0, true); cylinder(0, 0, 5.2, 1.0, 'concrete', '#cfc8ba', 0, true); water(0, 0, 4.6).position.y = 1.02; B(-0.5, 1, -0.5, 0.5, 5.9, 0.5, 'concrete', '#d9d2c2', false); B(-1.5, 4.4, -1.5, 1.5, 4.6, 1.5, 'concrete', '#d9d2c2', false);
  lifeSign('GET BETTER WORLD', 0, 6.7, 0, 0, 9, 1.6, '#4c1d95', '#fde047');
  // ---- housing blocks ----
  let hi = 0; const parks = { '-90,90': 'forest', '90,-90': 'sport' };
  for (const bx of BC) for (const bz of BC) {
    const k = bx + ',' + bz; if (Math.abs(bx) === 30 && Math.abs(bz) === 30) continue; if (parks[k]) continue;
    for (const dx of [-13, 13]) for (const dz of [-13, 13]) lifeHouse(hi++, bx + dx, bz + dz, dz < 0 ? -1 : 1);
  }
  // ---- NE: city park with lake ----
  { const cx = 30, cz = 30; water(cx + 6, cz + 6, 11, 0.75); pondCol(cx + 6, cz + 6, 11); for (let a = 0; a < 6.28; a += 0.5) B(cx + 6 + Math.cos(a) * 11.6 - 0.5, 0, cz + 6 + Math.sin(a) * 8.6 - 0.5, cx + 6 + Math.cos(a) * 11.6 + 0.5, 0.5, cz + 6 + Math.sin(a) * 8.6 + 0.5, 'concrete', '#8f8a80', false);
    B(cx - 24, 0.02, cz - 1.2, cx + 24, 0.05, cz + 1.2, 'tile', '#e2dccd', false, 3); B(cx - 1.2, 0.02, cz - 24, cx + 1.2, 0.05, cz + 24, 'tile', '#e2dccd', false, 3);
    for (const [x, z, ax] of [[-14, 5, false], [-14, -5, false], [4, -14, true], [16, -14, true], [-6, 20, true], [6, 20, true]]) bench(cx + x, cz + z, ax);
    for (let i = 0; i < 26; i++) { const x = cx + rnd(-22, 22), z = cz + rnd(-22, 22); if (Math.hypot(x - cx - 6, (z - cz - 6) / 0.75) < 14 || Math.abs(x - cx) < 2.6 || Math.abs(z - cz) < 2.6) continue; lifeTreeAt(x, z, rnd(1, 1.5)); }
    for (const [x, z] of [[-10, -10], [10, -10], [-10, 12], [20, 4]]) lamp(cx + x, cz + z); lifeSign('CITY PARK', cx - 23, 3.2, cz - 1, Math.PI / 2, 4, 1, '#14532d'); }
  // ---- NW: downtown ----
  lifeShop(-45, 44, 26, 16, 6.2, 's', '#e9edf5', '#3d5a6b', 'GT MOTORS', '#7f1d1d');
  for (const [i, m] of [0, 1, 2].entries()) { const x = -52 + i * 7.5; B(x - 2.6, 0.2, 38.5 - 2, x + 2.6, 0.5, 38.5 + 4.2, 'tile', '#f2f2f2', false); lifeStaticCar(x, 40.2, 0.6 - i * 0.6, i === 2 ? 3 : i, ['#e11d48', '#111827', '#f5f5f5'][i]); }
  lifeShop(-18, 44, 14, 12, 5.6, 's', '#f6e3c8', '#8a3b2b', 'CAFÉ', '#78350f'); lifeShop(-40, 20, 14, 12, 5.6, 'n', '#eadcf0', '#6a4a9a', 'BOUTIQUE', '#581c87'); lifeShop(-14, 20, 14, 12, 5.6, 'n', '#d7ecd9', '#2f6a4a', 'GYM', '#14532d');
  for (const [x, z] of [[-30, 32], [-26, 30]]) bench(x, z, true); lifeTreeAt(-30, 29, 1.2); lifeTreeAt(-22, 34, 1.1); lifeTreeAt(-38, 33, 1.1);
  // ---- SE: market street ----
  lifeShop(18, -44, 24, 14, 6.0, 'n', '#f2ecd8', '#b45309', 'SUPERMARKET', '#9a3412'); lifeShop(44, -44, 14, 12, 5.6, 'n', '#dfe6f0', '#374151', 'BANK', '#1e3a8a'); lifeShop(18, -18, 14, 12, 5.6, 's', '#f0d9d9', '#7a2e2e', 'PIZZA', '#991b1b'); lifeShop(44, -18, 14, 12, 5.6, 's', '#d9e8f0', '#0e7490', 'ARCADE', '#155e75');
  for (let i = 0; i < 5; i++) { const x = 8 + i * 9; B(x, 0, -31, x + 4.5, 1.0, -29.6, 'wood', '#a8845a', true, 1.5); B(x - 0.2, 2.5, -31.6, x + 4.7, 2.62, -28.2, 'paint', pick(['#d9534f', '#3a6aa0', '#e0a82e', '#4a9a5a']), false); }
  // ---- SW: playground + basketball ----
  { const cx = -30, cz = -30; B(cx - 22, 0.02, cz - 22, cx - 2, 0.05, cz - 2, 'paint', '#c4503c', false); B(cx - 20, 0.02, cz + 2, cx + 2, 0.05, cz + 22, 'paint', '#d89a30', false);   // surfaces
    for (const dx of [-8, -4, 0]) { B(cx - 18 + dx * 0 - 0.1, 0, cz - 16 + dx, cx - 18 + 0.1, 2.8, cz - 16 + dx + 0.1, 'metal', '#2563eb', false); }
    B(cx - 14, 0, cz - 18, cx - 13.8, 3.0, cz - 17.8, 'metal', '#2563eb', true); B(cx - 8, 0, cz - 18, cx - 7.8, 3.0, cz - 17.8, 'metal', '#2563eb', true); B(cx - 14, 2.9, cz - 18, cx - 7.8, 3.05, cz - 17.8, 'metal', '#2563eb', false); B(cx - 11.4, 0.6, cz - 18, cx - 10.4, 0.7, cz - 17.8, 'wood', '#d6a020', false);   // swing set
    stairs(cx - 12, cz - 8, 'z+', 6, 0.45, 0.45, 1.4, 'metal', '#e11d48'); B(cx - 12.7, 2.7, cz - 5.3, cx - 11.3, 2.85, cz - 3.5, 'metal', '#e11d48', true); B(cx - 12.6, 0.1, cz - 3.5, cx - 11.4, 2.7, cz - 0.6, 'metal', '#f59e0b', false);          // slide
    B(cx - 8, 0, cz - 8, cx - 3, 0.35, cz - 3, 'wood', '#e8d39a', true);   // sandbox
    for (const [hx, hz] of [[-17, 12], [-3, 12]]) { B(hx - 0.1, 0, hz - 0.1, hx + 0.1, 3.1, hz + 0.1, 'metal', '#555', true); B(hx - 0.9, 2.9, hz - 0.05, hx + 0.9, 3.9, hz + 0.05, 'paint', '#f4f4f4', false); }   // hoops
    B(cx - 18, 0.05, cz + 12 - 0.06, cx - 2, 0.06, cz + 12 + 0.06, 'paint', '#ffffff', false); B(cx - 10 - 0.06, 0.05, cz + 4, cx - 10 + 0.06, 0.06, cz + 20, 'paint', '#ffffff', false);
    for (const [x, z, ax] of [[-26, -8, true], [-6, -26, false], [-26, 24, true]]) bench(cx + x + 20, cz + z, ax); for (let i = 0; i < 16; i++) { const x = cx + rnd(-23, 23), z = cz + rnd(-23, 23); if (z > cz + 0 && z < cz + 24 && x < cx + 3) continue; if (x < cx - 1 && z < cz) continue; lifeTreeAt(x, z, rnd(0.9, 1.4)); }
    lifeSign('PLAYGROUND', cx + 22, 3.2, cz, -Math.PI / 2, 4, 1, '#9a3412'); }
  // ---- forest park (NW corner) & sports field (SE corner) ----
  { const cx = -90, cz = 90; for (let i = 0; i < 70; i++) { const x = cx + rnd(-23, 23), z = cz + rnd(-23, 23); lifeTreeAt(x, z, rnd(1.1, 1.8)); } water(cx + 6, cz - 12, 7, 0.7); pondCol(cx + 6, cz - 12, 7); B(cx - 24, 0.02, cz - 1, cx + 24, 0.05, cz + 1, 'tile', '#d8cfb8', false);
    for (const [x, z] of [[-6, -12], [-9, 6]]) { B(cx + x - 1.4, 0, cz + z - 1.4, cx + x + 1.4, 1.6, cz + z + 1.4, 'paint', pick(['#e8832a', '#3a7ac8']), true); } B(cx + 12 - 0.6, 0, cz + 12 - 0.6, cx + 12 + 0.6, 0.35, cz + 12 + 0.6, 'brick', '#7a6a5a', true); lifeSign('FOREST PARK', cx, 3.4, cz - 25.5, 0, 5, 1.1, '#14532d'); }
  { const cx = 90, cz = -90; B(cx - 22, 0.02, cz - 18, cx + 22, 0.05, cz + 18, 'paint', '#4c9a3c', false); for (const [x0, z0, x1, z1] of [[-22, -18, 22, -17.8], [-22, 17.8, 22, 18], [-22, -18, -21.8, 18], [21.8, -18, 22, 18], [-0.1, -18, 0.1, 18]]) B(cx + x0, 0.05, cz + z0, cx + x1, 0.07, cz + z1, 'paint', '#ffffff', false);
    for (const s of [-1, 1]) { B(cx + s * 22 - 0.1, 0, cz - 3.5, cx + s * 22 + 0.1, 2.4, cz - 3.3, 'metal', '#eee', true); B(cx + s * 22 - 0.1, 0, cz + 3.3, cx + s * 22 + 0.1, 2.4, cz + 3.5, 'metal', '#eee', true); B(cx + s * 22 - 0.1, 2.3, cz - 3.5, cx + s * 22 + 0.1, 2.45, cz + 3.5, 'metal', '#eee', false); }
    stairs(cx - 12, cz + 19.5, 'z+', 4, 0.45, 0.9, 20, 'concrete', '#9aa0aa'); for (let i = 0; i < 6; i++) lifeTreeAt(cx - 24 + i * 9, cz + 24, 1.2); lifeSign('SPORTS FIELD', cx, 3.4, cz - 25.5, 0, 5.4, 1.1, '#065f46'); }
  // ---- street furniture ----
  for (const rd of RD) for (let t = -R + 10; t < R - 6; t += 16) {
    if (RD.some((o) => Math.abs(t - o) < 11)) continue;
    for (const s of [-1, 1]) { lifeTreeAt(rd + s * 6.2, t, rnd(0.9, 1.15)); lifeTreeAt(t, rd + s * 6.2, rnd(0.9, 1.15)); }
    if (((t + R) / 16) % 2 < 1) { lamp(rd + 5.7, t + 8); lamp(t + 8, rd - 5.7); }
  }
  for (let i = 0; i < 26; i++) { const rd = pick(RD), t = rnd(-R + 12, R - 12), side = Math.random() > 0.5 ? 1 : -1; if (RD.some((o) => Math.abs(t - o) < 11)) continue; if (Math.random() > 0.5) lifeStaticCar(rd + side * 3.1, t, side > 0 ? 0 : Math.PI, Math.floor(rnd(0, 4)), pick(['#e11d48', '#2563eb', '#f5f5f5', '#111827', '#f59e0b', '#16a34a', '#7c3aed', '#9ca3af'])); else lifeStaticCar(t, rd + side * 3.1, side > 0 ? -Math.PI / 2 : Math.PI / 2, Math.floor(rnd(0, 4)), pick(['#e11d48', '#2563eb', '#f5f5f5', '#111827', '#f59e0b', '#16a34a', '#7c3aed', '#9ca3af'])); }
  // ---- boundary: iron fence, sea shore, mountains ----
  const e = 0.3; B(-R - 4, 0, R, R + 4, 3.2, R + e, 'metal', '#3b4a3b', true, 3); B(-R - 4, 0, -R - e, R + 4, 3.2, -R, 'metal', '#3b4a3b', true, 3); B(R, 0, -R, R + e, 3.2, R, 'metal', '#3b4a3b', true, 3); B(-R - e, 0, -R, -R, 3.2, R, 'metal', '#3b4a3b', true, 3);
  { const sand = new THREE.Mesh(new THREE.PlaneGeometry(2400, 40), new THREE.MeshStandardMaterial({ color: '#ecdcaa', roughness: 1 })); sand.rotation.x = -Math.PI / 2; sand.position.set(0, -0.04, -R - 28); sand.receiveShadow = true; scene.add(sand);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1400), new THREE.MeshStandardMaterial({ color: '#2f93d6', roughness: 0.15, metalness: 0.2 })); sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.1, -R - 740); scene.add(sea); WORLD.sea = sea; }
  for (let tries = 0, n = 0; n < 22 && tries < 100; tries++) { const x = rnd(-R + 6, R - 6), z = R - rnd(3, 8); lifeTreeAt(x, z, rnd(1.2, 1.9)); n++; }
  buildInterior();
  // ---- flush geometry batches ----
  for (const k of Object.keys(batches)) { const m = new THREE.Mesh(mergeGeometries(batches[k], false), MAT[k]); m.castShadow = k !== 'glow'; m.receiveShadow = true; scene.add(m); batches[k].forEach((x) => x.dispose()); }
  { const tg = new THREE.IcosahedronGeometry(1, 1), tm = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), n = LTREES.length * 2 + LBUSH.length, gm = new THREE.InstancedMesh(tg, tm, n), dm = new THREE.Object3D(), tc = new THREE.Color(); let q = 0;
    LTREES.forEach((t, i) => { for (let k = 0; k < 2; k++) { dm.position.set(t.x, 3.5 + k * 1.4, t.z); const s = t.s * (k ? 1.5 : 2.2); dm.scale.set(s, s * 0.9, s); dm.rotation.y = i + k; dm.updateMatrix(); gm.setMatrixAt(q, dm.matrix); gm.setColorAt(q++, tc.set(k ? pick(['#6aa84a', '#79b64f', '#8cc152']) : pick(['#3f8a3e', '#4a9a45', '#37803a']))); } });
    LBUSH.forEach((b) => { dm.position.set(b.x, b.s * 0.6, b.z); dm.scale.set(b.s * 1.3, b.s, b.s * 1.3); dm.rotation.y = 0; dm.updateMatrix(); gm.setMatrixAt(q, dm.matrix); gm.setColorAt(q++, tc.set(b.c)); });
    gm.castShadow = true; gm.receiveShadow = true; scene.add(gm); }
  mountains(R, true);
  // minimap backdrop
  const MH = R + 6, mm = document.createElement('canvas'); mm.width = mm.height = 512; const g = mm.getContext('2d'); WORLD.mh = MH; g.save(); g.scale(512 / (MH * 2), 512 / (MH * 2)); g.translate(MH, MH);
  g.fillStyle = '#7fb765'; g.fillRect(-MH, -MH, MH * 2, MH * 2); g.fillStyle = '#e9dfae'; g.fillRect(-MH, R, MH * 2, MH - R);
  g.fillStyle = '#4b5563'; for (const rd of RD) { g.fillRect(-R, -rd - 5, R * 2, 10); g.fillRect(rd - 5, -R, 10, R * 2); }
  g.fillStyle = '#3d9bd6'; g.beginPath(); g.ellipse(36, -36, 11, 8.3, 0, 0, 6.3); g.fill(); g.beginPath(); g.ellipse(-84, -78, 7, 4.9, 0, 0, 6.3); g.fill();
  g.fillStyle = '#d7a56a'; for (const c of COL) { if (c.y1 > 3.0 && c.y1 < 12 && c.x1 - c.x0 > 4) g.fillRect(c.x0, -c.z1, c.x1 - c.x0, c.z1 - c.z0); }
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
    this.m = m; this.group = m.group; this.rig = m.rig; this.speed = 0; scene.add(this.group); fighters.push(this); this.setStance(LIFE ? 'relaxed' : BOX ? 'fist' : 'rifle');
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
  } else { fxBurst(end, '#ffd9a0', 5, 3.2, 1); vehBulletHit(end, f); AU.impact(Math.pow(clamp(1 - distToPlayer(end.x, end.z) / 40, 0, 1), 1.5)); }
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
const ZPH = [{ wait: 40, shrink: 26, r: 80, dps: 3 }, { wait: 28, shrink: 22, r: 50, dps: 5 }, { wait: 20, shrink: 18, r: 28, dps: 8 }, { wait: 14, shrink: 14, r: 12, dps: 12 }, { wait: 8, shrink: 10, r: 4, dps: 20 }];
const Z = { cx: 0, cz: 0, r: 130, ph: 0, state: 'wait', timer: 40, nx: 0, nz: 0, nr: 80, fx: 0, fz: 0, fr: 130, dps: 3, mesh: null };
(function zoneMesh() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(160,90,255,0)'); gr.addColorStop(1, 'rgba(160,90,255,.8)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
  g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 8; i++) g.fillRect(i * 8, 0, 2, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(48, 1);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 96, 1, true), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: '#b58cff' }));
  m.position.y = 26; m.frustumCulled = false; scene.add(m); Z.mesh = m; Z.tex = t;
})();
function zonePlan(i) {
  const P = ZPH[Math.min(i, ZPH.length - 1)], off = Math.max(0, Z.r - P.r) * 0.7, a = rnd(0, 6.283), d = rnd(0, off);
  Z.nr = P.r; Z.nx = clamp(Z.cx + Math.cos(a) * d, -56, 56); Z.nz = clamp(Z.cz + Math.sin(a) * d, -56, 56); Z.dps = P.dps; Z.timer = P.wait; Z.state = 'wait';
}
function zoneReset() { Z.cx = Z.cz = 0; Z.r = 130; Z.ph = 0; zonePlan(0); }
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
const KICON = { ko: '🥊', heavy: '🥊', rifle: '🔫', punch: '🥊', kick: '🦶', sword: '⚔️', zone: '🌀', tank: '💥', crush: '🛞' };
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
/*  TANKS  (walk up + press E / USE to drive; cannon on fire; crush infantry) */
/* ========================================================================== */
G.veh = null;
const TANKS = [], SHELLS = [], SCORCH = [];
const tkMat = (c, r = 0.7, m = 0.3) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
function makeTank(x, z, yaw) {
  const g = new THREE.Group(), olive = tkMat('#59633f'), dark = tkMat('#3f4830'), trk = tkMat('#25272a', 0.9, 0.1), steel = tkMat('#4d524a', 0.5, 0.5), mats = [olive, dark, trk, steel];
  const add = (par, geo, mat, px, py, pz, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.x = rx; m.castShadow = true; m.receiveShadow = true; par.add(m); return m; };
  const bx = (w, h, l) => new THREE.BoxGeometry(w, h, l);
  for (const sx of [-1, 1]) {
    add(g, bx(0.85, 1.0, 6.6), trk, sx * 1.6, 0.55, 0); add(g, bx(0.95, 0.14, 6.9), dark, sx * 1.6, 1.14, 0);
    add(g, bx(0.85, 0.8, 1.1), trk, sx * 1.6, 0.7, 3.5, -0.55); add(g, bx(0.85, 0.8, 1.1), trk, sx * 1.6, 0.7, -3.5, 0.55);
    for (let i = 0; i < 7; i++) { const w = add(g, new THREE.CylinderGeometry(0.44, 0.44, 0.97, 12), steel, sx * 1.6, 0.48, -2.8 + i * 0.93); w.rotation.z = Math.PI / 2; }
  }
  add(g, bx(2.5, 0.9, 5.6), olive, 0, 1.15, 0); add(g, bx(2.5, 0.7, 2.0), olive, 0, 1.3, 3.1, 0.5); add(g, bx(2.3, 0.35, 2.0), dark, 0, 1.78, -2.2);
  add(g, bx(0.6, 0.25, 0.6), steel, 0.6, 1.95, -2.6); add(g, bx(0.6, 0.25, 0.6), steel, -0.6, 1.95, -2.6);
  for (let i = 0; i < 5; i++) add(g, bx(rnd(0.6, 1.3), 0.03, rnd(0.6, 1.4)), tkMat(pick(['#3d4a2b', '#6b6a44', '#2f3a22'])), rnd(-0.9, 0.9), 1.62, rnd(-2.5, 1.8));
  const turret = new THREE.Group(); turret.position.set(0, 1.62, -0.2); g.add(turret);
  add(turret, bx(2.5, 0.95, 3.0), olive, 0, 0.5, 0); add(turret, bx(2.2, 0.8, 1.0), olive, 0, 0.45, 1.8, 0.4); add(turret, bx(2.7, 0.4, 1.0), dark, 0, 0.25, -1.6);
  add(turret, new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), steel, 0.65, 1.1, -0.6); add(turret, bx(0.5, 0.18, 0.5), dark, -0.7, 1.05, 0.5);
  add(turret, bx(0.06, 1.4, 0.06), steel, -1.0, 1.4, -1.5);
  const gun = new THREE.Group(); gun.position.set(0, 0.55, 1.95); turret.add(gun);
  add(gun, bx(0.9, 0.75, 0.5), dark, 0, 0, 0.1); const br = add(gun, new THREE.CylinderGeometry(0.13, 0.15, 4.6, 12), steel, 0, 0, 2.3); br.rotation.x = Math.PI / 2; add(gun, bx(0.34, 0.34, 0.55), dark, 0, 0, 4.55);
  const T = { g, turret, gun, mats, x, z, yaw, v: 0, hp: 650, max: 650, tyaw: yaw, tp: 0.05, cool: 0, recoil: 0, driver: null, dead: false, sx: x, sz: z, syaw: yaw, dust: 0, burn: 0 };
  T.col = { x0: x - 3, x1: x + 3, z0: z - 3, z1: z + 3, y0: 0, y1: 2.5, q: 0, tank: T }; COL.push(T.col); DYN.push(T.col);
  scene.add(g); tankSync(T); return T;
}
function tankSync(T) {
  T.g.position.set(T.x, 0, T.z); T.g.rotation.y = T.yaw; T.turret.rotation.y = T.tyaw - T.yaw; T.gun.rotation.x = -T.tp; T.gun.position.z = 1.95 - T.recoil * 0.7;
  const s = Math.abs(Math.sin(T.yaw)), c = Math.abs(Math.cos(T.yaw)), ex = s * 3.4 + c * 1.7, ez = c * 3.4 + s * 1.7; const C = T.col; C.x0 = T.x - ex; C.x1 = T.x + ex; C.z0 = T.z - ez; C.z1 = T.z + ez;
}
function buildTanks() {
  const sm = new THREE.MeshBasicMaterial({ color: '#1a1816', transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 20), sm); m.rotation.x = -Math.PI / 2; m.visible = false; m.position.y = 0.05; scene.add(m); SCORCH.push(m); }
  const sg = new THREE.SphereGeometry(0.2, 8, 8), smat = new THREE.MeshBasicMaterial({ color: '#ffd27a' });
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(sg, smat); m.visible = false; scene.add(m); SHELLS.push({ m, on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, owner: null }); }
  for (const s of TANK_SPOTS) TANKS.push(makeTank(s.x, s.z, s.yaw));
}
function resetTanks() {
  G.veh = null; AU.engineOff();
  for (const T of TANKS) {
    T.x = T.sx; T.z = T.sz; T.yaw = T.tyaw = T.syaw; T.tp = 0.05; T.v = 0; T.hp = T.max; T.dead = false; T.driver = null; T.cool = 0; T.recoil = 0; T.col.off = false; T.col.y1 = 2.5;
    T.mats[0].color.set('#59633f'); T.mats[1].color.set('#3f4830'); T.mats[2].color.set('#25272a'); T.mats[3].color.set('#4d524a'); T.turret.position.y = 1.62; T.turret.rotation.z = 0; tankSync(T);
  }
  for (const s of SHELLS) { s.on = false; s.m.visible = false; }
}
const TKP = [[-1.5, -3.3], [1.5, -3.3], [-1.5, 3.3], [1.5, 3.3], [0, 3.6], [0, -3.6], [-1.8, 0], [1.8, 0]];
function tankBlocked(T, x, z, yaw) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw), lim = CFG.HALF - 2.5;
  for (const [lx, lz] of TKP) {
    const wx = x + lx * cs + lz * sn, wz = z - lx * sn + lz * cs; if (Math.abs(wx) > lim || Math.abs(wz) > lim) return true;
    const cols = nearCols(wx - 0.25, wz - 0.25, wx + 0.25, wz + 0.25);
    for (const c of cols) if (c.tank !== T && c.y1 > 0.8 && c.y0 < 2.2 && wx > c.x0 && wx < c.x1 && wz > c.z0 && wz < c.z1) return true;
  }
  return false;
}
function nearestTank(P, maxD) { let b = null, bd = maxD; for (const T of TANKS) { if (T.dead || T.driver) continue; const d = Math.hypot(T.x - P.x, T.z - P.z); if (d < bd) { bd = d; b = T; } } return b; }
function enterTank(T) {
  const P = G.player; if (!T || T.dead || T.driver || !P.alive) return;
  G.veh = T; T.driver = P; P.group.visible = false; if (P.m.rifle) P.m.rifle.visible = false; P.vx = P.vz = 0; G.cam.yaw = T.tyaw; G.cam.pitch = 0.18; G.cam.len = undefined; G.lock = null; U.lock.style.display = 'none'; G.zoom = 0;
  feed('🪖 You are driving the tank — WASD/stick to drive · aim = turret · FIRE = cannon · E to exit', true);
}
function exitTank(forced) {
  const T = G.veh, P = G.player; if (!T) return; G.veh = null; T.driver = null; AU.engineOff();
  const cs = Math.cos(T.yaw), sn = Math.sin(T.yaw); let spot = null;
  for (const [a, b] of [[3.6, 0], [-3.6, 0], [0, -5], [0, 5], [4.8, 0], [-4.8, 0]]) { const ex = T.x + a * cs + b * sn, ez = T.z - a * sn + b * cs; if (isFree(ex, ez, 0.5)) { spot = { x: ex, z: ez }; break; } }
  spot = spot || { x: T.x + 4, z: T.z };
  P.x = spot.x; P.z = spot.z; P.y = groundAt(P.x, P.z, 0.5); P.dispY = P.y; P.vx = P.vz = P.vy = 0; P.group.visible = true; P.group.position.set(P.x, P.y, P.z); if (P.m.rifle) P.m.rifle.visible = P.stance === 'rifle';
  if (!forced) feed('You climbed out', true);
}
function tankDamage(T, amt, by) { if (T.dead) return; T.hp -= amt; if (T.hp <= 0) tankWreck(T, by); }
function tankWreck(T, by) {
  T.dead = true; T.hp = 0; T.v = 0; const drv = T.driver; explode(T.x, 1.6, T.z, by || null, 11, 150, T); if (drv) { exitTank(true); damage(G.player, 55, null, { kind: 'tank' }); }
  T.mats[0].color.set('#2a2826'); T.mats[1].color.set('#1f1e1c'); T.mats[2].color.set('#141414'); T.mats[3].color.set('#2d2c2a'); T.turret.position.y = 2.0; T.turret.rotation.z = 0.28; T.col.y1 = 2.0; T.burn = 0;
}
function explode(x, y, z, owner, R, dmg, selfTank) {
  const o = { x, y, z }; fxBurst(o, '#ff9a2a', 46, 9, 3); fxBurst(o, '#ffd27a', 24, 6, 2); fxBurst(o, '#3a3733', 30, 4, 3); fxFlash(o, 7); fxFlash({ x, y: y + 0.6, z }, 4);
  const dp = Math.hypot(G.player.x - x, G.player.z - z); AU.boom(clamp(1.15 - dp / 130, 0, 1)); if (dp < 45) G.cam.shake = Math.min(1.6, G.cam.shake + (1 - dp / 45) * 1.2);
  const sc = SCORCH.find((m) => !m.visible) || SCORCH[0]; if (sc) { sc.position.set(x, 0.05, z); sc.scale.setScalar(R * 0.32); sc.visible = true; }
  const by = owner && owner.isPlayer ? owner : (owner && owner.driver) || null, att = by && by.isPlayer ? by : owner;
  for (const f of fighters.slice()) {
    if (!f.alive || f === G.showcase) continue; const d = Math.hypot(f.x - x, f.y + 0.9 - y, f.z - z); if (d > R) continue;
    let a = dmg * Math.pow(1 - d / R, 1.1) + 8; if (f === G.player && G.veh) { if (G.veh === selfTank) continue; a *= 0.1; }
    if (f === G.player && att === G.player && G.veh === null && selfTank == null) a *= 0.5;
    damage(f, a, att === f ? null : att, { kind: 'tank' });
  }
  for (const T of TANKS) { if (T === selfTank) continue; const d = Math.hypot(T.x - x, T.z - z); if (d < R + 2.5) tankDamage(T, dmg * 1.1 * (1 - d / (R + 2.5)), owner); }
}
function tankFire(T) {
  if (T.cool > 0 || T.dead) return; T.cool = 2.4; T.recoil = 1; const s = SHELLS.find((q) => !q.on); if (!s) return;
  const cp = Math.cos(T.tp), dir = { x: Math.sin(T.tyaw) * cp, y: Math.sin(T.tp), z: Math.cos(T.tyaw) * cp }, tx = T.x - Math.sin(T.yaw) * 0.2, tz = T.z - Math.cos(T.yaw) * 0.2;
  const m = { x: tx + Math.sin(T.tyaw) * 1.95 + dir.x * 5.0, y: 1.62 + 0.55 + dir.y * 5.0, z: tz + Math.cos(T.tyaw) * 1.95 + dir.z * 5.0 };
  s.on = true; s.x = m.x; s.y = m.y; s.z = m.z; s.vx = dir.x * 95; s.vy = dir.y * 95; s.vz = dir.z * 95; s.life = 4; s.owner = T; s.m.visible = true; s.m.position.set(m.x, m.y, m.z);
  fxFlash(m, 3.4); fxBurst(m, '#ffd27a', 14, 6, 1); fxBurst(m, '#8f8a80', 16, 3.5, 1.5);
  const dp = Math.hypot(G.player.x - T.x, G.player.z - T.z); AU.cannon(clamp(1.1 - dp / 150, 0, 1)); if (T.driver) G.cam.shake = Math.min(1.4, G.cam.shake + 0.8);
}
function vehBulletHit(p, by) { if (by && by.isPlayer) return; for (const T of TANKS) { if (T.dead) continue; const c = T.col; if (p.x > c.x0 - 0.3 && p.x < c.x1 + 0.3 && p.z > c.z0 - 0.3 && p.z < c.z1 + 0.3 && p.y < c.y1 + 0.3) { tankDamage(T, 4.5, by); fxBurst(p, '#ffe9a0', 4, 3, 1); return; } } }
function vehControl(dt) {
  const T = G.veh, P = G.player, c = G.cam; c.recoil = damp(c.recoil, 0, 9, dt);
  { const k = 1 - Math.exp(-24 * dt); c.yaw -= lookAcc.x * k; c.pitch = clamp(c.pitch - lookAcc.y * k, -0.75, 1.1); lookAcc.x *= 1 - k; lookAcc.y *= 1 - k; }
  P.inp.mx = P.inp.mz = 0; P.inp.speed = 0; P.aiming = false;
  joy.sx = damp(joy.sx || 0, joy.x, 22, dt); joy.sy = damp(joy.sy || 0, joy.y, 22, dt);
  let thr = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), st = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  if (Math.hypot(joy.sx, joy.sy) > 0.12) { thr = -joy.sy; st = joy.sx; }
  T.thr = thr; T.st = st; T.wantFire = fireHeld;
}
function vehStep(dt) {
  const P = G.player, c = G.cam;
  if (G.veh && (!P.alive || G.over)) exitTank(true);
  for (const T of TANKS) {
    const drv = T.driver === P && G.veh === T;
    if (T.cool > 0) T.cool -= dt; T.recoil = Math.max(0, T.recoil - dt * 2.2);
    if (T.dead) { T.v = damp(T.v, 0, 3, dt); T.burn -= dt; if (T.burn <= 0) { T.burn = 0.16; const p = { x: T.x + rnd(-1, 1), y: 2.2, z: T.z + rnd(-1, 1) }; fxBurst(p, '#ff7a18', 2, 1.5, 3); fxBurst(p, '#2a2826', 2, 1, 4); } tankSync(T); continue; }
    let thr = 0, st = 0;
    if (drv) { thr = T.thr || 0; st = T.st || 0; const dy = angDelta(T.tyaw, c.yaw); T.tyaw += clamp(dy, -1.6 * dt, 1.6 * dt); T.tp = damp(T.tp, clamp(c.pitch, -0.12, 0.42), 6, dt); if (T.wantFire) tankFire(T); }
    const tv = thr > 0 ? thr * 10.5 : thr * 5; T.v = damp(T.v, tv, Math.abs(tv) > Math.abs(T.v) ? 1.2 : 2.6, dt);
    if (drv && Math.abs(st) > 0.05) { const ny = T.yaw - st * 1.0 * dt * (0.6 + 0.4 * clamp(Math.abs(T.v) / 4, 0, 1)); if (!tankBlocked(T, T.x, T.z, ny)) { T.yaw = ny; T.tyaw += (ny - T.yaw); T.tyaw -= 0; } }
    if (Math.abs(T.v) > 0.05) {
      const nx = T.x + Math.sin(T.yaw) * T.v * dt, nz = T.z + Math.cos(T.yaw) * T.v * dt;
      if (!tankBlocked(T, nx, nz, T.yaw)) { T.x = nx; T.z = nz; } else if (!tankBlocked(T, nx, T.z, T.yaw)) { T.x = nx; T.v *= 0.7; } else if (!tankBlocked(T, T.x, nz, T.yaw)) { T.z = nz; T.v *= 0.7; } else T.v = 0;
      T.dust -= dt; if (Math.abs(T.v) > 2.5 && T.dust <= 0) { T.dust = 0.08; fxBurst({ x: T.x - Math.sin(T.yaw) * 3.3 * Math.sign(T.v), y: 0.3, z: T.z - Math.cos(T.yaw) * 3.3 * Math.sign(T.v) }, '#b8a98a', 2, 1.6, 0.5); }
      if (Math.abs(T.v) > 2.2) for (const f of fighters.slice()) {   // run them over
        if (!f.alive || f === P || f === G.showcase) continue; const dx = f.x - T.x, dz = f.z - T.z, lz = dx * Math.sin(T.yaw) + dz * Math.cos(T.yaw), lx = dx * Math.cos(T.yaw) - dz * Math.sin(T.yaw);
        if (Math.abs(lx) < 2.5 && lz > -3.8 && lz < 4.6 && f.y < 1.2) damage(f, 500, drv ? P : null, { kind: 'crush' });
      }
    }
    if (drv) { P.x = T.x; P.z = T.z; P.y = 0; P.dispY = 0; P.vx = P.vz = P.vy = 0; P.group.visible = false; if (P.m.rifle) P.m.rifle.visible = false; P.group.position.set(T.x, -5, T.z); AU.engine(T.v, T.thr || 0); }
    T.g.position.y = Math.sin(G.t * 14) * 0.012 * clamp(Math.abs(T.v) / 6, 0, 1);
    tankSync(T);
  }
  // cannon shells
  for (const s of SHELLS) {
    if (!s.on) continue; s.life -= dt; const steps = Math.max(1, Math.ceil(dt / 0.016)), h = dt / steps;
    for (let i = 0; i < steps && s.on; i++) {
      s.vy -= 12 * h; const dx = s.vx * h, dy = s.vy * h, dz = s.vz * h, L = Math.hypot(dx, dy, dz); let hit = false, hx = s.x + dx, hy = s.y + dy, hz = s.z + dz;
      s.owner.col.off = true; const t = rayWorld(s.x, s.y, s.z, dx / L, dy / L, dz / L, L); s.owner.col.off = false;
      if (t < L) { hit = true; hx = s.x + dx / L * t; hy = s.y + dy / L * t; hz = s.z + dz / L * t; } else if (hy <= 0.05) { hit = true; hy = 0.05; }
      if (!hit) for (const f of fighters) { if (!f.alive || f === G.showcase || (f === P && G.veh === s.owner)) continue; if (Math.hypot(f.x - hx, f.y + 0.9 - hy, f.z - hz) < 1.3) { hit = true; break; } }
      s.x = hx; s.y = hy; s.z = hz; s.m.position.set(hx, hy, hz); if (hit || s.life <= 0) { s.on = false; s.m.visible = false; explode(hx, Math.max(hy, 0.4), hz, s.owner.driver ? s.owner.driver : null, 9, 200, null); }
    }
    if (s.on && Math.random() < 0.6) fxBurst({ x: s.x, y: s.y, z: s.z }, '#aaa29a', 1, 0.5, 0.2);
  }
  for (const m of SCORCH) if (m.visible && Math.random() < 0.0005) m.visible = false;
  if (!G.veh) AU.engineOff();
}
function vehCamera(dt, d, pit) {
  const T = G.veh, c = G.cam, P = G.player, dist = 12;
  const ox = T.x, oy = 2.8, oz = T.z; let dx = -d.x, dy = -d.y + 0.12, dz = -d.z; const L0 = Math.hypot(dx, dy, dz); dx /= L0; dy /= L0; dz /= L0;
  T.col.off = true; const t = rayWorld(ox, oy, oz, dx, dy, dz, dist + 0.4); T.col.off = false; const cl0 = clamp(t - 0.4, 3.5, dist);
  c.len = c.len === undefined || cl0 < c.len ? cl0 : damp(c.len, cl0, 5, dt); c.dist = c.len; c.shake = damp(c.shake, 0, 7, dt); const sh = c.shake * 0.08;
  camera.position.set(ox + dx * c.len + rnd(-sh, sh), oy + dy * c.len + rnd(-sh, sh), oz + dz * c.len + rnd(-sh, sh)); camera.rotation.order = 'YXZ'; camera.rotation.set(pit, c.yaw + Math.PI, 0);
}

/* ========================================================================== */
/*  GET BETTER WORLD — cars, houses, furniture, chat, online presence          */
/* ========================================================================== */
const CARS = [
  { id: 'gt', name: 'Stuttgart GT', sub: 'Rear-engine sports coupe', L: 4.5, W: 1.85, top: 46, acc: 17, steer: 0.62, wr: 0.36, wb: 1.4,
    body: [[-2.25, .35], [-2.25, .8], [-1.6, .98], [-0.4, .98], [0.8, .92], [1.9, .72], [2.25, .52], [2.25, .35]], cab: [[-1.7, .95], [-1.05, 1.3], [0.1, 1.36], [0.95, .95]], roof: [-1.05, 0.1, 1.33], hl: 'round' },
  { id: 'g', name: 'Geländer G', sub: 'Boxy luxury 4x4', L: 4.7, W: 1.95, top: 32, acc: 12, steer: 0.58, wr: 0.46, wb: 1.5,
    body: [[-2.35, .45], [-2.35, 1.2], [2.35, 1.2], [2.35, .45]], cab: [[-2.2, 1.18], [-2.2, 2.0], [0.9, 2.0], [1.05, 1.18]], roof: [-2.2, 0.9, 1.99], hl: 'round', spare: true },
  { id: 'hy', name: 'Veyra Hyper', sub: 'Quad-turbo hypercar', L: 4.6, W: 2.0, top: 58, acc: 25, steer: 0.55, wr: 0.38, wb: 1.5,
    body: [[-2.3, .3], [-2.3, .74], [-1.2, .96], [0.2, .98], [1.4, .8], [2.3, .5], [2.3, .3]], cab: [[-1.3, .95], [-0.7, 1.22], [0.4, 1.24], [1.0, .9]], roof: [-0.7, 0.4, 1.23], hl: 'slit', horseshoe: true, wing: true },
  { id: 'sd', name: 'City Cruiser', sub: 'Comfy family sedan', L: 4.8, W: 1.85, top: 36, acc: 13, steer: 0.62, wr: 0.34, wb: 1.5,
    body: [[-2.4, .38], [-2.4, .92], [-1.1, 1.0], [1.2, .98], [2.4, .82], [2.4, .38]], cab: [[-1.4, .95], [-0.9, 1.45], [0.6, 1.45], [1.25, .97]], roof: [-0.9, 0.6, 1.45], hl: 'round' },
];
const CAR_COLS = ['#e11d48', '#f97316', '#facc15', '#22c55e', '#0ea5e9', '#2563eb', '#7c3aed', '#f5f5f5', '#9ca3af', '#111827'];
const _cm = new Map(), cmat = (k, f) => { let m = _cm.get(k); if (!m) { m = f(); _cm.set(k, m); } return m; };
function makeCarMesh(mi, hex) {
  const C = CARS[mi] || CARS[0], parts = { paint: [], glass: [], black: [], chrome: [], head: [], tail: [], accent: [] }, add = (k, g) => parts[k].push(g.index && g.toNonIndexed ? g.toNonIndexed() : g);
  const ex = (pts, w, bev) => {
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: w - bev * 2, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, steps: 1 });
    g.rotateY(-Math.PI / 2); g.computeBoundingBox(); const bb = g.boundingBox; g.translate(-(bb.min.x + bb.max.x) / 2, 0, 0); return g;
  };
  const bx = (w, h, d, x, y, z, k) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); add(k, g); };
  const cy = (r, len, x, y, z, k, seg = 16) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); add(k, g); };
  add('paint', ex(C.body, C.W, 0.1)); add('glass', ex(C.cab, C.W * 0.86, 0.05));
  bx(C.W * 0.78, 0.04, C.roof[1] - C.roof[0], 0, C.roof[2] + 0.02, (C.roof[0] + C.roof[1]) / 2, 'paint');
  const hz = C.L / 2, wx = C.W / 2 - 0.1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const z = sz * C.wb; cy(C.wr, 0.3, sx * wx, C.wr, z, 'black', 18); cy(C.wr * 0.62, 0.32, sx * (wx + 0.01), C.wr, z, 'chrome', 10); }
  // lights, bumpers, details
  if (C.hl === 'round') { for (const sx of [-1, 1]) { const g = new THREE.CylinderGeometry(0.17, 0.17, 0.1, 14); g.rotateX(Math.PI / 2); g.translate(sx * (C.W / 2 - 0.4), C.body[C.body.length - 3][1] + (mi === 1 ? 0.02 : -0.02), hz + 0.04); add('head', g); } }
  else for (const sx of [-1, 1]) bx(0.5, 0.07, 0.1, sx * (C.W / 2 - 0.42), C.body[C.body.length - 3][1] - 0.06, hz - 0.02, 'head');
  bx(C.W - 0.5, 0.06, 0.08, 0, C.body[1][1] - 0.08, -hz + 0.02, 'tail'); for (const sx of [-1, 1]) bx(0.4, 0.14, 0.1, sx * (C.W / 2 - 0.3), C.body[1][1] - 0.1, -hz + 0.02, 'tail');
  bx(C.W - 0.2, 0.18, 0.12, 0, 0.42, hz - 0.02, 'black'); bx(C.W - 0.2, 0.16, 0.12, 0, 0.42, -hz + 0.02, 'black');
  bx(0.5, 0.2, 0.06, 0, 0.52, hz + 0.02, 'black');   // grille / intake
  if (C.horseshoe) { bx(0.34, 0.26, 0.05, 0, 0.58, hz + 0.045, 'chrome'); bx(0.22, 0.2, 0.06, 0, 0.58, hz + 0.05, 'black'); }
  if (C.wing) { bx(C.W * 0.9, 0.05, 0.5, 0, 1.1, -hz + 0.35, 'black'); for (const sx of [-1, 1]) bx(0.05, 0.3, 0.4, sx * C.W * 0.3, 0.95, -hz + 0.38, 'black'); bx(0.1, 0.05, 0.7, 0, 1.0, -hz + 0.6, 'accent'); }
  if (C.spare) { cy(0.4, 0.22, 0, 1.0, -hz - 0.14, 'black', 14); cy(0.26, 0.24, 0, 1.0, -hz - 0.14, 'chrome', 10); for (const sx of [-1, 1]) bx(0.1, 0.14, 1.9, sx * (C.W / 2 + 0.05), 0.42, 0, 'black'); bx(C.W - 0.3, 0.1, 0.14, 0, 0.55, hz + 0.1, 'chrome'); }
  for (const sx of [-1, 1]) bx(0.08, 0.1, 0.2, sx * (C.W / 2 + 0.02), C.cab[0][1] + 0.12, C.cab[1][0] + 0.9, 'black');   // mirrors
  const grp = new THREE.Group(), pm = cmat('p' + hex, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.28, metalness: 0.55 }));
  const mats = { paint: pm, glass: cmat('gl', () => new THREE.MeshStandardMaterial({ color: '#0d1218', roughness: 0.08, metalness: 0.9 })), black: cmat('bk', () => new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.85 })),
    chrome: cmat('ch', () => new THREE.MeshStandardMaterial({ color: '#d6dae1', roughness: 0.18, metalness: 0.95 })), head: cmat('hd', () => new THREE.MeshBasicMaterial({ color: '#fff4c4' })), tail: cmat('tl', () => new THREE.MeshBasicMaterial({ color: '#ff2a2a' })),
    accent: cmat('ac', () => new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.3, metalness: 0.8 })) };
  for (const k of Object.keys(parts)) { if (!parts[k].length) continue; const m = new THREE.Mesh(mergeGeometries(parts[k], false), mats[k]); m.castShadow = true; grp.add(m); parts[k].forEach((g) => g.dispose()); }
  grp.userData = { mi, hex }; return grp;
}

/* ---------------------------------- interior ------------------------------ */
const IX = 330, IZ = 330, IW = 8, ID = 6, IH = 4.2;
const WALLS = ['#f3efe6', '#d7e3f0', '#f0d9d4', '#d6e8d8', '#efe3b8', '#c9c4e6', '#3b4252', '#e9a9a0'];
const FLOORS = [{ n: 'Oak', c: '#ffffff', t: 'wood' }, { n: 'Honey', c: '#ffd9a0', t: 'wood' }, { n: 'Walnut', c: '#9a6b4a', t: 'wood' }, { n: 'Tile', c: '#ffffff', t: 'concrete' }, { n: 'Marble', c: '#f4f4f8', t: 'concrete' }, { n: 'Carpet', c: '#3b4a7a', t: null }];
const DOORCOLS = ['#b23a3a', '#2f6aa8', '#2f8a5a', '#d6a020', '#6a4a9a', '#222831', '#c96a2a', '#f5f5f5'];
const FPAL = ['#e5e7eb', '#6b7280', '#1f2937', '#b45309', '#a16207', '#dc2626', '#f97316', '#16a34a', '#2563eb', '#7c3aed', '#db2777', '#f5f5f5'];
const FCAT = {
  bed: { n: 'Bed', i: '🛏️', w: 2.0, d: 2.4, h: 1.0, c: 8 }, sofa: { n: 'Sofa', i: '🛋️', w: 2.6, d: 1.1, h: 0.95, c: 1 }, coffee: { n: 'Coffee table', i: '☕', w: 1.4, d: 0.8, h: 0.45, c: 3 },
  dining: { n: 'Dining table', i: '🍽️', w: 2.2, d: 1.2, h: 0.78, c: 3 }, chair: { n: 'Chair', i: '🪑', w: 0.6, d: 0.6, h: 0.9, c: 5 }, tv: { n: 'TV + stand', i: '📺', w: 1.7, d: 0.5, h: 1.2, c: 2 },
  shelf: { n: 'Bookshelf', i: '📚', w: 1.6, d: 0.45, h: 2.2, c: 3 }, rug: { n: 'Rug', i: '🟫', w: 3.0, d: 2.0, h: 0.03, c: 9, nc: true }, lamp: { n: 'Floor lamp', i: '💡', w: 0.45, d: 0.45, h: 1.7, c: 11 },
  plant: { n: 'Plant', i: '🪴', w: 0.6, d: 0.6, h: 1.3, c: 7 }, fridge: { n: 'Fridge', i: '🧊', w: 0.9, d: 0.8, h: 2.0, c: 0 }, desk: { n: 'Desk + PC', i: '🖥️', w: 1.6, d: 0.8, h: 1.25, c: 3 },
  piano: { n: 'Piano', i: '🎹', w: 1.6, d: 0.7, h: 1.15, c: 2 }, art: { n: 'Painting', i: '🖼️', w: 1.4, d: 0.08, h: 1.0, c: 8, nc: true, wall: true }, speaker: { n: 'Speaker', i: '🔊', w: 0.5, d: 0.4, h: 1.2, c: 2 }, trophy: { n: 'Trophy case', i: '🏆', w: 1.2, d: 0.4, h: 1.9, c: 3 },
};
const _fm = new Map(), fmat = (c, o = {}) => { const k = c + (o.e || ''); let m = _fm.get(k); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.7, metalness: o.m ?? 0, emissive: o.e || '#000', emissiveIntensity: o.e ? 1 : 0 }); _fm.set(k, m); } return m; };
function mkFurn(k, ci) {
  const g = new THREE.Group(), col = FPAL[ci % FPAL.length], F = FCAT[k]; g.userData.mats = [];
  const bx = (w, h, d, x, y, z, c, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fmat(c, o)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const wood = '#8a6a48', dark = '#2b2b30';
  if (k === 'bed') { bx(2, 0.35, 2.4, 0, 0.25, 0, wood); bx(1.9, 0.3, 2.2, 0, 0.55, 0.05, col); bx(2, 1.0, 0.12, 0, 0.7, -1.2, wood); bx(0.7, 0.14, 0.45, -0.5, 0.78, -0.85, '#fafafa'); bx(0.7, 0.14, 0.45, 0.5, 0.78, -0.85, '#fafafa'); bx(1.9, 0.06, 1.2, 0, 0.72, 0.5, '#e5e7eb'); }
  else if (k === 'sofa') { bx(2.6, 0.45, 1.1, 0, 0.3, 0, col); bx(2.6, 0.55, 0.28, 0, 0.75, -0.42, col); bx(0.28, 0.35, 1.0, -1.18, 0.62, 0, col); bx(0.28, 0.35, 1.0, 1.18, 0.62, 0, col); bx(0.7, 0.4, 0.2, -0.7, 0.75, -0.2, '#f5f5f5'); bx(2.6, 0.1, 1.0, 0, 0.06, 0, dark); }
  else if (k === 'coffee') { bx(1.4, 0.06, 0.8, 0, 0.42, 0, col); for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(0.07, 0.4, 0.07, sx * 0.62, 0.2, sz * 0.33, dark); bx(0.3, 0.1, 0.2, 0.2, 0.5, 0, '#e5e7eb'); }
  else if (k === 'dining') { bx(2.2, 0.08, 1.2, 0, 0.74, 0, col); for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(0.1, 0.72, 0.1, sx * 1.0, 0.36, sz * 0.5, dark); for (const sx of [-0.6, 0.6]) for (const sz of [-1, 1]) { bx(0.45, 0.06, 0.45, sx, 0.46, sz * 0.95, wood); bx(0.45, 0.5, 0.06, sx, 0.72, sz * 1.15, wood); } }
  else if (k === 'chair') { bx(0.5, 0.08, 0.5, 0, 0.46, 0, col); bx(0.5, 0.5, 0.07, 0, 0.74, -0.22, col); for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(0.06, 0.44, 0.06, sx * 0.2, 0.22, sz * 0.2, dark); }
  else if (k === 'tv') { bx(1.7, 0.5, 0.45, 0, 0.25, 0, wood); bx(1.5, 0.85, 0.06, 0, 0.98, 0, '#0b0d12', { r: 0.1, m: 0.5 }); bx(1.4, 0.75, 0.02, 0, 0.98, 0.035, '#243b6b', { e: '#3b6fd8' }); bx(0.3, 0.1, 0.2, 0, 0.55, 0, dark); }
  else if (k === 'shelf') { bx(1.6, 2.2, 0.45, 0, 1.1, 0, wood); for (let i = 0; i < 4; i++) { bx(1.45, 0.05, 0.4, 0, 0.35 + i * 0.52, 0.03, '#a58459'); for (let j = 0; j < 6; j++) bx(0.14, 0.38, 0.28, -0.6 + j * 0.24, 0.57 + i * 0.52, 0.03, FPAL[(i * 3 + j * 5 + 3) % FPAL.length]); } }
  else if (k === 'rug') { bx(3, 0.03, 2, 0, 0.015, 0, col); bx(2.6, 0.035, 1.6, 0, 0.018, 0, '#f5f5f5'); bx(2.4, 0.04, 1.4, 0, 0.02, 0, col); }
  else if (k === 'lamp') { bx(0.36, 0.05, 0.36, 0, 0.025, 0, dark); bx(0.05, 1.45, 0.05, 0, 0.75, 0, dark); bx(0.4, 0.34, 0.4, 0, 1.5, 0, '#fff3c4', { e: '#ffd77a' }); }
  else if (k === 'plant') { bx(0.45, 0.4, 0.45, 0, 0.2, 0, '#b45309'); const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), fmat('#2f8a3a')); m.position.y = 0.85; m.scale.set(1, 1.3, 1); m.castShadow = true; g.add(m); const m2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), fmat('#46a84a')); m2.position.set(0.15, 1.2, 0.05); g.add(m2); }
  else if (k === 'fridge') { bx(0.9, 2.0, 0.8, 0, 1.0, 0, col, { m: 0.4, r: 0.35 }); bx(0.9, 0.03, 0.02, 0, 1.35, 0.41, '#555'); bx(0.05, 0.5, 0.05, 0.35, 1.65, 0.43, '#aaa'); bx(0.05, 0.5, 0.05, 0.35, 0.9, 0.43, '#aaa'); }
  else if (k === 'desk') { bx(1.6, 0.06, 0.8, 0, 0.74, 0, wood); for (const sx of [-1, 1]) bx(0.06, 0.72, 0.7, sx * 0.75, 0.36, 0, dark); bx(0.6, 0.38, 0.04, 0, 1.0, -0.15, '#0b0d12', { r: 0.1 }); bx(0.54, 0.32, 0.02, 0, 1.0, -0.12, '#244a2c', { e: '#35c46a' }); bx(0.1, 0.2, 0.06, 0, 0.88, -0.15, dark); bx(0.5, 0.02, 0.18, 0, 0.78, 0.15, '#222'); bx(0.5, 0.06, 0.5, 0, 0.45, 0.8, col); bx(0.5, 0.5, 0.06, 0, 0.72, 1.03, col); }
  else if (k === 'piano') { bx(1.6, 0.8, 0.7, 0, 0.4, 0, col, { r: 0.3, m: 0.3 }); bx(1.6, 0.05, 0.15, 0, 0.82, 0.3, '#f5f5f5'); bx(1.5, 0.3, 0.12, 0, 1.0, -0.25, col, { r: 0.3 }); for (let i = 0; i < 8; i++) bx(0.07, 0.06, 0.1, -0.6 + i * 0.17, 0.86, 0.3, '#111'); bx(1.0, 0.1, 0.4, 0, 0.3, 0.6, dark); }
  else if (k === 'art') { bx(1.4, 1.0, 0.06, 0, 2.0, 0, '#2b2b30'); bx(1.25, 0.85, 0.03, 0, 2.0, 0.03, col); bx(0.9, 0.5, 0.035, 0.1, 2.0, 0.04, FPAL[(ci + 4) % 12]); bx(0.4, 0.3, 0.04, -0.3, 2.1, 0.05, FPAL[(ci + 7) % 12]); }
  else if (k === 'speaker') { bx(0.5, 1.2, 0.4, 0, 0.6, 0, dark); for (const y of [0.4, 0.85]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(y > 0.5 ? 0.1 : 0.16, y > 0.5 ? 0.1 : 0.16, 0.04, 14), fmat('#888', { m: 0.6 })); m.rotation.x = Math.PI / 2; m.position.set(0, y, 0.21); g.add(m); } }
  else if (k === 'trophy') { bx(1.2, 1.9, 0.4, 0, 0.95, 0, wood); bx(1.1, 1.7, 0.04, 0, 1.0, 0.18, '#a9d6f0', { r: 0.05 }); for (const y of [0.4, 0.95, 1.5]) { bx(1.1, 0.04, 0.34, 0, y, 0, '#a58459'); bx(0.16, 0.26, 0.12, -0.3, y + 0.15, 0.02, '#e3b93a', { m: 0.9, r: 0.2 }); bx(0.2, 0.2, 0.12, 0.2, y + 0.12, 0.02, '#c0c6cf', { m: 0.9, r: 0.2 }); } }
  g.userData.k = k; return g;
}
let INT = null;   // interior handles
function buildInterior() {
  const x0 = IX - IW, x1 = IX + IW, z0 = IZ - ID, z1 = IZ + ID, t = 0.6;
  B(x0 - t, 0, z0 - t, x1 + t, IH, z0, 'paint', '#ffffff', true, 6); B(x0 - t, 0, z1, x1 + t, IH, z1 + t, 'paint', '#ffffff', true, 6); B(x0 - t, 0, z0, x0, IH, z1, 'paint', '#ffffff', true, 6); B(x1, 0, z0, x1 + t, IH, z1, 'paint', '#ffffff', true, 6);
  B(x0 - t, IH, z0 - t, x1 + t, IH + 0.5, z1 + t, 'paint', '#ffffff', true, 6);
  const wallMat = new THREE.MeshStandardMaterial({ color: WALLS[0], roughness: 0.95 }), ceilMat = new THREE.MeshStandardMaterial({ color: '#fbfaf6', roughness: 1 }), fl = TEX.wood.clone();
  const floorMat = new THREE.MeshStandardMaterial({ map: fl, color: '#ffffff', roughness: 0.55 }); fl.repeat.set(5, 4); fl.needsUpdate = true;
  const pl = (w, h, x, y, z, ry, rx, m, shadow) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.y = ry; p.rotation.x = rx; p.receiveShadow = true; scene.add(p); return p; };
  pl(IW * 2, ID * 2, IX, 0.02, IZ, 0, -Math.PI / 2, floorMat); pl(IW * 2, ID * 2, IX, IH - 0.02, IZ, 0, Math.PI / 2, ceilMat);
  pl(IW * 2, IH, IX, IH / 2, z1 - 0.02, Math.PI, 0, wallMat); pl(IW * 2, IH, IX, IH / 2, z0 + 0.02, 0, 0, wallMat); pl(ID * 2, IH, x1 - 0.02, IH / 2, IZ, -Math.PI / 2, 0, wallMat); pl(ID * 2, IH, x0 + 0.02, IH / 2, IZ, Math.PI / 2, 0, wallMat);
  const trim = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });
  for (const [w, h, x, y, z] of [[IW * 2, 0.16, IX, 0.1, z1 - 0.06], [IW * 2, 0.16, IX, 0.1, z0 + 0.06]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), trim); m.position.set(x, y, z); scene.add(m); }
  for (const [w, x, z] of [[ID * 2, x0 + 0.06, IZ], [ID * 2, x1 - 0.06, IZ]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, w), trim); m.position.set(x, 0.1, z); scene.add(m); }
  // windows (bright sky panels) on the long back wall and the side walls
  const win = new THREE.MeshBasicMaterial({ color: '#cfe8ff' }), frm = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  const wz = (x, y, z, w, h, ry) => { const f = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.06), frm); f.position.set(x, y, z); f.rotation.y = ry; scene.add(f); const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), win); p.position.set(x + Math.sin(ry) * 0.04, y, z + Math.cos(ry) * 0.04); p.rotation.y = ry; scene.add(p); };
  for (const dx of [-5, 0, 5]) wz(IX + dx, 2.3, z1 - 0.06, 2.6, 1.6, Math.PI); wz(x0 + 0.06, 2.3, IZ, 2.6, 1.6, Math.PI / 2); wz(x1 - 0.06, 2.3, IZ, 2.6, 1.6, -Math.PI / 2);
  // exit door (south wall)
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.7, 0.1), new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.6 })); door.position.set(IX, 1.35, z0 + 0.08); scene.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshStandardMaterial({ color: '#e8d27a', metalness: 0.9, roughness: 0.2 })); knob.position.set(IX + 0.65, 1.1, z0 + 0.16); scene.add(knob);
  const lights = [new THREE.PointLight('#fff1d6', 0, 0, 2), new THREE.PointLight('#fff1d6', 0, 0, 2)]; lights[0].position.set(IX - 4.5, 3.5, IZ); lights[1].position.set(IX + 4.5, 3.5, IZ); lights.forEach((l) => scene.add(l));
  INT = { wallMat, floorMat, floorTex: fl, lights, items: [], door };
}
function intSetStyle(wall, floor) {
  if (!INT) return; INT.wallMat.color.set(WALLS[wall % WALLS.length]); const F = FLOORS[floor % FLOORS.length]; INT.floorMat.color.set(F.c);
  INT.floorMat.map = F.t ? (F.t === 'wood' ? TEX.wood : TEX.concrete) : null; if (INT.floorMat.map) { INT.floorMat.map = INT.floorMat.map.clone(); INT.floorMat.map.repeat.set(F.t === 'wood' ? 5 : 6, F.t === 'wood' ? 4 : 5); INT.floorMat.map.needsUpdate = true; } INT.floorMat.needsUpdate = true;
}
function furnBox(it) { const F = FCAT[it.k], sw = it.r % 2; const w = (sw ? F.d : F.w) / 2, d = (sw ? F.w : F.d) / 2; return { x0: IX + it.x - w, x1: IX + it.x + w, z0: IZ + it.z - d, z1: IZ + it.z + d, y0: 0, y1: F.h, q: 0 }; }
function intClear() { if (!INT) return; for (const e of INT.items) { scene.remove(e.mesh); if (e.col) { const i = DYN.indexOf(e.col); if (i >= 0) DYN.splice(i, 1); } } INT.items = []; }
function intAdd(it) {
  const F = FCAT[it.k]; if (!F) return null; const mesh = mkFurn(it.k, it.c); const e = { it, mesh, col: null }; scene.add(mesh); INT.items.push(e); intPlace(e); return e;
}
function intPlace(e) {
  const it = e.it, F = FCAT[it.k], sw = it.r % 2; const hw = (sw ? F.d : F.w) / 2, hd = (sw ? F.w : F.d) / 2;
  it.x = clamp(it.x, -IW + hw + 0.1, IW - hw - 0.1); it.z = clamp(it.z, -ID + hd + 0.1, ID - hd - 0.1);
  if (F.wall) { const near = [[0, -ID + 0.09], [0, ID - 0.09]]; }
  e.mesh.position.set(IX + it.x, 0, IZ + it.z); e.mesh.rotation.y = it.r * Math.PI / 2;
  if (!F.nc) { if (!e.col) { e.col = furnBox(it); DYN.push(e.col); } else Object.assign(e.col, furnBox(it)); }
}
function intLoad(furn) { intClear(); for (const it of (furn || []).slice(0, 70)) intAdd({ k: it.k, x: +it.x || 0, z: +it.z || 0, r: (it.r | 0) & 3, c: it.c | 0 }); }
function intData() { return INT.items.map((e) => ({ k: e.it.k, x: Math.round(e.it.x * 100) / 100, z: Math.round(e.it.z * 100) / 100, r: e.it.r, c: e.it.c })); }
const DEFAULT_FURN = [{ k: 'bed', x: -5.6, z: 3.6, r: 0, c: 8 }, { k: 'sofa', x: 2.5, z: 4.5, r: 2, c: 1 }, { k: 'rug', x: 2.5, z: 1.6, r: 0, c: 9 }, { k: 'coffee', x: 2.5, z: 1.6, r: 0, c: 3 }, { k: 'tv', x: 2.5, z: -0.7, r: 0, c: 2 }, { k: 'shelf', x: 6.7, z: 4.9, r: 2, c: 3 }, { k: 'plant', x: -7.2, z: -4.8, r: 0, c: 7 }, { k: 'lamp', x: -3.5, z: 5.0, r: 0, c: 11 }, { k: 'dining', x: -4.5, z: -2.5, r: 0, c: 3 }, { k: 'fridge', x: 7.1, z: -4.6, r: 1, c: 0 }];

/* ---------------------------------- state --------------------------------- */
const L = { room: 'world', me: null, plots: {}, car: null, drive: false, remotes: new Map(), log: [], bub: new Map(), near: null, house: -1, sel: null, lastLook: -9, tp: 0, camY: 0, shot: 0 };
const LN = { ready: false, unsubs: [], sendT: 0, hbT: 0, last: '', token: 0, hb: 0, st: 'offline' };
const lMe = () => L.me;
function lifeLoadMe() {
  let m = store.get('life_me', null); if (!m || typeof m !== 'object') m = {};
  L.me = { plot: Number.isInteger(m.plot) ? m.plot : -1, door: m.door | 0, wall: m.wall | 0, floor: m.floor | 0, open: m.open === 0 ? 0 : 1, furn: Array.isArray(m.furn) ? m.furn : [], car: { m: ((m.car && m.car.m) | 0) % CARS.length, c: ((m.car && m.car.c) | 0) % CAR_COLS.length } };
}
const lifeSave = () => { store.set('life_me', L.me); lifePublishPlot(); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lifeOnline = () => LN.ready && NET.ready && NET.db;
function lifePublishPlot() {
  if (!lifeOnline() || L.me.plot < 0) return; const m = L.me;
  NET.fsm.setDoc(NET.fsm.doc(NET.db, 'life_plots', String(m.plot)), { uid: NET.uid, name: PLAYER_NAME, door: m.door, wall: m.wall, floor: m.floor, open: m.open, furn: m.furn.slice(0, 70), ts: Date.now() }).catch(netErr);
}
function plotData(i) { return L.me.plot === i ? { uid: 'me', name: PLAYER_NAME, door: L.me.door, wall: L.me.wall, floor: L.me.floor, open: L.me.open, furn: L.me.furn } : L.plots[i] || null; }
function plotRefresh(i) {
  const p = PLOTS[i]; if (!p) return; const d = plotData(i);
  p.door.material.color.set(DOORCOLS[(d ? d.door : i) % DOORCOLS.length] || '#b23a3a');
  if (d && !p.sign) { p.sign = lifeSign('', p.x, 4.1, p.sz - p.face * 2.9 + p.face * 0.12, p.face > 0 ? 0 : Math.PI, 3.8, 0.75, '#0f172a', '#fde047'); p.sign.visible = false; }
  if (p.sign) { if (!d) p.sign.visible = false; else { const nm = d.uid === 'me' ? 'MY HOME' : String(d.name || 'Player').slice(0, 14).toUpperCase() + "'S"; if (p.signTxt !== nm) { p.signTxt = nm; const c = p.sign.material.map.image, g = c.getContext('2d'); g.fillStyle = '#0f172a'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#fde047'; g.lineWidth = 5; g.strokeRect(5, 5, c.width - 10, c.height - 10); g.fillStyle = '#fde047'; g.font = `800 ${Math.round(c.height * 0.5)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(nm, c.width / 2, c.height / 2 + 2); p.sign.material.map.needsUpdate = true; } p.sign.visible = true; } }
}
/* ---------------------------------- audio extras -------------------------- */
Object.assign(AU, {
  horn() { try { if (!this.ctx) return; const d = this._bus(0.8, 0.15); this._t(415, 410, 0.5, 0.22, 'square', 0, d); this._t(520, 515, 0.5, 0.18, 'square', 0, d); this._t(830, 825, 0.5, 0.05, 'sawtooth', 0, d); } catch {} },
  thud(v = 1) { try { if (!this.ctx) return; const d = this._bus(Math.min(1, v), 0.2); this._n(0.18, 700, 0.7, 0.8 * v, 'lowpass', 90, 0, d); this._t(120, 40, 0.2, 0.8 * v, 'sine', 0, d); this._n(0.12, 3000, 1, 0.25 * v, 'bandpass', 800, 0.02, d); } catch {} },
  screech(v = 0.5) { try { if (!this.ctx) return; this._n(0.35, 2300, 6, 0.18 * v, 'bandpass', 1500, 0, this.out, 1.3); } catch {} },
  door() { try { if (!this.ctx) return; const d = this._bus(0.6, 0.3); this._n(0.05, 900, 1, 0.5, 'bandpass', 300, 0, d); this._t(180, 90, 0.12, 0.4, 'sine', 0.03, d); this._n(0.1, 2500, 2, 0.15, 'bandpass', 0, 0.2, d); } catch {} },
  pop() { try { if (!this.ctx) return; this._t(660, 990, 0.09, 0.15, 'sine'); this._t(990, 1320, 0.08, 0.1, 'sine', 0.07); } catch {} },
  claim() { try { if (!this.ctx) return; [523, 659, 784, 1047].forEach((f, i) => this._t(f, f, 0.3, 0.16, 'triangle', i * 0.1)); } catch {} },
});

/* ---------------------------------- UI ------------------------------------ */
const LCSS = `
.cc-life .cc-top,.cc-life .cc-gun,.cc-life .cc-xh,.cc-life .cc-bars,.cc-life .cc-tags,.cc-life [data-b=fire],.cc-life [data-b=aim],.cc-life [data-b=roll],.cc-life [data-b=reload],.cc-life [data-b=melee],.cc-life [data-b=kick],.cc-life [data-b=view],.cc-life [data-b=swap],.cc-life .cc-feed{display:none!important}
.cc-life .cc-map{top:calc(10px + env(safe-area-inset-top))}
.lf-ui{pointer-events:auto;touch-action:none}
.lf-bar{position:absolute;right:10px;top:calc(8px + env(safe-area-inset-top));display:flex;gap:6px;pointer-events:none}
.lf-b{pointer-events:auto;touch-action:none;width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(20,16,50,.62);backdrop-filter:blur(4px);color:#fff;font-size:19px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.lf-b.on{background:rgba(250,204,21,.85);color:#111}
.lf-car{position:absolute;right:16px;bottom:34px;display:none;gap:10px;pointer-events:none;flex-direction:column;align-items:flex-end}
.lf-car .row{display:flex;gap:10px}.lf-car .lf-b{width:62px;height:62px;font-size:24px}
.lf-spd{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);font-weight:800;font-size:30px;text-shadow:0 2px 8px #000;display:none;pointer-events:none;text-align:center}.lf-spd small{display:block;font-size:11px;letter-spacing:2px;opacity:.8}
.lf-chat{position:absolute;left:128px;top:calc(8px + env(safe-area-inset-top));width:min(46vw,380px);display:flex;flex-direction:column;gap:3px;pointer-events:none;font-size:13px}
.lf-chat div{background:rgba(10,8,30,.55);padding:3px 9px;border-radius:10px;width:fit-content;max-width:100%;word-break:break-word;text-shadow:0 1px 2px #000;animation:lfin .2s}
.lf-chat b{color:#fde047}.lf-chat .me b{color:#7dd3fc}.lf-chat .sys{color:#c4b5fd;font-style:italic}
@keyframes lfin{from{opacity:0;transform:translateY(4px)}to{opacity:1}}
.lf-in{position:absolute;left:50%;top:calc(8px + env(safe-area-inset-top));transform:translateX(-50%);width:min(88vw,520px);display:none;gap:6px;z-index:4;pointer-events:auto}
.lf-in input{flex:1;min-width:0;padding:10px 14px;border-radius:22px;border:2px solid #fde047;background:rgba(10,8,30,.92);color:#fff;font-size:16px;outline:none}
.lf-in button{border:0;border-radius:22px;padding:0 18px;background:#fde047;color:#111;font-weight:800;font-size:15px}
.lf-tg{position:absolute;transform:translate(-50%,-100%);text-align:center;pointer-events:none;display:none;white-space:nowrap}
.lf-tg b{display:block;font-size:12px;font-weight:800;text-shadow:0 1px 3px #000,0 0 6px #000}
.lf-tg i{display:block;margin:0 auto 3px;font-style:normal;background:#fff;color:#111;padding:4px 10px;border-radius:12px;font-size:13px;font-weight:600;max-width:200px;white-space:normal;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.lf-panel{position:fixed;inset:0;z-index:6;display:none;align-items:center;justify-content:center;background:rgba(5,4,20,.55);backdrop-filter:blur(3px);pointer-events:auto}
.lf-panel.on{display:flex}
.lf-card{width:min(94vw,560px);max-height:88vh;overflow:auto;background:#17133a;border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);color:#fff}
.lf-card h2{margin:0 0 10px;font-size:20px;display:flex;justify-content:space-between;align-items:center}.lf-card h3{margin:14px 0 6px;font-size:13px;letter-spacing:1.5px;opacity:.7;text-transform:uppercase}
.lf-x{border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:50%;width:32px;height:32px;font-size:16px}
.lf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}
.lf-opt{border:2px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff;border-radius:12px;padding:10px 6px;font-size:13px;font-weight:700;cursor:pointer;text-align:center}
.lf-opt small{display:block;font-weight:500;opacity:.7;font-size:11px;margin-top:2px}.lf-opt.sel{border-color:#fde047;background:rgba(253,224,71,.16)}
.lf-sw{display:flex;gap:8px;flex-wrap:wrap}.lf-sw i{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.25);cursor:pointer}.lf-sw i.sel{border-color:#fde047;transform:scale(1.12)}
.lf-wide{display:block;width:100%;margin-top:8px;padding:12px;border:0;border-radius:12px;font-weight:800;font-size:15px;background:#fde047;color:#111;cursor:pointer}.lf-wide.alt{background:rgba(255,255,255,.14);color:#fff}
.lf-dock{position:absolute;left:50%;bottom:calc(10px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(96vw,640px);background:rgba(15,12,40,.93);border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:8px;display:none;pointer-events:auto;z-index:3;max-height:42vh;overflow:auto}
.lf-dock .tabs{display:flex;gap:6px;margin-bottom:6px}.lf-dock .tabs button{flex:1}
.lf-dock .lf-opt{padding:6px 4px;font-size:12px}.lf-dock .lf-grid{grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:6px}
.lf-pad{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px}
.lf-pad button{padding:10px 0;border:0;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;font-size:17px;font-weight:700;touch-action:manipulation}
.lf-pad button.red{background:#be123c}.lf-pad button.go{background:#16a34a}
.lf-hint{font-size:12px;opacity:.75;margin:4px 2px}
.lf-shot{max-width:100%;border-radius:12px;display:block;margin:0 auto 8px}
`;
let LU = {};
function lifeInitUI() {
  const st = document.createElement('style'); st.textContent = LCSS; document.head.appendChild(st); U.root.classList.add('cc-life');
  U.hud.insertAdjacentHTML('beforeend', `<div class="lf-bar"><button class="lf-b" data-lf="chat">💬</button><button class="lf-b" data-lf="emote">👋</button><button class="lf-b" data-lf="photo">📸</button><button class="lf-b" data-lf="menu">☰</button></div>
    <div class="lf-chat" data-lk="log"></div><div class="lf-in" data-lk="in"><input maxlength="120" placeholder="Say something…" data-lk="inp"><button data-lf="send">Send</button></div>
    <div class="lf-tags" data-lk="tags"></div><div class="lf-spd" data-lk="spd"><span data-lk="kmh">0</span><small>KM/H</small></div>
    <div class="lf-car" data-lk="carb"><div class="row"><button class="lf-b" data-lf="horn">📣</button><button class="lf-b" data-lf="brake">⛔</button></div></div>
    <div class="lf-dock" data-lk="dock"></div>`);
  const pn = document.createElement('div'); pn.className = 'lf-panel'; pn.innerHTML = '<div class="lf-card" data-lk="card"></div>'; U.root.appendChild(pn);
  LU = { panel: pn, card: pn.querySelector('[data-lk=card]') }; U.hud.querySelectorAll('[data-lk]').forEach((e) => { LU[e.dataset.lk] = e; });
  const bind = (root) => root.addEventListener('click', (e) => { const b = e.target.closest('[data-lf]'); if (b) lifeBtn(b.dataset.lf, b, e); });
  bind(U.hud); bind(pn); pn.addEventListener('click', (e) => { if (e.target === pn) lifeClosePanel(); });
  U.hud.querySelectorAll('.lf-bar,.lf-b,.lf-in,.lf-dock').forEach((e) => e.classList.add('lf-ui'));
  for (const nm of ['horn', 'brake']) { const b = U.hud.querySelector(`[data-lf=${nm}]`); b.addEventListener('pointerdown', (e) => { e.preventDefault(); L['h_' + nm] = true; if (nm === 'horn') AU.horn(); }); const up = () => { L['h_' + nm] = false; }; b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up); }
  LU.inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') lifeSendChat(); else if (e.key === 'Escape') lifeChatToggle(false); });
  LU.inp.addEventListener('keyup', (e) => e.stopPropagation());
  addEventListener('keydown', (e) => { if (!LIFE || G.state !== 'playing' || G.paused || e.repeat) return; if (document.activeElement === LU.inp) return; if (e.code === 'Enter') { lifeChatToggle(true); e.preventDefault(); } else if (e.code === 'KeyM') { lifeMenu(); } else if (e.code === 'KeyH' && L.drive) AU.horn(); else if (e.code === 'Escape') { lifeClosePanel(); } });
  // desktop: drag to look (no pointer lock, so menus and chat stay usable)
  if (!TOUCH) { let dn = false; U.canvas.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.button === 2) dn = true; }); addEventListener('pointerup', () => { dn = false; }); addEventListener('pointermove', (e) => { if (dn && G.state === 'playing' && !G.paused && !L.panelOn) lookBy(e.movementX, e.movementY, 0.0042, false); }); }
  U.screens.menu.querySelector('h1').innerHTML = '<small>GET BETTER</small>World';
  const ps = U.screens.menu.querySelectorAll('p'); ps[0].textContent = 'A shared town to hang out in. Claim a house, decorate it, drive your dream car, chat and visit your friends.';
  U.menurow.style.display = 'none'; U.menurow2.style.display = 'none'; U.play.textContent = 'Enter the world';
  U.online.querySelectorAll('button')[0].textContent = 'Online with friends'; U.online.querySelectorAll('button')[1].textContent = 'Solo';
  U.quit.textContent = 'Leave world'; U.eplace.parentElement.parentElement.style.display = 'none';
  U.keys.innerHTML = TOUCH ? '<span><b>Left pad</b> walk / drive</span><span><b>Drag right</b> look</span><span><b>Use</b> doors, car, claim house</span><span><b>💬</b> chat · <b>☰</b> menu · <b>📸</b> photo</span>' : '<span><b>WASD</b> move / drive</span><span><b>Drag mouse</b> look</span><span><b>E</b> use (doors, car, claim)</span><span><b>Shift</b> run · <b>Space</b> jump / handbrake</span><span><b>Enter</b> chat · <b>M</b> menu · <b>H</b> horn</span>';
  const u = U.btn.use; u.style.right = '110px'; u.style.bottom = '120px'; u.style.width = u.style.height = '72px'; u.innerHTML = '<span>✋</span>Use'; U.btn.jump.style.right = '22px'; U.btn.jump.style.bottom = '150px';
}
function lifeBtn(k, b) {
  if (k === 'chat') lifeChatToggle(LU.in.style.display !== 'flex'); else if (k === 'send') lifeSendChat(); else if (k === 'menu') lifeMenu(); else if (k === 'emote') { if (G.player.speed < 1 && !L.drive) G.player.wave(); }
  else if (k === 'photo') lifePhoto(); else if (k === 'x') lifeClosePanel();
}
function lifeClosePanel() { LU.panel.classList.remove('on'); L.panelOn = false; }
function lifePanel(title, html) { LU.card.innerHTML = `<h2>${title}<button class="lf-x" data-lf="x">✕</button></h2>${html}`; LU.panel.classList.add('on'); L.panelOn = true; try { document.exitPointerLock?.(); } catch {} lifeChatToggle(false); }
function lifeChatToggle(on) { LU.in.style.display = on ? 'flex' : 'none'; if (on) { LU.inp.value = ''; setTimeout(() => LU.inp.focus(), 30); } else LU.inp.blur(); }
function lifeLog(html, cls = '') { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; LU.log.appendChild(d); while (LU.log.children.length > 6) LU.log.firstChild.remove(); setTimeout(() => { try { d.style.transition = 'opacity 1s'; d.style.opacity = 0; setTimeout(() => d.remove(), 1000); } catch {} }, 14000); }
function lifeSendChat() {
  const t = LU.inp.value.trim().slice(0, 120); lifeChatToggle(false); if (!t) return;
  lifeLog(`<b>${esc(PLAYER_NAME)}</b> ${esc(t)}`, 'me'); L.bub.set('me', { t: G.t + 6, text: t }); AU.pop();
  if (lifeOnline()) NET.fsm.addDoc(NET.fsm.collection(NET.db, 'life_chat'), { uid: NET.uid, name: PLAYER_NAME, text: t, room: L.room, ts: Date.now() }).then((r) => setTimeout(() => NET.fsm.deleteDoc(r).catch(() => {}), 30000)).catch(netErr);
}
/* -------- menu panels -------- */
const swatches = (arr, sel, key, wrap) => `<div class="lf-sw">${arr.map((c, i) => `<i style="background:${typeof c === 'string' ? c : c.c};${typeof c !== 'string' && c.t ? 'background-image:linear-gradient(135deg,rgba(255,255,255,.25),rgba(0,0,0,.2))' : ''}" class="${i === sel ? 'sel' : ''}" data-lf="${key}:${i}"></i>`).join('')}</div>`;
function lifeMenu() {
  const m = L.me, own = m.plot >= 0;
  lifePanel('Get Better World', `<p class="lf-hint">${LN.ready ? '🟢 Online · ' + (L.remotes.size + 1) + ' in town' : '⚪ Solo (not connected)'}${own ? ' · 🏠 House #' + (m.plot + 1) : ' · No house yet — walk to an empty house and press Use'}</p>
    <div class="lf-grid"><button class="lf-opt" data-lf="m:house">🏠<small>My house</small></button><button class="lf-opt" data-lf="m:car">🚗<small>My car</small></button><button class="lf-opt" data-lf="m:tp">🧭<small>Travel</small></button><button class="lf-opt" data-lf="m:photo">📸<small>Photo</small></button>${L.room !== 'world' && L.house === m.plot ? '<button class="lf-opt" data-lf="m:deco">🛋️<small>Decorate</small></button>' : ''}</div>
    <button class="lf-wide alt" data-lf="m:leave">Leave world</button>`);
}
const _lb = lifeBtn;
lifeBtn = function (k, b) {
  if (k.indexOf(':') < 0) return _lb(k, b); const [a, v] = k.split(':'), m = L.me;
  if (a === 'm') { if (v === 'house') lifeHousePanel(); else if (v === 'car') lifeCarPanel(); else if (v === 'tp') lifeTpPanel(); else if (v === 'photo') { lifeClosePanel(); setTimeout(lifePhoto, 60); } else if (v === 'deco') { lifeClosePanel(); decoOpen(); } else if (v === 'leave') { lifeClosePanel(); U.quit.click(); } }
  else if (a === 'door') { m.door = +v; lifeSave(); plotRefresh(m.plot); lifeHousePanel(); }
  else if (a === 'wall') { m.wall = +v; lifeSave(); if (L.house === m.plot) intSetStyle(m.wall, m.floor); lifeHousePanel(); }
  else if (a === 'floor') { m.floor = +v; lifeSave(); if (L.house === m.plot) intSetStyle(m.wall, m.floor); lifeHousePanel(); }
  else if (a === 'open') { m.open = m.open ? 0 : 1; lifeSave(); lifeHousePanel(); }
  else if (a === 'home') { lifeClosePanel(); lifeGoHome(); }
  else if (a === 'abandon') { if (confirm('Give up your house? Your furniture will be lost.')) { const p = m.plot; m.plot = -1; m.furn = []; store.set('life_me', m); if (lifeOnline() && p >= 0) NET.fsm.deleteDoc(NET.fsm.doc(NET.db, 'life_plots', String(p))).catch(() => {}); delete L.plots[p]; if (L.house === p) lifeExitHouse(); plotRefresh(p); lifeClosePanel(); banner('House released', '#fff'); } }
  else if (a === 'cm') { m.car.m = +v; lifeSave(); carRebuild(); lifeCarPanel(); }
  else if (a === 'cc') { m.car.c = +v; lifeSave(); carRebuild(); lifeCarPanel(); }
  else if (a === 'call') { lifeClosePanel(); lifeCallCar(); }
  else if (a === 'tp') { lifeClosePanel(); lifeTeleport(+v); }
  else if (a === 'post') { lifeClosePanel(); try { parent !== window && parent.postMessage({ type: 'gb-life-photo', data: L.shotData }, '*'); } catch {} if (parent === window) lifeDownload(); else banner('Sent to Get better feed', '#fde047'); }
  else if (a === 'save') lifeDownload();
};
function lifeHousePanel() {
  const m = L.me; if (m.plot < 0) return lifePanel('My house', '<p>You don\'t own a house yet.</p><p class="lf-hint">Every house with a plain sign is free. Walk to its front door and press <b>Use</b> to claim it — one house per player.</p>');
  lifePanel(`My house #${m.plot + 1}`, `<h3>Front door colour</h3>${swatches(DOORCOLS, m.door, 'door')}<h3>Wall colour (inside)</h3>${swatches(WALLS, m.wall, 'wall')}<h3>Floor</h3>${swatches(FLOORS, m.floor, 'floor')}
    <h3>Visitors</h3><button class="lf-wide alt" data-lf="open:0">${m.open ? '🔓 Open to everyone — tap to lock' : '🔒 Locked — tap to open'}</button>
    <button class="lf-wide" data-lf="home:0">🏠 Go home</button><button class="lf-wide alt" data-lf="abandon:0">Give up this house</button>`);
}
function lifeCarPanel() {
  const m = L.me;
  lifePanel('My car', `<div class="lf-grid">${CARS.map((c, i) => `<button class="lf-opt ${i === m.car.m ? 'sel' : ''}" data-lf="cm:${i}">🚘 ${c.name}<small>${c.sub} · ${Math.round(c.top * 3.6)} km/h</small></button>`).join('')}</div><h3>Paint</h3>${swatches(CAR_COLS, m.car.c, 'cc')}<button class="lf-wide" data-lf="call:0">📍 Bring my car to me</button><p class="lf-hint">Walk up to your car and press Use to drive. WASD / left pad to steer · Space / ⛔ handbrake · H / 📣 horn.</p>`);
}
const TPS = [['🌳 Fountain Square', 0, 14, 0], ['🏠 My house', 0, 0, 0], ['🌲 City Park', 30, 14, Math.PI], ['🏬 Downtown', -30, 30, 0], ['🛒 Market', 30, -30, 0], ['🛝 Playground', -30, -4, 0], ['⚽ Sports field', 90, -64, 0], ['🌲 Forest park', -90, 64, 0]];
function lifeTpPanel() { lifePanel('Travel', `<div class="lf-grid">${TPS.map((t, i) => `<button class="lf-opt" data-lf="tp:${i}">${t[0]}</button>`).join('')}</div>`); }
function lifeTeleport(i) { if (L.drive) lifeExitCar(); if (L.room !== 'world') lifeExitHouse(true); if (i === 1) return lifeGoHome(); const t = TPS[i]; lifeTp(t[1], t[2], t[3]); }
function lifeTp(x, z, yaw) { const P = G.player; P.spawnAt(x, z); P.yaw = yaw; G.cam.yaw = yaw; G.cam.len = undefined; L.camY = 0; }
function lifeGoHome() { const m = L.me; if (m.plot < 0) return banner('Claim a house first', '#fff'); if (L.drive) lifeExitCar(); if (L.room !== 'world') lifeExitHouse(true); const p = PLOTS[m.plot]; lifeTp(p.sx, p.sz + p.face * 1.0, p.face > 0 ? 0 : Math.PI); }
function lifePhoto() {
  try { renderer.render(scene, camera); const d = renderer.domElement.toDataURL('image/jpeg', 0.86); L.shotData = d; AU.door(); lifePanel('Photo', `<img class="lf-shot" src="${d}"><button class="lf-wide" data-lf="post:0">${parent !== window ? '📣 Post to Get better feed' : '⬇ Save photo'}</button><button class="lf-wide alt" data-lf="save:0">⬇ Save to device</button>`); } catch (e) { banner('Photo failed', '#fff'); }
}
function lifeDownload() { try { const a = document.createElement('a'); a.href = L.shotData; a.download = 'get-better-world.jpg'; document.body.appendChild(a); a.click(); a.remove(); } catch {} }

/* ---------------------------------- houses -------------------------------- */
function lifeEnterHouse(i) {
  const own = L.me.plot === i, d = plotData(i); if (!d) return;
  if (!own && d.open === 0) return banner('🔒 Locked', '#fca5a5');
  if (L.drive) return;
  AU.door(); L.room = 'h' + i; L.house = i; intSetStyle(d.wall | 0, d.floor | 0); intLoad(d.furn && d.furn.length ? d.furn : (own ? [] : []));
  INT.lights.forEach((l) => { l.intensity = 34; }); lifeTp(IX, IZ - ID + 1.6, 0); banner(own ? '🏠 Home sweet home' : `🏠 ${String(d.name || 'Player').slice(0, 16)}'s house`, '#fde047'); lifeSnapNow();
}
function lifeExitHouse(quiet) {
  if (L.room === 'world') return; const i = L.house, p = PLOTS[i]; if (L.sel) decoClose(); L.room = 'world'; L.house = -1; INT.lights.forEach((l) => { l.intensity = 0; }); if (!quiet) AU.door();
  lifeTp(p.sx, p.sz + p.face * 0.6, p.face > 0 ? 0 : Math.PI); lifeSnapNow();
}
function lifeClaim(i) {
  const m = L.me; if (m.plot >= 0) return banner('You already own a house', '#fff');
  const done = () => { m.plot = i; m.door = (i % DOORCOLS.length); m.wall = 0; m.floor = 0; m.open = 1; m.furn = DEFAULT_FURN.map((x) => ({ ...x })); lifeSave(); plotRefresh(i); AU.claim(); banner('🎉 This house is yours!', '#fde047'); lifeLog('Tip: press ☰ → My house to repaint, and go inside to decorate.', 'sys'); };
  if (lifeOnline()) NET.fsm.getDoc(NET.fsm.doc(NET.db, 'life_plots', String(i))).then((s) => { if (s.exists() && s.data().uid !== NET.uid) { banner('Someone just claimed it', '#fca5a5'); return; } done(); }).catch(() => done()); else done();
}
/* ---------------------------------- decorate ------------------------------ */
function decoOpen() {
  if (L.room === 'world' || L.house !== L.me.plot) return; L.sel = { i: -1, tab: 'add' }; decoRender();
}
function decoClose() { L.sel = null; LU.dock.style.display = 'none'; decoHi(); L.me.furn = intData(); lifeSave(); }
function decoHi() { INT.items.forEach((e, i) => { const on = L.sel && L.sel.i === i; e.mesh.traverse((o) => { if (o.material && o.material.emissive && !o.userData.keep) { if (on) { if (!o.userData.hi) { o.userData.hi = o.material; o.material = o.material.clone(); } if (o.material.emissive) { o.material.emissive.set('#ffd34d'); o.material.emissiveIntensity = 0.35; } } else if (o.userData.hi) { o.material.dispose(); o.material = o.userData.hi; o.userData.hi = null; } } }); }); }
function decoRender() {
  const s = L.sel; if (!s) return; const it = INT.items[s.i];
  const tabs = `<div class="tabs"><button class="lf-opt ${s.tab === 'add' ? 'sel' : ''}" data-lf="d:tab-add">➕ Add</button><button class="lf-opt ${s.tab === 'edit' ? 'sel' : ''}" data-lf="d:tab-edit">✏️ Move${it ? ' ' + FCAT[it.it.k].n : ''}</button><button class="lf-opt" data-lf="d:done">✔ Done</button></div>`;
  let body = '';
  if (s.tab === 'add') body = `<div class="lf-grid">${Object.entries(FCAT).map(([k, f]) => `<button class="lf-opt" data-lf="d:new-${k}">${f.i}<small>${f.n}</small></button>`).join('')}</div>`;
  else body = `<div class="lf-pad"><button data-lf="d:mv-l">◀</button><button data-lf="d:mv-u">▲</button><button data-lf="d:mv-d">▼</button><button data-lf="d:mv-r">▶</button><button data-lf="d:rot">⟳ Rotate</button><button data-lf="d:col">🎨 Colour</button><button data-lf="d:next">⇥ Next item</button><button class="red" data-lf="d:del">🗑 Delete</button></div><p class="lf-hint">Arrows move relative to your camera. Tap Next item to pick another piece (the selected one glows).</p>`;
  LU.dock.innerHTML = tabs + body; LU.dock.style.display = 'block'; decoHi();
}
const _lb2 = lifeBtn;
lifeBtn = function (k, b, e) {
  if (k.startsWith('d:')) return decoAct(k.slice(2)); return _lb2(k, b, e);
};
function decoAct(a) {
  const s = L.sel; if (!s) return; let it = INT.items[s.i];
  if (a === 'done') return decoClose();
  if (a === 'tab-add') { s.tab = 'add'; return decoRender(); }
  if (a === 'tab-edit') { if (!it && INT.items.length) { s.i = INT.items.length - 1; } s.tab = 'edit'; return decoRender(); }
  if (a.startsWith('new-')) { if (INT.items.length >= 60) return banner('Room is full', '#fff'); const k = a.slice(4), P = G.player, F = FCAT[k], fx = Math.sin(G.cam.yaw), fz = Math.cos(G.cam.yaw); const e = intAdd({ k, x: P.x - IX + fx * 2.4, z: P.z - IZ + fz * 2.4, r: 0, c: F.c }); s.i = INT.items.indexOf(e); s.tab = 'edit'; AU.pop(); return decoRender(); }
  if (!it) return;
  const o = it.it, step = 0.25, cy = G.cam.yaw; let dx = 0, dz = 0;
  if (a.startsWith('mv-')) { const fx = Math.sin(cy), fz = Math.cos(cy), rx = -Math.cos(cy), rz = Math.sin(cy), d = a[3]; let vx = d === 'u' ? fx : d === 'd' ? -fx : d === 'r' ? rx : -rx, vz = d === 'u' ? fz : d === 'd' ? -fz : d === 'r' ? rz : -rz; if (Math.abs(vx) > Math.abs(vz)) { dx = Math.sign(vx) * step; } else { dz = Math.sign(vz) * step; } o.x += dx; o.z += dz; intPlace(it); }
  else if (a === 'rot') { o.r = (o.r + 1) & 3; intPlace(it); } else if (a === 'col') { o.c = (o.c + 1) % FPAL.length; const keep = L.sel.i; const mesh = mkFurn(o.k, o.c); scene.remove(it.mesh); it.mesh = mesh; scene.add(mesh); intPlace(it); decoHi(); }
  else if (a === 'next') { const P = G.player; const arr = INT.items.map((e, i) => [i, Math.hypot(IX + e.it.x - P.x, IZ + e.it.z - P.z)]).sort((p, q) => p[1] - q[1]); const pos = arr.findIndex((v) => v[0] === s.i); s.i = arr[(pos + 1) % arr.length][0]; decoRender(); }
  else if (a === 'del') { scene.remove(it.mesh); if (it.col) { const j = DYN.indexOf(it.col); if (j >= 0) DYN.splice(j, 1); } INT.items.splice(s.i, 1); s.i = INT.items.length ? Math.min(s.i, INT.items.length - 1) : -1; s.tab = s.i < 0 ? 'add' : 'edit'; decoRender(); }
}
// press-and-hold repeat for the arrow buttons
{ let tm = 0, iv = 0; const stop = () => { clearTimeout(tm); clearInterval(iv); }; addEventListener('pointerdown', (e) => { const b = e.target.closest && e.target.closest('[data-lf^="d:mv-"]'); if (!b) return; stop(); const a = b.dataset.lf.slice(2); e.preventDefault(); decoAct(a); tm = setTimeout(() => { iv = setInterval(() => decoAct(a), 90); }, 380); }, true); addEventListener('pointerup', stop); addEventListener('pointercancel', stop);
  addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-lf^="d:mv-"]'); if (b) { e.stopPropagation(); e.preventDefault(); } }, true); }

/* ---------------------------------- cars ---------------------------------- */
function carCol(C) { const sp = CARS[C.m], s = Math.abs(Math.sin(C.yaw)), c = Math.abs(Math.cos(C.yaw)), hl = sp.L / 2, hw = sp.W / 2; Object.assign(C.col, { x0: C.x - (s * hl + c * hw), x1: C.x + (s * hl + c * hw), z0: C.z - (c * hl + s * hw), z1: C.z + (c * hl + s * hw) }); }
function carMake(m, c, x, z, yaw) {
  const g = makeCarMesh(m, CAR_COLS[c]); g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g); const C = { m, c, x, z, yaw, v: 0, steer: 0, grp: g, col: { x0: 0, x1: 0, z0: 0, z1: 0, y0: 0, y1: 1.45, q: 0 } }; DYN.push(C.col); carCol(C); return C;
}
function carDrop(C) { if (!C) return; scene.remove(C.grp); const i = DYN.indexOf(C.col); if (i >= 0) DYN.splice(i, 1); }
function carRebuild() { const o = L.car; if (!o) return; const C = carMake(L.me.car.m, L.me.car.c, o.x, o.z, o.yaw); C.v = o.v; C.col.off = o.col.off; carDrop(o); L.car = C; }
function carBlocked(C, x, z, yaw) {
  const sp = CARS[C.m], hl = sp.L / 2 - 0.1, hw = sp.W / 2 - 0.05, sy = Math.sin(yaw), cy = Math.cos(yaw), cols = nearCols(x - 4, z - 4, x + 4, z + 4);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { if (!a && !b) continue; const px = x + sy * a * hl - cy * b * hw, pz = z + cy * a * hl + sy * b * hw; for (const k of cols) { if (k === C.col || k.off || k.y0 > 1.2 || k.y1 < 0.2) continue; if (px > k.x0 && px < k.x1 && pz > k.z0 && pz < k.z1) return true; } }
  return false;
}
function lifeCallCar() {
  const P = G.player; if (L.room !== 'world') return banner('Go outside first', '#fff'); if (L.drive) return;
  const m = L.me.car, f = [Math.sin(P.yaw), Math.cos(P.yaw)], tries = [[6, 0], [6, 4], [6, -4], [-6, 0], [0, 6], [0, -6], [9, 0]]; let pos = null, yaw = P.yaw + Math.PI / 2;
  const tmp = L.car || { m: m.m, col: {} };
  for (const [a, b] of tries) { const x = P.x + f[0] * a + f[1] * b, z = P.z + f[1] * a - f[0] * b; for (const y of [P.yaw, P.yaw + Math.PI / 2]) if (!carBlocked(tmp, x, z, y)) { pos = [x, z, y]; break; } if (pos) break; }
  if (!pos) pos = [P.x + f[0] * 7, P.z + f[1] * 7, P.yaw];
  if (L.car) carDrop(L.car); L.car = carMake(m.m, m.c, pos[0], pos[1], pos[2]); AU.door(); banner('🚗 Your car is here', '#fde047');
}
function lifeEnterCar() {
  const C = L.car, P = G.player; if (!C) return; L.drive = true; C.col.off = true; P.group.visible = false; AU.door(); AU.init(); G.cam.yaw = C.yaw; G.cam.pitch = 0.2; G.cam.len = undefined; L.lastLook = -9;
  LU.carb.style.display = TOUCH ? 'flex' : 'none'; LU.spd.style.display = 'block';
}
function lifeExitCar() {
  const C = L.car, P = G.player; if (!C || !L.drive) return; L.drive = false; C.col.off = false; C.v = 0; AU.engineOff(); AU.door(); LU.carb.style.display = 'none'; LU.spd.style.display = 'none';
  const sp = CARS[C.m], rx = -Math.cos(C.yaw), rz = Math.sin(C.yaw); let sx = 1, ok = null; for (const s of [1, -1, 2.2, -2.2]) { const d = (s > 0 ? 1 : -1) * (sp.W / 2 + 1.0), x = C.x + rx * d, z = C.z + rz * d; if (!nearCols(x - 0.4, z - 0.4, x + 0.4, z + 0.4).some((k) => k !== C.col && k.y0 < 1.5 && k.y1 > 0.3 && x > k.x0 - 0.3 && x < k.x1 + 0.3 && z > k.z0 - 0.3 && z < k.z1 + 0.3)) { ok = [x, z]; break; } }
  ok = ok || [C.x + rx * (sp.W / 2 + 1.0), C.z + rz * (sp.W / 2 + 1.0)]; P.spawnAt(ok[0], ok[1]); P.yaw = C.yaw; P.group.visible = true; carCol(C);
}
function carStep(dt, ix, iz) {
  const C = L.car, sp = CARS[C.m]; let thr = clamp(iz, -1, 1); const hb = !!(keys.Space || L.h_brake);
  if (keys.KeyH || L.h_horn) { if (!L.hornT || G.t - L.hornT > 0.5) { L.hornT = G.t; AU.horn(); } }
  const v = C.v; let a = 0;
  if (thr > 0.02) a = v < 0 ? 36 : sp.acc * (1 - Math.max(0, v) / sp.top) * thr + (v < 6 ? 3.5 * thr : 0);
  else if (thr < -0.02) a = v > 0.5 ? -36 * -thr : -sp.acc * 0.6 * (1 - Math.max(0, -v) / (sp.top * 0.3)) * -thr;
  else a = -Math.sign(v) * Math.min(Math.abs(v) / dt, 4 + 0.012 * v * v);
  if (hb) a = -Math.sign(v) * Math.min(Math.abs(v) / dt, 30);
  C.v = clamp(v + a * dt, -sp.top * 0.3, sp.top); if (Math.abs(C.v) < 0.04 && thr === 0) C.v = 0;
  const so = ix * sp.steer / (1 + Math.abs(C.v) / 16); C.steer = damp(C.steer, so, 9, dt);
  const slide = hb && Math.abs(C.v) > 8; C.yaw -= (C.v * Math.tan(C.steer) / (sp.wb * 2)) * dt * (slide ? 1.7 : 1);
  if ((slide || (Math.abs(ix) > 0.85 && Math.abs(C.v) > 26)) && (!L.scrT || G.t - L.scrT > 0.3)) { L.scrT = G.t; AU.screech(clamp(Math.abs(C.v) / 40, 0.3, 1)); }
  const n = Math.max(1, Math.ceil(Math.abs(C.v * dt) / 0.4)), h = dt / n; let bumped = false;
  for (let i = 0; i < n; i++) {
    const nx = C.x + Math.sin(C.yaw) * C.v * h, nz = C.z + Math.cos(C.yaw) * C.v * h;
    if (!carBlocked(C, nx, nz, C.yaw)) { C.x = nx; C.z = nz; } else if (!carBlocked(C, nx, C.z, C.yaw)) { C.x = nx; C.v *= 0.97; bumped = true; } else if (!carBlocked(C, C.x, nz, C.yaw)) { C.z = nz; C.v *= 0.97; bumped = true; } else { bumped = true; C.v *= -0.25; break; }
  }
  if (bumped && (!L.bumpT || G.t - L.bumpT > 0.4)) { L.bumpT = G.t; const s = clamp(Math.abs(C.v) / 18, 0.2, 1); AU.thud(s); G.cam.shake = Math.max(G.cam.shake || 0, s * 1.2); }
  C.grp.position.set(C.x, 0, C.z); C.grp.rotation.y = C.yaw; C.grp.rotation.z = -C.steer * C.v * 0.0035; C.grp.rotation.x = clamp(-a * 0.0022, -0.05, 0.05); carCol(C);
  const gr = (Math.abs(C.v) / sp.top) * 5; AU.engine(4 + (gr % 1) * 14 + Math.floor(gr) * 1.5, Math.abs(thr));
  return true;
}

/* ------------------------------ online presence --------------------------- */
const lifeSnapNow = () => { LN.sendT = 0; LN.last = ''; };
function lifeHue(id) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return new THREE.Color().setHSL((h % 360) / 360, 0.6, 0.62); }
function lifeRemoteUpsert(id, d) {
  if (d.mode !== 'life') return; let r = L.remotes.get(id);
  if (!r) {
    const f = new Fighter(String(d.name || 'Player').slice(0, 16), false, lifeHue(id)); f.remote = true; f.uid = id; f.lastEvs = d.evs || 0; f.spawnAt(d.x || 0, d.z || 0); f.y = d.y || 0; f.dispY = f.y; f.yaw = d.yaw || 0; f.setStance('relaxed'); f.deadT = 0;
    r = { f, car: null, recv: 0, d }; L.remotes.set(id, r); lifeLog(`<span class="sys">${esc(f.name)} joined the world</span>`);
  }
  r.d = d; r.recv = performance.now();
  const dr = d.drv && d.car; r.f.net = { x: dr ? d.car.x : d.x, y: dr ? 0 : d.y, z: dr ? d.car.z : d.z, yaw: d.yaw || 0, hp: 100, armor: 0, alive: true, st: 'relaxed', evs: d.evs, ev: d.ev, fs: 0 };
  const cd = d.car; if (cd && (!r.car || r.car.m !== cd.m || r.car.c !== cd.c)) { if (r.car) carDrop(r.car); r.car = carMake(cd.m | 0, cd.c | 0, cd.x, cd.z, cd.yaw); r.car.first = true; }
  if (!cd && r.car) { carDrop(r.car); r.car = null; } if (r.car && cd) { r.car.tx = cd.x; r.car.tz = cd.z; r.car.tyaw = cd.yaw; if (r.car.first) { r.car.first = false; r.car.x = cd.x; r.car.z = cd.z; r.car.yaw = cd.yaw; } }
}
function lifeRemoteDrop(id) { const r = L.remotes.get(id); if (!r) return; L.remotes.delete(id); scene.remove(r.f.group); const i = fighters.indexOf(r.f); if (i >= 0) fighters.splice(i, 1); if (r.car) carDrop(r.car); lifeLog(`<span class="sys">${esc(r.f.name)} left</span>`); }
async function lifeJoin() {
  lifeLeave(); const tk = ++LN.token; if (!NET.on) { LN.st = 'solo'; return; } LN.st = 'connecting';
  const ok = await netInit(); if (tk !== LN.token) return; if (!ok) { LN.st = 'offline'; lifeLog('<span class="sys">Offline — you are alone in town. Sign in to Get better to meet people.</span>'); return; }
  const F = NET.fsm, db = NET.db, uid = NET.uid; LN.ready = true; LN.st = 'online'; let fp = true, fc = true;
  LN.unsubs.push(F.onSnapshot(F.collection(db, 'life_plots'), (snap) => {
    snap.docChanges().forEach((ch) => { const i = Number(ch.doc.id); if (!(i >= 0 && i < PLOTS.length)) return; if (ch.type === 'removed') { delete L.plots[i]; } else { const d = ch.doc.data(); if (d.uid === uid) { if (L.me.plot !== i && L.me.plot < 0) { L.me.plot = i; L.me.door = d.door | 0; L.me.wall = d.wall | 0; L.me.floor = d.floor | 0; L.me.open = d.open === 0 ? 0 : 1; L.me.furn = d.furn || []; store.set('life_me', L.me); } delete L.plots[i]; } else { L.plots[i] = d; if (L.me.plot === i) { L.me.plot = -1; lifeLog('<span class="sys">Your house was claimed by someone else.</span>'); } } } plotRefresh(i); });
    if (fp) { fp = false; if (L.me.plot >= 0 && !snap.docs.some((x) => x.id === String(L.me.plot))) lifePublishPlot(); }
  }, netErr));
  LN.unsubs.push(F.onSnapshot(F.collection(db, 'life_players'), (snap) => { if (tk !== LN.token) return; const now = Date.now(); snap.docChanges().forEach((ch) => { if (ch.doc.id === uid) return; if (ch.type === 'removed') return lifeRemoteDrop(ch.doc.id); const d = ch.doc.data(); if (!L.remotes.has(ch.doc.id) && Math.abs(now - (d.ts || 0)) > 30000) return; lifeRemoteUpsert(ch.doc.id, d); }); }, netErr));
  LN.unsubs.push(F.onSnapshot(F.collection(db, 'life_chat'), (snap) => { if (tk !== LN.token) return; snap.docChanges().forEach((ch) => { if (ch.type !== 'added') return; const d = ch.doc.data(); if (d.uid === uid || Date.now() - (d.ts || 0) > 12000) return; if (d.room !== L.room) return; const t = String(d.text || '').slice(0, 120); lifeLog(`<b>${esc(String(d.name || 'Player').slice(0, 16))}</b> ${esc(t)}`); L.bub.set(d.uid, { t: G.t + 6, text: t }); AU.pop(); }); }, netErr));
  lifeSnapNow(); lifeLog('<span class="sys">🌐 Online — people in the world will show up here</span>');
}
function lifeLeave() {
  LN.token++; for (const u of LN.unsubs) { try { u(); } catch {} } LN.unsubs = []; for (const id of [...L.remotes.keys()]) lifeRemoteDrop(id);
  if (LN.ready && NET.ready) { try { NET.fsm.deleteDoc(NET.fsm.doc(NET.db, 'life_players', NET.uid)).catch(() => {}); } catch {} } LN.ready = false;
}
function lifeWrite(force) {
  if (!LN.ready || !G.player) return; const P = G.player, C = L.car;
  const s = { mode: 'life', name: PLAYER_NAME, x: r2(P.x), y: r2(P.y), z: r2(P.z), yaw: r2(L.drive && C ? C.yaw : P.yaw), room: L.room, drv: L.drive ? 1 : 0, car: C ? { m: C.m, c: C.c, x: r2(C.x), z: r2(C.z), yaw: r2(C.yaw) } : null, ev: NET.ev, evs: NET.evs };
  const key = JSON.stringify(s); if (!force && key === LN.last && LN.hbT > 0) return; LN.last = key; LN.hbT = 2.5; s.hb = ++LN.hb; s.ts = Date.now();
  NET.fsm.setDoc(NET.fsm.doc(NET.db, 'life_players', NET.uid), s).catch(netErr);
}
function lifeNetTick(dt) {
  if (!LN.ready) return; LN.sendT -= dt; LN.hbT -= dt; if (LN.sendT <= 0) { LN.sendT = L.drive ? 0.1 : 0.2; lifeWrite(false); }
  const now = performance.now(); for (const [id, r] of [...L.remotes]) if (now - r.recv > 9000) lifeRemoteDrop(id);
  for (const r of L.remotes.values()) {
    const same = r.d.room === L.room; r.f.group.visible = same && !r.d.drv; const w = L.room === 'world';
    if (r.car) { const c = r.car; c.x = damp(c.x, c.tx, 12, dt); c.z = damp(c.z, c.tz, 12, dt); c.yaw = dampAng(c.yaw, c.tyaw, 12, dt); c.grp.position.set(c.x, 0, c.z); c.grp.rotation.y = c.yaw; c.grp.visible = w; c.col.off = !w || !!r.d.drv; carCol(c); }
  }
}
/* ------------------------------- control / camera ------------------------- */
const DOOR_SHOP = { x: -45, z: 34.6 };
function lifeNear() {
  const P = G.player; let best = null, bd = 1e9; const cand = (d, o) => { if (d < bd) { bd = d; best = o; } };
  if (L.drive) return { t: 'exitcar', txt: TOUCH ? 'Tap USE to get out' : 'E · Get out' };
  if (L.room !== 'world') { const d = Math.hypot(P.x - IX, P.z - (IZ - ID + 0.9)); if (d < 2.6) return { t: 'exit', txt: TOUCH ? 'Tap USE: Leave house' : 'E · Leave house' }; return null; }
  if (L.car && Math.hypot(P.x - L.car.x, P.z - L.car.z) < 3.6 + CARS[L.car.m].L / 2) cand(0, { t: 'car', txt: TOUCH ? 'Tap USE: Drive' : 'E · Drive your car' });
  for (const p of PLOTS) { const d = Math.hypot(P.x - p.sx, P.z - p.sz); if (d > 3.4) continue; const dt = plotData(p.i), own = L.me.plot === p.i; cand(d + 0.5, dt ? { t: 'enter', i: p.i, txt: own ? (TOUCH ? 'Tap USE: Go inside (your home)' : 'E · Go inside (your home)') : `${TOUCH ? 'Tap USE' : 'E'} · Visit ${String(dt.name || 'Player').slice(0, 14)}'s house${dt.open === 0 ? ' 🔒' : ''}` } : { t: 'claim', i: p.i, txt: L.me.plot >= 0 ? 'Empty house — you already own one' : `${TOUCH ? 'Tap USE' : 'E'}: Claim this house (free)` }); }
  if (Math.hypot(P.x - DOOR_SHOP.x, P.z - DOOR_SHOP.z) < 4) cand(1, { t: 'shop', txt: `${TOUCH ? 'Tap USE' : 'E'}: Car showroom` });
  return best;
}
function lifeUse() {
  const n = L.near; if (!n || !G.player) return;
  if (n.t === 'exitcar') lifeExitCar(); else if (n.t === 'car') lifeEnterCar(); else if (n.t === 'exit') lifeExitHouse(); else if (n.t === 'enter') lifeEnterHouse(n.i); else if (n.t === 'claim') { if (L.me.plot < 0) lifeClaim(n.i); else banner('You already own a house', '#fff'); } else if (n.t === 'shop') lifeCarPanel();
}
function lifeAct(name) { const P = G.player; if (!P) return; if (name === 'jump') { if (!L.drive) P.inp.jump = true; } else if (name === 'use') lifeUse(); else if (name === 'wave') { if (P.speed < 1 && !L.drive) P.wave(); } }
function lifeControl(dt) {
  const P = G.player, c = G.cam; c.recoil = 0; { const k = 1 - Math.exp(-24 * dt); c.yaw -= lookAcc.x * k; c.pitch = clamp(c.pitch - lookAcc.y * k, -0.6, 1.1); lookAcc.x *= 1 - k; lookAcc.y *= 1 - k; }
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), mag = 0, analog = false;
  if (L.panelOn || LU.in.style.display === 'flex') { ix = iz = 0; }
  joy.sx = damp(joy.sx || 0, joy.x, 22, dt); joy.sy = damp(joy.sy || 0, joy.y, 22, dt); const jl = Math.hypot(joy.sx, joy.sy);
  if (jl > 0.08 && !L.panelOn) { ix = joy.sx; iz = -joy.sy; mag = Math.min(1, jl); analog = true; } else { const l = Math.hypot(ix, iz); if (l > 0) { ix /= l; iz /= l; mag = 1; } }
  if (L.drive) { carStep(dt, ix, iz); P.inp.mx = P.inp.mz = 0; P.inp.speed = 0; P.vx = P.vz = 0; const C = L.car; P.x = C.x; P.z = C.z; P.y = 0; P.dispY = 0; P.group.position.set(C.x, 0, C.z); }
  else {
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw); let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix; const ml = Math.hypot(mx, mz); if (ml > 0) { mx /= ml; mz /= ml; }
    const sprint = (keys.ShiftLeft || keys.ShiftRight || (analog && jl > 0.93)) && iz > 0.25 && mag > 0; let base = sprint ? CFG.SPRINT : CFG.RUN; if (analog) base = lerp(CFG.WALK, base, smooth(0.28, 0.92, mag));
    P.inp.mx = mx; P.inp.mz = mz; P.inp.speed = mag > 0 ? base : 0; P.inp.sprint = sprint; if (P.rollT <= 0) P.yaw = dampAng(P.yaw, mag > 0.05 ? Math.atan2(mx, mz) : P.yaw, 14, dt);
    P.relax = false;
  }
  L.near = L.panelOn ? null : lifeNear(); const n = L.near;
  if (n) { U.prompt.style.display = 'block'; setT(U.prompt, n.txt); } else U.prompt.style.display = 'none'; U.btn.use.style.display = n && TOUCH ? 'flex' : 'none';
  if (L.drive) U.btn.jump.style.display = 'none'; else U.btn.jump.style.display = '';
}
function lifeCamera(dt) {
  const P = G.player, c = G.cam, C = L.car, inH = L.room !== 'world'; let pit = c.pitch;
  if (L.drive && C) { if (G.t - L.lastLook > 1.4) { c.yaw = dampAng(c.yaw, C.yaw, Math.abs(C.v) > 2 ? 3.2 : 0.6, dt); c.pitch = damp(c.pitch, 0.2, 1.5, dt); } pit = c.pitch; }
  const d = camDir(c.yaw, pit), dist = L.drive ? 7.2 + Math.abs(C.v) * 0.05 : inH ? 3.1 : 4.4, oy = L.drive ? 1.5 : P.dispY + 1.55, ox = L.drive ? C.x : P.x, oz = L.drive ? C.z : P.z, sh = L.drive ? 0 : 0.35;
  const rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw); const sx = ox + rx * sh, sz = oz + rz * sh;
  let dx = -d.x, dy = -d.y + 0.18, dz = -d.z; const Ln = Math.hypot(dx, dy, dz); dx /= Ln; dy /= Ln; dz /= Ln; const off = C && L.drive; if (off) C.col.off = true;
  const t = rayWorld(sx, oy, sz, dx, dy, dz, dist + 0.4); if (off) C.col.off = !!L.drive;
  const cl0 = clamp(t - 0.4, 1.1, dist); c.len = c.len === undefined || cl0 < c.len ? cl0 : damp(c.len, cl0, 5, dt); c.shake = damp(c.shake || 0, 0, 8, dt); const shk = c.shake * 0.05;
  let cy = oy + dy * c.len + rnd(-shk, shk); if (inH) cy = Math.min(cy, IH - 0.35); camera.position.set(sx + dx * c.len + rnd(-shk, shk), cy, sz + dz * c.len + rnd(-shk, shk)); camera.rotation.order = 'YXZ'; camera.rotation.set(pit, c.yaw + Math.PI, 0);
  if (camera.near !== 0.1) { camera.near = 0.1; camera.updateProjectionMatrix(); }
  const aspect = innerWidth / innerHeight, base = aspect < 1 ? 80 : 68, tf = base + (L.drive ? clamp(Math.abs(C.v) * 0.32, 0, 16) : 0); c.fov = damp(c.fov || base, tf, 5, dt); if (Math.abs(camera.fov - c.fov) > 0.01) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
  const px = L.drive ? C.x : P.x, pz = L.drive ? C.z : P.z, qx = Math.round(px), qz = Math.round(pz); sun.position.set(qx + SUN_DIR.x * 90, SUN_DIR.y * 90, qz + SUN_DIR.z * 90); sun.target.position.set(qx, 0, qz);
}
/* ------------------------------ HUD: tags / minimap ----------------------- */
const _pv = new THREE.Vector3(), ltags = new Map();
function lifeTag(id, name, x, y, z, bub) {
  let e = ltags.get(id); if (!e) { e = document.createElement('div'); e.className = 'lf-tg'; e.innerHTML = '<i></i><b></b>'; LU.tags.appendChild(e); ltags.set(id, e); e._b = e.firstChild; e._n = e.lastChild; e._n.textContent = name; e._n.style.color = id === 'me' ? '#7dd3fc' : '#fff'; }
  _pv.set(x, y, z); const dist = camera.position.distanceTo(_pv); _pv.project(camera); const on = _pv.z < 1 && Math.abs(_pv.x) < 1.1 && Math.abs(_pv.y) < 1.1 && dist < 42;
  e.style.display = on ? 'block' : 'none'; if (!on) return; e.style.left = ((_pv.x * 0.5 + 0.5) * innerWidth) + 'px'; e.style.top = ((-_pv.y * 0.5 + 0.5) * innerHeight) + 'px'; e.style.opacity = dist > 28 ? 0.55 : 1;
  const b = bub && bub.t > G.t ? bub.text : ''; if (e._b._t !== b) { e._b._t = b; e._b.textContent = b; e._b.style.display = b ? '' : 'none'; }
}
function lifeHUD(dt) {
  const P = G.player, seen = new Set(['me']); if (!L.drive || true) lifeTag('me', PLAYER_NAME, L.drive ? L.car.x : P.x, (L.drive ? 2.6 : P.dispY + 2.35), L.drive ? L.car.z : P.z, L.bub.get('me'));
  for (const [id, r] of L.remotes) { seen.add(id); const f = r.f, same = r.d.room === L.room; if (!same) { const e = ltags.get(id); if (e) e.style.display = 'none'; continue; } const dr = r.d.drv && r.car; lifeTag(id, f.name, dr ? r.car.x : f.x, dr ? 2.6 : f.y + 2.35, dr ? r.car.z : f.z, L.bub.get(id)); }
  for (const [id, e] of ltags) if (!seen.has(id)) { e.remove(); ltags.delete(id); }
  if (L.drive) { const k = Math.round(Math.abs(L.car.v) * 3.6); if (LU.kmh._v !== k) { LU.kmh._v = k; LU.kmh.textContent = k; } }
  L.mapT = (L.mapT || 0) - dt; if (L.mapT > 0) return; L.mapT = 0.066; const g = mctx, S = 224, M = WORLD.mini; g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 6.3); g.clip(); g.fillStyle = '#10141f'; g.fillRect(0, 0, S, S);
  if (L.room !== 'world') { g.fillStyle = '#fde047'; g.font = '700 40px sans-serif'; g.textAlign = 'center'; g.fillText('🏠', S / 2, S / 2 + 4); g.font = '700 16px sans-serif'; g.fillText('At home', S / 2, S / 2 + 34); g.restore(); return; }
  const span = 120, ppm = M.width / (WORLD.mh * 2), cx = (G.player.x + WORLD.mh) * ppm, cz = (WORLD.mh - G.player.z) * ppm, sw = span * ppm; g.drawImage(M, cx - sw / 2, cz - sw / 2, sw, sw, 0, 0, S, S);
  const pm = (x, z) => [(x - P.x) / span * S + S / 2, -(z - P.z) / span * S + S / 2]; g.font = '16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (L.me.plot >= 0) { const p = PLOTS[L.me.plot], [x, y] = pm(p.x, p.z); g.fillText('🏠', x, y); }
  for (const p of PLOTS) if (L.plots[p.i]) { const [x, y] = pm(p.x, p.z); g.fillStyle = '#f87171'; g.beginPath(); g.arc(x, y, 3.2, 0, 6.3); g.fill(); }
  if (L.car) { const [x, y] = pm(L.car.x, L.car.z); g.fillText('🚗', x, y); }
  for (const r of L.remotes.values()) if (r.d.room === 'world') { const [x, y] = pm(r.f.x, r.f.z); g.fillStyle = '#38bdf8'; g.beginPath(); g.arc(x, y, 4.2, 0, 6.3); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
  g.translate(S / 2, S / 2); g.rotate(-(L.drive ? L.car.yaw : P.yaw) + Math.PI); g.fillStyle = '#fde047'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 9); g.lineTo(6.5, -7); g.lineTo(0, -3); g.lineTo(-6.5, -7); g.closePath(); g.fill(); g.stroke(); g.restore();
}
/* ------------------------------- flow ------------------------------------- */
let _lifeUI = false;
function startLife() {
  AU.init(); netLeave(); clearWorld(); if (!_lifeUI) { lifeInitUI(); _lifeUI = true; } lifeLoadMe();
  G.over = false; G.t = 0; G.paused = false; G.zoom = 0; G.lock = null; G.cam.pitch = 0.2; G.cam.recoil = 0; G.cam.len = undefined; L.room = 'world'; L.house = -1; L.drive = false; L.near = null; L.bub.clear(); L.camY = 0; L.panelOn = false;
  INT && INT.lights.forEach((l) => { l.intensity = 0; }); lifeClosePanel(); LU.dock.style.display = 'none'; LU.carb.style.display = 'none'; LU.spd.style.display = 'none';
  if (L.car) { carDrop(L.car); L.car = null; } LU.log.innerHTML = '';
  const P = new Fighter(PLAYER_NAME, true, null); G.player = P; P.setStance('relaxed'); P.relax = false; P.lastShot = -9;
  const own = L.me.plot >= 0 && PLOTS[L.me.plot], sp = own ? { x: PLOTS[L.me.plot].sx, z: PLOTS[L.me.plot].sz + PLOTS[L.me.plot].face * 1.2, yaw: PLOTS[L.me.plot].face > 0 ? 0 : Math.PI } : { x: 0, z: 14, yaw: Math.PI };
  P.spawnAt(sp.x, sp.z); P.yaw = sp.yaw; G.cam.yaw = sp.yaw;
  for (let i = 0; i < PLOTS.length; i++) plotRefresh(i);
  if (L.me.plot >= 0) { L.car = carMake(L.me.car.m, L.me.car.c, PLOTS[L.me.plot].x + 14.5 * PLOTS[L.me.plot].face * 0, PLOTS[L.me.plot].sz + PLOTS[L.me.plot].face * 7.5, PLOTS[L.me.plot].face > 0 ? Math.PI / 2 : -Math.PI / 2); L.car.x = PLOTS[L.me.plot].x + 9; carCol(L.car); L.car.grp.position.set(L.car.x, 0, L.car.z); }
  NET.on = U.online.querySelector('.on')?.dataset.o !== '0'; store.set('online', NET.on ? 1 : 0);
  for (const s of Object.values(U.screens)) s.classList.remove('on'); U.hud.classList.add('on'); if (TOUCH) U.touch.classList.add('on'); U.prompt.style.display = 'none';
  G.state = 'playing'; lifeJoin(); banner(L.me.plot >= 0 ? '🏠 Welcome home' : '🌆 Welcome to Get Better World', '#fde047'); if (L.me.plot < 0) lifeLog('<span class="sys">Find an empty house, walk to its door and press USE to claim it.</span>');
  try { if (TOUCH) { document.documentElement.requestFullscreen?.().catch(() => {}); screen.orientation?.lock?.('landscape').catch(() => {}); } } catch {}
}
function stepLife(dt) {
  G.t += dt; for (let i = timers.length - 1; i >= 0; i--) { const t = timers[i]; t.t -= dt; if (t.t <= 0) { timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } } }
  lifeControl(dt); lifeNetTick(dt); const P = G.player;
  for (const f of fighters) if (f !== G.showcase) f.update(dt);
  if (L.drive) { const C = L.car; P.x = C.x; P.z = C.z; P.y = 0; P.group.position.set(C.x, 0, C.z); P.group.visible = false; } else P.group.visible = true;
  lifeCamera(dt); lifeHUD(dt); fxUpdate(dt);
  for (const c of clouds) { c.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.004 * c.userData.sp); c.lookAt(0, 0, 0); }
}
addEventListener('pagehide', () => { try { lifeLeave(); } catch {} });

/* ========================================================================== */
/*  INPUT                                                                     */
/* ========================================================================== */
const keys = {}; let fireHeld = false, aimHeld = false, exhausted = false, idleT = 0;
const joy = { x: 0, y: 0, id: null }; const tb = { fire: false, aim: false };
const lookAcc = { x: 0, y: 0 };
const zoomLevel = () => (G.player && G.player.stance === 'rifle' ? Math.max(G.zoom, aimHeld ? 1 : 0) : 0);
G.zoom = 0;
const lookBy = (dx, dy, k, smooth) => { const P = G.player; if (!P || BOX) return; if (LIFE) L.lastLook = G.t; const s = k * G.sens * clamp(G.cam.fov / 72, 0.3, 1.15); if (smooth) { lookAcc.x += dx * s; lookAcc.y += dy * s; } else { G.cam.yaw -= dx * s; G.cam.pitch = clamp(G.cam.pitch - dy * s, -0.75, 1.1); } };
function lockPointer() { try { const r = U.canvas.requestPointerLock?.(); r && r.catch && r.catch(() => {}); } catch {} }
const playing = () => G.state === 'playing' && !G.paused && G.player;
const meleeKey = () => { const P = G.player; P.melee(P.stance === 'sword' ? 'sword' : 'punch'); };
function doUse() {
  if (G.veh) return exitTank(); { const tk = nearestTank(G.player, 4.8), pk0 = nearestPickup(G.player, 2.4, false); if (tk && !pk0 && G.player.alive) return enterTank(tk); }
  const P = G.player, p = nearestPickup(P, 2.4, false); if (!p || !P.alive) return;
  P.interact(() => { if (!p.taken) takePickup(p, P); });
}
function act(name) {
  const P = G.player; if (!playing() || !P.alive) return;
  if (LIFE) return lifeAct(name);
  if (G.veh && name !== 'use' && name !== 'view') return;
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
U.canvas.addEventListener('click', () => { if (!LIFE && !TOUCH && G.state === 'playing' && !G.paused && document.pointerLockElement !== U.canvas) lockPointer(); });
addEventListener('mousedown', (e) => { if (!playing() || document.pointerLockElement !== U.canvas) return; if (e.button === 0) fireHeld = true; if (e.button === 2) aimHeld = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) fireHeld = false; if (e.button === 2) aimHeld = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
let _wh = 0; addEventListener('wheel', (e) => { if (!TOUCH && playing() && performance.now() - _wh > 180) { _wh = performance.now(); act('zoom'); } }, { passive: true });
addEventListener('mousemove', (e) => { if (playing() && document.pointerLockElement === U.canvas) lookBy(e.movementX, e.movementY, 0.0022); });
document.addEventListener('pointerlockchange', () => { if (!LIFE && !TOUCH && G.state === 'playing' && !G.over && document.pointerLockElement !== U.canvas) setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'playing' && !G.over) setPaused(true); });
// touch: joystick
(function touchUI() {
  const base = U.joy.querySelector('.base'), knob = U.joy.querySelector('.knob'); let cx = 0, cy = 0;
  U.joy.addEventListener('pointerdown', (e) => { if (joy.id !== null) return; joy.id = e.pointerId; U.joy.setPointerCapture(e.pointerId); const r = U.joy.getBoundingClientRect(); cx = e.clientX; cy = e.clientY; base.style.display = 'block'; base.style.left = (cx - r.left - 64) + 'px'; base.style.top = (cy - r.top - 64) + 'px'; knob.style.transform = ''; });
  U.joy.addEventListener('pointermove', (e) => { if (e.pointerId !== joy.id) return; let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy), R = 56; if (l > R) { dx = dx / l * R; dy = dy / l * R; } joy.x = dx / R; joy.y = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`; });
  const up = (e) => { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; base.style.display = 'none'; };
  U.joy.addEventListener('pointerup', up); U.joy.addEventListener('pointercancel', up);
  let lid = null, lx = 0, ly = 0;   // look: drag anywhere on the right side (even between buttons), like Free Fire
  addEventListener('pointerdown', (e) => { if (!TOUCH || lid !== null || !playing() || e.target.closest('.cc-btn,.cc-pause,.cc-joy,.cc-screen,.lf-ui,.lf-panel')) return; if (e.clientX < innerWidth * 0.36) return; lid = e.pointerId; lx = e.clientX; ly = e.clientY; });
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
  if (G.veh) { vehControl(dt); const t = G.veh; U.prompt.style.display = 'block'; setT(U.prompt, TOUCH ? 'Tap USE to exit tank' : 'E  ·  Exit tank'); if (U.btn.use) U.btn.use.style.display = TOUCH ? 'flex' : 'none'; return; }
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
  const pk = nearestPickup(P, 2.4, false), tk = nearestTank(P, 4.8);
  if (!pk && tk) { U.prompt.style.display = 'block'; setT(U.prompt, TOUCH ? 'Tap USE: Drive tank' : 'E  ·  Drive tank'); if (U.btn.use) U.btn.use.style.display = TOUCH ? 'flex' : 'none'; return; }
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
  G.fp = !!(G.fpv && P.alive && !G.over && P.stance !== 'sword' && !G.veh); try { if (!G.fp) fpHead(P, false); fpSetLayers(P, G.fp && !BOX); } catch (e) { console.error('fp', e); }
  const d = camDir(c.yaw, pit), rx = -Math.cos(c.yaw), rz = Math.sin(c.yaw);
  const px = P.x, py = P.dispY + 1.5 + (P.rollT > 0 ? -0.5 : 0), pz = P.z;
  const ox = px + rx * shoulder, oy = py, oz = pz + rz * shoulder;
  if (G.fp) {
    let ex = P.x + d.x * 0.1, ey = P.dispY + 1.62 + (P.rollT > 0 ? -0.55 : 0), ez = P.z + d.z * 0.1;
    if (c.fx === undefined || Math.hypot(c.fx - ex, c.fz - ez) > 1.5) { c.fx = ex; c.fy = ey; c.fz = ez; } else { c.fx = damp(c.fx, ex, 38, dt); c.fy = damp(c.fy, ey, 22, dt); c.fz = damp(c.fz, ez, 38, dt); } ex = c.fx; ey = c.fy; ez = c.fz; c.shake = damp(c.shake, 0, 9, dt); const shk = c.shake * 0.02;
    camera.position.set(ex + rnd(-shk, shk), ey + rnd(-shk, shk), ez + rnd(-shk, shk)); camera.rotation.order = 'YXZ'; camera.rotation.set(pit, c.yaw + Math.PI, 0); c.dist = 0.4; c.len = undefined;
    try { fpFrame(P, dt, camera.position, c.yaw, pit); } catch (e) { console.error('fp', e); G.fpv = false; }
  } else if (G.veh) { VM.grp.visible = false; c.fx = undefined; vehCamera(dt, d, pit);
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
  if (G.veh) { setT(U.mag, G.veh.cool > 0 ? '…' : '●'); setT(U.res, `HP ${Math.ceil(G.veh.hp)}`); setT(U.wname, 'Tank cannon'); setW(U.ar, G.veh.hp / G.veh.max * 100); }
  U.mag.parentElement.classList.toggle('empty', !G.veh && P.stance === 'rifle' && P.mag === 0);
  const t = Math.max(0, Math.ceil(Z.timer)), zt = Z.state === 'final' ? 'FINAL' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  setT(U.zone, zt); setT(U.zonel, Z.state === 'shrink' ? 'closing' : Z.state === 'final' ? 'zone' : 'next'); U.zonep.classList.toggle('warn', Z.state === 'shrink' || Math.hypot(P.x - Z.cx, P.z - Z.cz) > Z.r);
  const sp = (P.aiming ? 0 : 3) + (P.speed / CFG.RUN) * 8 + G.bloom * 600 + (P.grounded ? 0 : 8); U.xh.style.setProperty('--s', sp.toFixed(1) + 'px'); U.xh.classList.toggle('ads', P.aiming);
  if (G.lock && G.lock.alive) { const s = toScreen(G.lock.x, G.lock.y + 1.3, G.lock.z); U.lock.style.display = s.v ? 'block' : 'none'; U.lock.style.left = s.x + 'px'; U.lock.style.top = s.y + 'px'; } else U.lock.style.display = 'none';
  // minimap (every other frame)
  if ((mapTick++ & 1) === 0) {
    const g = mctx, W = U.map.width, S = 1.45;
    g.save(); g.clearRect(0, 0, W, W); g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, 6.283); g.clip();
    g.translate(W / 2, W / 2); g.rotate(-G.cam.yaw); g.scale(S, S); g.translate(-P.x, P.z);
    { const mh = WORLD.mh || 62; g.drawImage(WORLD.mini, -mh, -mh, mh * 2, mh * 2); }
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
  if (LIFE) return startLife();
  if (BOX) return startBoxing();
  AU.init(); netLeave(); clearWorld(); resetTanks(); G.total = 0; G._winT = 0; NET.fs = 0; NET.evs = 0; NET.ev = ''; G.over = false; G.t = 0; G.paused = false; G.streak = 0; G.lastKillT = -9; G.bloom = 0; exhausted = false; idleT = 0;
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
  if (!p && !TOUCH && !LIFE) lockPointer();
}
function toMenu() { netLeave(); if (LIFE) lifeLeave(); try { parent !== window && parent.postMessage({ type: 'gb-game-exit' }, '*'); } catch {} if (parent === window) location.href = qs.get('back') || './'; }
U.pause.addEventListener('click', () => setPaused(true)); U.resume.addEventListener('click', () => setPaused(false));
U.quit.addEventListener('click', () => { G.over = true; netLeave(); if (LIFE) lifeLeave(); try { document.exitPointerLock?.(); } catch {} toMenu(); });
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
  const sc = new Fighter('Hero', false, null); G.showcase = sc; sc.spawnAt(0, BOX ? 0 : 15); sc.yaw = Math.PI; sc.relax = true; sc.setStance(LIFE ? 'relaxed' : BOX ? 'fist' : 'rifle'); if (BOX) sc.glove('#e11d48');
  const loop = () => { if (G.showcase === sc) { sc.wave(); setTimeout(loop, 4200); } }; setTimeout(loop, 900);
}
function menuCam(dt) {
  G.menuA = (G.menuA || 0) + dt * 0.18; const a = G.menuA, cx = 0, cz = BOX ? 0 : 15;
  camera.position.set(cx + Math.sin(a) * 6.5, 2.1 + Math.sin(a * 0.7) * 0.25, cz + Math.cos(a) * 6.5); camera.lookAt(cx, 1.25, cz);
  camera.rotation.order = 'XYZ'; if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
  sun.position.set(SUN_DIR.x * 90, SUN_DIR.y * 90, 15 + SUN_DIR.z * 90); sun.target.position.set(0, 0, cz);
}
function step(dt) {
  if (LIFE) return stepLife(dt);
  if (BOX) return stepBox(dt);
  G.t += dt; for (let i = timers.length - 1; i >= 0; i--) { const t = timers[i]; t.t -= dt; if (t.t <= 0) { timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } } }
  playerControl(dt);
  { let n = 0; for (const f of fighters) if (f.alive && f !== G.showcase) n++; G.alive = n; G.total = Math.max(G.total || 0, fighters.length); if (n === 1 && G.player.alive && !G.over && !G._winT) { G._winT = 1; later(1.4, () => endMatch(true)); } }
  netTick(dt);
  for (const f of fighters) if (f.ai && f.alive) botThink(f, dt);
  for (const f of fighters) f.update(dt);
  vehStep(dt);
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
  { const t = document.createElement('div'); t.textContent = 'build v38 · ' + (LIFE ? 'world' : BOX ? 'boxing' : 'compound'); t.style.cssText = 'position:fixed;left:8px;bottom:4px;font:10px sans-serif;color:#fff;opacity:.35;z-index:5;pointer-events:none'; document.body.appendChild(t); }
  if (LIFE) buildCity(); else if (BOX) buildArena(); else { buildTown(); buildTanks(); } requestAnimationFrame(frame);
  if (TOUCH && innerHeight > innerWidth) U.loadt.insertAdjacentHTML('afterend', '<p style="color:#fde047;font-size:14px">📱 Turn your phone sideways for the best view.</p>');
  U.sensrow.style.display = 'flex'; U.menurow.style.display = 'flex'; U.menurow2.style.display = 'flex'; U.menurow3.style.display = 'flex'; if (!NET.on) { U.online.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.o === '0')); }
  await loadAssets(); if (BOX) bxInitUI(); else if (LIFE) { lifeInitUI(); _lifeUI = true; } G.state = 'menu'; showcaseInit(); U.play.style.display = ''; U.load.parentElement.style.display = 'none'; U.loadt.style.display = TOUCH || ASSETS.soldier ? 'none' : '';
  if (NET.on && !qs.get('auto')) netInit();
  if (qs.get('auto')) startMatch();
})();
window.__cc = { L, LN, PLOTS, CARS, lifeUse, lifeEnterHouse, lifeClaim, lifeCallCar, lifeEnterCar, lifeExitCar, lifeMenu, TANKS, keys, enterTank, exitTank, tankFire, G, fighters, COL, scene, camera, renderer, startMatch, step, WORLD, Z, pickups, act, NET, rayWorld, playerFire, damage, Fighter };
