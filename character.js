import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinnedModel } from "three/addons/utils/SkeletonUtils.js";

// Default model — used when the user has no custom avatar.
const DEFAULT_MODEL_URL = new URL("./Soldier.glb", import.meta.url).href;
const CHARACTER_HEIGHT = 1.85;
const WAVE_DURATION_MS = 1450;

// Cache per-URL so a user's custom model loads once and is reused.
const _characterAssetCache = new Map();

const loadCharacterAsset = (modelUrl) => {
  const url = modelUrl || DEFAULT_MODEL_URL;
  if (!_characterAssetCache.has(url)) {
    const promise = new GLTFLoader().loadAsync(url)
      .then((gltf) => ({ scene: gltf.scene, animations: gltf.animations || [] }))
      .catch((error) => {
        _characterAssetCache.delete(url);
        throw error;
      });
    _characterAssetCache.set(url, promise);
  }
  return _characterAssetCache.get(url);
};

const namedClip = (clips, expression, except = null) =>
  clips.find((clip) => clip !== except && expression.test(clip.name)) || null;

const findFallbackWaveBone = (root) => {
  const bones = [];
  root.traverse((node) => { if (node.isBone) bones.push(node); });
  const score = (name) => {
    const value = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (/right.*(shoulder|upperarm|arm)$/.test(value) || /(shoulder|upperarm|arm).*right$/.test(value)) return 0;
    if (/right.*(forearm|wrist|hand)$/.test(value) || /(forearm|wrist|hand).*right$/.test(value)) return 1;
    if (/(shoulder|upperarm|arm)$/.test(value)) return 2;
    if (/(forearm|wrist|hand)$/.test(value)) return 3;
    return 10;
  };
  return bones
    .map((bone) => ({ bone, score: score(bone.name) }))
    .filter((entry) => entry.score < 10)
    .sort((a, b) => a.score - b.score)[0]?.bone || null;
};

/**
 * Resolves which animation clip to use for a given slot on a given asset.
 * Prefers the user's custom map (from customisation.js), falls back to a
 * name-matching regex so default Soldier.glb and unmapped models still work.
 */
const pickClipForSlot = (clips, slot, customMap) => {
  // 1. Explicit mapping from the user's uploaded avatar config
  const mappedName = customMap?.[slot];
  if (mappedName) {
    const hit = clips.find((c) => c.name === mappedName);
    if (hit) return hit;
  }
  // 2. Fallback regex on the clip name
  const patterns = {
    idle:  /idle|stand|breath/i,
    wave:  /wave|greet|hello/i,
    run:   /^run$|run_?forward|jog|sprint/i,
    walk:  /walk|stroll/i,
    shoot: /shoot|fire|gun_?shoot/i,
  };
  const re = patterns[slot];
  return re ? (clips.find((c) => re.test(c.name)) || null) : null;
};

/**
 * Mounts a small, scroll-aware 3D character in a profile avatar slot.
 * The existing profile image remains visible until the model loads.
 * Returns a disposer for route changes.
 *
 * Options:
 *   modelURL       — custom avatar GLB URL, or null for default Soldier.glb
 *   animationMap   — { idle: "Idle_Gun", wave: "Wave", ... } from user doc
 *   rotationY      — 0 = face camera (default); ±Math.PI/2 for side-facing
 *   waveOnInitialView — whether to play the wave animation on first view
 */
export function mountProfileCharacter(host, {
  photoURL = "",
  alt = "3D character avatar",
  scrollRoot = null,
  rotationY = 0,
  waveOnInitialView = false,
  modelURL = null,
  animationMap = null,
} = {}) {
  if (!host) return () => {};

  host.classList.add("orbit-character");
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", alt);

  const fallback = document.createElement("img");
  fallback.className = "orbit-character-fallback";
  fallback.src = photoURL;
  fallback.alt = "";
  fallback.loading = "lazy";
  fallback.decoding = "async";

  const canvas = document.createElement("canvas");
  canvas.className = "orbit-character-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.replaceChildren(fallback, canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x55436f, 1.7));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(2.5, 3.5, 4);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xc8c1ff, 0.65);
  fillLight.position.set(-3, 1.5, -1);
  scene.add(fillLight);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  camera.position.set(0, 0.94, 3.0);
  camera.lookAt(0, 0.93, 0);

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
  let renderer = null;
  let modelRoot = null;
  let animatedRoot = null;
  let mixer = null;
  let idleAction = null;
  let waveAction = null;
  let fallbackWaveBone = null;
  let fallbackWaveBase = null;
  let fallbackWaveStartedAt = 0;
  let lastWaveAt = -Infinity;
  let visible = false;
  let disposed = false;
  let animationFrame = 0;
  let lastFrameAt = 0;
  let waveWhenReady = false;
  let failedToLoad = false;

  const resize = () => {
    if (!renderer || disposed) return;
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const createRenderer = () => {
    if (renderer || disposed) return Boolean(renderer);
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      resize();
      return true;
    } catch (error) {
      console.warn("Orbit character: WebGL is unavailable; keeping the profile photo.", error);
      return false;
    }
  };

  const playWave = () => {
    if (prefersReducedMotion || !modelRoot) return;
    const now = performance.now();
    if (now - lastWaveAt < 1100) return;
    lastWaveAt = now;
    if (fallbackWaveBone) fallbackWaveStartedAt = now;

    if (waveAction) {
      waveAction.reset();
      waveAction.setLoop(THREE.LoopOnce, 1);
      waveAction.clampWhenFinished = Boolean(idleAction);
      if (idleAction) idleAction.crossFadeTo(waveAction, 0.2, false);
      else waveAction.fadeIn(0.2);
      waveAction.play();
    }
  };

  const setupModel = (asset, waveOnReady = false) => {
    const model = cloneSkinnedModel(asset.scene);
    // Facing direction — 0 means the character faces the camera.
    model.rotation.y = rotationY;
    model.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(model);
    const height = Math.max(0.001, bounds.max.y - bounds.min.y);
    model.scale.setScalar(CHARACTER_HEIGHT / height);
    model.updateMatrixWorld(true);

    const fittedBounds = new THREE.Box3().setFromObject(model);
    const center = fittedBounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= fittedBounds.min.y;
    model.position.z -= center.z;
    model.traverse((node) => {
      if (node.isMesh) {
        node.frustumCulled = false;
        node.castShadow = true;
      }
    });

    animatedRoot = new THREE.Group();
    animatedRoot.add(model);
    scene.add(animatedRoot);
    modelRoot = model;

    mixer = new THREE.AnimationMixer(model);
    const clips = asset.animations || [];

    // Use custom map first, fall back to regex on clip names
    const idleClip = pickClipForSlot(clips, "idle", animationMap);
    const waveClip = pickClipForSlot(clips, "wave", animationMap);

    if (idleClip) {
      idleAction = mixer.clipAction(idleClip);
      idleAction.setLoop(THREE.LoopRepeat, Infinity);
      idleAction.play();
    }
    if (waveClip && waveClip !== idleClip) {
      waveAction = mixer.clipAction(waveClip);
    }
    if (!waveAction) {
      // No wave clip — fall back to a simple arm swing on the wave bone
      fallbackWaveBone = findFallbackWaveBone(model);
      if (fallbackWaveBone) {
        fallbackWaveBase = {
          x: fallbackWaveBone.rotation.x,
          y: fallbackWaveBone.rotation.y,
          z: fallbackWaveBone.rotation.z,
        };
      }
    }

    if (waveAction && idleAction) {
      mixer.addEventListener("finished", (event) => {
        if (event.action !== waveAction) return;
        idleAction.reset().fadeIn(0.2).play();
        waveAction.fadeOut(0.2);
      });
    }

    host.classList.add("model-ready");
    if (waveOnReady && !prefersReducedMotion) playWave();
    startAnimationLoop();
  };

  const animate = (time) => {
    animationFrame = 0;
    if (disposed || !visible || !renderer || !animatedRoot) return;
    const delta = lastFrameAt ? Math.min((time - lastFrameAt) / 1000, 0.05) : 0;
    lastFrameAt = time;
    mixer?.update(delta);

    const seconds = time / 1000;
    animatedRoot.position.y = prefersReducedMotion ? 0 : Math.sin(seconds * 2.1) * 0.025;
    animatedRoot.rotation.z = prefersReducedMotion ? 0 : Math.sin(seconds * 1.35) * 0.018;

    if (fallbackWaveBone && fallbackWaveBase && fallbackWaveStartedAt) {
      const progress = (time - fallbackWaveStartedAt) / WAVE_DURATION_MS;
      if (progress >= 1) {
        fallbackWaveBone.rotation.set(fallbackWaveBase.x, fallbackWaveBase.y, fallbackWaveBase.z);
        fallbackWaveStartedAt = 0;
      } else if (progress >= 0) {
        const envelope = Math.sin(Math.PI * progress);
        const swing = Math.sin(progress * Math.PI * 6);
        fallbackWaveBone.rotation.x = fallbackWaveBase.x + envelope * (0.2 + swing * 0.38);
        fallbackWaveBone.rotation.z = fallbackWaveBase.z + envelope * (0.62 + Math.abs(swing) * 0.18);
      }
    }

    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(animate);
  };

  function startAnimationLoop() {
    if (!animationFrame && visible && !disposed && renderer && animatedRoot) {
      lastFrameAt = 0;
      animationFrame = window.requestAnimationFrame(animate);
    }
  }

  const enterView = (shouldWave = false) => {
    if (disposed || visible) return;
    visible = true;
    if (shouldWave) waveWhenReady = true;
    if (!createRenderer()) return;
    resize();
    if (modelRoot) {
      if (shouldWave) playWave();
      startAnimationLoop();
      return;
    }
    if (failedToLoad) return;
    loadCharacterAsset(modelURL)
      .then((asset) => {
        if (!disposed && visible && !modelRoot) {
          const waveOnReady = waveWhenReady;
          waveWhenReady = false;
          setupModel(asset, waveOnReady);
        }
      })
      .catch((error) => {
        failedToLoad = true;
        console.warn(`Orbit character: could not load ${modelURL || DEFAULT_MODEL_URL}; keeping the profile photo.`, error);
      });
  };

  const leaveView = () => {
    if (!visible) return;
    visible = false;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastFrameAt = 0;
  };

  let intersectionObserver = null;
  let hasBeenOutsideView = false;
  let firstIntersectionUpdate = true;
  if ("IntersectionObserver" in window) {
    try {
      intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const shouldWave = hasBeenOutsideView || (firstIntersectionUpdate && waveOnInitialView);
            firstIntersectionUpdate = false;
            hasBeenOutsideView = false;
            enterView(shouldWave);
          } else {
            firstIntersectionUpdate = false;
            hasBeenOutsideView = true;
            leaveView();
          }
        });
      }, { root: scrollRoot || null, threshold: 0.3 });
      intersectionObserver.observe(host);
    } catch {
      enterView();
    }
  } else {
    enterView();
  }

  let resizeObserver = null;
  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
  } else {
    window.addEventListener("resize", resize, { passive: true });
  }

  return () => {
    if (disposed) return;
    disposed = true;
    intersectionObserver?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener("resize", resize);
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    mixer?.stopAllAction();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
    }
    scene.clear();
  };
}