/* ============================================================
   DRIFT — Complete Application JavaScript
   Single-file SPA: Globe · Feed · Explore · Profile · Chat · Stories · Notifications
   ============================================================ */

// ─────────────────────────────────────────
// 0a. DATA STORE — avoids JSON in onclick attrs
// ─────────────────────────────────────────
const _store = {};
function _put(key, val) { _store[key] = val; return key; }
function _get(key) { return _store[key]; }

// ─────────────────────────────────────────
// 0b. THEME
// ─────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem("drift-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeIcon(saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next    = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("drift-theme", next);
  updateThemeIcon(next);
}
function updateThemeIcon(theme) {
  document.querySelectorAll(".theme-toggle-icon").forEach(el => {
    el.innerHTML = theme === "dark"
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  });
}

// ─────────────────────────────────────────
// 0c. CONFIG — Replace with your credentials
// ─────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC9jF-ocy6HjsVzWVVlAyXW-4aIFgA79-A",
    authDomain: "crypto-6517d.firebaseapp.com",
    projectId: "crypto-6517d",
    storageBucket: "crypto-6517d.firebasestorage.app",
    messagingSenderId: "60263975159",
    appId: "1:60263975159:web:bd53dcaad86d6ed9592bf2"
};

const CLOUDINARY = {
  cloudName: "YOUR_CLOUD_NAME",
  uploadPreset: "YOUR_UPLOAD_PRESET"
};

const EARTH_TEX   = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/earth_atmos_2048.jpg";
const CLOUDS_TEX  = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/earth_clouds_1024.png";
const BUMP_TEX    = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/earth_normal_2048.jpg";
const NIGHT_TEX   = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/earth_lights_2048.png";

// ─────────────────────────────────────────
// 1. FIREBASE INIT
// ─────────────────────────────────────────
let db, auth, storage;
let currentUser = null;
let userProfile = null;

function initFirebase() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth    = firebase.auth();
    db      = firebase.firestore();
    console.log("Firebase ready");
  } catch(e) {
    console.warn("Firebase init error:", e.message);
    showToast("⚠️ Firebase not configured — using demo mode", "info");
  }
}

// ─────────────────────────────────────────
// 2. ROUTER — Page management
// ─────────────────────────────────────────
const pages = {};
let activePage = null;

function initRouter() {
  document.querySelectorAll(".page").forEach(p => {
    pages[p.id] = p;
    p.classList.remove("active"); // loader is visible; clear any initial active classes
  });

  document.querySelectorAll(".nav-item[data-page]").forEach(item => {
    item.addEventListener("click", () => {
      navigate(item.dataset.page);
      document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
      item.classList.add("active");
    });
  });
}

function navigate(pageId) {
  if (activePage) activePage.classList.remove("active");
  const target = pages[pageId];
  if (!target) return;
  target.classList.add("active");
  activePage = target;

  // Show/hide bottom nav (hidden on auth page)
  const nav = document.getElementById("bottom-nav");
  if (nav) nav.style.display = pageId === "page-auth" ? "none" : "";

  // Page-specific init hooks
  if (pageId === "page-globe")         initGlobe();
  if (pageId === "page-feed")          initFeed();
  if (pageId === "page-explore")       initExplore();
  if (pageId === "page-notifications") initNotifications();
  if (pageId === "page-chat")          initChatList();
  if (pageId === "page-profile")       initProfile();
}

// ─────────────────────────────────────────
// 3. AUTH
// ─────────────────────────────────────────
let authMode = "login";

function initAuth() {
  // Tab toggle
  document.querySelectorAll(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      authMode = tab.dataset.mode;
      const isSignup = authMode === "signup";
      document.getElementById("auth-name-group").style.display       = isSignup ? "flex" : "none";
      document.getElementById("auth-bio-group").style.display         = isSignup ? "flex" : "none";
      document.getElementById("auth-location-group").style.display    = isSignup ? "block" : "none";
      document.getElementById("auth-btn").textContent = isSignup ? "Create Account" : "Sign In";
    });
  });

  // Main auth action
  document.getElementById("auth-btn").addEventListener("click", handleEmailAuth);
  document.getElementById("auth-google-btn").addEventListener("click", handleGoogleAuth);

  // Enter key
  document.querySelectorAll("#page-auth .input").forEach(inp => {
    inp.addEventListener("keydown", e => { if (e.key === "Enter") handleEmailAuth(); });
  });

  // Auth state
  if (auth) {
    auth.onAuthStateChanged(async user => {
      if (user) {
        currentUser = user;
        await loadUserProfile(user.uid);
        hideLoader();
        navigate("page-globe");
        syncNavToPage("page-globe");
      } else {
        hideLoader();
        navigate("page-auth");
      }
    });
  } else {
    // Demo mode — skip auth
    setTimeout(() => {
      hideLoader();
      currentUser = { uid: "demo", displayName: "Demo User", email: "demo@drift.app", photoURL: null };
      userProfile = mockProfile();
      navigate("page-globe");
      syncNavToPage("page-globe");
    }, 1400);
  }
}

async function handleEmailAuth() {
  const email = document.getElementById("auth-email").value.trim();
  const pass  = document.getElementById("auth-pass").value;
  const name  = document.getElementById("auth-name")?.value?.trim();
  if (!email || !pass) { showToast("Please fill all fields", "error"); return; }

  // Signup requires location
  if (authMode === "signup") {
    const lat = document.getElementById("auth-lat")?.value;
    const locationText = document.getElementById("auth-location-text")?.value?.trim();
    if (!lat && !locationText) {
      showToast("Please share your location to continue", "error");
      document.getElementById("auth-location-group")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
  }

  setAuthLoading(true);
  try {
    let cred;
    if (authMode === "signup") {
      cred = await auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: name || "Drifter" });
      await createUserProfile(cred.user, name);
    } else {
      cred = await auth.signInWithEmailAndPassword(email, pass);
    }
    showToast("Welcome to Drift!", "success");
  } catch(e) {
    showToast(friendlyAuthError(e.code), "error");
  } finally {
    setAuthLoading(false);
  }
}

async function handleGoogleAuth() {
  if (!auth) return;
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const cred = await auth.signInWithPopup(provider);
    if (cred.additionalUserInfo?.isNewUser) {
      await createUserProfile(cred.user, cred.user.displayName);
    }
    showToast("Welcome back! 🌍", "success");
  } catch(e) {
    showToast(friendlyAuthError(e.code), "error");
  }
}

async function createUserProfile(user, name) {
  if (!db) return;
  const bio      = document.getElementById("auth-bio")?.value?.trim() || "";
  const lat      = parseFloat(document.getElementById("auth-lat")?.value || "0") || 0;
  const lng      = parseFloat(document.getElementById("auth-lng")?.value || "0") || 0;
  const locText  = document.getElementById("auth-location-text")?.value?.trim() || "";
  await db.collection("users").doc(user.uid).set({
    uid: user.uid,
    name: name || user.displayName || "Drifter",
    handle: "@" + (name || "drifter").toLowerCase().replace(/\s+/g,"") + Math.floor(Math.random()*9999),
    email: user.email,
    avatar: user.photoURL || null,
    bio: bio || "Just drifting around the world",
    location: locText || "Earth",
    lat, lng,
    followers: 0, following: 0, posts: 0,
    verified: false, online: true,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

// ── Mandatory location detection on signup ──
let _signupLat = null, _signupLng = null;

function detectSignupLocation() {
  const btn      = document.getElementById("location-detect-btn");
  const title    = document.getElementById("location-detect-title");
  const sub      = document.getElementById("location-detect-sub");
  const status   = document.getElementById("location-detect-status");

  if (!navigator.geolocation) {
    showToast("Geolocation not supported — type your city below", "info");
    return;
  }

  title.textContent = "Detecting location...";
  sub.textContent   = "Please allow location access";
  status.innerHTML  = `<div class="spinner" style="width:18px;height:18px;border-width:2px"></div>`;

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      _signupLat = pos.coords.latitude;
      _signupLng = pos.coords.longitude;
      document.getElementById("auth-lat").value = _signupLat;
      document.getElementById("auth-lng").value = _signupLng;

      // Reverse geocode using a free API
      let cityLabel = `${_signupLat.toFixed(2)}, ${_signupLng.toFixed(2)}`;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${_signupLat}&lon=${_signupLng}&format=json`);
        const d = await r.json();
        cityLabel = d.address?.city || d.address?.town || d.address?.state || d.address?.country || cityLabel;
        document.getElementById("auth-location-text").value = cityLabel;
      } catch(e) {
        document.getElementById("auth-location-text").value = cityLabel;
      }

      btn.classList.add("detected");
      title.textContent = cityLabel;
      sub.textContent   = "Location confirmed";
      status.innerHTML  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      status.classList.add("ok");
    },
    () => {
      title.textContent = "Detect my location";
      sub.textContent   = "Couldn't access location — type your city below";
      status.innerHTML  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
      showToast("Location blocked — type your city manually", "info");
    }
  );
}

async function loadUserProfile(uid) {
  if (!db) { userProfile = mockProfile(); return; }
  const snap = await db.collection("users").doc(uid).get();
  if (snap.exists) {
    userProfile = snap.data();
  } else {
    userProfile = mockProfile();
  }
  renderMyProfile();
}

function setAuthLoading(on) {
  const btn = document.getElementById("auth-btn");
  btn.disabled = on;
  btn.innerHTML = on
    ? `<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>`
    : (authMode === "signup" ? "Create Account" : "Sign In");
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found": "No account with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "Email already registered.",
    "auth/weak-password": "Password must be 6+ characters.",
    "auth/invalid-email": "Invalid email address.",
    "auth/too-many-requests": "Too many attempts. Try later.",
    "auth/popup-closed-by-user": "Sign-in popup was closed."
  };
  return map[code] || "Authentication failed.";
}

function signOut() {
  if (auth) auth.signOut();
  currentUser = null;
  userProfile = null;
  document.getElementById("edit-profile-overlay")?.classList.remove("open");
  document.getElementById("profile-menu-overlay")?.classList.remove("open");
  navigate("page-auth");
  showToast("Signed out", "info");
}

// ─────────────────────────────────────────
// 4. 3D EARTH GLOBE
// ─────────────────────────────────────────
let globeScene, globeCamera, globeRenderer, globeEarth, globeClouds;
let globeInitialized = false;
let globeAnimId = null;
let globeUsers = [];
let globeMarkers = [];
let globeIsDragging = false;
let globePrev = { x: 0, y: 0 };
let globeVel  = { x: 0, y: 0 };
let globeZoom = 2.5;

function initGlobe() {
  const container = document.getElementById("globe-canvas-container");
  if (!container || globeInitialized) return;
  globeInitialized = true;

  // Three.js scene
  const THREE = window.THREE;
  if (!THREE) { console.warn("Three.js not loaded"); return; }

  globeScene  = new THREE.Scene();
  globeCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  globeCamera.position.z = globeZoom;

  globeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  globeRenderer.setSize(container.clientWidth, container.clientHeight);
  globeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  globeRenderer.setClearColor(0x000000, 0);
  container.appendChild(globeRenderer.domElement);

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const starCount = 6000;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount * 3; i++) starPositions[i] = (Math.random() - 0.5) * 300;
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.8 });
  globeScene.add(new THREE.Points(starGeo, starMat));

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  globeScene.add(ambient);
  const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.4);
  sunLight.position.set(5, 3, 5);
  globeScene.add(sunLight);

  // Earth sphere
  const loader = new THREE.TextureLoader();
  const earthGeo = new THREE.SphereGeometry(1, 64, 64);
  const earthMat = new THREE.MeshPhongMaterial({
    map:         loader.load(EARTH_TEX),
    bumpMap:     loader.load(BUMP_TEX),
    bumpScale:   0.04,
    specularMap: loader.load(NIGHT_TEX),
    specular:    new THREE.Color(0x222222),
    shininess:   8
  });
  globeEarth = new THREE.Mesh(earthGeo, earthMat);
  globeScene.add(globeEarth);

  // Clouds layer
  const cloudGeo = new THREE.SphereGeometry(1.008, 48, 48);
  const cloudMat = new THREE.MeshPhongMaterial({
    map:         loader.load(CLOUDS_TEX),
    transparent: true,
    opacity:     0.6,
    depthWrite:  false
  });
  globeClouds = new THREE.Mesh(cloudGeo, cloudMat);
  globeScene.add(globeClouds);

  // Atmosphere glow
  const atmGeo = new THREE.SphereGeometry(1.12, 32, 32);
  const atmMat = new THREE.MeshPhongMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.08,
    side: THREE.BackSide
  });
  globeScene.add(new THREE.Mesh(atmGeo, atmMat));

  // Load users and place markers
  loadGlobeUsers();

  // Controls
  setupGlobeControls(container);

  // Resize
  window.addEventListener("resize", () => {
    if (!globeCamera || !globeRenderer) return;
    globeCamera.aspect = container.clientWidth / container.clientHeight;
    globeCamera.updateProjectionMatrix();
    globeRenderer.setSize(container.clientWidth, container.clientHeight);
  });

  // Animate
  animateGlobe();
  updateGlobeStats();
}

function animateGlobe() {
  globeAnimId = requestAnimationFrame(animateGlobe);
  if (!globeEarth) return;

  if (!globeIsDragging) {
    globeEarth.rotation.y  += globeVel.x * 0.95;
    globeEarth.rotation.x  += globeVel.y * 0.95;
    globeVel.x *= 0.92;
    globeVel.y *= 0.92;
    if (Math.abs(globeVel.x) < 0.0001) globeVel.x = 0;
    if (Math.abs(globeVel.y) < 0.0001) { globeVel.y = 0; globeEarth.rotation.y += 0.0008; }
  }

  globeClouds.rotation.y = globeEarth.rotation.y + performance.now() * 0.00002;
  globeClouds.rotation.x = globeEarth.rotation.x;

  // Sync markers with earth rotation
  globeMarkers.forEach(m => {
    m.mesh.rotation.y = globeEarth.rotation.y;
    m.mesh.rotation.x = globeEarth.rotation.x;
  });

  globeRenderer.render(globeScene, globeCamera);
}

function latLngToVector3(lat, lng, radius) {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
     (radius * Math.cos(phi)),
     (radius * Math.sin(phi) * Math.sin(theta))
  );
}

function addGlobeMarker(user) {
  const THREE = window.THREE;
  const lat = user.lat || (Math.random() * 160 - 80);
  const lng = user.lng || (Math.random() * 360 - 180);
  const pos = latLngToVector3(lat, lng, 1.02);

  // Outer ring
  const ringGeo = new THREE.RingGeometry(0.018, 0.026, 16);
  const ringMat = new THREE.MeshBasicMaterial({ color: user.hasStory ? 0xF9A825 : 0x6C63FF, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const ring = new THREE.Mesh(ringGeo, ringMat);

  // Inner dot
  const dotGeo = new THREE.SphereGeometry(0.014, 8, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dot = new THREE.Mesh(dotGeo, dotMat);

  const group = new THREE.Group();
  group.add(ring);
  group.add(dot);
  group.position.copy(pos);
  group.lookAt(new THREE.Vector3(0, 0, 0));
  group.rotateX(Math.PI / 2);

  group._userData = { ...user, lat, lng };
  globeScene.add(group);
  globeMarkers.push({ mesh: group, user, lat, lng });
}

async function loadGlobeUsers() {
  const users = db
    ? await db.collection("users").limit(80).get().then(s => s.docs.map(d => d.data()))
    : generateMockUsers(60);

  globeUsers = users;
  users.forEach(u => addGlobeMarker(u));
  updateGlobeStats();
}

function setupGlobeControls(container) {
  const el = container;

  // Mouse
  el.addEventListener("mousedown", e => { globeIsDragging = true; globePrev = { x: e.clientX, y: e.clientY }; globeVel = { x: 0, y: 0 }; });
  window.addEventListener("mouseup", e => {
    if (!globeIsDragging) return;
    globeIsDragging = false;
    handleGlobeClick(e, container);
  });
  window.addEventListener("mousemove", e => {
    if (!globeIsDragging) return;
    const dx = (e.clientX - globePrev.x) * 0.004;
    const dy = (e.clientY - globePrev.y) * 0.004;
    globeEarth.rotation.y += dx;
    globeEarth.rotation.x += dy;
    globeEarth.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, globeEarth.rotation.x));
    globeVel.x = dx;
    globeVel.y = dy;
    globePrev = { x: e.clientX, y: e.clientY };
  });

  // Wheel zoom
  el.addEventListener("wheel", e => {
    e.preventDefault();
    globeZoom = Math.max(1.4, Math.min(8, globeZoom + e.deltaY * 0.002));
    globeCamera.position.z = globeZoom;
  }, { passive: false });

  // Touch
  let touches = [];
  let initDist = 0;
  el.addEventListener("touchstart", e => {
    touches = Array.from(e.touches);
    if (touches.length === 1) { globeIsDragging = true; globePrev = { x: touches[0].clientX, y: touches[0].clientY }; globeVel = { x: 0, y: 0 }; }
    if (touches.length === 2) { initDist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); }
  }, { passive: true });

  el.addEventListener("touchmove", e => {
    e.preventDefault();
    const t = Array.from(e.touches);
    if (t.length === 1 && globeIsDragging) {
      const dx = (t[0].clientX - globePrev.x) * 0.005;
      const dy = (t[0].clientY - globePrev.y) * 0.005;
      globeEarth.rotation.y += dx;
      globeEarth.rotation.x += dy;
      globeEarth.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, globeEarth.rotation.x));
      globeVel.x = dx;
      globeVel.y = dy;
      globePrev = { x: t[0].clientX, y: t[0].clientY };
    }
    if (t.length === 2) {
      const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      const scale = initDist / dist;
      globeZoom = Math.max(1.4, Math.min(8, globeZoom * (1 + (scale - 1) * 0.08)));
      globeCamera.position.z = globeZoom;
      initDist = dist;
    }
  }, { passive: false });

  el.addEventListener("touchend", e => {
    if (e.changedTouches.length === 1 && globeIsDragging) {
      handleGlobeClick(e.changedTouches[0], container, true);
    }
    globeIsDragging = false;
  }, { passive: true });
}

function handleGlobeClick(event, container, isTouch = false) {
  if (Math.abs(globeVel.x) > 0.01 || Math.abs(globeVel.y) > 0.01) return;
  const THREE = window.THREE;
  if (!THREE) return;

  const rect = container.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width)  * 2 - 1;
  const y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera({ x, y }, globeCamera);

  const meshes = globeMarkers.map(m => m.mesh);
  const hits   = raycaster.intersectObjects(meshes, true);

  if (hits.length > 0) {
    const hitGroup = hits[0].object.parent;
    const userData = hitGroup._userData;
    if (userData) showGlobePopup(userData);
  } else {
    hideGlobePopup();
  }
}

function showGlobePopup(user) {
  const popup = document.getElementById("globe-popup");
  document.getElementById("globe-popup-avatar").textContent = avatarInitials(user.name || "?");
  document.getElementById("globe-popup-avatar").style.background = randomGradient(user.uid || "x");
  if (user.avatar) {
    document.getElementById("globe-popup-avatar").innerHTML = `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
  document.getElementById("globe-popup-name").textContent = user.name || "Drifter";
  document.getElementById("globe-popup-handle").textContent = user.handle || "@drifter";
  document.getElementById("globe-popup-loc").textContent   = user.location || `${(user.lat||0).toFixed(2)}°, ${(user.lng||0).toFixed(2)}°`;
  document.getElementById("globe-popup-follow").onclick = () => followUser(user.uid);
  document.getElementById("globe-popup-msg").onclick     = () => openChat(user);
  document.getElementById("globe-popup-profile").onclick  = () => openUserProfile(user);
  popup.classList.add("show");
}

function hideGlobePopup() { document.getElementById("globe-popup").classList.remove("show"); }

function updateGlobeStats() {
  const total  = globeUsers.length;
  const online = globeUsers.filter(u => u.online).length || Math.floor(total * 0.3);
  const countries = new Set(globeUsers.map(u => u.country || "Unknown")).size;
  safeSet("globe-stat-users", total.toLocaleString());
  safeSet("globe-stat-online", online.toLocaleString());
  safeSet("globe-stat-countries", countries || "190");
}

// ─────────────────────────────────────────
// 5. FEED — Swipe Cards
// ─────────────────────────────────────────
let feedPosts     = [];
let feedIndex     = 0;
let feedMiniGlobes = {};
let isDragging    = false;
let dragStart     = { x: 0, y: 0 };
let currentCard   = null;
let currentSwipePost = null;
let feedInitialized = false;

function initFeed() {
  renderStories();
  if (!feedInitialized) {
    loadFeedPosts();
    feedInitialized = true;
  }
}

async function loadFeedPosts() {
  showFeedLoading();
  feedPosts = db
    ? await db.collection("posts").orderBy("createdAt","desc").limit(30).get()
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    : generateMockPosts(20);
  feedIndex = 0;
  renderFeedCards();
}

function showFeedLoading() {
  const stage = document.getElementById("swipe-stage");
  stage.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:16px;color:var(--text3)">
      <div class="spinner" style="width:36px;height:36px;border-width:3px"></div>
      <span style="font-size:.875rem;font-weight:600">Finding posts near you</span>
    </div>`;
}

function renderFeedCards() {
  const stage = document.getElementById("swipe-stage");
  const remaining = feedPosts.slice(feedIndex);

  if (remaining.length === 0) {
    stage.innerHTML = `
      <div class="swipe-empty">
        <div class="swipe-empty-icon">🌍</div>
        <h3>You've seen it all</h3>
        <p>Come back later for more posts from around the world</p>
        <button class="btn btn-primary btn-sm" onclick="reloadFeed()" style="margin-top:8px">Refresh</button>
      </div>`;
    return;
  }

  stage.innerHTML = "";
  const preview = remaining.slice(0, 3);
  preview.reverse().forEach((post, i) => {
    const card = buildSwipeCard(post, i === preview.length - 1);
    stage.prepend(card);
  });

  setupTopCardSwipe();
}

function buildSwipeCard(post, isTop) {
  const card = document.createElement("div");
  card.className = "swipe-card" + (isTop ? " top" : "");
  card.dataset.id = post.id;

  const mediaHTML = post.imageUrl
    ? `<img src="${post.imageUrl}" alt="post" loading="lazy" draggable="false">`
    : `<div class="swipe-media-placeholder"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>`;

  const locPin = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="opacity:.7"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
  const globeIco = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.48)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

  card.innerHTML = `
    <div class="swipe-media">
      ${mediaHTML}
      <div class="mini-globe-wrap">
        <div class="mini-globe-inner">
          <div class="mini-globe-land" style="width:18px;height:12px;top:14px;left:8px;border-radius:60% 40% 50% 60%"></div>
          <div class="mini-globe-land" style="width:12px;height:8px;top:28px;left:24px;border-radius:50% 60% 40% 55%"></div>
          <div class="mini-globe-land" style="width:10px;height:7px;top:20px;left:30px;border-radius:55% 45% 60% 50%"></div>
        </div>
        <div class="mini-globe-pin"></div>
      </div>
      <div class="swipe-overlay-like" id="like-label-${post.id}">LIKE</div>
      <div class="swipe-overlay-pass" id="pass-label-${post.id}">PASS</div>
      <div class="card-gradient"></div>
      <div class="card-body">
        <div class="card-user">
          <div class="avatar av-36" style="background:${randomGradient(post.uid||'x')}" id="cu-${post.id}">
            ${post.userAvatar ? `<img src="${post.userAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : avatarInitials(post.userName||'?')}
          </div>
          <div>
            <div class="card-username">${post.userName||"Drifter"} ${post.verified?'<span class="verified" style="color:#8B85FF;font-size:.75rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg></span>':''}</div>
            <div class="card-location">${locPin} ${post.location||"Earth"}</div>
          </div>
        </div>
        <div class="card-caption">${post.caption||""}</div>
        <div class="card-time-distance">
          <span>${timeAgo(post.createdAt)}</span>
          <span style="display:flex;align-items:center;gap:3px">${globeIco}${post.country||""}</span>
        </div>
      </div>
    </div>`;
  return card;
}

function setupTopCardSwipe() {
  const card = document.querySelector(".swipe-card.top");
  if (!card) return;
  currentCard = card;
  currentSwipePost = feedPosts[feedIndex];

  let startX, startY, startTime;

  const onStart = (x, y) => {
    isDragging = true;
    startX = x; startY = y;
    startTime = Date.now();
    card.style.transition = "none";
  };

  const onMove = (x, y) => {
    if (!isDragging) return;
    const dx = x - startX;
    const dy = y - startY;
    const rot = dx * 0.06;
    card.style.transform = `translate(${dx}px,${dy}px) rotate(${rot}deg)`;

    const ratio = Math.min(Math.abs(dx) / 100, 1);
    const likeEl = document.getElementById(`like-label-${currentSwipePost?.id}`);
    const passEl = document.getElementById(`pass-label-${currentSwipePost?.id}`);
    if (likeEl) likeEl.style.opacity = dx > 30  ? ratio : 0;
    if (passEl) passEl.style.opacity = dx < -30 ? ratio : 0;
  };

  const onEnd = (x) => {
    if (!isDragging) return;
    isDragging = false;
    const dx     = x - startX;
    const elapsed = Date.now() - startTime;
    const velocity = Math.abs(dx) / elapsed;

    if (dx > 80 || (velocity > 0.5 && dx > 20)) {
      swipeCard("like");
    } else if (dx < -80 || (velocity > 0.5 && dx < -20)) {
      swipeCard("pass");
    } else {
      card.style.transition = "transform 0.4s cubic-bezier(0.34,1.56,0.64,1)";
      card.style.transform  = "";
      const likeEl = document.getElementById(`like-label-${currentSwipePost?.id}`);
      const passEl = document.getElementById(`pass-label-${currentSwipePost?.id}`);
      if (likeEl) likeEl.style.opacity = 0;
      if (passEl) passEl.style.opacity = 0;
    }
  };

  // Mouse
  card.addEventListener("mousedown",  e => { e.preventDefault(); onStart(e.clientX, e.clientY); });
  window.addEventListener("mousemove", e => onMove(e.clientX, e.clientY));
  window.addEventListener("mouseup",   e => onEnd(e.clientX));

  // Touch
  card.addEventListener("touchstart", e => { const t = e.touches[0]; onStart(t.clientX, t.clientY); }, { passive: true });
  card.addEventListener("touchmove",  e => { const t = e.touches[0]; onMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  card.addEventListener("touchend",   e => { const t = e.changedTouches[0]; onEnd(t.clientX); }, { passive: true });
}

function swipeCard(action) {
  if (!currentCard || !currentSwipePost) return;
  const card = currentCard;
  const post  = currentSwipePost;

  card.style.transition = "transform 0.45s cubic-bezier(0.4,0,0.2,1), opacity 0.4s";
  card.style.transform  = action === "like"
    ? "translate(130vw, -20px) rotate(20deg)"
    : "translate(-130vw, -20px) rotate(-20deg)";
  card.style.opacity = "0";

  if (action === "like") {
    likePost(post);
    showToast("❤️ Liked!", "success");
    spawnLikeEffect();
  }

  feedIndex++;
  setTimeout(() => { card.remove(); renderFeedCards(); }, 420);
}

function spawnLikeEffect() {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:999;pointer-events:none;animation:heartPop .7s ease-out forwards;color:#FF6B9D`;
  el.innerHTML = `<svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  document.body.appendChild(el);
  if (!document.getElementById("heart-style")) {
    const s = document.createElement("style");
    s.id = "heart-style";
    s.textContent = "@keyframes heartPop{0%{opacity:1;transform:translate(-50%,-50%) scale(0)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.4)}100%{opacity:0;transform:translate(-50%,-70%) scale(1)}}";
    document.head.appendChild(s);
  }
  setTimeout(() => el.remove(), 700);
}

function reloadFeed() { feedInitialized = false; feedIndex = 0; initFeed(); }

function btnSwipeLike() { if (currentCard) swipeCard("like"); }
function btnSwipePass() { if (currentCard) swipeCard("pass"); }
function btnSwipeSuper() {
  if (!currentCard || !currentSwipePost) return;
  likePost(currentSwipePost, true);
  showToast("⭐ Super liked!", "success");
  currentCard.style.transition = "transform 0.5s, opacity 0.4s";
  currentCard.style.transform  = "translateY(-120vh)";
  currentCard.style.opacity    = "0";
  feedIndex++;
  setTimeout(() => { currentCard.remove(); renderFeedCards(); }, 480);
}

async function likePost(post, isSuper = false) {
  if (!db || !currentUser) return;
  await db.collection("posts").doc(post.id).update({
    likes: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
  });
  await db.collection("notifications").add({
    toUid: post.uid,
    fromUid: currentUser.uid,
    fromName: userProfile?.name || "Someone",
    fromAvatar: userProfile?.avatar || null,
    type: isSuper ? "super_like" : "like",
    postId: post.id,
    postThumb: post.imageUrl || null,
    read: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ── Mini Globe — CSS-only (replaced Three.js per-card renderers for performance) ──
function initMiniGlobe(post) { /* no-op — CSS globe used instead */ }

// ─────────────────────────────────────────
// 6. COMMENTS
// ─────────────────────────────────────────
let commentsPostId = null;

function openComments(postId) {
  commentsPostId = postId;
  const overlay = document.getElementById("comments-overlay");
  overlay.classList.add("open");
  loadComments(postId);
}

function closeComments() {
  document.getElementById("comments-overlay").classList.remove("open");
  commentsPostId = null;
}

async function loadComments(postId) {
  const list = document.getElementById("comments-list");
  list.innerHTML = `<div style="text-align:center;padding:20px"><div class="spinner"></div></div>`;

  const comments = db
    ? await db.collection("posts").doc(postId).collection("comments")
        .orderBy("createdAt","asc").limit(50).get()
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    : generateMockComments();

  if (comments.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:30px">
      <div class="empty-state-icon">💬</div>
      <h3>No comments yet</h3>
      <p>Be the first to comment!</p>
    </div>`;
    return;
  }

  list.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="avatar av-36" style="background:${randomGradient(c.uid||'x')};flex-shrink:0">
        ${c.userAvatar ? `<img src="${c.userAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : avatarInitials(c.userName||'?')}
      </div>
      <div class="comment-body">
        <div class="comment-name">
          <span>${c.userName||"Drifter"}</span>
          ${c.verified ? '<span class="verified" style="font-size:12px">✓</span>' : ''}
        </div>
        <div class="comment-text">${c.text}</div>
        <div class="comment-meta">
          <span>${timeAgo(c.createdAt)}</span>
          <span class="comment-like-btn" onclick="likeComment('${c.id}',this)">
            ♡ <span class="comment-like-count">${c.likes||0}</span>
          </span>
          <span style="cursor:pointer" onclick="replyToComment('${c.userName}')">Reply</span>
        </div>
      </div>
    </div>`).join("");
}

async function submitComment() {
  if (!commentsPostId) return;
  const inp = document.getElementById("comment-input");
  const text = inp.value.trim();
  if (!text) return;
  inp.value = "";
  const comment = {
    text,
    uid: currentUser?.uid || "demo",
    userName: userProfile?.name || currentUser?.displayName || "You",
    userAvatar: userProfile?.avatar || currentUser?.photoURL || null,
    verified: userProfile?.verified || false,
    likes: 0,
    createdAt: new Date()
  };
  if (db && currentUser) {
    await db.collection("posts").doc(commentsPostId).collection("comments").add({
      ...comment,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  loadComments(commentsPostId);
}

function replyToComment(name) {
  const inp = document.getElementById("comment-input");
  inp.value = `@${name} `;
  inp.focus();
}

async function likeComment(commentId, el) {
  el.classList.toggle("liked");
  const countEl = el.querySelector(".comment-like-count");
  const current = parseInt(countEl.textContent) || 0;
  countEl.textContent = el.classList.contains("liked") ? current + 1 : current - 1;
}

// ─────────────────────────────────────────
// 7. STORIES
// ─────────────────────────────────────────
let storyData     = [];
let storyUser     = null;
let storyIdx      = 0;
let storyTimer    = null;
let storyProgress = null;

async function loadStoriesForBar() {
  storyData = db
    ? await db.collection("stories")
        .where("expiresAt", ">", new Date())
        .orderBy("expiresAt","desc").limit(30).get()
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    : generateMockStories();
  return storyData;
}

async function renderStories() {
  const stories = await loadStoriesForBar();
  const bar = document.getElementById("stories-bar");

  // Group by user
  const byUser = {};
  stories.forEach(s => {
    if (!byUser[s.uid]) byUser[s.uid] = { user: s, items: [] };
    byUser[s.uid].items.push(s);
  });

  const myStoryBtn = `
    <div class="story-item" onclick="openCreateStory()">
      <div class="story-add">＋</div>
      <span class="story-name">Your Story</span>
    </div>`;

  const storyItems = Object.values(byUser).map(({ user, items }) => {
    const key = _put("story_" + user.uid, user);
    return `
    <div class="story-item" onclick="openStoryById('${key}')">
      <div class="story-ring ${user.seenBy?.includes(currentUser?.uid) ? 'seen' : ''}">
        <div class="story-ring-inner">
          ${user.userAvatar
            ? `<img src="${user.userAvatar}" alt="${user.userName}">`
            : `<span>${avatarInitials(user.userName||'?')}</span>`}
        </div>
      </div>
      <span class="story-name">${user.userName||"Drifter"}</span>
    </div>`;
  }).join("");

  bar.innerHTML = myStoryBtn + storyItems;
}

function openStoryById(key) { openStory(_get(key)); }

function openStory(user) {
  const items = storyData.filter(s => s.uid === user.uid);
  if (!items.length) return;
  storyUser = user;
  storyIdx  = 0;

  const viewer = document.getElementById("story-viewer");
  viewer.classList.add("open");
  renderStoryItem(items, 0);
}

function renderStoryItem(items, idx) {
  const item = items[idx];
  if (!item) { closeStory(); return; }

  document.getElementById("sv-name").textContent   = storyUser.userName || "Drifter";
  document.getElementById("sv-time").textContent   = timeAgo(item.createdAt);
  document.getElementById("sv-avatar").style.background = randomGradient(storyUser.uid||"x");
  document.getElementById("sv-avatar").textContent = avatarInitials(storyUser.userName||"?");

  const mediaEl = document.getElementById("sv-media");
  if (item.type === "video" && item.url) {
    mediaEl.innerHTML = `<video src="${item.url}" autoplay muted loop style="width:100%;height:100%;object-fit:cover"></video>`;
  } else if (item.url) {
    mediaEl.innerHTML = `<img src="${item.url}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    mediaEl.innerHTML = `<div class="story-placeholder" style="background:linear-gradient(135deg,${item.bgColor||'#6C63FF'},#FF6B9D);width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px">
      <span style="font-size:3rem">${item.emoji||'🌍'}</span>
      <span style="color:#fff;font-size:1.25rem;font-weight:700;text-align:center;padding:0 32px">${item.text||''}</span>
    </div>`;
  }

  // Progress bars
  const barsContainer = document.getElementById("sv-progress-bars");
  barsContainer.innerHTML = items.map((_, i) => `
    <div class="story-progress-bar">
      <div class="story-progress-fill" id="spf-${i}" style="width:${i < idx ? '100%' : '0%'}"></div>
    </div>`).join("");

  clearTimeout(storyTimer);
  const duration = item.duration || 5000;
  const fill = document.getElementById(`spf-${idx}`);
  if (fill) {
    fill.style.transition = `width ${duration}ms linear`;
    fill.style.width = "100%";
  }
  storyTimer = setTimeout(() => {
    if (idx + 1 < items.length) renderStoryItem(items, idx + 1);
    else closeStory();
  }, duration);

  // Mark as seen
  if (db && currentUser && item.id) {
    db.collection("stories").doc(item.id).update({
      seenBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
    }).catch(() => {});
  }
}

function closeStory() {
  clearTimeout(storyTimer);
  document.getElementById("story-viewer").classList.remove("open");
}

function storyTapLeft() {
  const items = storyData.filter(s => s.uid === storyUser?.uid);
  if (storyIdx > 0) renderStoryItem(items, --storyIdx);
  else closeStory();
}

function storyTapRight() {
  const items = storyData.filter(s => s.uid === storyUser?.uid);
  renderStoryItem(items, ++storyIdx);
}

// ─────────────────────────────────────────
// 8. EXPLORE
// ─────────────────────────────────────────
let exploreInitialized = false;
let searchTimeout      = null;

function initExplore() {
  if (exploreInitialized) return;
  exploreInitialized = true;
  renderExploreGrid();
  renderTrending();
  renderPeopleToFollow();
}

async function renderExploreGrid() {
  const posts = db
    ? await db.collection("posts").orderBy("likes","desc").limit(12).get()
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    : generateMockPosts(12);

  const grid = document.getElementById("explore-grid");
  if (!grid) return;

  grid.innerHTML = posts.map((p, i) => `
    <div class="explore-grid-item${i === 0 ? ' explore-grid-large' : ''}" onclick="openPost('${p.id}')">
      ${p.imageUrl
        ? `<img src="${p.imageUrl}" loading="lazy" alt="post">`
        : `<div style="width:100%;height:100%;background:linear-gradient(135deg,${randomColor()},${randomColor()});display:flex;align-items:center;justify-content:center;font-size:2rem">🌍</div>`}
      <div class="explore-grid-item-overlay">
        <span style="color:#fff;font-size:.75rem;font-weight:600">❤️ ${p.likes?.length||Math.floor(Math.random()*500)}</span>
      </div>
    </div>`).join("");
}

async function renderTrending() {
  const tags  = document.getElementById("trending-list");
  if (!tags) return;
  const items = [
    { tag: "#drift", count: "2.4M posts", rank: 1 },
    { tag: "#globelife", count: "1.8M posts", rank: 2 },
    { tag: "#worldvibes", count: "987K posts", rank: 3 },
    { tag: "#wanderlust", count: "742K posts", rank: 4 },
    { tag: "#earthlings", count: "631K posts", rank: 5 },
    { tag: "#citylights", count: "528K posts", rank: 6 },
  ];
  tags.innerHTML = items.map(t => `
    <div class="trending-item" onclick="searchTag('${t.tag}')">
      <div class="trending-rank${t.rank <= 3 ? ' top' : ''}">#${t.rank}</div>
      <div class="trending-info">
        <div class="trending-tag">${t.tag}</div>
        <div class="trending-count">${t.count}</div>
      </div>
      <span style="color:var(--text3);font-size:1.1rem">›</span>
    </div>`).join("");
}

async function renderPeopleToFollow() {
  const container = document.getElementById("people-scroll");
  if (!container) return;
  const people = db
    ? await db.collection("users").limit(10).get().then(s => s.docs.map(d => d.data()))
    : generateMockUsers(10);

  container.innerHTML = people.map(u => {
    const key = _put("user_" + u.uid, u);
    return `
    <div class="people-card" onclick="openUserProfileById('${key}')">
      <div class="avatar av-56" style="background:${randomGradient(u.uid||'x')}">
        ${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : avatarInitials(u.name||'?')}
      </div>
      <div class="people-name">${u.name||"Drifter"}</div>
      <div class="people-handle">${u.handle||"@drifter"}</div>
      <button class="people-follow-btn" onclick="event.stopPropagation();toggleFollowBtn(this,'${u.uid}')">Follow</button>
    </div>`;
  }).join("");
}

function searchTag(tag) {
  navigate("page-explore");
  document.getElementById("explore-search-input").value = tag;
  handleSearch(tag);
}

function handleSearch(q) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    if (!q.trim()) { renderExploreGrid(); return; }
    // Search posts by caption or location
    const posts = db
      ? await db.collection("posts")
          .where("caption",">=",q).where("caption","<=",q+"\uf8ff")
          .limit(12).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
      : generateMockPosts(6);
    const grid = document.getElementById("explore-grid");
    if (grid) grid.innerHTML = posts.length
      ? posts.map(p => `<div class="explore-grid-item" onclick="openPost('${p.id}')">
          ${p.imageUrl ? `<img src="${p.imageUrl}" loading="lazy">` : `<div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:2rem">🌍</div>`}
        </div>`).join("")
      : `<div class="empty-state" style="grid-column:span 3;padding:40px"><div class="empty-state-icon">🔍</div><h3>No results</h3></div>`;
  }, 400);
}

function toggleFollowBtn(btn, uid) {
  const isFollowing = btn.classList.contains("following");
  btn.classList.toggle("following");
  btn.textContent = isFollowing ? "Follow" : "Following";
  followUser(uid, isFollowing);
}

async function followUser(uid, unfollow = false) {
  if (!db || !currentUser || uid === currentUser.uid) return;
  const ref = db.collection("users").doc(currentUser.uid);
  if (unfollow) {
    ref.update({ following: firebase.firestore.FieldValue.increment(-1) });
    db.collection("users").doc(uid).update({ followers: firebase.firestore.FieldValue.increment(-1) });
  } else {
    ref.update({ following: firebase.firestore.FieldValue.increment(1) });
    db.collection("users").doc(uid).update({ followers: firebase.firestore.FieldValue.increment(1) });
    db.collection("notifications").add({
      toUid: uid, fromUid: currentUser.uid,
      fromName: userProfile?.name || "Someone",
      fromAvatar: userProfile?.avatar || null,
      type: "follow", read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

// ─────────────────────────────────────────
// 9. PROFILE
// ─────────────────────────────────────────
let profileInitialized = false;
let activeProfileTab   = "posts";

function initProfile() { if (!profileInitialized) { renderMyProfile(); profileInitialized = true; } }

function renderMyProfile() {
  const u = userProfile || mockProfile();
  safeSet("profile-name",     u.name || "Drifter");
  safeSet("profile-handle",   u.handle || "@drifter");
  safeSet("profile-bio",      u.bio || "Just drifting around 🌍");
  safeSet("profile-location-text", u.location || "Earth");
  safeSet("profile-followers",  formatCount(u.followers || 0));
  safeSet("profile-following",  formatCount(u.following || 0));
  safeSet("profile-posts-count",formatCount(u.posts || 0));

  const avEl = document.getElementById("profile-avatar");
  if (avEl) {
    avEl.style.background = randomGradient(u.uid || "me");
    if (u.avatar) {
      avEl.innerHTML = `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      avEl.textContent = avatarInitials(u.name || "?");
    }
  }
  const coverEl = document.getElementById("profile-cover-img");
  if (coverEl && u.coverUrl) coverEl.src = u.coverUrl;

  loadProfilePosts(u.uid || "demo");
}

async function loadProfilePosts(uid) {
  const grid = document.getElementById("profile-posts-grid");
  if (!grid) return;
  grid.innerHTML = Array(6).fill(`<div class="skeleton" style="aspect-ratio:1"></div>`).join("");

  const posts = db
    ? await db.collection("posts").where("uid","==",uid)
        .orderBy("createdAt","desc").limit(30).get()
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    : generateMockPosts(12).map(p => ({ ...p, uid }));

  if (!posts.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:span 3;padding:40px"><div class="empty-state-icon">📸</div><h3>No posts yet</h3><p>Share your first moment with the world</p></div>`;
    return;
  }

  grid.innerHTML = posts.map(p => `
    <div class="profile-grid-item" onclick="openPost('${p.id}')">
      ${p.imageUrl
        ? `<img src="${p.imageUrl}" loading="lazy">`
        : `<div style="width:100%;height:100%;background:linear-gradient(135deg,${randomColor()},${randomColor()});display:flex;align-items:center;justify-content:center;font-size:2rem">🌍</div>`}
      ${p.type==="video" ? '<span class="profile-grid-item-type">▶</span>' : ''}
    </div>`).join("");
}

function switchProfileTab(tab) {
  activeProfileTab = tab;
  document.querySelectorAll(".profile-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  document.getElementById("profile-posts-grid").style.display   = tab === "posts"  ? "grid" : "none";
  document.getElementById("profile-liked-list").style.display   = tab === "liked"  ? "flex" : "none";
  if (tab === "liked") loadLikedPosts();
}

async function loadLikedPosts() {
  const list = document.getElementById("profile-liked-list");
  if (!list) return;
  list.innerHTML = `<div style="padding:20px;text-align:center"><div class="spinner"></div></div>`;
  const posts = db && currentUser
    ? await db.collection("posts").where("likes","array-contains",currentUser.uid)
        .orderBy("createdAt","desc").limit(20).get()
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    : generateMockPosts(6);
  list.innerHTML = posts.map(p => buildFeedListItem(p)).join("");
}

function buildFeedListItem(p) {
  return `
    <div style="display:flex;gap:12px;padding:14px;border-bottom:1px solid var(--border);cursor:pointer" onclick="openPost('${p.id}')">
      ${p.imageUrl
        ? `<img src="${p.imageUrl}" style="width:64px;height:64px;border-radius:var(--radius);object-fit:cover;flex-shrink:0">`
        : `<div style="width:64px;height:64px;border-radius:var(--radius);background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0">🌍</div>`}
      <div style="flex:1;min-width:0">
        <div style="font-size:.875rem;font-weight:700">${p.userName||"Drifter"}</div>
        <div style="font-size:.8125rem;color:var(--text3);margin-top:2px">${p.caption||""}</div>
        <div style="font-size:.75rem;color:var(--text3);margin-top:6px;display:flex;gap:12px">
          <span>❤️ ${p.likes?.length||0}</span>
          <span>💬 ${p.comments||0}</span>
          <span>${timeAgo(p.createdAt)}</span>
        </div>
      </div>
    </div>`;
}

function openUserProfileById(key) { openUserProfile(_get(key)); }
function openChatById(key)        { openChat(_get(key)); }

function openUserProfile(user) {
  const u = typeof user === "string" ? { uid: user } : user;
  navigate("page-profile");
  syncNavToPage("page-profile");
  // Temporarily override profile with this user's data
  safeSet("profile-name",    u.name||"Drifter");
  safeSet("profile-handle",  u.handle||"@drifter");
  safeSet("profile-bio",     u.bio||"");
  safeSet("profile-followers", formatCount(u.followers||0));
  safeSet("profile-following", formatCount(u.following||0));
  loadProfilePosts(u.uid||"demo");
}

function openEditProfile() {
  document.getElementById("edit-profile-overlay").classList.add("open");
  const u = userProfile || {};
  safeVal("edit-name",  u.name||"");
  safeVal("edit-bio",   u.bio||"");
  safeVal("edit-location", u.location||"");
}

async function saveProfile() {
  const name     = document.getElementById("edit-name").value.trim();
  const bio      = document.getElementById("edit-bio").value.trim();
  const location = document.getElementById("edit-location").value.trim();
  if (!name) { showToast("Name is required", "error"); return; }

  if (db && currentUser) {
    await db.collection("users").doc(currentUser.uid).update({ name, bio, location });
    userProfile = { ...userProfile, name, bio, location };
    renderMyProfile();
    showToast("Profile updated ✓", "success");
  }
  document.getElementById("edit-profile-overlay").classList.remove("open");
}

// ─────────────────────────────────────────
// 10. NOTIFICATIONS
// ─────────────────────────────────────────
let notifInitialized = false;
let unreadCount = 0;

function initNotifications() {
  if (notifInitialized) return;
  notifInitialized = true;
  loadNotifications();
  listenNotifications();
}

async function loadNotifications(filter = "all") {
  const list = document.getElementById("notif-list");
  list.innerHTML = Array(5).fill(`<div style="display:flex;gap:12px;padding:14px;border-bottom:1px solid var(--border)"><div class="skeleton" style="width:40px;height:40px;border-radius:50%;flex-shrink:0"></div><div style="flex:1;display:flex;flex-direction:column;gap:8px"><div class="skeleton" style="height:14px;width:80%"></div><div class="skeleton" style="height:12px;width:50%"></div></div></div>`).join("");

  const notifs = db && currentUser
    ? await db.collection("notifications").where("toUid","==",currentUser.uid)
        .orderBy("createdAt","desc").limit(40).get()
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    : generateMockNotifs();

  if (!notifs.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔔</div><h3>All quiet</h3><p>Your notifications will appear here</p></div>`;
    return;
  }

  let html = "";
  let lastDay = "";
  notifs.forEach(n => {
    const day = formatDay(n.createdAt);
    if (day !== lastDay) { html += `<div class="notif-date-header">${day}</div>`; lastDay = day; }
    html += buildNotifItem(n);
  });
  list.innerHTML = html;

  // Mark all as read
  if (db && currentUser) {
    notifs.filter(n => !n.read).forEach(n => {
      db.collection("notifications").doc(n.id).update({ read: true });
    });
  }
  updateUnreadBadge(0);
}

function buildNotifItem(n) {
  const icons = { like:"❤️", super_like:"⭐", follow:"👤", comment:"💬", story:"✨", match:"🎉" };
  const texts = {
    like:       `<b>${n.fromName}</b> liked your post`,
    super_like: `<b>${n.fromName}</b> super liked your post ⭐`,
    follow:     `<b>${n.fromName}</b> started following you`,
    comment:    `<b>${n.fromName}</b> commented: "${n.commentText||''}"`,
    story:      `<b>${n.fromName}</b> viewed your story`,
    match:      `You and <b>${n.fromName}</b> are drifting nearby 🌍`
  };
  const iconBgs = { like:"notif-icon-like", super_like:"notif-icon-match", follow:"notif-icon-follow", comment:"notif-icon-comment", story:"notif-icon-story", match:"notif-icon-match" };

  return `
    <div class="notif-item${n.read?'':' unread'}">
      <div class="notif-icon ${iconBgs[n.type]||'notif-icon-like'}">${icons[n.type]||'🔔'}</div>
      <div class="notif-content">
        <div class="notif-text">${texts[n.type]||n.text||''}</div>
        <div class="notif-time">${timeAgo(n.createdAt)}</div>
      </div>
      ${n.postThumb ? `<img src="${n.postThumb}" class="notif-thumb" loading="lazy">` : ''}
    </div>`;
}

function listenNotifications() {
  if (!db || !currentUser) return;
  db.collection("notifications")
    .where("toUid","==",currentUser.uid)
    .where("read","==",false)
    .onSnapshot(snap => {
      unreadCount = snap.size;
      updateUnreadBadge(unreadCount);
    });
}

function updateUnreadBadge(count) {
  const badge = document.getElementById("notif-badge");
  if (!badge) return;
  badge.style.display = count > 0 ? "flex" : "none";
  badge.textContent   = count > 9 ? "9+" : count;
}

function filterNotifs(type) {
  document.querySelectorAll(".notif-pill").forEach(p => p.classList.toggle("active", p.dataset.filter === type));
  loadNotifications(type);
}

// ─────────────────────────────────────────
// 11. CHAT / MESSAGES
// ─────────────────────────────────────────
let chatListeners     = {};
let activeChatUid     = null;

function initChatList() {
  loadChatList();
}

async function loadChatList() {
  const list = document.getElementById("chat-list");
  list.innerHTML = `<div style="padding:20px;text-align:center"><div class="spinner"></div></div>`;

  const chats = db && currentUser
    ? await db.collection("chats")
        .where("members","array-contains",currentUser.uid)
        .orderBy("lastMessageAt","desc").limit(30).get()
        .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    : generateMockChats();

  if (!chats.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💬</div><h3>No messages yet</h3><p>Start a conversation from someone's profile or on the globe</p></div>`;
    return;
  }

  list.innerHTML = chats.map(c => {
    const other   = c.memberData?.find(m => m.uid !== currentUser?.uid) || { name:"Drifter", uid:"x" };
    const chatKey = _put("chat_" + other.uid, other);
    return `
      <div class="chat-list-item${c.unread ? ' unread' : ''}" onclick="openChatById('${chatKey}')">
        <div class="av-online" style="position:relative">
          <div class="avatar av-56" style="background:${randomGradient(other.uid)}">
            ${other.avatar ? `<img src="${other.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : avatarInitials(other.name||'?')}
          </div>
          ${other.online ? '<div style="position:absolute;bottom:2px;right:2px;width:12px;height:12px;border-radius:50%;background:var(--accent2);border:2px solid var(--bg2)"></div>' : ''}
        </div>
        <div class="chat-list-info">
          <div class="chat-list-name">
            <span>${other.name||"Drifter"}</span>
            <span class="chat-list-time">${timeAgo(c.lastMessageAt)}</span>
          </div>
          <div class="chat-list-msg">${c.lastMessage||"Say hi 👋"}</div>
        </div>
        ${c.unread ? `<div class="chat-list-badge">${c.unreadCount||1}</div>` : ''}
      </div>`;
  }).join("");
}

function openChat(user) {
  if (!user) return;
  activeChatUid = user.uid;
  const room = document.getElementById("chat-room");
  document.getElementById("cr-name").textContent   = user.name || "Drifter";
  document.getElementById("cr-status").textContent = user.online ? "Online now" : "Offline";
  document.getElementById("cr-avatar").style.background = randomGradient(user.uid||"x");
  document.getElementById("cr-avatar").textContent = avatarInitials(user.name||"?");
  if (user.avatar) document.getElementById("cr-avatar").innerHTML = `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  room.classList.add("open");
  loadMessages(user.uid);
}

function closeChat() {
  document.getElementById("chat-room").classList.remove("open");
  if (chatListeners[activeChatUid]) { chatListeners[activeChatUid](); delete chatListeners[activeChatUid]; }
  activeChatUid = null;
}

function getChatId(uid1, uid2) { return [uid1, uid2].sort().join("_"); }

async function loadMessages(otherUid) {
  const msgs = document.getElementById("chat-messages");
  msgs.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;flex:1"><div class="spinner"></div></div>`;

  if (!db || !currentUser) {
    msgs.innerHTML = generateMockMessages().map(m => buildMessageBubble(m)).join("");
    return;
  }

  const chatId = getChatId(currentUser.uid, otherUid);
  const unsubscribe = db.collection("chats").doc(chatId).collection("messages")
    .orderBy("createdAt","asc").limit(60)
    .onSnapshot(snap => {
      const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      msgs.innerHTML = messages.length
        ? messages.map(m => buildMessageBubble(m)).join("")
        : `<div class="empty-state"><div class="empty-state-icon">👋</div><h3>Say hello!</h3></div>`;
      msgs.scrollTop = msgs.scrollHeight;
    });

  chatListeners[otherUid] = unsubscribe;
}

function buildMessageBubble(m) {
  const isMe = m.uid === currentUser?.uid;
  return `
    <div class="msg ${isMe ? 'me' : 'them'}">
      ${!isMe ? `<div class="avatar av-28" style="background:${randomGradient(m.uid||'x')};flex-shrink:0">${avatarInitials(m.senderName||'?')}</div>` : ''}
      <div>
        <div class="msg-bubble">
          ${m.imageUrl ? `<img src="${m.imageUrl}" class="msg-img" loading="lazy">` : ''}
          ${m.text || ''}
        </div>
        <div class="msg-time">
          ${timeAgo(m.createdAt)}
          ${isMe ? `<span class="msg-tick ${m.read?'read':''}">✓✓</span>` : ''}
        </div>
      </div>
    </div>`;
}

async function sendMessage() {
  if (!activeChatUid) return;
  const input = document.getElementById("chat-input");
  const text  = input.value.trim();
  if (!text) return;
  input.value = "";

  if (!db || !currentUser) {
    const msgs = document.getElementById("chat-messages");
    msgs.innerHTML += buildMessageBubble({ uid: currentUser?.uid||"me", text, createdAt: new Date(), senderName: userProfile?.name||"Me" });
    msgs.scrollTop = msgs.scrollHeight;
    return;
  }

  const chatId = getChatId(currentUser.uid, activeChatUid);
  const msg = {
    text, uid: currentUser.uid,
    senderName: userProfile?.name || currentUser.displayName,
    senderAvatar: userProfile?.avatar || currentUser.photoURL || null,
    read: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection("chats").doc(chatId).collection("messages").add(msg);
  await db.collection("chats").doc(chatId).set({
    members: [currentUser.uid, activeChatUid],
    lastMessage: text,
    lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
    unread: true, unreadCount: firebase.firestore.FieldValue.increment(1)
  }, { merge: true });
}

function chatKeydown(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

// ─────────────────────────────────────────
// 12. CREATE POST
// ─────────────────────────────────────────
let selectedFile = null;
let postType     = "post";

function initCreate() {
  document.getElementById("post-type-tabs").querySelectorAll(".create-type-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".create-type-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      postType = tab.dataset.type;
    });
  });
}

function openCreateStory() {
  navigate("page-create");
  syncNavToPage("page-create");
  document.querySelector('[data-type="story"]')?.click();
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  const url = URL.createObjectURL(file);
  const prev = document.getElementById("create-preview");
  const drop = document.getElementById("create-drop");
  if (file.type.startsWith("video")) {
    prev.innerHTML = `<video src="${url}" autoplay muted loop class="create-media-preview"></video>`;
  } else {
    prev.innerHTML = `<img src="${url}" class="create-media-preview">`;
  }
  drop.style.border = "none";
  prev.innerHTML += `<div class="create-media-overlay">
    <button class="btn btn-outline btn-sm" onclick="clearMedia()">✕ Remove</button>
    <button class="btn btn-primary btn-sm" onclick="document.getElementById('file-input').click()">Change</button>
  </div>`;
}

function clearMedia() {
  selectedFile = null;
  const prev = document.getElementById("create-preview");
  const drop = document.getElementById("create-drop");
  prev.innerHTML = "";
  drop.style.border = "2px dashed var(--border2)";
}

async function publishPost() {
  const caption  = document.getElementById("create-caption").value.trim();
  const location = document.getElementById("create-location-input")?.value?.trim() || userProfile?.location || "Earth";
  if (!caption && !selectedFile) { showToast("Add a photo or caption", "error"); return; }

  const btn = document.getElementById("publish-btn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:18px;height:18px;border-width:2px"></span> Publishing...`;

  try {
    let imageUrl = null;
    if (selectedFile) {
      imageUrl = await uploadToCloudinary(selectedFile);
    }

    const post = {
      uid: currentUser?.uid || "demo",
      userName: userProfile?.name || currentUser?.displayName || "Drifter",
      userAvatar: userProfile?.avatar || currentUser?.photoURL || null,
      verified: userProfile?.verified || false,
      caption,
      location,
      country: userProfile?.country || "Earth",
      lat: userProfile?.lat || 0,
      lng: userProfile?.lng || 0,
      imageUrl,
      type: postType,
      likes: [],
      comments: 0,
      views: 0,
      createdAt: db ? firebase.firestore.FieldValue.serverTimestamp() : new Date()
    };

    if (db && currentUser) {
      if (postType === "story") {
        await db.collection("stories").add({
          ...post,
          url: imageUrl,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          seenBy: []
        });
      } else {
        await db.collection("posts").add(post);
        await db.collection("users").doc(currentUser.uid).update({
          posts: firebase.firestore.FieldValue.increment(1)
        });
      }
    }

    showToast("🌍 Posted!", "success");
    document.getElementById("create-caption").value = "";
    clearMedia();
    feedInitialized = false;
    navigate("page-feed");
    syncNavToPage("page-feed");
  } catch(e) {
    showToast("Failed to post: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = postType === "story" ? "Share Story" : "Publish Post";
  }
}

async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY.uploadPreset);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/auto/upload`, {
    method: "POST", body: formData
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.secure_url;
}

function getLocation() {
  if (!navigator.geolocation) { showToast("Location not supported", "error"); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (userProfile && db && currentUser) {
      db.collection("users").doc(currentUser.uid).update({ lat, lng, online: true });
      userProfile.lat = lat;
      userProfile.lng = lng;
    }
    const inp = document.getElementById("create-location-input");
    if (inp) inp.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    showToast("📍 Location set", "success");
  }, () => showToast("Location permission denied", "error"));
}

// ─────────────────────────────────────────
// 13. MOCK DATA GENERATORS
// ─────────────────────────────────────────
function generateMockUsers(count = 20) {
  const names = ["Alex Rivera","Mia Chen","Jordan Lee","Zara Ahmed","Kai Tanaka","Priya Patel","Lucas Silva","Emma Wilson","Amir Hassan","Sofia Rossi","Noah Kim","Yuki Sato","Omar Khalil","Chloe Martin","Ravi Gupta","Isabella Torres"];
  const locs = ["New York","Tokyo","London","Paris","Dubai","São Paulo","Mumbai","Sydney","Toronto","Berlin","Seoul","Lagos","Cairo","Mexico City","Bangkok","Amsterdam"];
  return Array.from({ length: count }, (_, i) => {
    const n = names[i % names.length];
    const lat = Math.random() * 160 - 80;
    const lng = Math.random() * 360 - 180;
    return {
      uid: `user_${i}`, name: n,
      handle: "@" + n.toLowerCase().split(" ")[0] + Math.floor(Math.random()*999),
      bio: "Just drifting around 🌍",
      location: locs[i % locs.length], country: locs[i % locs.length],
      avatar: null, lat, lng,
      followers: Math.floor(Math.random() * 50000),
      following:  Math.floor(Math.random() * 2000),
      posts: Math.floor(Math.random() * 300),
      online: Math.random() > 0.5,
      verified: Math.random() > 0.85,
      hasStory: Math.random() > 0.5
    };
  });
}

function generateMockPosts(count = 10) {
  const captions = [
    "Golden hour hits different from up here 🌅",
    "Explored every corner of this city today 🗺️",
    "The world is so big and I'm just drifting through it 🌍",
    "Found this hidden gem completely by accident ✨",
    "Some days you just need to get lost 🧭",
    "This view made all the miles worth it 🏔️",
    "Local life > tourist traps 💯",
    "The best stories come from unplanned detours 🚗",
    "Chasing sunsets one city at a time 🌇",
    "Street food, good company, perfect evening 🍜"
  ];
  const locs = ["New York","Tokyo","London","Paris","Dubai","Sydney","Mumbai","Berlin","Seoul","Lagos"];
  return Array.from({ length: count }, (_, i) => ({
    id: `post_${i}_${Date.now()}`,
    uid: `user_${i % 10}`,
    userName: ["Alex","Mia","Jordan","Zara","Kai","Priya","Lucas","Emma","Amir","Sofia"][i % 10],
    userAvatar: null,
    verified: Math.random() > 0.8,
    caption: captions[i % captions.length],
    location: locs[i % locs.length],
    country: locs[i % locs.length],
    lat: Math.random() * 160 - 80,
    lng: Math.random() * 360 - 180,
    imageUrl: null,
    type: "post",
    likes: Array.from({ length: Math.floor(Math.random() * 500) }, (_, j) => `u${j}`),
    comments: Math.floor(Math.random() * 80),
    views: Math.floor(Math.random() * 5000),
    createdAt: new Date(Date.now() - Math.random() * 7 * 86400000)
  }));
}

function generateMockStories() {
  const names = ["Alex","Mia","Jordan","Zara","Kai"];
  const emojis = ["🌍","🌅","🏔️","🌊","✨","🌺","🌙","⭐"];
  const colors = ["#6C63FF","#FF6B9D","#00D4AA","#FFB347","#4ECDC4"];
  return names.flatMap((n, i) => [
    { id: `story_${i}`, uid: `user_${i}`, userName: n, userAvatar: null,
      type: "text", text: "Just arrived 🌍", emoji: emojis[i],
      bgColor: colors[i], url: null, duration: 5000,
      createdAt: new Date(Date.now() - Math.random() * 3600000),
      expiresAt: new Date(Date.now() + 20 * 3600000), seenBy: [] }
  ]);
}

function generateMockComments() {
  const names   = ["Alex Rivera","Mia Chen","Jordan Lee","Zara Ahmed","Kai Tanaka"];
  const texts   = ["This is absolutely stunning 😍","Where is this?? Need to visit!","The lighting here is perfect ✨","Love your content! 🙌","Goals 🌍"];
  return Array.from({ length: 6 }, (_, i) => ({
    id: `comment_${i}`, uid: `user_${i}`,
    userName: names[i % names.length], userAvatar: null, verified: false,
    text: texts[i % texts.length], likes: Math.floor(Math.random() * 50),
    createdAt: new Date(Date.now() - Math.random() * 86400000)
  }));
}

function generateMockChats() {
  const names = ["Mia Chen","Alex Rivera","Jordan Lee","Zara Ahmed"];
  return names.map((n, i) => ({
    id: `chat_${i}`,
    members: [currentUser?.uid||"demo", `user_${i}`],
    memberData: [
      { uid: currentUser?.uid||"demo", name: "You" },
      { uid: `user_${i}`, name: n, online: Math.random() > 0.5 }
    ],
    lastMessage: ["Hey, saw your post! 👋","Are you in Tokyo right now?","That sunset photo 😍","Let's explore together!"][i],
    lastMessageAt: new Date(Date.now() - Math.random() * 86400000),
    unread: i < 2, unreadCount: i + 1
  }));
}

function generateMockMessages() {
  return [
    { uid: "other", senderName: "Mia", text: "Hey! Saw you're nearby on the globe 🌍", createdAt: new Date(Date.now() - 3600000) },
    { uid: currentUser?.uid||"me", senderName: "You", text: "Yes! Just arrived in the city 😄", createdAt: new Date(Date.now() - 3500000), read: true },
    { uid: "other", senderName: "Mia", text: "Want to explore together? I know a great spot 🗺️", createdAt: new Date(Date.now() - 3000000) },
    { uid: currentUser?.uid||"me", senderName: "You", text: "Absolutely! Where should we meet?", createdAt: new Date(Date.now() - 2800000), read: true },
  ];
}

function generateMockNotifs() {
  return [
    { id:"n1", toUid:"me", fromName:"Mia Chen", type:"like", postThumb:null, read:false, createdAt:new Date(Date.now()-600000) },
    { id:"n2", toUid:"me", fromName:"Alex Rivera", type:"follow", postThumb:null, read:false, createdAt:new Date(Date.now()-1800000) },
    { id:"n3", toUid:"me", fromName:"Jordan Lee", type:"comment", commentText:"This is amazing!", postThumb:null, read:true, createdAt:new Date(Date.now()-7200000) },
    { id:"n4", toUid:"me", fromName:"Zara Ahmed", type:"super_like", postThumb:null, read:true, createdAt:new Date(Date.now()-86400000) },
    { id:"n5", toUid:"me", fromName:"Kai Tanaka", type:"match", postThumb:null, read:true, createdAt:new Date(Date.now()-172800000) },
  ];
}

function mockProfile() {
  return { uid:"demo", name:"You", handle:"@you", bio:"Just drifting around 🌍", location:"Earth", avatar:null, followers:0, following:0, posts:0, verified:false };
}

// ─────────────────────────────────────────
// 14. UTILITIES
// ─────────────────────────────────────────
function showToast(msg, type = "info") {
  const container = document.getElementById("toasts");
  const t = document.createElement("div");
  const svgs = {
    success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    info:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary-light)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };
  t.className = `toast ${type}`;
  t.innerHTML = `<span style="flex-shrink:0">${svgs[type]||svgs.info}</span><span>${msg}</span>`;
  container.appendChild(t);
  requestAnimationFrame(() => { requestAnimationFrame(() => t.classList.add("show")); });
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 3500);
}

function hideLoader() {
  const l = document.getElementById("loader");
  if (l) { l.classList.add("hidden"); setTimeout(() => l.remove(), 500); }
}

function timeAgo(date) {
  if (!date) return "";
  const d = date?.toDate ? date.toDate() : (date instanceof Date ? date : new Date(date));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)   return "just now";
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString("en-US", { month:"short", day:"numeric" });
}

function formatDay(date) {
  if (!date) return "Recent";
  const d = date?.toDate ? date.toDate() : (date instanceof Date ? date : new Date(date));
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });
}

function formatCount(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + "M";
  if (n >= 1000)    return (n/1000).toFixed(1) + "K";
  return n.toString();
}

function avatarInitials(name) {
  return name.split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase();
}

function randomGradient(seed) {
  const colors = [
    ["#6C63FF","#4A43D4"],["#FF6B9D","#E05595"],["#00D4AA","#00A882"],
    ["#FFB347","#E0932E"],["#4ECDC4","#35B2AA"],["#FF6B6B","#E05252"],
    ["#A78BFA","#7C3AED"],["#34D399","#059669"],["#FB923C","#EA580C"],["#60A5FA","#2563EB"]
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) & 0xFFFFFF;
  const pair = colors[Math.abs(hash) % colors.length];
  return `linear-gradient(135deg,${pair[0]},${pair[1]})`;
}

function randomColor() {
  const cs = ["#6C63FF","#FF6B9D","#00D4AA","#FFB347","#4ECDC4","#60A5FA","#A78BFA","#34D399"];
  return cs[Math.floor(Math.random() * cs.length)];
}

function safeSet(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function safeVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

function syncNavToPage(pageId) {
  document.querySelectorAll(".nav-item[data-page]").forEach(n => {
    n.classList.toggle("active", n.dataset.page === pageId);
  });
}

function openPost(id) {
  const post = feedPosts.find(p => p.id === id) || generateMockPosts(1)[0];
  openComments(id);
}

// ─────────────────────────────────────────
// 15. BOOT
// ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initFirebase();
  initRouter();
  initAuth();
  initCreate();

  // Geolocation permission
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      if (userProfile && db && currentUser) {
        db.collection("users").doc(currentUser.uid).update({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          online: true
        }).catch(() => {});
        userProfile.lat = pos.coords.latitude;
        userProfile.lng = pos.coords.longitude;
      }
    }, () => {});
  }

  // Online status
  window.addEventListener("beforeunload", () => {
    if (db && currentUser) {
      db.collection("users").doc(currentUser.uid).update({ online: false }).catch(() => {});
    }
  });
});
