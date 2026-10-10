import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  addDoc, collection, deleteDoc, doc, increment, onSnapshot, query,
  serverTimestamp, setDoc, updateDoc, where,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { avatarFor, db, state } from "./app.js";

const GAME_ID = "killers-ops";
const MAP_HALF = 200;
const PLAYER_RADIUS = 0.55;
const PLAYER_HEIGHT = 1.8;
const FIRE_RATE_MS = 155;
const MAGAZINE_SIZE = 30;
const MAX_HEALTH = 100;
const BUILDING_MODELS = [
  "building-a.glb", "building-b.glb", "building-c.glb", "building-d.glb",
  "building-e.glb", "building-f.glb", "building-g.glb", "building-h.glb",
  "building-i.glb", "building-j.glb", "building-k.glb", "building-l.glb",
  "building-m.glb", "building-n.glb", "building-o.glb", "building-p.glb",
  "building-q.glb", "building-r.glb", "building-s.glb", "building-t.glb",
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const playerName = (profile) => profile?.username
  ? `@${String(profile.username).replace(/^@/, "")}`
  : profile?.name || "Orbit player";

function makeIcon(name) {
  const paths = {
    crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
    reload: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/>',
    sprint: '<path d="m13 5 3 2-2 3-3-1-2 4 4 2 1 5m-8-1 3-5m7-10a2 2 0 1 0 0 .01"/>',
    exit: '<path d="M10 17l5-5-5-5m5 5H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/>',
    fire: '<path d="M12 22c4.4 0 7-3 7-7 0-3.3-2-5.6-4-7-.2 2-1.1 3.3-2.5 4.3C12.4 8.4 10.6 5 8 2 8 7 5 9.6 5 15c0 4.1 2.8 7 7 7Z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.crosshair}</svg>`;
}

function haptic(ms = 18) {
  try { navigator.vibrate?.(ms); } catch {}
}

class KillersOps {
  constructor(stage, profile) {
    this.stage = stage;
    this.profile = profile || {};
    this.uid = state.uid || state.me?.uid || null;
    this.name = playerName(this.profile);
    this.photoURL = avatarFor(this.profile);
    this.avatarModelUrl = this.profile.avatarModelUrl || null;
    this.running = true;
    this.active = false;
    this.dead = false;
    this.health = MAX_HEALTH;
    this.ammo = MAGAZINE_SIZE;
    this.reserve = 150;
    this.kills = 0;
    this.streak = 0;
    this.lastDamagedBy = null;
    this.lastShotAt = 0;
    this.lastHitIds = new Set();
    this.players = new Map();
    this.remoteModels = new Map();
    this.buildings = [];
    this.buildingModels = new Map();
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.yaw = Math.PI;
    this.pitch = -0.04;
    this.pos = new THREE.Vector3(0, 0, 24);
    this.velocity = new THREE.Vector3();
    this.lastFrame = performance.now();
    this.lastHeartbeat = 0;
    this.reloadUntil = 0;
    this.reloading = false;
    this.fireHeld = false;
    this.isAiming = false;
    this.sprinting = false;
    this.subscriptions = [];
    this.audio = null;
    this.cleanupFns = [];
    this.temp = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.photoTextures = new Map();
    this.buildInterface();
    this.makeScene();
    this.makeLocalAvatar();
    this.makeWeapon();
    this.buildCity();
    this.bindControls();
    this.watchFirebase();
    this.resize();
    this.frame();
    this.loadOptionalAssets();
  }

  buildInterface() {
    this.stage.innerHTML = `
      <div class="ko-game">
        <div class="ko-scene" id="koScene"></div>
        <div class="ko-vignette" id="koVignette"></div>
        <div class="ko-hud">
          <header class="ko-top">
            <button class="ko-icon-btn ko-exit" id="koExit" aria-label="Leave game">${makeIcon("exit")}</button>
            <div class="ko-brand"><span class="ko-live-dot"></span><span>ORBIT ARENA</span><b>FREE-FOR-ALL</b></div>
            <div class="ko-online"><span id="koOnline">1</span> <small>ONLINE</small></div>
          </header>
          <div class="ko-match-strip">
            <span class="ko-match-label">KILLERS OPS</span><span class="ko-match-sep"></span>
            <span><i>ELIMS</i><b id="koKills">0</b></span><span><i>STREAK</i><b id="koStreak">0</b></span>
            <span class="ko-score-leader" id="koLeader">DROP IN · SURVIVE · ELIMINATE</span>
          </div>
          <div class="ko-crosshair" id="koCrosshair"><i></i><i></i><i></i><i></i><b></b></div>
          <div class="ko-hitmarker" id="koHitmarker">×</div>
          <div class="ko-feed" id="koFeed"></div>
          <div class="ko-banner" id="koBanner"></div>
          <div class="ko-minimap-wrap"><canvas id="koMap" width="160" height="160"></canvas><span>SECTOR 04</span></div>
          <div class="ko-health">
            <div class="ko-health-head"><span>ARMOR</span><b id="koHealthText">100</b></div>
            <div class="ko-health-track"><i id="koHealthBar"></i></div>
          </div>
          <div class="ko-ammo"><div><b id="koAmmo">${MAGAZINE_SIZE}</b><span> / <i id="koReserve">150</i></span></div><small>5.56 MM · ASSAULT RIFLE</small></div>
          <div class="ko-controls">
            <div class="ko-joystick" id="koJoystick"><div id="koJoyThumb"></div></div>
            <div class="ko-action-stack">
              <button class="ko-action-btn ko-reload" id="koReload" aria-label="Reload">${makeIcon("reload")}<small>RELOAD</small></button>
              <button class="ko-action-btn ko-sprint" id="koSprint" aria-label="Sprint">${makeIcon("sprint")}<small>SPRINT</small></button>
              <button class="ko-fire-btn" id="koFire" aria-label="Fire weapon">${makeIcon("fire")}<small>FIRE</small></button>
            </div>
          </div>
          <div class="ko-help"><kbd>WASD</kbd> MOVE <kbd>SHIFT</kbd> SPRINT <kbd>R</kbd> RELOAD <kbd>CLICK</kbd> FIRE <kbd>ESC</kbd> EXIT</div>
        </div>
        <div class="ko-start-screen" id="koStart">
          <div class="ko-start-card">
            <div class="ko-start-mark">KO</div><div class="ko-kicker">ORBIT ORIGINAL · GAME 01</div>
            <h1>KILLERS <span>OPS</span></h1>
            <p>Drop into the city, find your sightline, and outplay the lobby.</p>
            <div class="ko-player-chip"><img id="koStartAvatar" alt=""><span><b id="koStartName"></b><small>ORBIT OPERATOR</small></span><i>READY</i></div>
            <div class="ko-loadout"><span>PRIMARY</span><b>ASSAULT RIFLE</b><span class="ko-loadout-icon">${makeIcon("crosshair")}</span></div>
            <button class="ko-deploy" id="koDeploy">DEPLOY <span>→</span></button>
            <div class="ko-start-note">MULTIPLAYER ARENA · PORTRAIT DEVICES ROTATE TO LANDSCAPE</div>
            <button class="ko-close-start" id="koCloseStart">BACK TO GAMES</button>
          </div>
        </div>
        <div class="ko-death-screen" id="koDeath" hidden>
          <div class="ko-death-card"><small>OPERATOR DOWN</small><h2>ELIMINATED</h2><p>Back into the fight in <b id="koRespawnTimer">3</b></p><button id="koRespawn">RESPAWN</button></div>
        </div>
        <div class="ko-toast" id="koToast" aria-live="polite"></div>
      </div>`;
    this.game = this.stage.querySelector(".ko-game");
    this.sceneHost = this.stage.querySelector("#koScene");
    this.avatarImg = this.stage.querySelector("#koStartAvatar");
    this.avatarImg.src = this.photoURL;
    this.stage.querySelector("#koStartName").textContent = this.name;
    this.ui = Object.fromEntries([
      "koOnline", "koKills", "koStreak", "koLeader", "koHitmarker", "koFeed", "koBanner",
      "koHealthText", "koHealthBar", "koAmmo", "koReserve", "koMap", "koStart", "koDeath",
      "koRespawnTimer", "koToast", "koCrosshair", "koVignette", "koJoyThumb",
    ].map((id) => [id, this.stage.querySelector(`#${id}`)]));
    this.minimap = this.ui.koMap.getContext("2d");
  }

  makeScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x91b5ce);
    this.scene.fog = new THREE.FogExp2(0xa4bfca, 0.0026);
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.08, 800);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: false, powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.setSize(100, 100);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.sceneHost.appendChild(this.renderer.domElement);
    this.sceneHost.querySelector("canvas").setAttribute("aria-label", "Killers Ops 3D game view");
    this.scene.add(new THREE.HemisphereLight(0xd8e8f1, 0x364238, 2.15));
    const sun = new THREE.DirectionalLight(0xffe4bd, 3.15);
    sun.position.set(-70, 120, 65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -115;
    sun.shadow.camera.right = 115;
    sun.shadow.camera.top = 115;
    sun.shadow.camera.bottom = -115;
    sun.shadow.camera.far = 300;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x84bdf1, 1.0);
    fill.position.set(60, 35, -80);
    this.scene.add(fill);
    this.camera.position.set(0, 3, 29);
  }

  makeGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0x525c52, roughness: 0.96 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x30363a, roughness: 0.9 });
    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xd7bf83, roughness: 0.8 });
    for (let c = 0; c <= 10; c++) {
      const x = -190 + c * 38;
      this.addRoad(6, 400, x, 0, roadMaterial);
      for (let z = -190; z < 195; z += 14) this.addRoad(0.13, 3.1, x, z, lineMaterial);
    }
    for (let r = 0; r <= 8; r++) this.addRoad(400, 6, 0, -168 + r * 42, roadMaterial);
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xb7b3a6, roughness: 0.8 });
    for (let c = 0; c < 10; c++) {
      const x = -171 + c * 38;
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 36), curbMat);
      curb.position.set(x, 0.08, 0);
      curb.receiveShadow = true;
      this.scene.add(curb);
    }
  }

  addRoad(w, d, x, z, mat) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.014, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  createBuilding(x, z, seed) {
    const rnd = (n) => {
      const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const width = 9 + rnd(1) * 6;
    const depth = 9 + rnd(2) * 7;
    const floors = 2 + Math.floor(rnd(3) * 4);
    const height = floors * 3.7;
    const palette = [0x626d72, 0x8c8071, 0x637369, 0x777779, 0x9a8772, 0x506478];
    const wall = new THREE.MeshStandardMaterial({ color: palette[Math.floor(rnd(4) * palette.length)], roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x30383d, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x81a6ad, roughness: 0.25, metalness: 0.22, emissive: 0x1a3037 });
    const group = new THREE.Group();
    const main = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wall);
    main.position.y = height / 2;
    main.castShadow = main.receiveShadow = true;
    group.add(main);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, 0.35, depth + 0.5), trim);
    roof.position.y = height + 0.16;
    roof.castShadow = true;
    group.add(roof);
    const rowCount = Math.max(1, floors - 1);
    const windowGeometry = new THREE.BoxGeometry(0.8, 1.1, 0.11);
    for (let floor = 0; floor < rowCount; floor++) {
      const y = 2.15 + floor * 3.7;
      for (const side of [-1, 1]) {
        for (let i = -1; i <= 1; i++) {
          const win = new THREE.Mesh(windowGeometry, glass);
          win.position.set(i * width * 0.27, y, side * (depth / 2 + 0.055));
          group.add(win);
        }
        const sideWindow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.8), glass);
        sideWindow.position.set(side * (width / 2 + 0.055), y, 0);
        group.add(sideWindow);
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.12), trim);
    door.position.set(0, 1.2, depth / 2 + 0.07);
    group.add(door);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.5, 0.14),
      new THREE.MeshStandardMaterial({ color: [0x9f683c, 0x7269a0, 0x4e827e, 0x9b5149][seed % 4], emissive: 0x211812 }),
    );
    sign.position.set(0, 2.85, depth / 2 + 0.08);
    group.add(sign);
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.95, 1.4, 10),
      new THREE.MeshStandardMaterial({ color: 0x666e71, metalness: 0.45, roughness: 0.48 }),
    );
    tank.position.set(width * 0.28, height + 1.0, -depth * 0.2);
    tank.castShadow = true;
    group.add(tank);
    group.position.set(x, 0, z);
    group.rotation.y = (seed % 4) * Math.PI / 2;
    this.scene.add(group);
    const box = new THREE.Box3().setFromObject(main);
    box.expandByScalar(0.6);
    const building = { group, box, x, z, width, depth, height, seed };
    this.buildings.push(building);
    return building;
  }

  buildCity() {
    this.makeGround();
    let seed = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 10; col++) {
        seed += 1;
        const x = -171 + col * 38 + Math.sin(seed * 5) * 1.9;
        const z = -147 + row * 42 + Math.cos(seed * 2.3) * 2;
        const building = this.createBuilding(x, z, seed);
        building.assetName = BUILDING_MODELS[(seed - 1) % BUILDING_MODELS.length];
      }
    }
    this.createCover();
    this.createPickups();
    this.makeGroundDecals();
  }

  createCover() {
    for (let i = 0; i < 24; i++) {
      const group = new THREE.Group();
      const color = [0x415a64, 0x7d533f, 0x56745b, 0x77796c][i % 4];
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(5.5, 2.3, 2.6),
        new THREE.MeshStandardMaterial({ color, metalness: 0.16, roughness: 0.72 }),
      );
      body.position.y = 1.15;
      body.castShadow = body.receiveShadow = true;
      group.add(body);
      for (let j = 0; j < 3; j++) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(5.54, 0.09, 2.65),
          new THREE.MeshStandardMaterial({ color: 0xc0b6a1, roughness: 0.65 }),
        );
        stripe.position.set(0, 0.45 + j * 0.55, 0);
        group.add(stripe);
      }
      const x = ((i * 71) % 340) - 170;
      const z = ((i * 43) % 300) - 150;
      group.position.set(x, 0, z);
      group.rotation.y = (i % 4) * Math.PI / 2;
      this.scene.add(group);
    }
    for (let i = 0; i < 34; i++) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.28, 2.4, 7),
        new THREE.MeshStandardMaterial({ color: 0x594736, roughness: 0.9 }),
      );
      const leaves = new THREE.Mesh(
        new THREE.ConeGeometry(1.5, 3.5, 7),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x425b47 : 0x526a48, roughness: 0.88 }),
      );
      const x = ((i * 83) % 365) - 182;
      const z = ((i * 47) % 365) - 182;
      trunk.position.set(x, 1.2, z);
      leaves.position.set(x, 3.2, z);
      trunk.castShadow = leaves.castShadow = true;
      this.scene.add(trunk, leaves);
    }
  }

  makeGroundDecals() {
    const marks = new THREE.Group();
    for (let i = 0; i < 70; i++) {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.5 + (i % 5) * 0.25, 7),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0x494d45 : 0x65665c, transparent: true, opacity: 0.2 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(((i * 37) % 390) - 195, 0.024, ((i * 61) % 390) - 195);
      marks.add(mesh);
    }
    this.scene.add(marks);
  }

  createPickups() {
    this.pickups = [];
    for (let i = 0; i < 16; i++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.72, 0.75),
        new THREE.MeshStandardMaterial({ color: 0x9e6d3e, metalness: 0.2, roughness: 0.62, emissive: 0x17100a }),
      );
      const lid = new THREE.Mesh(
        new THREE.BoxGeometry(1.04, 0.12, 0.79),
        new THREE.MeshStandardMaterial({ color: 0xcca66a, metalness: 0.25, roughness: 0.45 }),
      );
      const group = new THREE.Group();
      box.position.y = 0.42;
      lid.position.y = 0.82;
      group.add(box, lid);
      group.position.set(((i * 93) % 330) - 165, 0, ((i * 67) % 290) - 145);
      group.userData.ammo = 28;
      this.scene.add(group);
      this.pickups.push(group);
    }
  }

  async loadOptionalAssets() {
    const loader = new GLTFLoader();
    const selected = [...new Set([BUILDING_MODELS[0], BUILDING_MODELS[3], BUILDING_MODELS[6], BUILDING_MODELS[9], BUILDING_MODELS[12], BUILDING_MODELS[15]])];
    for (const path of selected) {
      if (!this.running) return;
      try {
        const gltf = await new Promise((resolve, reject) => loader.load(path, resolve, undefined, reject));
        gltf.scene.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        this.buildingModels.set(path, gltf.scene);
        const matching = this.buildings.filter((b) => b.assetName === path);
        matching.forEach((building, index) => this.swapInBuilding(building, gltf.scene, index));
      } catch {
        // The source game's GLBs are optional; the bundled procedural city is the fallback.
      }
    }
    try {
      const gltf = await new Promise((resolve, reject) => loader.load("Rifle.glb", resolve, undefined, reject));
      if (this.running) this.swapWeapon(gltf.scene);
    } catch {
      // Use the built-in rifle model when Rifle.glb isn't beside the app.
    }
    try {
      const gltf = await new Promise((resolve, reject) => loader.load("Soldier.glb", resolve, undefined, reject));
      if (this.running && gltf.scene) this.soldierTemplate = gltf.scene;
    } catch {
      // Character cards and procedural operators need no extra download.
    }
  }

  swapInBuilding(building, model, index) {
    if (!this.running || !building.group.parent) return;
    const clone = model.clone(true);
    const raw = new THREE.Box3().setFromObject(clone);
    const size = raw.getSize(new THREE.Vector3());
    if (size.y > 0) clone.scale.setScalar(building.height / size.y);
    const box = new THREE.Box3().setFromObject(clone);
    clone.position.y -= box.min.y;
    clone.rotation.y = ((building.seed + index) % 4) * Math.PI / 2;
    clone.position.x = building.x;
    clone.position.z = building.z;
    clone.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = true;
      }
    });
    this.scene.remove(building.group);
    this.scene.add(clone);
    building.group = clone;
    building.box = new THREE.Box3().setFromObject(clone).expandByScalar(0.55);
  }

  makeAvatar(display, isLocal = false) {
    const group = new THREE.Group();
    const profile = display.profile || {};
    const bodyMat = new THREE.MeshStandardMaterial({
      color: isLocal ? 0x414d59 : 0x48555f, roughness: 0.7, metalness: 0.12,
    });
    const vestMat = new THREE.MeshStandardMaterial({
      color: display.teamColor || (isLocal ? 0x735baf : 0x995a48), roughness: 0.66, metalness: 0.12,
    });
    const bootsMat = new THREE.MeshStandardMaterial({ color: 0x292c30, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.43, 0.56, 4, 9), bodyMat);
    torso.position.y = 1.05;
    torso.castShadow = torso.receiveShadow = true;
    torso.userData.isDefaultBody = true;
    group.add(torso);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.68, 0.38), vestMat);
    vest.position.set(0, 1.18, -0.06);
    vest.castShadow = true;
    vest.userData.isDefaultBody = true;
    group.add(vest);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xc6a78a, roughness: 0.87 }),
    );
    head.position.y = 1.75;
    head.castShadow = true;
    head.userData.isDefaultBody = true;
    group.add(head);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.46, 3, 7), bodyMat);
      leg.position.set(side * 0.19, 0.38, 0);
      leg.castShadow = true;
      leg.userData.isDefaultBody = true;
      group.add(leg);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.48, 3, 7), vestMat);
      arm.position.set(side * 0.45, 1.17, -0.04);
      arm.rotation.z = side * -0.2;
      arm.castShadow = true;
      arm.userData.isDefaultBody = true;
      group.add(arm);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.17, 0.42), bootsMat);
      boot.position.set(side * 0.19, 0.11, 0.045);
      boot.userData.isDefaultBody = true;
      group.add(boot);
    }
    if (!profile.avatarModelUrl) {
      const photo = this.makePhotoSprite(profile.photoURL || avatarFor(profile));
      photo.position.set(0, 1.78, 0.255);
      photo.scale.set(0.42, 0.42, 1);
      photo.userData.isAvatarPortrait = true;
      group.add(photo);
    }
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.025, 5, 32),
      new THREE.MeshBasicMaterial({ color: display.teamColor || (isLocal ? 0xa78bfa : 0xff8c6b) }),
    );
    ring.position.set(0, 1.78, 0.27);
    ring.userData.isAvatarRing = true;
    group.add(ring);
    const gun = this.makeRifle();
    gun.userData.isWeapon = true;
    gun.position.set(0.34, 1.18, -0.35);
    gun.rotation.x = 0.02;
    group.add(gun);
    group.userData.displayName = display.name || "Operator";
    group.userData.uid = display.uid || "";
    group.userData.photo = profile.photoURL || "";
    if (profile.avatarModelUrl) {
      group.visible = false;
      this.loadAvatarModel(group, profile.avatarModelUrl);
    }
    return group;
  }

  loadAvatarModel(group, url) {
    if (!url || !/^(https?:\/\/|\/|\.\/)/i.test(url)) return;
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      if (!this.running) return;
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      if (size.y > 0) model.scale.setScalar(1.78 / size.y);
      const scaled = new THREE.Box3().setFromObject(model);
      model.position.y -= scaled.min.y;
      model.traverse((n) => {
        if (n.isMesh) {
          n.castShadow = true;
          n.receiveShadow = true;
        }
      });
      group.children
        .filter((child) => child.userData.isDefaultBody || child.userData.isAvatarPortrait || child.userData.isAvatarRing)
        .forEach((child) => {
          group.remove(child);
          child.geometry?.dispose?.();
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => material.dispose?.());
          }
        });
      group.add(model);
      group.visible = true;
    }, undefined, () => {
      if (group.parent) group.visible = true;
    });
  }

  makePhotoSprite(url) {
    const texture = new THREE.TextureLoader().load(url || avatarFor({ uid: this.uid }));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    this.photoTextures.set(url, texture);
    return sprite;
  }

  makeLocalAvatar() {
    this.localAvatar = this.makeAvatar({
      uid: this.uid, name: this.name,
      profile: { ...this.profile, uid: this.uid, photoURL: this.photoURL },
      teamColor: 0x806cff,
    }, true);
    this.localAvatar.position.copy(this.pos);
    this.scene.add(this.localAvatar);
  }

  makeRifle() {
    const rifle = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x20272a, metalness: 0.76, roughness: 0.27 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x3a413e, metalness: 0.22, roughness: 0.62 });
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.45, 10), metal);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = -0.38;
    rifle.add(muzzle);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.17, 0.42), polymer);
    receiver.position.z = -0.04;
    rifle.add(receiver);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.22), polymer);
    stock.position.set(0, -0.02, 0.25);
    rifle.add(stock);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.11), metal);
    grip.position.set(0, -0.14, 0.04);
    rifle.add(grip);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.11), metal);
    sight.position.set(0, 0.115, -0.02);
    rifle.add(sight);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.19, 0.12), polymer);
    mag.position.set(0, -0.17, -0.07);
    mag.rotation.x = -0.12;
    rifle.add(mag);
    rifle.traverse((n) => { if (n.isMesh) n.castShadow = true; });
    return rifle;
  }

  makeWeapon() {
    this.weapon = this.makeRifle();
  }

  swapWeapon(template) {
    if (!this.running || !template) return;
    const raw = new THREE.Box3().setFromObject(template);
    const size = raw.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (longest > 0) template.scale.setScalar(0.9 / longest);
    const box = new THREE.Box3().setFromObject(template);
    template.position.sub(box.getCenter(new THREE.Vector3()));
    this.weapon = template;
    this.localAvatar.children.forEach((child) => {
      if (child.userData?.isWeapon) this.localAvatar.remove(child);
    });
    const gun = template.clone(true);
    gun.userData.isWeapon = true;
    gun.position.set(0.34, 1.18, -0.35);
    this.localAvatar.add(gun);
  }

  loadPhotoTexture(url) {
    const key = url || avatarFor({ uid: "operator" });
    return this.photoTextures.get(key) || null;
  }

  bindControls() {
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this.cleanupFns.push(() => target.removeEventListener(type, handler, options));
    };
    const joystick = this.stage.querySelector("#koJoystick");
    const thumb = this.ui.koJoyThumb;
    let joyPointer = null;
    const moveJoy = (event) => {
      const rect = joystick.getBoundingClientRect();
      const dx0 = event.clientX - (rect.left + rect.width / 2);
      const dy0 = event.clientY - (rect.top + rect.height / 2);
      const length = Math.hypot(dx0, dy0);
      const dx = length > 42 ? dx0 * 42 / length : dx0;
      const dy = length > 42 ? dy0 * 42 / length : dy0;
      thumb.style.transform = `translate(${dx}px, ${dy}px)`;
      this.move.x = clamp(dx / 42, -1, 1);
      this.move.y = clamp(-dy / 42, -1, 1);
    };
    on(joystick, "pointerdown", (event) => {
      if (!this.active || joyPointer !== null) return;
      event.preventDefault();
      joyPointer = event.pointerId;
      joystick.setPointerCapture?.(event.pointerId);
      moveJoy(event);
    });
    on(joystick, "pointermove", (event) => {
      if (event.pointerId === joyPointer) moveJoy(event);
    });
    const endJoy = (event) => {
      if (event.pointerId !== joyPointer) return;
      joyPointer = null;
      this.move.x = this.move.y = 0;
      thumb.style.transform = "";
    };
    on(joystick, "pointerup", endJoy);
    on(joystick, "pointercancel", endJoy);

    const canvas = this.renderer.domElement;
    let aimPointer = null;
    let lastLook = null;
    on(canvas, "pointerdown", (event) => {
      if (!this.active) return;
      if (event.pointerType === "touch") {
        aimPointer = event.pointerId;
        lastLook = { x: event.clientX, y: event.clientY };
        canvas.setPointerCapture?.(event.pointerId);
        return;
      }
      if (event.pointerType === "mouse") {
        if (event.button === 2) {
          this.isAiming = true;
        } else if (event.button === 0) {
          this.fireHeld = true;
          this.shoot();
        } else return;
      }
      aimPointer = event.pointerId;
      lastLook = { x: event.clientX, y: event.clientY };
      if (event.pointerType !== "mouse") canvas.setPointerCapture?.(event.pointerId);
    });
    on(canvas, "pointermove", (event) => {
      if (!this.active) return;
      if (document.pointerLockElement === canvas) {
        this.turn(event.movementX, event.movementY);
      } else if (event.pointerId === aimPointer && lastLook) {
        const dx = event.clientX - lastLook.x;
        const dy = event.clientY - lastLook.y;
        this.turn(dx, dy);
        lastLook = { x: event.clientX, y: event.clientY };
      }
    });
    const endAim = (event) => {
      if (event.pointerId === aimPointer) {
        aimPointer = null;
        lastLook = null;
      }
      if (event.pointerType === "mouse") {
        this.fireHeld = false;
        if (event.button === 2) this.isAiming = false;
      }
    };
    on(canvas, "pointerup", endAim);
    on(canvas, "pointercancel", endAim);
    on(canvas, "contextmenu", (event) => event.preventDefault());

    const fire = this.stage.querySelector("#koFire");
    on(fire, "pointerdown", (event) => {
      event.preventDefault();
      this.fireHeld = true;
      this.shoot();
      haptic(10);
    });
    on(fire, "pointerup", () => { this.fireHeld = false; });
    on(this.stage.querySelector("#koReload"), "click", () => this.reload());
    on(this.stage.querySelector("#koSprint"), "pointerdown", (event) => {
      event.preventDefault();
      this.sprinting = true;
      this.stage.querySelector("#koSprint").classList.add("active");
    });
    const stopSprint = () => {
      this.sprinting = false;
      this.stage.querySelector("#koSprint").classList.remove("active");
    };
    on(this.stage.querySelector("#koSprint"), "pointerup", stopSprint);
    on(this.stage.querySelector("#koSprint"), "pointercancel", stopSprint);
    on(this.stage.querySelector("#koDeploy"), "click", () => this.deploy());
    on(this.stage.querySelector("#koCloseStart"), "click", () => this.onExit?.());
    on(this.stage.querySelector("#koExit"), "click", () => this.onExit?.());
    on(this.stage.querySelector("#koRespawn"), "click", () => this.respawn());
    on(window, "keydown", (event) => {
      if (!this.active || event.target?.matches?.("input,textarea,select")) return;
      const key = event.key.toLowerCase();
      this.keys.add(key);
      if (key === "r") this.reload();
      if (key === "shift") this.sprinting = true;
      if (key === "escape" && document.pointerLockElement) document.exitPointerLock?.();
      if (key === " " && this.active && !this.dead) this.jump();
    });
    on(window, "keyup", (event) => {
      this.keys.delete(event.key.toLowerCase());
      if (event.key === "Shift") this.sprinting = false;
    });
    on(window, "resize", () => this.resize());
    on(window, "orientationchange", () => setTimeout(() => this.resize(), 160));
    on(document, "visibilitychange", () => {
      if (document.hidden) this.fireHeld = false;
    });
    on(document, "pointerlockchange", () => {});
    on(window, "beforeunload", () => this.cleanup());
    on(this.ui.koToast, "animationend", () => this.ui.koToast.classList.remove("show"));
  }

  turn(dx, dy) {
    const sens = this.isAiming ? 0.0015 : 0.0025;
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -0.48, 0.44);
  }

  deploy() {
    if (!this.uid) {
      this.toast("Sign in to enter the online arena.");
      return;
    }
    this.active = true;
    this.health = MAX_HEALTH;
    this.ammo = MAGAZINE_SIZE;
    this.reserve = 150;
    this.dead = false;
    this.pos.set(0, 0, 24);
    this.yaw = Math.PI;
    this.pitch = -0.04;
    this.ui.koStart.classList.add("hidden");
    this.game.classList.add("playing");
    this.stage.classList.add("ko-playing");
    this.audio = this.audio || new (window.AudioContext || window.webkitAudioContext)();
    this.audio.resume?.().catch?.(() => {});
    this.tryLandscape();
    this.updateHUD();
    this.publishPlayer(true);
    this.renderer.domElement.requestPointerLock?.();
  }

  async tryLandscape() {
    try {
      if (screen.orientation?.lock) await screen.orientation.lock("landscape");
      else this.game.classList.add("ko-rotate-fallback");
    } catch {
      this.game.classList.add("ko-rotate-fallback");
    }
  }

  resize() {
    if (!this.renderer || !this.sceneHost) return;
    const rect = this.sceneHost.getBoundingClientRect();
    const w = Math.max(200, rect.width || window.innerWidth);
    const h = Math.max(140, rect.height || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  makeCharacterForRemote(data) {
    const profile = {
      uid: data.id, name: data.name, username: data.username,
      photoURL: data.photoURL, avatarModelUrl: data.avatarModelUrl,
    };
    const avatar = this.makeAvatar({
      uid: data.id, name: data.name || "Operator", profile,
      teamColor: data.teamColor || 0x995a48,
    });
    this.scene.add(avatar);
    return avatar;
  }

  watchFirebase() {
    if (!this.uid || !db) {
      this.toast("Multiplayer is unavailable in this session.");
      return;
    }
    try {
      const playersQuery = query(collection(db, "game_players"), where("gameId", "==", GAME_ID));
      const playerUnsub = onSnapshot(playersQuery, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          const pid = data.id || change.doc.id;
          if (pid === this.uid) return;
          if (change.type === "removed" || data.alive === false) {
            this.removeRemote(pid);
            return;
          }
          this.upsertRemote({ ...data, id: pid });
        });
        this.ui.koOnline.textContent = String(Math.max(1, snapshot.size));
      }, (error) => {
        console.warn("Killers Ops players listener:", error);
        this.toast("Online lobby couldn't connect. Check Firestore rules.");
      });
      this.subscriptions.push(playerUnsub);
      const hitsQuery = query(collection(db, "game_hits"), where("gameId", "==", GAME_ID));
      let firstHitSnapshot = true;
      const hitsUnsub = onSnapshot(hitsQuery, (snapshot) => {
        if (firstHitSnapshot) {
          firstHitSnapshot = false;
          snapshot.docs.forEach((hit) => this.lastHitIds.add(hit.id));
          return;
        }
        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added" || this.lastHitIds.has(change.doc.id)) return;
          this.lastHitIds.add(change.doc.id);
          if (this.lastHitIds.size > 600) this.lastHitIds = new Set([...this.lastHitIds].slice(-300));
          const hit = change.doc.data();
          if (hit.targetId === this.uid && this.active && !this.dead && hit.shooterId !== this.uid) {
            this.takeDamage(clamp(Number(hit.damage) || 0, 0, 40), hit.shooterId, hit.shooterName);
          }
        });
      }, (error) => {
        console.warn("Killers Ops hits listener:", error);
        this.toast("Hit sync is blocked by Firestore rules.");
      });
      this.subscriptions.push(hitsUnsub);
      const eventsQuery = query(collection(db, "game_events"), where("gameId", "==", GAME_ID));
      let firstEventSnapshot = true;
      const eventsUnsub = onSnapshot(eventsQuery, (snapshot) => {
        if (firstEventSnapshot) {
          firstEventSnapshot = false;
          snapshot.docs.forEach((entry) => this.lastHitIds.add(`event:${entry.id}`));
          return;
        }
        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added" || this.lastHitIds.has(`event:${change.doc.id}`)) return;
          this.lastHitIds.add(`event:${change.doc.id}`);
          const event = change.doc.data();
          if (event.kind !== "elimination") return;
          this.pushKillFeed(event.killerName, event.victimName);
          if (event.killerId === this.uid) this.confirmKill();
        });
      }, (error) => console.warn("Killers Ops events listener:", error));
      this.subscriptions.push(eventsUnsub);
    } catch (error) {
      console.warn("Killers Ops Firebase setup:", error);
      this.toast("Online play needs Firestore access.");
    }
  }

  async publishPlayer(joined = false) {
    if (!db || !this.uid || !this.active) return;
    const ref = doc(db, "game_players", this.uid);
    const record = {
      id: this.uid, gameId: GAME_ID, name: this.name,
      username: this.profile.username || "",
      photoURL: this.photoURL,
      avatarModelUrl: this.avatarModelUrl || "",
      position: { x: this.pos.x, y: 0, z: this.pos.z },
      rotation: { y: this.yaw, x: this.pitch },
      health: this.health, ammo: this.ammo, kills: this.kills,
      alive: !this.dead, isMoving: this.move.x !== 0 || this.move.y !== 0,
      lastUpdate: serverTimestamp(),
      ...(joined ? { joinedAt: serverTimestamp() } : {}),
    };
    try {
      if (joined) await setDoc(ref, record, { merge: true });
      else await updateDoc(ref, record);
    } catch (error) {
      if (joined) {
        try { await setDoc(ref, record, { merge: true }); } catch {}
      }
      console.warn("Killers Ops presence write:", error);
    }
  }

  upsertRemote(data) {
    if (data.lastUpdate?.toMillis && Date.now() - data.lastUpdate.toMillis() > 30000) {
      this.removeRemote(data.id);
      return;
    }
    let player = this.players.get(data.id);
    if (!player) {
      const avatar = this.makeCharacterForRemote(data);
      player = { avatar, data, target: new THREE.Vector3(), yaw: 0, lastSeen: Date.now() };
      this.players.set(data.id, player);
    }
    player.data = data;
    player.lastSeen = Date.now();
    if (data.position && Number.isFinite(data.position.x) && Number.isFinite(data.position.z)) {
      player.target.set(data.position.x, Number(data.position.y) || 0, data.position.z);
    }
    player.yaw = Number(data.rotation?.y) || 0;
    player.avatar.visible = data.alive !== false;
    player.avatar.userData.displayName = data.name || "Operator";
  }

  removeRemote(uid) {
    const player = this.players.get(uid);
    if (!player) return;
    this.scene.remove(player.avatar);
    player.avatar.traverse((node) => {
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => material.dispose?.());
      }
      node.geometry?.dispose?.();
    });
    this.players.delete(uid);
  }

  isFree(x, z) {
    if (Math.abs(x) > MAP_HALF - 3 || Math.abs(z) > MAP_HALF - 3) return false;
    for (const building of this.buildings) {
      const b = building.box;
      if (x + PLAYER_RADIUS < b.min.x || x - PLAYER_RADIUS > b.max.x) continue;
      if (z + PLAYER_RADIUS < b.min.z || z - PLAYER_RADIUS > b.max.z) continue;
      return false;
    }
    return true;
  }

  movement(dt) {
    const forward = (this.keys.has("w") || this.keys.has("arrowup") ? 1 : 0)
      - (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0) + this.move.y;
    const side = (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0)
      - (this.keys.has("a") || this.keys.has("arrowleft") ? 1 : 0) + this.move.x;
    const length = Math.hypot(forward, side);
    if (length > 1) {
      this.temp.set(side / length, 0, -forward / length);
    } else {
      this.temp.set(side, 0, -forward);
    }
    const run = this.sprinting || this.keys.has("shift");
    const speed = run ? 12.2 : 7.0;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const dx = (this.temp.x * cos - this.temp.z * sin) * speed * dt;
    const dz = (this.temp.x * sin + this.temp.z * cos) * speed * dt;
    const nx = this.pos.x + dx;
    if (this.isFree(nx, this.pos.z)) this.pos.x = nx;
    const nz = this.pos.z + dz;
    if (this.isFree(this.pos.x, nz)) this.pos.z = nz;
    if (this.localAvatar) {
      this.localAvatar.position.lerp(this.pos, Math.min(1, dt * 13));
      this.localAvatar.rotation.y = this.yaw;
      this.localAvatar.position.y = 0;
      if (this.localAvatar.children[0]) {
        const moving = length > 0.08;
        const sway = moving ? Math.sin(performance.now() * (run ? 0.015 : 0.01)) * 0.045 : 0;
        this.localAvatar.children[0].position.y = 1.05 + sway;
      }
    }
    return length > 0.08;
  }

  updateCamera() {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const distance = this.isAiming ? 2.15 : 4.25;
    const shoulder = this.isAiming ? 0.52 : 0.82;
    const desired = new THREE.Vector3(
      this.pos.x + sin * distance + cos * shoulder,
      this.pos.y + (this.isAiming ? 1.9 : 2.65),
      this.pos.z + cos * distance - sin * shoulder,
    );
    this.camera.position.lerp(desired, 0.18);
    const target = new THREE.Vector3(
      this.pos.x - sin * 4,
      this.pos.y + 1.48 + this.pitch * 2.2,
      this.pos.z - cos * 4,
    );
    this.camera.lookAt(target);
    this.camera.fov += ((this.isAiming ? 50 : 68) - this.camera.fov) * 0.16;
    this.camera.updateProjectionMatrix();
  }

  shoot() {
    if (!this.active || this.dead || this.reloading) return;
    const now = performance.now();
    if (now - this.lastShotAt < FIRE_RATE_MS) return;
    if (this.ammo <= 0) {
      this.reload();
      return;
    }
    this.lastShotAt = now;
    this.ammo--;
    this.updateHUD();
    this.playGunSound();
    this.flashMuzzle();
    this.traceShot();
    haptic(12);
    if (this.ammo === 0) this.toast("Magazine empty · tap reload");
  }

  traceShot() {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const spread = this.isAiming ? 0.0018 : 0.006;
    direction.x += (Math.random() - 0.5) * spread;
    direction.y += (Math.random() - 0.5) * spread;
    direction.z += (Math.random() - 0.5) * spread;
    direction.normalize();
    const end = origin.clone().addScaledVector(direction, 135);
    const tracerMaterial = new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.9 });
    const tracer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin, end]), tracerMaterial);
    this.scene.add(tracer);
    setTimeout(() => {
      this.scene.remove(tracer);
      tracer.geometry.dispose();
      tracerMaterial.dispose();
    }, 90);
    this.raycaster.set(origin, direction);
    this.raycaster.far = 140;
    const targets = [...this.players.values()]
      .filter((p) => p.data.alive !== false && p.avatar.visible)
      .map((p) => p.avatar);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) return;
    let root = hits[0].object;
    while (root.parent && !root.userData.uid) root = root.parent;
    const targetId = root.userData.uid;
    if (!targetId || targetId === this.uid) return;
    this.showHit();
    this.registerHit(targetId);
  }

  async registerHit(targetId) {
    if (!db || !this.uid) return;
    try {
      await addDoc(collection(db, "game_hits"), {
        gameId: GAME_ID,
        shooterId: this.uid, shooterName: this.name,
        targetId, damage: 34,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.warn("Killers Ops hit write:", error);
      this.toast("Hit sync unavailable. Check Firestore permissions.");
    }
  }

  takeDamage(damage, attackerId, attackerName) {
    if (!this.active || this.dead) return;
    this.health = Math.max(0, this.health - damage);
    this.lastDamagedBy = { id: attackerId, name: attackerName || "Operator" };
    this.updateHUD();
    this.ui.koVignette.classList.add("damage");
    setTimeout(() => this.ui.koVignette.classList.remove("damage"), 220);
    this.playHitSound();
    haptic(36);
    if (this.health <= 0) this.die();
  }

  async die() {
    if (this.dead) return;
    this.dead = true;
    this.active = false;
    this.sprinting = false;
    this.ui.koDeath.hidden = false;
    this.ui.koDeath.classList.add("show");
    let remaining = 3;
    this.ui.koRespawnTimer.textContent = String(remaining);
    this.respawnTicker = setInterval(() => {
      remaining -= 1;
      this.ui.koRespawnTimer.textContent = String(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(this.respawnTicker);
        this.respawn();
      }
    }, 1000);
    await this.publishPlayer();
    if (this.lastDamagedBy && db && this.uid) {
      try {
        await addDoc(collection(db, "game_events"), {
          gameId: GAME_ID, kind: "elimination",
          killerId: this.lastDamagedBy.id, killerName: this.lastDamagedBy.name,
          victimId: this.uid, victimName: this.name, timestamp: serverTimestamp(),
        });
      } catch (error) {
        console.warn("Killers Ops elimination write:", error);
      }
    }
  }

  respawn() {
    clearInterval(this.respawnTicker);
    this.dead = false;
    this.active = true;
    this.health = MAX_HEALTH;
    this.ammo = MAGAZINE_SIZE;
    this.pos.set((Math.random() - 0.5) * 56, 0, (Math.random() - 0.5) * 56);
    this.ui.koDeath.hidden = true;
    this.ui.koDeath.classList.remove("show");
    this.ui.koLeader.textContent = "BACK IN THE FIGHT";
    setTimeout(() => { if (this.active) this.ui.koLeader.textContent = "DROP IN · SURVIVE · ELIMINATE"; }, 1800);
    this.localAvatar.position.copy(this.pos);
    this.updateHUD();
    this.publishPlayer(true);
  }

  confirmKill() {
    this.kills++;
    this.streak++;
    this.ui.koKills.textContent = String(this.kills);
    this.ui.koStreak.textContent = String(this.streak);
    this.ui.koLeader.textContent = `ELIMINATION CONFIRMED · ${this.kills} TOTAL`;
    this.showBanner(this.streak >= 10 ? "UNSTOPPABLE" : this.streak >= 5 ? "RAMPAGE" : this.streak >= 3 ? "ON A ROLL" : "ELIMINATION");
    if (this.streak === 3 || this.streak === 5 || this.streak === 10) {
      this.toast(`${this.streak} ELIMINATIONS · ${this.streak >= 10 ? "UNSTOPPABLE" : this.streak >= 5 ? "RAMPAGE" : "KILL STREAK"}!`);
    }
    this.playKillSound();
    this.publishPlayer();
  }

  reload() {
    if (!this.active || this.dead || this.reloading || this.ammo >= MAGAZINE_SIZE || this.reserve <= 0) return;
    this.reloading = true;
    const count = Math.min(MAGAZINE_SIZE - this.ammo, this.reserve);
    this.toast("RELOADING");
    this.reloadUntil = performance.now() + 1150;
    setTimeout(() => {
      if (!this.running) return;
      this.ammo += count;
      this.reserve -= count;
      this.reloading = false;
      this.updateHUD();
    }, 1150);
  }

  jump() {
    this.velocity.y = 5.2;
  }

  playGunSound() {
    try {
      if (!this.audio) this.audio = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.audio;
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.22), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 5);
      const source = ctx.createBufferSource();
      source.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1250, now);
      filter.frequency.exponentialRampToValueAtTime(200, now + 0.14);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.36, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start(now);
      source.stop(now + 0.18);
      const thump = ctx.createOscillator();
      const low = ctx.createGain();
      thump.type = "triangle";
      thump.frequency.setValueAtTime(95, now);
      thump.frequency.exponentialRampToValueAtTime(42, now + 0.12);
      low.gain.setValueAtTime(0.14, now);
      low.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      thump.connect(low).connect(ctx.destination);
      thump.start(now);
      thump.stop(now + 0.14);
    } catch {}
  }

  playHitSound() {
    this.playTone(180, 0.12, "triangle", 0.09);
  }

  playKillSound() {
    this.playTone(680, 0.2, "sine", 0.08);
    setTimeout(() => this.playTone(910, 0.22, "sine", 0.07), 80);
  }

  playTone(freq, duration, type, volume) {
    try {
      if (!this.audio) return;
      const ctx = this.audio;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + duration);
    } catch {}
  }

  flashMuzzle() {
    const flash = this.stage.querySelector("#koCrosshair");
    flash.classList.add("fire");
    setTimeout(() => flash.classList.remove("fire"), 55);
  }

  showHit() {
    this.ui.koHitmarker.classList.remove("show");
    void this.ui.koHitmarker.offsetWidth;
    this.ui.koHitmarker.classList.add("show");
    setTimeout(() => this.ui.koHitmarker.classList.remove("show"), 280);
  }

  showBanner(text) {
    this.ui.koBanner.textContent = text;
    this.ui.koBanner.classList.remove("show");
    void this.ui.koBanner.offsetWidth;
    this.ui.koBanner.classList.add("show");
    setTimeout(() => this.ui.koBanner.classList.remove("show"), 1350);
  }

  pushKillFeed(killer, victim) {
    const row = document.createElement("div");
    row.className = "ko-feed-item";
    const k = document.createElement("b");
    k.textContent = killer || "Operator";
    const sep = document.createElement("span");
    sep.textContent = " ✕ ";
    const v = document.createElement("span");
    v.textContent = victim || "Operator";
    row.append(k, sep, v);
    this.ui.koFeed.prepend(row);
    while (this.ui.koFeed.children.length > 4) this.ui.koFeed.lastElementChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  toast(message) {
    this.ui.koToast.textContent = message;
    this.ui.koToast.classList.remove("show");
    void this.ui.koToast.offsetWidth;
    this.ui.koToast.classList.add("show");
  }

  updateHUD() {
    this.ui.koHealthText.textContent = String(this.health);
    this.ui.koHealthBar.style.width = `${this.health}%`;
    this.ui.koHealthBar.classList.toggle("low", this.health <= 30);
    this.ui.koAmmo.textContent = String(this.ammo);
    this.ui.koReserve.textContent = String(this.reserve);
    this.ui.koKills.textContent = String(this.kills);
    this.ui.koStreak.textContent = String(this.streak);
  }

  updateMinimap() {
    const ctx = this.minimap;
    const canvas = this.ui.koMap;
    if (!ctx || !this.active) return;
    const width = canvas.width;
    const scale = width / (MAP_HALF * 2);
    ctx.clearRect(0, 0, width, width);
    ctx.fillStyle = "rgba(10, 17, 23, .86)";
    ctx.fillRect(0, 0, width, width);
    ctx.strokeStyle = "rgba(199, 215, 221, .16)";
    ctx.lineWidth = 3;
    for (let x = 0; x <= width; x += width / 5) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, width); ctx.stroke();
    }
    for (let y = 0; y <= width; y += width / 5) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    this.buildings.forEach(({ x, z, width: w, depth: d }) => {
      const px = (x + MAP_HALF) * scale;
      const py = (z + MAP_HALF) * scale;
      ctx.fillStyle = "rgba(160,174,173,.58)";
      ctx.fillRect(px - w * scale / 2, py - d * scale / 2, w * scale, d * scale);
    });
    this.players.forEach((player) => {
      const x = (player.avatar.position.x + MAP_HALF) * scale;
      const y = (player.avatar.position.z + MAP_HALF) * scale;
      ctx.fillStyle = "#ff6d5c";
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });
    const x = (this.pos.x + MAP_HALF) * scale;
    const y = (this.pos.z + MAP_HALF) * scale;
    ctx.fillStyle = "#b4a1ff";
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#d5cbff";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.sin(this.yaw) * 10, y - Math.cos(this.yaw) * 10);
    ctx.stroke();
  }

  collectAmmo() {
    if (!this.pickups) return;
    for (const pickup of this.pickups) {
      if (pickup.visible && pickup.position.distanceTo(this.pos) < 2.3) {
        pickup.visible = false;
        this.reserve = Math.min(240, this.reserve + pickup.userData.ammo);
        this.updateHUD();
        this.toast("+28 RIFLE AMMO");
        this.playTone(520, 0.08, "sine", 0.05);
        break;
      }
    }
  }

  frame() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.04, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    if (this.active && !this.dead) {
      this.movement(dt);
      this.updateCamera();
      if (this.fireHeld && now - this.lastShotAt >= FIRE_RATE_MS) this.shoot();
      this.collectAmmo();
      this.players.forEach((player) => {
        player.avatar.position.lerp(player.target, 0.22);
        player.avatar.rotation.y += (player.yaw - player.avatar.rotation.y) * 0.2;
        if (Date.now() - player.lastSeen > 45000) this.removeRemote(player.avatar.userData.uid);
      });
      this.pickups?.forEach((pickup) => {
        if (pickup.visible) pickup.rotation.y += dt * 0.6;
      });
      if (now - this.lastHeartbeat > 550) {
        this.lastHeartbeat = now;
        this.publishPlayer();
      }
      this.updateMinimap();
    } else if (!this.active) {
      const t = now * 0.00018;
      this.camera.position.lerp(new THREE.Vector3(Math.sin(t) * 14, 26, Math.cos(t) * 18), 0.007);
      this.camera.lookAt(0, 4, 0);
    }
    this.renderer.render(this.scene, this.camera);
  }

  cleanup() {
    if (!this.running) return;
    this.running = false;
    this.active = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.respawnTicker);
    this.cleanupFns.forEach((fn) => fn());
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions = [];
    if (this.uid && db) deleteDoc(doc(db, "game_players", this.uid)).catch(() => {});
    if (this.audio) this.audio.close().catch(() => {});
    this.players.forEach((player) => this.scene.remove(player.avatar));
    this.players.clear();
    this.scene.traverse((node) => {
      node.geometry?.dispose?.();
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => material.dispose?.());
      }
      if (node.material?.map) node.material.map.dispose?.();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    try { screen.orientation?.unlock?.(); } catch {}
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock?.();
  }
}

export function renderGames(root) {
  root.innerHTML = `
    <section class="ko-library">
      <div class="ko-library-top"><div><div class="ko-library-kicker">ORBIT ARCADE · EARLY ACCESS</div><h1>Games <span>for your circle.</span></h1><p>Play together, then come back to Orbit.</p></div><div class="ko-library-user"><img id="koLibraryAvatar" alt=""><span id="koLibraryName"></span></div></div>
      <div class="ko-library-feature">
        <div class="ko-feature-art"><div class="ko-feature-grid"></div><div class="ko-feature-glow"></div><div class="ko-feature-city"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="ko-feature-title"><span>ORBIT ORIGINAL · GAME 01</span><b>KILLERS<br>OPS</b><small>FREE-FOR-ALL · MULTIPLAYER</small></div><div class="ko-feature-reticle">⊕</div></div>
        <div class="ko-feature-info"><div class="ko-feature-status"><span></span> AVAILABLE NOW <i>·</i> ONLINE</div><h2>Own the whole block.</h2><p>A fast, third-person city shooter. Drop in with your Orbit avatar, loot ammo, build your streak, and take on the lobby.</p><div class="ko-game-tags"><span>THIRD-PERSON</span><span>URBAN ARENA</span><span>FREE-FOR-ALL</span></div><button class="ko-launch" id="koLaunch">PLAY KILLERS OPS <span>→</span></button><small class="ko-platform-note">BEST PLAYED IN LANDSCAPE · DESKTOP &amp; MOBILE</small></div>
      </div>
      <div class="ko-library-bottom"><div><span class="ko-next-game-dot"></span> MORE GAMES ARE ON THE WAY</div><span>YOUR ORBIT AVATAR · YOUR GAME</span></div>
      <div id="koStage" class="ko-stage"></div>
    </section>`;
  const user = state.me || {};
  const photo = root.querySelector("#koLibraryAvatar");
  photo.src = avatarFor(user);
  root.querySelector("#koLibraryName").textContent = playerName(user);
  root.querySelector("#koLaunch").addEventListener("click", () => {
    if (root._gameSession?.running) return;
    const stage = root.querySelector("#koStage");
    stage.classList.add("open");
    const session = new KillersOps(stage, state.me || {});
    root._gameSession = session;
    session.onExit = () => {
      session.cleanup();
      stage.classList.remove("open");
      stage.innerHTML = "";
      root._gameSession = null;
      root._gameCleanup = () => {};
    };
    root._gameCleanup = () => {
      session.cleanup();
      root._gameSession = null;
    };
  });
  root._gameCleanup = () => {};
}
