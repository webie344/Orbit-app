// =========================================================================
// Orbit — customisation.js
// Custom 3D avatar uploader: pick a GLB (≤3 MB), preview it, map its
// animations to Orbit's categories, upload to Cloudinary, and save the
// reference to the user document.
//
// Exports:
//   openAvatarCustomiser()      — opens the full-screen modal
//   mountAvatarSettingsCard(host, user) — renders the settings-card entry point
//
// Depends on:
//   - app.js exports: el, $, $$, db, auth, state, toast, uploadToCloudinary
//   - three (imported via the same importmap used everywhere else)
// =========================================================================

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinnedModel } from "three/addons/utils/SkeletonUtils.js";
import {
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Note: the imports above are the ones we need. The rest of app.js's exports
// (el, toast, state, db, uploadToCloudinary) are pulled in lazily inside the
// functions below so this module can be loaded from anywhere without risk of
// circular-init problems.

// =========================================================================
// Constants
// =========================================================================

// Users can upload a GLB up to 3 MB. Enforced client-side here AND
// server-side via the Cloudinary upload preset's own size limit.
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

// Cloudinary upload preset made specifically for avatars (raw resource type,
// unsigned, 3 MB limit, .glb/.gltf allowed). Create this preset in the
// Cloudinary dashboard before shipping.
const AVATAR_UPLOAD_PRESET = "profile-pictures";

// Cloudinary cloud name — matches the one already used in app.js.
const CLOUD_NAME = "ddtdqrh1b";

// Animation categories users map their own clip names onto. Only "idle"
// is required; the rest are optional and used on profile pages when those
// states are needed.
const ANIMATION_SLOTS = [
  { key: "idle",   label: "Idle / Default",   hint: "Plays when the avatar is standing still." , required: true  },
  { key: "wave",   label: "Wave / Greeting",  hint: "Plays on first view of the profile." ,    required: false },
  { key: "run",    label: "Run",              hint: "Used when the avatar is moving fast." ,    required: false },
  { key: "walk",   label: "Walk",             hint: "Used when the avatar is moving slowly." ,  required: false },
  { key: "shoot",  label: "Shoot",            hint: "Used in the game when firing." ,           required: false },
];

// =========================================================================
// Lazy bridge to app.js exports (avoids circular-import issues)
// =========================================================================

const _bridge = () => import("./app.js");
const _getAppHelpers = async () => {
  const app = await _bridge();
  return {
    el:                app.el,
    $:                 app.$,
    $$:                app.$$,
    db:                app.db,
    state:             app.state,
    toast:             app.toast,
    uploadToCloudinary: app.uploadToCloudinary,
  };
};

// =========================================================================
// Public entry point — opens the full-screen customiser modal
// =========================================================================

export async function openAvatarCustomiser() {
  const { el, state, toast } = await _getAppHelpers();

  // Prevent duplicate modals
  document.getElementById("orbitAvatarModal")?.remove();

  const modal = el("div", { id: "orbitAvatarModal", class: "orbit-avatar-modal" });
  const card  = el("div", { class: "orbit-avatar-card" });
  modal.appendChild(card);
  document.body.appendChild(modal);

  // ── Header ──────────────────────────────────────────────────────────
  const closeBtn = el("button", { class: "icon-btn", onclick: () => modal.remove() },
    el("i", { class: "ri-close-line" }));
  card.appendChild(el("div", { class: "orbit-avatar-head" },
    el("div", {},
      el("h2", {}, "Custom avatar"),
      el("p", {}, "Upload your own 3D character (GLB, up to 3 MB)"),
    ),
    closeBtn,
  ));

  // ── Body — swapped as the user moves between steps ──────────────────
  const body = el("div", { class: "orbit-avatar-body" });
  card.appendChild(body);

  const stepState = {
    step: "pick",             // pick | mapping | uploading | done
    file: null,
    modelUrl: null,           // blob URL of the loaded file
    gltf: null,               // parsed glTF
    animationNames: [],
    animationMap: {},         // { idle: "Idle_Gun", wave: "Wave", ... }
    previewHost: null,
  };

  const renderPickStep = () => {
    body.innerHTML = "";
    const fileInput = el("input", { type: "file", accept: ".glb,.gltf,model/gltf-binary,model/gltf+json", hidden: true });

    const picker = el("div", { class: "orbit-avatar-picker" });
    picker.appendChild(el("div", { class: "orbit-avatar-picker-icon" }, el("i", { class: "ri-user-star-line" })));
    picker.appendChild(el("h3", {}, "Choose a GLB file"));
    picker.appendChild(el("p", {}, "Max 3 MB. Humanoid characters look best."));
    const chooseBtn = el("button", { class: "btn primary" }, el("i", { class: "ri-upload-2-line" }), " Pick file");
    picker.appendChild(chooseBtn);
    picker.appendChild(el("p", { class: "orbit-avatar-hint" },
      "Need a smaller file? Compress first at ",
      el("a", { href: "https://gltf.report", target: "_blank", rel: "noopener" }, "gltf.report"),
    ));
    body.appendChild(picker);
    body.appendChild(fileInput);

    chooseBtn.onclick = () => fileInput.click();
    fileInput.onchange = async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;

      // Client-side size guard — mirrored server-side by the Cloudinary preset.
      if (file.size > MAX_AVATAR_BYTES) {
        toast(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB — max is 3 MB.`);
        return;
      }
      if (!/\.(glb|gltf)$/i.test(file.name)) {
        toast("Please choose a .glb or .gltf file");
        return;
      }
      stepState.file = file;
      await loadAndShowMapping();
    };
  };

  const loadAndShowMapping = async () => {
    body.innerHTML = "";
    body.appendChild(el("div", { class: "orbit-avatar-loading" },
      el("i", { class: "ri-loader-4-line" }),
      el("span", {}, "Reading your model…"),
    ));

    const url = URL.createObjectURL(stepState.file);
    stepState.modelUrl = url;

    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      stepState.gltf = gltf;
      stepState.animationNames = (gltf.animations || []).map((c) => c.name).filter(Boolean);

      if (stepState.animationNames.length === 0) {
        body.innerHTML = "";
        body.appendChild(el("div", { class: "orbit-avatar-error" },
          el("i", { class: "ri-error-warning-line" }),
          el("h3", {}, "No animations found"),
          el("p", {}, "Your model loaded but has no animation clips. Upload a character with at least an idle animation."),
          el("button", { class: "btn ghost", onclick: renderPickStep }, "Try another file"),
        ));
        return;
      }

      // Auto-guess a starting map from animation names
      stepState.animationMap = autoGuessAnimationMap(stepState.animationNames);

      renderMappingStep();
    } catch (err) {
      console.error("[customisation] GLB load failed:", err);
      body.innerHTML = "";
      body.appendChild(el("div", { class: "orbit-avatar-error" },
        el("i", { class: "ri-error-warning-line" }),
        el("h3", {}, "Couldn't read that file"),
        el("p", {}, "The GLB may be corrupted or use an unsupported extension. Try exporting again."),
        el("button", { class: "btn ghost", onclick: renderPickStep }, "Choose another file"),
      ));
    }
  };

  const renderMappingStep = () => {
    body.innerHTML = "";

    // ── Preview pane (left side on desktop, top on mobile) ─────────
    const previewHost = el("div", { class: "orbit-avatar-preview" });
    body.appendChild(previewHost);
    startPreview(previewHost, stepState.gltf, stepState.animationMap.idle);
    stepState.previewHost = previewHost;

    // ── Mapping pane ───────────────────────────────────────────────
    const mappingPane = el("div", { class: "orbit-avatar-mapping" });
    mappingPane.appendChild(el("h3", {}, "Map your animations"));
    mappingPane.appendChild(el("p", { class: "orbit-avatar-mapping-desc" },
      "Orbit uses these to know when to play which animation. Match them to your model's clip names.",
    ));

    ANIMATION_SLOTS.forEach((slot) => {
      const row = el("div", { class: "orbit-avatar-map-row" });
      row.appendChild(el("label", {},
        el("strong", {}, slot.label),
        slot.required ? el("span", { class: "orbit-avatar-required" }, "required") : null,
        el("small", {}, slot.hint),
      ));

      const select = el("select", { class: "orbit-avatar-select" });
      select.appendChild(el("option", { value: "" }, "— None —"));
      stepState.animationNames.forEach((name) => {
        const opt = el("option", { value: name }, name);
        if (stepState.animationMap[slot.key] === name) opt.selected = true;
        select.appendChild(opt);
      });
      select.onchange = () => {
        if (select.value) stepState.animationMap[slot.key] = select.value;
        else delete stepState.animationMap[slot.key];
        // Live-update preview: if idle changed, restart the preview
        if (slot.key === "idle" && select.value) {
          restartPreview(previewHost, stepState.gltf, select.value);
        }
      };
      row.appendChild(select);
      mappingPane.appendChild(row);
    });

    // ── Actions ────────────────────────────────────────────────────
    const actions = el("div", { class: "orbit-avatar-actions" });
    const cancelBtn = el("button", { class: "btn ghost", onclick: renderPickStep }, "Choose different file");
    const saveBtn   = el("button", { class: "btn primary" }, el("i", { class: "ri-cloud-upload-line" }), " Upload avatar");
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    mappingPane.appendChild(actions);
    body.appendChild(mappingPane);

    saveBtn.onclick = async () => {
      if (!stepState.animationMap.idle) {
        toast("Please map at least the Idle animation");
        return;
      }
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="ri-loader-4-line"></i> Uploading…';
      try {
        await uploadAndSave();
      } catch (err) {
        console.error("[customisation] Upload failed:", err);
        toast(err.message || "Upload failed — please try again");
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="ri-cloud-upload-line"></i> Upload avatar';
      }
    };
  };

  const uploadAndSave = async () => {
    const { toast, state, db } = await _getAppHelpers();

    // Build a FormData for the unsigned Cloudinary raw upload.
    const fd = new FormData();
    fd.append("file", stepState.file);
    fd.append("upload_preset", AVATAR_UPLOAD_PRESET);

    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`;
    const res = await fetch(url, { method: "POST", body: fd });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Cloudinary rejected the upload (${res.status}). ${txt.slice(0, 120)}`);
    }
    const json = await res.json();

    // Cloudinary raw uploads return `secure_url` pointing at the raw file.
    const modelUrl = json.secure_url;
    if (!modelUrl) throw new Error("Upload succeeded but no URL was returned");

    // Persist to the user document. Only the fields we need.
    await updateDoc(doc(db, "users", state.uid), {
      avatarModelUrl: modelUrl,
      avatarModelBytes: stepState.file.size,
      avatarAnimationMap: stepState.animationMap,
      avatarUploadedAt: serverTimestamp(),
    });

    // Update the in-memory user object so subsequent renders use the new avatar.
    state.me.avatarModelUrl = modelUrl;
    state.me.avatarAnimationMap = stepState.animationMap;
    state.me.avatarModelBytes = stepState.file.size;

    // Clean up blob URL
    if (stepState.modelUrl) URL.revokeObjectURL(stepState.modelUrl);
    stopPreview();

    // Show success and close
    body.innerHTML = "";
    body.appendChild(el("div", { class: "orbit-avatar-success" },
      el("i", { class: "ri-checkbox-circle-fill" }),
      el("h3", {}, "Avatar saved"),
      el("p", {}, "Your profile and friends pages will show this character from now on."),
      el("button", { class: "btn primary", onclick: () => modal.remove() }, "Done"),
    ));
  };

  renderPickStep();
}

// =========================================================================
// Live 3D preview inside the modal
// =========================================================================

let _preview = null;

function startPreview(host, gltf, idleName) {
  stopPreview();

  const width  = host.clientWidth || 260;
  const height = host.clientHeight || 320;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x55436f, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(2.5, 3.5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8c1ff, 0.65);
  fill.position.set(-3, 1.5, -1);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 30);
  camera.position.set(0, 0.94, 3.0);
  camera.lookAt(0, 0.93, 0);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.innerHTML = "";
  host.appendChild(renderer.domElement);

  const model = cloneSkinnedModel(gltf.scene);
  model.rotation.y = 0;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3(); bounds.getSize(size);
  const targetH = 1.85;
  if (size.y > 0) model.scale.setScalar(targetH / size.y);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3(); fitted.getCenter(center);
  model.position.x -= center.x;
  model.position.y -= fitted.min.y;
  model.position.z -= center.z;
  model.traverse((n) => { if (n.isMesh) { n.frustumCulled = false; n.castShadow = true; } });

  const root = new THREE.Group();
  root.add(model);
  scene.add(root);

  const mixer = new THREE.AnimationMixer(model);
  let action = null;
  const idleClip = (gltf.animations || []).find((c) => c.name === idleName)
                || (gltf.animations || [])[0];
  if (idleClip) {
    action = mixer.clipAction(idleClip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  }

  let raf = 0;
  let last = performance.now();
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    mixer.update(dt);
    const t = now / 1000;
    root.rotation.z = Math.sin(t * 1.35) * 0.018;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  _preview = { renderer, scene, mixer, raf };
}

function restartPreview(host, gltf, idleName) {
  startPreview(host, gltf, idleName);
}

function stopPreview() {
  if (!_preview) return;
  cancelAnimationFrame(_preview.raf);
  _preview.mixer?.stopAllAction();
  _preview.renderer?.dispose();
  _preview.renderer?.forceContextLoss?.();
  _preview.scene?.clear();
  _preview = null;
}

// =========================================================================
// Guessing animation mappings from clip names
// =========================================================================

// Best-effort guess so the user usually only has to tweak one or two
// dropdowns. Falls back to the first clip for idle if nothing else matches.
function autoGuessAnimationMap(names) {
  const map = {};
  const patterns = {
    idle:   /idle|stand|breath|pose/i,
    wave:   /wave|greet|hello|hello_?wave/i,
    run:    /^run$|run_?forward|jog|sprint/i,
    walk:   /walk|stroll/i,
    shoot:  /shoot|fire|gun_?shoot|shoot_?gun/i,
  };
  for (const [key, re] of Object.entries(patterns)) {
    const hit = names.find((n) => re.test(n));
    if (hit) map[key] = hit;
  }
  if (!map.idle && names.length) map.idle = names[0];
  return map;
}

// =========================================================================
// Settings card entry point — call this from renderSettings() in app.js
// =========================================================================

/**
 * Renders a settings card that lets the user preview their current avatar
 * (or upload a new one). Append the returned node wherever you want in
 * your existing settings page.
 *
 * Example usage in app.js renderSettings():
 *
 *   import { mountAvatarSettingsCard } from "./customisation.js";
 *   const avatarCard = await mountAvatarSettingsCard();
 *   wrap.appendChild(avatarCard);
 */
export async function mountAvatarSettingsCard() {
  const { el, state } = await _getAppHelpers();

  const card = el("div", { class: "group" });
  card.appendChild(el("h3", {},
    el("i", { class: "ri-user-star-line", style: "color:var(--grad-1);margin-right:6px;" }),
    "Custom avatar",
  ));

  const hasCustom = !!state.me?.avatarModelUrl;

  const row = el("div", { class: "row" },
    el("div", { class: "label" },
      el("div", { class: "t" }, hasCustom ? "Custom avatar active" : "Use your own 3D character"),
      el("div", { class: "d" },
        hasCustom
          ? "Your profile and friends pages show your uploaded character."
          : "Upload a .glb (up to 3 MB) to replace the default soldier.",
      ),
    ),
    el("button", {
      class: `btn ${hasCustom ? "ghost" : "primary"}`,
      onclick: () => openAvatarCustomiser(),
    }, el("i", { class: hasCustom ? "ri-refresh-line" : "ri-upload-2-line" }),
      hasCustom ? " Replace" : " Upload",
    ),
  );
  card.appendChild(row);

  if (hasCustom) {
    const remove = el("div", { class: "row" },
      el("div", { class: "label" },
        el("div", { class: "t" }, "Remove custom avatar"),
        el("div", { class: "d" }, "Revert to the default Orbit soldier."),
      ),
      el("button", {
        class: "btn ghost",
        onclick: async () => {
          const { db, state: s, toast } = await _getAppHelpers();
          if (!confirm("Remove your custom avatar? You'll be back to the default soldier.")) return;
          try {
            await updateDoc(doc(db, "users", s.uid), {
              avatarModelUrl: null,
              avatarAnimationMap: null,
              avatarModelBytes: null,
            });
            s.me.avatarModelUrl = null;
            s.me.avatarAnimationMap = null;
            toast("Custom avatar removed");
            location.reload();
          } catch {
            toast("Could not remove avatar");
          }
        },
      }, el("i", { class: "ri-delete-bin-line" }), " Remove"),
    );
    card.appendChild(remove);
  }

  return card;
}

// =========================================================================
// Cleanup on page unload
// =========================================================================

window.addEventListener("beforeunload", () => stopPreview());

