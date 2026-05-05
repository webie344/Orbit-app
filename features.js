// =========================================================================
// Orbit — features.js
// New features: Orbit Score · Code Snippets · Tech Stack · Build in Public
// Project Showcase · Orbit Spaces · Daily Challenges · Skill Badges ·
// Mentorship Matching · Constellation View
//
// HOW TO USE:
// 1. Add in index.html <head>:
//      <link rel="stylesheet" href="features.css" />
//      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css" />
//      <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
// 2. Add before </body> in index.html:
//      <script type="module" src="features.js"></script>
// 3. In app.js — update routes array to include new routes:
//      const routes = [...existing..., "spaces", "challenges", "mentorship"];
// 4. In app.js — add new cases to the router switch:
//      case "spaces":     renderSpaces(content); break;
//      case "challenges": renderChallenges(content); break;
//      case "mentorship": renderMentorship(content); break;
//    NOTE: You must import these from features.js or copy the export calls
//    below. Simplest: replace those 3 cases with dynamic imports:
//      case "spaces":     import("./features.js").then(m=>m.renderSpaces(content)); break;
//      case "challenges": import("./features.js").then(m=>m.renderChallenges(content)); break;
//      case "mentorship": import("./features.js").then(m=>m.renderMentorship(content)); break;
// 5. Add new nav items to sidebar & bottomnav in index.html (see README below)
// =========================================================================

import { db, state, $, $$, el, toast, avatarFor, fetchUser, fmtTime, writeNotif, escapeHtml } from "./app.js";

import {
  doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, onSnapshot,
  getDocs, serverTimestamp, increment, arrayUnion, arrayRemove,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// =========================================================================
// UTILITIES
// =========================================================================

// Render text with code block detection (```lang\ncode\n```)
export const renderTextWithCode = (text = "") => {
  const frag = document.createDocumentFragment();
  const parts = text.split(/(```[\s\S]*?```)/g);
  parts.forEach((part) => {
    if (part.startsWith("```")) {
      const inner  = part.slice(3, -3);
      const nl     = inner.indexOf("\n");
      const lang   = nl > -1 ? inner.slice(0, nl).trim() : "";
      const code   = nl > -1 ? inner.slice(nl + 1) : inner;
      const pre    = el("div", { class: "orbit-code-wrap" });
      if (lang) pre.appendChild(el("div", { class: "orbit-code-lang" }, lang));
      const copyBtn = el("button", { class: "orbit-code-copy", title: "Copy" }, el("i", { class: "ri-file-copy-line" }));
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(code).then(() => toast("Copied!"));
      });
      pre.appendChild(copyBtn);
      const codeEl = el("code", { class: lang ? `language-${lang}` : "" });
      codeEl.textContent = code;
      const preEl  = el("pre");
      preEl.appendChild(codeEl);
      pre.appendChild(preEl);
      if (window.hljs) window.hljs.highlightElement(codeEl);
      frag.appendChild(pre);
    } else if (part) {
      const div = el("div", { class: "post-text" });
      div.innerHTML = escapeHtml(part)
        .replace(/(https?:\/\/[^\s]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener">${m}</a>`)
        .replace(/#([A-Za-z][\w]*)/g, (_, t) => `<a class="hashtag" href="#explore/tag/${t}">#${t}</a>`)
        .replace(/@(\w+)/g, (_, u) => `<a class="mention" href="#profile-u/${u}">@${u}</a>`);
      frag.appendChild(div);
    }
  });
  return frag;
};

// =========================================================================
// 1. ORBIT SCORE
// Shows a weighted reputation score on profiles.
// Score = (post orbits × 3) + (comments × 1) + (followers × 5)
// =========================================================================
export const computeOrbitScore = async (uid, userData = null) => {
  try {
    const [postsSnap, userSnap] = await Promise.all([
      getDocs(query(collection(db, "posts"), where("authorUid", "==", uid), limit(50))),
      userData ? Promise.resolve(null) : getDoc(doc(db, "users", uid)),
    ]);
    const user = userData || userSnap?.data() || {};
    const followerCount = (user.followers || []).length;
    let orbitTotal = 0, commentTotal = 0;
    postsSnap.docs.forEach((d) => {
      orbitTotal   += d.data().orbitCount   || 0;
      commentTotal += d.data().commentCount || 0;
    });
    return Math.round(orbitTotal * 3 + commentTotal * 1 + followerCount * 5);
  } catch { return 0; }
};

export const renderOrbitScoreBadge = (container, uid) => {
  const badge = el("div", { class: "orbit-score-badge", title: "Orbit Score" });
  container.appendChild(badge);

  const paint = (score) => {
    const tier =
      score >= 500 ? { label: "Legend",  color: "#ffd700",         icon: "ri-vip-crown-fill" } :
      score >= 200 ? { label: "Pro",     color: "var(--grad-1)",   icon: "ri-star-fill" } :
      score >= 80  ? { label: "Rising",  color: "var(--good)",     icon: "ri-rocket-fill" } :
                     { label: "Newcomer",color: "var(--text-dim)", icon: "ri-seedling-fill" };
    badge.innerHTML = "";
    badge.title = `Orbit Score: ${score}`;
    badge.appendChild(el("i", { class: tier.icon, style: `color:${tier.color}` }));
    badge.appendChild(el("span", { class: "osb-score" }, String(score)));
    badge.appendChild(el("span", { class: "osb-tier" }, tier.label));
  };

  const unsub = onSnapshot(doc(db, "users", uid), async (snap) => {
    if (!snap.exists()) return;
    const score = await computeOrbitScore(uid, snap.data());
    paint(score);
  });
  const obs = new MutationObserver(() => {
    if (!document.body.contains(badge)) { unsub(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
};

// =========================================================================
// 2. TECH STACK PROFILE SECTION
// Users declare what they use / are learning on their profile.
// Stored in Firestore user doc as `techStack: string[]`
// =========================================================================
const TECH_SUGGESTIONS = [
  "JavaScript","TypeScript","Python","Rust","Go","Java","C++","C#","Swift","Kotlin",
  "React","Vue","Angular","Svelte","Next.js","Nuxt","Remix","SolidJS",
  "Node.js","Express","FastAPI","Django","Spring","Laravel","Rails",
  "Firebase","Supabase","PostgreSQL","MongoDB","Redis","MySQL",
  "Docker","Kubernetes","AWS","GCP","Azure","Vercel","Netlify",
  "TailwindCSS","GraphQL","tRPC","WebSockets","WebAssembly",
  "React Native","Flutter","Swift UI","Expo",
];

export const renderTechStack = (container, userDoc, isMe = false) => {
  const stack = userDoc.techStack || [];
  const wrap  = el("div", { class: "tech-stack-section" });

  const head = el("div", { class: "ts-head" },
    el("span", { class: "ts-title" }, el("i", { class: "ri-code-s-slash-fill" }), " Tech Stack"),
  );
  wrap.appendChild(head);

  if (!stack.length && !isMe) {
    wrap.appendChild(el("div", { class: "ts-empty" }, "No tech stack listed yet."));
    container.appendChild(wrap);
    return;
  }

  const tagsEl = el("div", { class: "ts-tags" });
  stack.forEach((t) => tagsEl.appendChild(el("span", { class: "ts-tag" }, t)));
  wrap.appendChild(tagsEl);

  if (isMe) {
    const editBtn = el("button", { class: "btn ghost sm ts-edit-btn" },
      el("i", { class: "ri-edit-line" }), stack.length ? "Edit" : "Add your stack");
    editBtn.addEventListener("click", () => openTechStackEditor(userDoc, tagsEl));
    wrap.appendChild(editBtn);
  }

  container.appendChild(wrap);
};

const openTechStackEditor = (userDoc, tagsEl) => {
  const existing = [...(userDoc.techStack || [])];
  const overlay  = el("div", { class: "ts-editor-overlay" });
  const modal    = el("div", { class: "ts-editor-modal" });

  modal.appendChild(el("div", { class: "ts-editor-head" },
    el("h3", {}, "Edit Tech Stack"),
    el("button", { class: "icon-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" })),
  ));

  const selected = new Set(existing);

  const selectedWrap = el("div", { class: "ts-selected-wrap" });
  const refreshSelected = () => {
    selectedWrap.innerHTML = "";
    selected.forEach((t) => {
      const chip = el("span", { class: "ts-chip" },
        t,
        el("button", { onclick: () => { selected.delete(t); refreshSelected(); } },
          el("i", { class: "ri-close-line" })),
      );
      selectedWrap.appendChild(chip);
    });
  };
  refreshSelected();
  modal.appendChild(el("div", { class: "ts-editor-body" },
    el("div", { class: "ts-editor-label" }, "Selected"),
    selectedWrap,
    el("div", { class: "ts-editor-label" }, "Suggestions"),
    (() => {
      const grid = el("div", { class: "ts-suggestions" });
      TECH_SUGGESTIONS.forEach((t) => {
        const btn = el("button", { class: "ts-suggest-btn" }, t);
        btn.addEventListener("click", () => {
          if (selected.size >= 20) { toast("Max 20 techs"); return; }
          selected.add(t);
          refreshSelected();
        });
        grid.appendChild(btn);
      });
      return grid;
    })(),
  ));

  const inputRow = el("div", { class: "ts-custom-row" },
    el("input", { type: "text", placeholder: "Add custom tech…", id: "tsCustomInput" }),
    el("button", { class: "btn primary sm", onclick: () => {
      const val = document.getElementById("tsCustomInput")?.value.trim();
      if (!val) return;
      if (selected.size >= 20) { toast("Max 20 techs"); return; }
      selected.add(val);
      refreshSelected();
      const inp = document.getElementById("tsCustomInput");
      if (inp) inp.value = "";
    }}, "Add"),
  );
  modal.appendChild(inputRow);

  const saveBtn = el("button", { class: "btn primary ts-save-btn", onclick: async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    const arr = [...selected];
    await updateDoc(doc(db, "users", state.uid), { techStack: arr });
    userDoc.techStack = arr;
    tagsEl.innerHTML = "";
    arr.forEach((t) => tagsEl.appendChild(el("span", { class: "ts-tag" }, t)));
    toast("Stack updated!");
    overlay.remove();
  }}, "Save changes");
  modal.appendChild(saveBtn);

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

// =========================================================================
// 3. BUILD IN PUBLIC — post type with milestone + progress tracking
// Add new compose tab in index.html:
//   <button class="ct" data-ctab="build"><i class="ri-hammer-line"></i> Build</button>
// Add new compose pane in index.html:
//   <form id="buildForm" class="compose-pane hidden"> ... </form>
// =========================================================================
export const initBuildCompose = () => {
  const form = document.getElementById("buildForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd     = new FormData(form);
    const title  = (fd.get("buildTitle") || "").trim();
    const desc   = (fd.get("buildDesc")  || "").trim();
    const stage  = fd.get("buildStage")  || "idea";
    const prog   = parseInt(fd.get("buildProgress") || "0", 10);
    if (!title) { toast("Give your build a title"); return; }

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Posting…";
    try {
      await addDoc(collection(db, "posts"), {
        authorUid: state.uid,
        kind: "build",
        title,
        text: desc,
        buildStage: stage,
        buildProgress: Math.min(100, Math.max(0, prog)),
        orbits: [], orbitCount: 0, commentCount: 0,
        createdAt: serverTimestamp(),
      });
      form.reset();
      document.getElementById("composeModal")?.classList.add("hidden");
      toast("Build update posted!");
    } catch (err) { toast("Failed: " + (err.message || "error")); }
    finally { btn.disabled = false; btn.textContent = "Post update"; }
  });

  // Live progress preview
  const prog = form.querySelector("input[name='buildProgress']");
  const bar  = form.querySelector(".build-prog-preview");
  if (prog && bar) {
    prog.addEventListener("input", () => { bar.style.width = prog.value + "%"; });
  }
};

export const renderBuildPost = (p, author) => {
  const stageColors = { idea:"var(--grad-3)", prototype:"var(--warn)", beta:"var(--grad-1)", live:"var(--good)" };
  const stageLabels = { idea:"Idea", prototype:"Prototype", beta:"Beta", live:"Live" };
  const color = stageColors[p.buildStage] || "var(--primary)";

  return el("article", { class: "post build-post" },
    el("div", { class: "build-post-head" },
      el("img", { class: "avatar sm", src: avatarFor(author),
        onclick: () => location.hash = `#profile/${author?.uid}` }),
      el("div", { class: "build-meta" },
        el("div", { class: "build-name" },
          author?.name || "User",
          el("span", { class: "build-stage-badge", style: `background:${color}` },
            stageLabels[p.buildStage] || p.buildStage),
        ),
        el("div", { class: "build-time" }, "@" + (author?.username || "user") + " · " + fmtTime(p.createdAt)),
      ),
      el("span", { class: "build-label" }, el("i", { class: "ri-hammer-line" }), " Build in Public"),
    ),
    el("div", { class: "build-title" }, p.title || ""),
    p.text ? el("div", { class: "build-desc" }, p.text) : null,
    el("div", { class: "build-progress-wrap" },
      el("div", { class: "build-progress-label" },
        el("span", {}, "Progress"),
        el("strong", {}, (p.buildProgress || 0) + "%"),
      ),
      el("div", { class: "build-progress-track" },
        el("div", { class: "build-progress-fill", style: `width:${p.buildProgress||0}%;background:${color}` }),
      ),
    ),
  );
};

// =========================================================================
// 4. PROJECT SHOWCASE — post type with GitHub + live URL + tech tags
// Add new compose tab in index.html:
//   <button class="ct" data-ctab="project"><i class="ri-folder-5-line"></i> Project</button>
// Add new compose pane in index.html:
//   <form id="projectForm" class="compose-pane hidden"> ... </form>
// =========================================================================
export const initProjectCompose = () => {
  const form = document.getElementById("projectForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd      = new FormData(form);
    const title   = (fd.get("projectTitle") || "").trim();
    const desc    = (fd.get("projectDesc")  || "").trim();
    const github  = (fd.get("projectGithub") || "").trim();
    const live    = (fd.get("projectLive")   || "").trim();
    const rawTags = (fd.get("projectTags")   || "").trim();
    const tags    = rawTags ? rawTags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8) : [];

    if (!title) { toast("Give your project a name"); return; }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Posting…";
    try {
      await addDoc(collection(db, "posts"), {
        authorUid: state.uid,
        kind: "project",
        title,
        text: desc,
        githubUrl: github || null,
        liveUrl: live || null,
        techTags: tags,
        orbits: [], orbitCount: 0, commentCount: 0,
        createdAt: serverTimestamp(),
      });
      form.reset();
      document.getElementById("composeModal")?.classList.add("hidden");
      toast("Project showcased!");
    } catch (err) { toast("Failed: " + (err.message || "error")); }
    finally { btn.disabled = false; btn.textContent = "Showcase"; }
  });
};

export const renderProjectPost = (p, author) => {
  return el("article", { class: "post project-post" },
    el("div", { class: "project-card-inner" },
      el("div", { class: "project-post-head" },
        el("img", { class: "avatar sm", src: avatarFor(author),
          onclick: () => location.hash = `#profile/${author?.uid}` }),
        el("div", { class: "project-meta" },
          el("div", { class: "project-author" }, author?.name || "User"),
          el("div", { class: "project-time" }, fmtTime(p.createdAt)),
        ),
        el("span", { class: "project-label" }, el("i", { class: "ri-folder-5-line" }), " Project"),
      ),
      el("div", { class: "project-title" }, p.title || ""),
      p.text ? el("div", { class: "project-desc" }, p.text) : null,
      p.techTags?.length
        ? el("div", { class: "project-tags" },
            ...p.techTags.map((t) => el("span", { class: "ts-tag" }, t)))
        : null,
      el("div", { class: "project-links" },
        p.githubUrl ? el("a", { href: p.githubUrl, target: "_blank", rel: "noopener", class: "btn ghost sm" },
          el("i", { class: "ri-github-fill" }), "GitHub") : null,
        p.liveUrl ? el("a", { href: p.liveUrl, target: "_blank", rel: "noopener", class: "btn primary sm" },
          el("i", { class: "ri-external-link-line" }), "Live Demo") : null,
      ),
    ),
  );
};

// =========================================================================
// 5. ORBIT SPACES — topic-based persistent rooms
// Route: #spaces
// =========================================================================
export const renderSpaces = (root) => {
  root.innerHTML = "";
  const head = el("div", { class: "section-head" },
    el("h2", {}, el("i", { class: "ri-planet-line" }), " Orbit Spaces"),
    el("div", { class: "right" },
      el("button", { class: "btn primary", onclick: openCreateSpace },
        el("i", { class: "ri-add-line" }), "New Space"),
    ),
  );
  root.appendChild(head);

  const grid = el("div", { class: "spaces-grid" });
  root.appendChild(grid);

  onSnapshot(query(collection(db, "spaces"), orderBy("memberCount", "desc"), limit(40)), (snap) => {
    grid.innerHTML = "";
    if (snap.empty) {
      grid.appendChild(el("div", { class: "empty", style: "grid-column:1/-1" },
        el("i", { class: "ri-planet-line" }),
        el("div", { class: "t" }, "No Spaces yet"),
        el("div", {}, "Create the first topic space for your community."),
      ));
      return;
    }
    snap.docs.forEach((d) => {
      const s = { id: d.id, ...d.data() };
      const joined = (s.members || []).includes(state.uid);
      const card = el("div", { class: "space-card" },
        el("div", { class: "space-icon", style: `background:${s.color || "var(--grad-1)"}` },
          el("i", { class: s.icon || "ri-planet-line" })),
        el("div", { class: "space-name" }, s.name),
        el("div", { class: "space-topic" }, s.topic || ""),
        el("div", { class: "space-meta" },
          el("i", { class: "ri-group-line" }),
          ` ${s.memberCount || 0} members`,
        ),
        el("div", { class: "space-actions" },
          el("button", {
            class: `btn ${joined ? "ghost" : "primary"} sm`,
            onclick: async () => {
              const ref = doc(db, "spaces", s.id);
              if (joined) {
                await updateDoc(ref, { members: arrayRemove(state.uid), memberCount: increment(-1) });
                toast("Left space");
              } else {
                await updateDoc(ref, { members: arrayUnion(state.uid), memberCount: increment(1) });
                toast("Joined space!");
              }
            },
          }, joined ? "Leave" : "Join"),
          joined ? el("button", { class: "btn ghost sm", onclick: () => openSpaceChat(s) },
            el("i", { class: "ri-chat-3-line" }), "Open") : null,
        ),
      );
      grid.appendChild(card);
    });
  });
};

const SPACE_ICONS = [
  "ri-code-s-slash-fill","ri-robot-fill","ri-database-fill","ri-smartphone-fill",
  "ri-global-fill","ri-paint-fill","ri-star-fill","ri-trophy-fill",
  "ri-brain-fill","ri-rocket-fill","ri-cpu-fill","ri-cloud-fill",
];
const SPACE_COLORS = [
  "var(--grad-1)","var(--grad-2)","var(--grad-3)","var(--good)","var(--warn)","var(--danger)",
  "#5c8aff","#ff8c5c","#5cffc2",
];

const openCreateSpace = () => {
  const overlay = el("div", { class: "ts-editor-overlay" });
  const modal   = el("div", { class: "ts-editor-modal" });
  let pickedIcon  = SPACE_ICONS[0];
  let pickedColor = SPACE_COLORS[0];

  modal.appendChild(el("div", { class: "ts-editor-head" },
    el("h3", {}, "Create Space"),
    el("button", { class: "icon-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" })),
  ));

  const preview = el("div", { class: "space-icon", style: `background:${pickedColor}` }, el("i", { class: pickedIcon }));
  modal.appendChild(el("div", { class: "ts-editor-body" },
    el("div", { style: "display:flex;justify-content:center;margin-bottom:16px;" }, preview),
    el("label", {}, "Space name", el("input", { type: "text", id: "spaceNameInp", placeholder: "e.g. AI Builders" })),
    el("label", {}, "Topic / description", el("input", { type: "text", id: "spaceTopicInp", placeholder: "e.g. Discuss AI tools & projects" })),
    el("div", { class: "ts-editor-label" }, "Icon"),
    (() => {
      const g = el("div", { class: "space-icon-grid" });
      SPACE_ICONS.forEach((ic) => {
        const btn = el("button", { class: "space-icon-btn", onclick: () => {
          pickedIcon = ic;
          preview.innerHTML = "";
          preview.appendChild(el("i", { class: ic }));
        }}, el("i", { class: ic }));
        g.appendChild(btn);
      });
      return g;
    })(),
    el("div", { class: "ts-editor-label" }, "Color"),
    (() => {
      const g = el("div", { class: "swatches" });
      SPACE_COLORS.forEach((c) => {
        const s = el("button", { class: "swatch", style: `background:${c}`, onclick: () => {
          pickedColor = c;
          preview.style.background = c;
        }});
        g.appendChild(s);
      });
      return g;
    })(),
  ));

  modal.appendChild(el("button", { class: "btn primary ts-save-btn", onclick: async () => {
    const name  = (document.getElementById("spaceNameInp")?.value  || "").trim();
    const topic = (document.getElementById("spaceTopicInp")?.value || "").trim();
    if (!name) { toast("Give the space a name"); return; }
    await addDoc(collection(db, "spaces"), {
      name, topic,
      icon: pickedIcon, color: pickedColor,
      ownerUid: state.uid,
      members: [state.uid],
      memberCount: 1,
      createdAt: serverTimestamp(),
    });
    toast("Space created!");
    overlay.remove();
  }}, "Create Space"));

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

const openSpaceChat = (space) => {
  const overlay = el("div", { class: "ts-editor-overlay" });
  const modal   = el("div", { class: "space-chat-modal" });

  modal.appendChild(el("div", { class: "ts-editor-head" },
    el("div", { style: "display:flex;align-items:center;gap:10px;" },
      el("div", { class: "space-icon sm", style: `background:${space.color}` }, el("i", { class: space.icon })),
      el("h3", { style: "margin:0" }, space.name),
    ),
    el("button", { class: "icon-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" })),
  ));

  const msgList = el("div", { class: "space-msg-list" });
  modal.appendChild(msgList);

  const composeRow = el("div", { class: "space-compose-row" });
  const input = el("input", { type: "text", placeholder: `Message #${space.name}…`, class: "space-msg-input" });
  const sendBtn = el("button", { class: "icon-btn", onclick: sendMsg }, el("i", { class: "ri-send-plane-fill", style: "color:var(--primary)" }));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMsg(); });
  composeRow.appendChild(el("img", { class: "avatar xs", src: avatarFor(state.me) }));
  composeRow.appendChild(input);
  composeRow.appendChild(sendBtn);
  modal.appendChild(composeRow);

  async function sendMsg() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await addDoc(collection(db, "spaces", space.id, "messages"), {
      authorUid: state.uid,
      fromName: state.me?.name || "User",
      fromAvatar: state.me?.photoURL || "",
      text,
      createdAt: serverTimestamp(),
    });
  }

  const unsub = onSnapshot(
    query(collection(db, "spaces", space.id, "messages"), orderBy("createdAt", "asc"), limit(80)),
    (snap) => {
      msgList.innerHTML = "";
      snap.docs.forEach((d) => {
        const m = d.data();
        const isMe = m.authorUid === state.uid;
        msgList.appendChild(el("div", { class: `space-msg${isMe ? " mine" : ""}` },
          !isMe ? el("img", { class: "avatar xs", src: m.fromAvatar || avatarFor({ uid: m.authorUid }) }) : null,
          el("div", { class: "space-msg-body" },
            !isMe ? el("div", { class: "space-msg-name" }, m.fromName) : null,
            el("div", { class: "space-msg-text" }, m.text),
          ),
        ));
      });
      msgList.scrollTop = msgList.scrollHeight;
    });

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) { unsub(); overlay.remove(); } });
  document.body.appendChild(overlay);
};

// =========================================================================
// 6. DAILY CHALLENGES + LEADERBOARD
// Route: #challenges
// Firestore: "challenges" collection — one active doc per day
// =========================================================================
export const renderChallenges = (root) => {
  root.innerHTML = "";
  root.appendChild(el("div", { class: "section-head" },
    el("h2", {}, el("i", { class: "ri-trophy-line" }), " Daily Challenges"),
  ));

  const wrap = el("div", { class: "challenge-wrap" });
  root.appendChild(wrap);

  const today = new Date().toISOString().slice(0, 10);

  getDoc(doc(db, "challenges", today)).then(async (snap) => {
    let challenge = snap.exists() ? { id: snap.id, ...snap.data() } : null;

    if (!challenge) {
      const seed = DAILY_CHALLENGES[Math.floor(Date.now() / 86400000) % DAILY_CHALLENGES.length];
      challenge = { id: today, ...seed, submissions: [], createdAt: new Date() };
      try { await setDoc(doc(db, "challenges", today), { ...seed, submissions: [], createdAt: serverTimestamp() }); } catch {}
    }

    wrap.appendChild(renderChallengeCard(challenge, today));
    wrap.appendChild(await renderLeaderboard());
  }).catch(() => {
    wrap.appendChild(el("div", { class: "empty" },
      el("i", { class: "ri-error-warning-line" }),
      el("div", { class: "t" }, "Could not load challenge"),
    ));
  });
};

const DAILY_CHALLENGES = [
  { title: "Reverse a String", difficulty: "Easy",   description: "Write a function that reverses a string without using built-in reverse methods. What's the time complexity?", category: "Algorithms" },
  { title: "FizzBuzz with a Twist", difficulty: "Easy", description: "Classic FizzBuzz but: multiples of 7 print 'Orbit', multiples of both 3 and 7 print 'OrbitFizz'. Make it work for any n.", category: "Logic" },
  { title: "Debounce Function", difficulty: "Medium", description: "Implement a debounce function from scratch in JavaScript. Your implementation should handle edge cases.", category: "JavaScript" },
  { title: "Binary Search", difficulty: "Medium", description: "Implement binary search iteratively AND recursively. Compare the approaches. What are the trade-offs?", category: "Algorithms" },
  { title: "Flatten Nested Array", difficulty: "Medium", description: "Flatten an arbitrarily nested array without using Array.flat(). Handle mixed types.", category: "JavaScript" },
  { title: "LRU Cache", difficulty: "Hard", description: "Implement an LRU (Least Recently Used) cache with O(1) get and put operations.", category: "Data Structures" },
  { title: "Build a Promise", difficulty: "Hard", description: "Implement a basic Promise class from scratch with .then(), .catch(), and chaining support.", category: "JavaScript" },
  { title: "Two Sum", difficulty: "Easy", description: "Given an array of integers and a target, return the indices of the two numbers that add up to the target.", category: "Algorithms" },
  { title: "CSS Layout Challenge", difficulty: "Easy", description: "Center a div both horizontally and vertically using 3 different CSS methods. Which do you prefer and why?", category: "CSS" },
  { title: "Event Emitter", difficulty: "Medium", description: "Build a simple EventEmitter class with on(), off(), and emit() methods.", category: "JavaScript" },
];

const renderChallengeCard = (challenge, today) => {
  const diffColors = { Easy: "var(--good)", Medium: "var(--warn)", Hard: "var(--danger)" };
  const hasSubmitted = (challenge.submissions || []).includes(state.uid);

  const card = el("div", { class: "challenge-card" },
    el("div", { class: "challenge-card-head" },
      el("span", { class: "challenge-cat" }, challenge.category || ""),
      el("span", { class: "challenge-diff", style: `color:${diffColors[challenge.difficulty] || "var(--primary)"}` },
        challenge.difficulty),
      el("span", { class: "challenge-date" }, "Today"),
    ),
    el("div", { class: "challenge-title" }, challenge.title),
    el("div", { class: "challenge-desc" }, challenge.description),
  );

  if (hasSubmitted) {
    card.appendChild(el("div", { class: "challenge-done" },
      el("i", { class: "ri-check-double-line" }), " You submitted today — check back tomorrow!",
    ));
  } else {
    const textarea = el("textarea", { placeholder: "Paste your solution here (code, explanation, or both)…", rows: "6", class: "challenge-solution" });
    const submitBtn = el("button", { class: "btn primary", onclick: async () => {
      const sol = textarea.value.trim();
      if (!sol) { toast("Write your solution first"); return; }
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";
      try {
        await addDoc(collection(db, "challenges", today, "entries"), {
          authorUid: state.uid,
          authorName: state.me?.name || "User",
          solution: sol,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, "challenges", today), { submissions: arrayUnion(state.uid) });
        await updateDoc(doc(db, "users", state.uid), { challengeScore: increment(1) });
        card.querySelector(".challenge-solution")?.replaceWith(
          el("div", { class: "challenge-done" }, el("i", { class: "ri-check-double-line" }), " Submitted!"),
        );
        submitBtn.remove();
        toast("Solution submitted! +1 to your score");
      } catch { toast("Failed to submit"); submitBtn.disabled = false; submitBtn.textContent = "Submit solution"; }
    }}, "Submit solution");
    card.appendChild(textarea);
    card.appendChild(submitBtn);
  }
  return card;
};

const renderLeaderboard = async () => {
  const wrap = el("div", { class: "leaderboard-wrap" });
  wrap.appendChild(el("div", { class: "lb-title" }, el("i", { class: "ri-bar-chart-2-fill" }), " Leaderboard"));

  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("challengeScore", "desc"), limit(10)));
    if (snap.empty) {
      wrap.appendChild(el("div", { class: "lb-empty" }, "No submissions yet — be the first!"));
      return wrap;
    }
    snap.docs.forEach((d, i) => {
      const u = { uid: d.id, ...d.data() };
      const medals = ["🥇", "🥈", "🥉"];
      wrap.appendChild(el("div", { class: "lb-row" },
        el("div", { class: "lb-rank" }, medals[i] || String(i + 1)),
        el("img", { class: "avatar sm", src: avatarFor(u), onclick: () => location.hash = `#profile/${u.uid}` }),
        el("div", { class: "lb-info" },
          el("div", { class: "lb-name" }, u.name || "User"),
          el("div", { class: "lb-score" }, (u.challengeScore || 0) + " solved"),
        ),
      ));
    });
  } catch { wrap.appendChild(el("div", { class: "lb-empty" }, "Could not load leaderboard")); }
  return wrap;
};

// =========================================================================
// 7. SKILL BADGES — peer-verified skill tags on profiles
// Stored in Firestore: users/{uid}/badges subcollection
// =========================================================================
export const renderSkillBadges = (container, uid, isMe = false) => {
  const wrap = el("div", { class: "skill-badges-section" });
  const head = el("div", { class: "sb-head" },
    el("span", {}, el("i", { class: "ri-award-fill" }), " Skill Badges"),
    isMe ? el("button", { class: "btn ghost sm", onclick: () => openAddBadge(uid, wrap) },
      el("i", { class: "ri-add-line" }), "Add") : null,
  );
  wrap.appendChild(head);
  container.appendChild(wrap);

  const grid = el("div", { class: "sb-grid" });

  const unsub = onSnapshot(collection(db, "users", uid, "badges"), (snap) => {
    grid.innerHTML = "";
    if (snap.empty) {
      grid.appendChild(el("div", { class: "sb-empty" },
        isMe ? "Add skills you want peers to verify." : "No skill badges yet."));
    } else {
      snap.docs.forEach((d) => {
        const b = { id: d.id, ...d.data() };
        const endorsed = (b.endorsements || []).includes(state.uid);
        const endorseBtn = uid !== state.uid ? el("button", {
          class: `sb-endorse${endorsed ? " active" : ""}`,
          title: endorsed ? "Remove endorsement" : "Endorse this skill",
          onclick: async (e) => {
            e.stopPropagation();
            await updateDoc(doc(db, "users", uid, "badges", b.id), {
              endorsements: endorsed ? arrayRemove(state.uid) : arrayUnion(state.uid),
            });
          },
        }, el("i", { class: "ri-thumb-up-line" }), el("span", { class: "sb-endorse-count" }, String((b.endorsements || []).length))) : null;

        grid.appendChild(el("div", { class: "sb-chip" },
          el("div", { class: "sb-chip-info" },
            el("span", { class: "sb-skill" }, b.name),
            el("span", { class: "sb-level" }, b.level || ""),
          ),
          endorseBtn,
        ));
      });
    }
    if (!wrap.contains(grid)) wrap.appendChild(grid);
  });

  const obs = new MutationObserver(() => {
    if (!document.body.contains(wrap)) { unsub(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
};

const SKILL_LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];

const openAddBadge = (uid, parentWrap) => {
  const overlay = el("div", { class: "ts-editor-overlay" });
  const modal   = el("div", { class: "ts-editor-modal" });

  modal.appendChild(el("div", { class: "ts-editor-head" },
    el("h3", {}, "Add Skill Badge"),
    el("button", { class: "icon-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" })),
  ));
  modal.appendChild(el("div", { class: "ts-editor-body" },
    el("label", {}, "Skill name", el("input", { type: "text", id: "badgeNameInp", placeholder: "e.g. React, Python, Docker" })),
    el("label", {}, "Level",
      (() => {
        const sel = el("select", { id: "badgeLevelSel" });
        SKILL_LEVELS.forEach((l) => sel.appendChild(el("option", { value: l }, l)));
        return sel;
      })(),
    ),
  ));
  modal.appendChild(el("button", { class: "btn primary ts-save-btn", onclick: async () => {
    const name  = (document.getElementById("badgeNameInp")?.value || "").trim();
    const level = document.getElementById("badgeLevelSel")?.value || "Beginner";
    if (!name) { toast("Enter a skill name"); return; }
    await addDoc(collection(db, "users", uid, "badges"), { name, level, endorsements: [], createdAt: serverTimestamp() });
    toast("Badge added!");
    overlay.remove();
    parentWrap.remove();
  }}, "Add Badge"));

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

// =========================================================================
// 8. MENTORSHIP MATCHING
// Route: #mentorship
// Firestore: "mentorship" collection — one doc per user
// =========================================================================
export const renderMentorship = (root) => {
  root.innerHTML = "";
  root.appendChild(el("div", { class: "section-head" },
    el("h2", {}, el("i", { class: "ri-user-heart-line" }), " Mentorship"),
  ));

  const wrap = el("div", { class: "mentorship-wrap" });
  root.appendChild(wrap);

  getDoc(doc(db, "mentorship", state.uid)).then((snap) => {
    const myProfile = snap.exists() ? snap.data() : null;
    wrap.appendChild(renderMyMentorProfile(myProfile));
    wrap.appendChild(el("div", { class: "mentor-divider" },
      el("h3", {}, myProfile?.role === "mentor" ? "People Looking for Mentorship" : "Available Mentors"),
    ));
    loadMentorMatches(wrap, myProfile);
  });
};

const renderMyMentorProfile = (profile) => {
  const card = el("div", { class: "mentor-my-card" });
  card.appendChild(el("div", { class: "mentor-card-title" },
    el("i", { class: "ri-user-settings-line" }), " My Mentorship Profile",
  ));

  if (profile) {
    card.appendChild(el("div", { class: "mentor-profile-view" },
      el("div", { class: "mp-role" },
        el("span", { class: `mp-role-badge ${profile.role}` },
          profile.role === "mentor" ? "Mentor" : "Mentee"),
      ),
      el("div", { class: "mp-info" },
        el("div", { class: "mp-label" }, "Skills / Expertise"),
        el("div", { class: "mp-val" }, profile.skills || "—"),
        el("div", { class: "mp-label" }, "Goals"),
        el("div", { class: "mp-val" }, profile.goals || "—"),
        el("div", { class: "mp-label" }, "Availability"),
        el("div", { class: "mp-val" }, profile.availability || "—"),
      ),
      el("button", { class: "btn ghost sm", onclick: () => openMentorEdit(profile, card) },
        el("i", { class: "ri-edit-line" }), "Edit"),
    ));
  } else {
    card.appendChild(el("div", { class: "mentor-setup-prompt" },
      el("p", {}, "Set up your mentorship profile to connect with others."),
      el("button", { class: "btn primary", onclick: () => openMentorEdit(null, card) },
        el("i", { class: "ri-user-add-line" }), "Set up profile"),
    ));
  }
  return card;
};

const openMentorEdit = (profile, card) => {
  const overlay = el("div", { class: "ts-editor-overlay" });
  const modal   = el("div", { class: "ts-editor-modal" });

  modal.appendChild(el("div", { class: "ts-editor-head" },
    el("h3", {}, "Mentorship Profile"),
    el("button", { class: "icon-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" })),
  ));

  let role = profile?.role || "mentee";
  const roleToggle = el("div", { class: "seg mentor-role-toggle" },
    (() => {
      const mb = el("button", { class: role === "mentee" ? "active" : "" }, "I want a Mentor");
      const mr = el("button", { class: role === "mentor" ? "active" : "" }, "I am a Mentor");
      mb.onclick = () => { role = "mentee"; mb.classList.add("active"); mr.classList.remove("active"); };
      mr.onclick = () => { role = "mentor"; mr.classList.add("active"); mb.classList.remove("active"); };
      return [mb, mr];
    })(),
  );

  modal.appendChild(el("div", { class: "ts-editor-body" },
    el("div", { class: "mentor-role-section" }, el("div", { class: "ts-editor-label" }, "Your Role"), roleToggle),
    el("label", {}, "Skills / Expertise",
      el("input", { type: "text", id: "mentorSkillsInp", placeholder: "e.g. React, Python, system design", value: profile?.skills || "" })),
    el("label", {}, "Goals",
      el("textarea", { id: "mentorGoalsInp", placeholder: "What do you want to learn or help others with?", rows: "3" },
        profile?.goals || "")),
    el("label", {}, "Availability",
      el("input", { type: "text", id: "mentorAvailInp", placeholder: "e.g. Weekends, 2 hrs/week", value: profile?.availability || "" })),
  ));

  modal.appendChild(el("button", { class: "btn primary ts-save-btn", onclick: async () => {
    const data = {
      uid: state.uid,
      name: state.me?.name || "",
      photoURL: state.me?.photoURL || "",
      role,
      skills:       (document.getElementById("mentorSkillsInp")?.value || "").trim(),
      goals:        (document.getElementById("mentorGoalsInp")?.value  || "").trim(),
      availability: (document.getElementById("mentorAvailInp")?.value  || "").trim(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, "mentorship", state.uid), data, { merge: true });
    toast("Profile saved!");
    overlay.remove();
    card.innerHTML = "";
    card.appendChild(renderMyMentorProfile(data).children[0]); // refresh
    card.appendChild(renderMyMentorProfile(data).children[1] || document.createTextNode(""));
  }}, "Save profile"));

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

const loadMentorMatches = async (wrap, myProfile) => {
  const oppositeRole = !myProfile || myProfile.role === "mentee" ? "mentor" : "mentee";
  try {
    const snap = await getDocs(
      query(collection(db, "mentorship"), where("role", "==", oppositeRole), limit(20)),
    );
    if (snap.empty) {
      wrap.appendChild(el("div", { class: "empty" },
        el("i", { class: "ri-user-search-line" }),
        el("div", { class: "t" }, "No matches yet"),
        el("div", {}, "Be the first to set up a profile!"),
      ));
      return;
    }
    const grid = el("div", { class: "mentor-grid" });
    snap.docs.forEach((d) => {
      const m = d.data();
      if (m.uid === state.uid) return;
      grid.appendChild(el("div", { class: "mentor-card" },
        el("img", { class: "avatar md", src: m.photoURL || avatarFor({ uid: m.uid }) }),
        el("div", { class: "mentor-card-info" },
          el("div", { class: "mentor-card-name" }, m.name || "User"),
          el("span", { class: `mp-role-badge ${m.role}` }, m.role === "mentor" ? "Mentor" : "Mentee"),
          m.skills ? el("div", { class: "mentor-card-skills" }, el("i", { class: "ri-code-s-slash-line" }), " " + m.skills) : null,
          m.availability ? el("div", { class: "mentor-card-avail" }, el("i", { class: "ri-time-line" }), " " + m.availability) : null,
        ),
        el("button", { class: "btn primary sm", onclick: () => {
          location.hash = `#profile/${m.uid}`;
        }}, "View profile"),
        el("button", { class: "btn ghost sm", onclick: async () => {
          if (!m.uid) return;
          await writeNotif(m.uid, "message", { text: "I'd like to connect for mentorship!" }).catch(() => {});
          location.hash = `#chats/${m.uid}`;
        }}, el("i", { class: "ri-chat-3-line" }), "Message"),
      ));
    });
    wrap.appendChild(grid);
  } catch (err) {
    wrap.appendChild(el("div", { class: "empty" }, el("div", { class: "t" }, "Could not load matches")));
  }
};

// =========================================================================
// 9. CONSTELLATION VIEW — visual topic cluster for Explore
// Call this from inside renderExplore to add a "Constellation" tab
// =========================================================================
export const renderConstellation = async (container) => {
  container.innerHTML = "";
  const wrap = el("div", { class: "constellation-wrap" });
  container.appendChild(wrap);

  const snap = await getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100)));
  const tagCounts = {};
  snap.docs.forEach((d) => {
    const tags = d.data().hashtags || [];
    tags.forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
  });

  const sorted = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (!sorted.length) {
    wrap.appendChild(el("div", { class: "empty" },
      el("i", { class: "ri-planet-line" }),
      el("div", { class: "t" }, "No hashtags yet"),
    ));
    return;
  }

  const maxCount = sorted[0][1];
  wrap.appendChild(el("div", { class: "constellation-header" },
    el("i", { class: "ri-planet-line" }), " Topic Constellation",
    el("p", { style: "color:var(--text-mute);font-size:13px;margin:4px 0 0;" },
      "Bigger = more posts · Click a topic to explore it"),
  ));

  const galaxy = el("div", { class: "galaxy-wrap" });
  wrap.appendChild(galaxy);

  sorted.forEach(([tag, count], i) => {
    const size   = 32 + Math.round((count / maxCount) * 60);
    const angle  = (i / sorted.length) * 360;
    const radius = 120 + (i % 3) * 60;
    const x      = 50 + radius * Math.cos((angle * Math.PI) / 180) / 5;
    const y      = 50 + radius * Math.sin((angle * Math.PI) / 180) / 5;
    const node   = el("button", {
      class: "galaxy-node",
      style: `width:${size}px;height:${size}px;left:${x}%;top:${y}%;font-size:${10 + Math.round(count / maxCount * 6)}px;`,
      title: `#${tag} — ${count} posts`,
      onclick: () => { location.hash = `#explore/tag/${tag}`; },
    }, `#${tag}`);
    galaxy.appendChild(node);
  });
};

// =========================================================================
// RENDER EXTRAS — injected into standard renderPost for build/project kinds
// =========================================================================
export const renderBuildExtra = (p) => {
  const stageColors = { idea: "var(--grad-3)", prototype: "var(--warn)", beta: "var(--grad-1)", live: "var(--good)" };
  const stageLabels = { idea: "Idea", prototype: "Prototype", beta: "Beta", live: "Live" };
  const color = stageColors[p.buildStage] || "var(--primary)";
  const prog  = Math.min(100, Math.max(0, p.buildProgress || 0));

  return el("div", { class: "build-extra" },
    el("span", { class: "build-stage-badge", style: `background:${color}` },
      stageLabels[p.buildStage] || p.buildStage || "Update"),
    el("div", { class: "build-progress-wrap" },
      el("div", { class: "build-progress-label" },
        el("span", {}, "Progress"),
        el("strong", {}, prog + "%"),
      ),
      el("div", { class: "build-progress-track" },
        el("div", { class: "build-progress-fill", style: `width:${prog}%;background:${color}` }),
      ),
    ),
  );
};

export const renderProjectExtra = (p) => {
  const wrap = el("div", { class: "project-extra" });
  if (p.techTags?.length) {
    wrap.appendChild(el("div", { class: "project-tags" },
      ...p.techTags.map((t) => el("span", { class: "ts-tag" }, t))));
  }
  const links = el("div", { class: "project-links" });
  if (p.githubUrl) links.appendChild(el("a", {
    href: p.githubUrl, target: "_blank", rel: "noopener", class: "btn ghost sm",
  }, el("i", { class: "ri-github-fill" }), " GitHub"));
  if (p.liveUrl) links.appendChild(el("a", {
    href: p.liveUrl, target: "_blank", rel: "noopener", class: "btn primary sm",
  }, el("i", { class: "ri-external-link-line" }), " Live Demo"));
  if (links.children.length) wrap.appendChild(links);
  return wrap;
};

// =========================================================================
// GO PRO — banner + modal for non-Pro users
// =========================================================================
export const renderGoProBanner = (container) => {
  container.appendChild(el("div", { class: "gopro-banner" },
    el("div", { class: "gopro-banner-icon" }, el("i", { class: "ri-vip-crown-fill" })),
    el("div", { class: "gopro-banner-text" },
      el("div", { class: "gopro-banner-title" }, "Unlock Orbit Pro"),
      el("div", { class: "gopro-banner-desc" },
        "Activate Pro in Settings to access Orbit Score, Tech Stack, Skill Badges, Build in Public and Project Showcase."),
    ),
    el("button", { class: "btn primary sm", onclick: () => { location.hash = "#settings"; } },
      el("i", { class: "ri-vip-crown-line" }), " Go Pro"),
  ));
};

export const showGoProModal = () => {
  const overlay = el("div", { class: "ts-editor-overlay" });
  const modal   = el("div", { class: "ts-editor-modal gopro-modal" });

  modal.appendChild(el("div", { class: "ts-editor-head" },
    el("div", { style: "display:flex;align-items:center;gap:10px;" },
      el("i", { class: "ri-vip-crown-fill", style: "font-size:22px;color:var(--grad-1)" }),
      el("h3", { style: "margin:0" }, "Orbit Pro Required"),
    ),
    el("button", { class: "icon-btn", onclick: () => overlay.remove() }, el("i", { class: "ri-close-line" })),
  ));

  const features = [
    "Orbit Score — live reputation badge",
    "Tech Stack Profile — showcase your tools",
    "Skill Badges — peer-verified skills",
    "Build in Public posts — share your progress",
    "Project Showcase posts — present your work",
  ];
  modal.appendChild(el("div", { class: "gopro-modal-body" },
    el("p", { style: "color:var(--text-dim);margin:0 0 14px;" },
      "This feature is only available after activating Orbit Pro. It's free — just one tap in Settings."),
    el("div", { class: "gopro-features" },
      ...features.map((f) => el("div", { class: "gopro-feature-row" },
        el("i", { class: "ri-check-line", style: "color:var(--good);flex-shrink:0;" }), " " + f)),
    ),
  ));

  modal.appendChild(el("button", { class: "btn primary ts-save-btn", onclick: () => {
    overlay.remove();
    location.hash = "#settings";
  }}, el("i", { class: "ri-vip-crown-line" }), " Activate Pro in Settings — it's free"));

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

// =========================================================================
// PROFILE HOOKS — call these inside your existing renderProfile function
// after you have the userDoc and root container.
//
// Example usage (add inside renderProfile after building the basic profile):
//   import { renderOrbitScoreBadge, renderTechStack, renderSkillBadges } from "./features.js";
//   renderOrbitScoreBadge(nameRowEl, uid);
//   renderTechStack(tabContentEl, userDoc, isMe);
//   renderSkillBadges(tabContentEl, uid, isMe);
// =========================================================================

// =========================================================================
// INIT — wire up new compose forms & nav on auth-ready
// =========================================================================
document.addEventListener("orbit:auth-ready", () => {
  initBuildCompose();
  initProjectCompose();
});
