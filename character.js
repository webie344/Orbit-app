import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinnedModel } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/SkeletonUtils.js";

// game.js loads this same model name from its app directory.
const MODEL_URL = new URL("./Soldier.glb", import.meta.url).href;
const CHARACTER_HEIGHT = 1.75;
const WAVE_DURATION_MS = 1450;

let characterAssetPromise = null;

const loadCharacterAsset = () => {
  if (!characterAssetPromise) {
    characterAssetPromise = new GLTFLoader().loadAsync(MODEL_URL)
      .then((gltf) => ({ scene: gltf.scene, animations: gltf.animations || [] }))
      .catch((error) => {
        characterAssetPromise = null;
        throw error;
      });
  }
  return characterAssetPromise;
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
 * Mounts a small, scroll-aware 3D character in a profile avatar slot.
 * The existing profile image remains visible until Soldier.glb loads.
 * Returns a disposer for route changes.
 */
export function mountProfileCharacter(host, { photoURL = "", alt = "3D character avatar", scrollRoot = null } = {}) {
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
  camera.position.set(0, 0.94, 3.35);
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
    fallbackWaveStartedAt = now;

    if (waveAction) {
      waveAction.reset();
      waveAction.setLoop(THREE.LoopOnce, 1);
      waveAction.clampWhenFinished = Boolean(idleAction);
      if (idleAction) idleAction.crossFadeTo(waveAction, 0.2, false);
      else waveAction.fadeIn(0.2);
      waveAction.play();
    }
  };

  const setupModel = (asset) => {
    const model = cloneSkinnedModel(asset.scene);
    model.rotation.y = Math.PI;
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
    const idleClip = namedClip(asset.animations, /idle|stand|breath/i);
    const waveClip = namedClip(asset.animations, /wave|greet|hello/i, idleClip);
    if (idleClip) {
      idleAction = mixer.clipAction(idleClip);
      idleAction.setLoop(THREE.LoopRepeat, Infinity);
      idleAction.play();
    }
    if (waveClip) waveAction = mixer.clipAction(waveClip);
    if (!waveAction) {
      fallbackWaveBone = findFallbackWaveBone(model);
      if (fallbackWaveBone) {
        fallbackWaveBase = {
          x: fallbackWaveBone.rotation.x,
          y: fallbackWaveBone.rotation.y,
          z: fallbackWaveBone.rotation.z,
        };
      }
    }

    host.classList.add("model-ready");
    if (!prefersReducedMotion) playWave();
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

  const enterView = () => {
    if (disposed || visible) return;
    visible = true;
    if (!createRenderer()) return;
    resize();
    if (modelRoot) {
      playWave();
      startAnimationLoop();
      return;
    }
    if (failedToLoad) return;
    loadCharacterAsset()
      .then((asset) => {
        if (!disposed && visible && !modelRoot) setupModel(asset);
      })
      .catch((error) => {
        failedToLoad = true;
        console.warn(`Orbit character: could not load ${MODEL_URL}; keeping the profile photo.`, error);
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
  if ("IntersectionObserver" in window) {
    try {
      intersectionObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) enterView();
        else leaveView();
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
