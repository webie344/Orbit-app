// =========================================================================
// Orbit — bot-engine-browser.js
// Drop this alongside app.js and add to index.html:
//   <script type="module" src="./bot-engine-browser.js"></script>
//
// Bots respond to real user posts + group messages using Groq AI.
// Groq key is stored in localStorage so you only set it once.
// =========================================================================

import { state, db } from "./app.js";

import {
  collection, doc, addDoc, updateDoc, getDocs,
  onSnapshot, query, orderBy, limit, where,
  serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// =========================================================================
// CONFIG — replace the value below with your Groq API key.
// Get one free at https://console.groq.com → API Keys
// =========================================================================
const groqConfig = {
  apiKey: "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",   // ← paste your key here
};

// ── Groq config ──────────────────────────────────────────────────────────
const GROQ_KEY   = () => groqConfig.apiKey && groqConfig.apiKey !== "YOUR_GROQ_API_KEY_HERE" ? groqConfig.apiKey : "";
const GROQ_MODEL = "llama-3.1-8b-instant";

// =========================================================================
// GROQ — generate a reply
// =========================================================================
const groqReply = async (system, user) => {
  const key = GROQ_KEY();
  if (!key) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: 80,
        temperature: 0.85,
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
};

// ── Fallback replies when Groq isn't configured ──────────────────────────
const FALLBACKS = [
  "this is actually so real", "felt this deeply", "couldn't agree more",
  "okay but why is this me 😭", "saying what we're all thinking",
  "facts 💯", "needed to read this today", "this hit different",
  "the accuracy tho", "you're not alone on this one",
  "i've been thinking about this exact thing", "real talk",
  "genuinely one of the most honest things i've seen today",
  "saving this", "yes 🙏", "this resonated", "the way i felt this",
  "no one talks about this enough", "been here before tbh",
  "couldn't have said it better myself",
];
const fallback = () => FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];

const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick    = (arr)  => arr[Math.floor(Math.random() * arr.length)];

// =========================================================================
// BOT USER CACHE
// =========================================================================
let _bots    = [];
let _botsLoaded = false;

const loadBots = async () => {
  if (_botsLoaded) return;
  try {
    const snap = await getDocs(
      query(collection(db, "users"), where("isBot", "==", true), limit(200))
    );
    _bots = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    _botsLoaded = true;
    console.log(`[BotEngine] ${_bots.length} bots loaded`);
  } catch (e) {
    console.warn("[BotEngine] Could not load bots:", e.message);
  }
};

const pickBot = (excludeUid = null) => {
  const pool = excludeUid ? _bots.filter((b) => b.uid !== excludeUid) : _bots;
  return pool.length ? pick(pool) : null;
};

const isBotUid = (uid) => _bots.some((b) => b.uid === uid);

// =========================================================================
// RESPOND TO A REAL USER POST
// =========================================================================
const respondToPost = async (postId, post) => {
  if (!_bots.length) return;

  const numBots = randInt(1, 3);

  for (let i = 0; i < numBots; i++) {
    const bot = pickBot(post.authorUid);
    if (!bot) continue;

    // Stagger replies: 4s – 30s apart so it feels organic
    const delay = randInt(4000, 30000) + i * randInt(3000, 8000);

    setTimeout(async () => {
      const system = [
        `You are ${bot.name} on Orbit, a social app about saying what's on your mind.`,
        `Your bio: "${bot.bio}".`,
        `Write ONE short natural comment — 1 sentence, conversational, lowercase is fine.`,
        `No hashtags. Sound like a real person. Never say you're an AI.`,
        `Match the vibe: funny post → funny reply, deep post → thoughtful reply.`,
      ].join(" ");

      const user = `Someone posted: "${(post.text || "").slice(0, 200) || "[shared something]"}"\n\nReply naturally as yourself in one sentence.`;

      let text = (await groqReply(system, user)) || fallback();
      if (text.length > 200) text = text.slice(0, 197) + "...";

      try {
        await addDoc(collection(db, "posts", postId, "comments"), {
          authorUid: bot.uid,
          text,
          likes:     [],
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, "posts", postId), { commentCount: increment(1) });
        console.log(`[BotEngine] ${bot.name} commented on post`);
      } catch (e) {
        console.warn("[BotEngine] Comment failed:", e.message);
      }
    }, delay);
  }
};

// =========================================================================
// RESPOND IN GROUPS
// =========================================================================
const respondInGroup = (groupId, groupName, message, senderUid) => {
  // Only engage 40% of the time — keeps it natural
  if (Math.random() > 0.40 || !_bots.length) return;

  const bot   = pickBot(senderUid);
  if (!bot) return;

  const delay = randInt(6000, 22000);

  setTimeout(async () => {
    const system = [
      `You are ${bot.name} in a group chat called "${groupName}" on Orbit.`,
      `Your bio: "${bot.bio}".`,
      `Write a ONE sentence group chat reply. Conversational, casual, real.`,
      `No hashtags. Never say you're an AI.`,
    ].join(" ");

    const user = `Someone in the group said: "${(message.text || "").slice(0, 150) || "[sent something]"}"\n\nReply naturally.`;

    let text = (await groqReply(system, user)) || fallback();
    if (text.length > 160) text = text.slice(0, 157) + "...";

    try {
      await addDoc(collection(db, "groups", groupId, "messages"), {
        authorUid: bot.uid,
        text,
        media:     null,
        reactions: {},
        readBy:    [bot.uid],
        createdAt: serverTimestamp(),
      });
      console.log(`[BotEngine] ${bot.name} replied in group "${groupName}"`);
    } catch (e) {
      console.warn("[BotEngine] Group reply failed:", e.message);
    }
  }, delay);
};

// =========================================================================
// SPONTANEOUS POSTS — bots post on their own periodically
// =========================================================================
const SPONTANEOUS = [
  "random thought: the version of myself i was 3 years ago would be shook by where i am now",
  "why does doing nothing feel so productive until you realize you've done nothing",
  "today was a day. that's all i have for you",
  "some songs just know exactly what you're going through",
  "reminder that you don't have to have it all figured out. nobody does",
  "it's giving growth. slowly but surely",
  "okay but why is accountability so hard until you just decide to do it",
  "the weekend energy is something else. everyone's a different person",
  "my future self is going to understand this era better than i do right now",
  "genuinely grateful for the people who show up when they don't have to",
  "peace is truly the goal above everything else",
  "i need to stop saying 'i should really do that' and just do it",
  "silence hits different at night. my brain has opinions",
  "growth is so quiet. you don't notice it until something that used to hurt doesn't",
  "the right people don't need you to explain yourself that much",
];

const scheduleSpontaneous = () => {
  const wait = randInt(10 * 60 * 1000, 25 * 60 * 1000); // 10–25 min
  setTimeout(async () => {
    if (!_bots.length) { scheduleSpontaneous(); return; }
    const bot  = pickBot(state.uid); // don't post as the current logged-in user's uid
    if (!bot)  { scheduleSpontaneous(); return; }

    try {
      await addDoc(collection(db, "posts"), {
        authorUid:    bot.uid,
        authorIsBot:  true,
        text:         pick(SPONTANEOUS),
        media:        null,
        orbitCount:   0,
        orbits:       [],
        commentCount: 0,
        views:        randInt(10, 80),
        createdAt:    serverTimestamp(),
      });
      console.log(`[BotEngine] ${bot.name} posted spontaneously`);
    } catch (e) {
      console.warn("[BotEngine] Spontaneous post failed:", e.message);
    }

    scheduleSpontaneous();
  }, wait);
};

// =========================================================================
// WATCHERS
// =========================================================================
let _postWatcherStarted  = false;
let _groupWatcherStarted = false;

const watchPosts = () => {
  if (_postWatcherStarted) return;
  _postWatcherStarted = true;

  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(1));
  let   init = false;

  onSnapshot(q, (snap) => {
    if (!init) { init = true; return; } // skip initial load
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const post = change.doc.data();
      // Only respond to real users — skip bots and self
      if (post.authorIsBot)            return;
      if (post.authorUid === state.uid) return;
      console.log("[BotEngine] Real user posted — queuing bot replies");
      respondToPost(change.doc.id, post);
    });
  });
};

const watchGroups = async () => {
  if (_groupWatcherStarted) return;
  _groupWatcherStarted = true;

  try {
    const snap = await getDocs(collection(db, "groups"));
    snap.forEach((groupDoc) => {
      const group = groupDoc.data();
      const q     = query(
        collection(db, "groups", groupDoc.id, "messages"),
        orderBy("createdAt", "desc"), limit(1)
      );
      let init = false;
      onSnapshot(q, (msgSnap) => {
        if (!init) { init = true; return; }
        msgSnap.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const msg = change.doc.data();
          if (isBotUid(msg.authorUid))      return; // ignore bot messages
          if (msg.authorUid === state.uid)  return; // ignore self
          respondInGroup(groupDoc.id, group.name || "group", msg, msg.authorUid);
        });
      });
    });
    console.log(`[BotEngine] Watching ${snap.size} groups`);
  } catch (e) {
    console.warn("[BotEngine] Group watch failed:", e.message);
  }
};

// =========================================================================
// BOOT — wait for auth then start
// =========================================================================
const boot = async () => {
  // Wait until state.uid is populated (auth resolved)
  const waitForAuth = () => new Promise((resolve) => {
    const check = setInterval(() => {
      if (state.uid) { clearInterval(check); resolve(); }
    }, 300);
  });

  await waitForAuth();

  // Don't run if the current user is a bot themselves
  if (state.me?.isBot) return;

  console.log("[BotEngine] Starting — user:", state.uid);

  await loadBots();
  watchPosts();
  await watchGroups();
  scheduleSpontaneous();

  console.log("[BotEngine] ✅ Running. Groq:", GROQ_KEY() ? "enabled" : "fallback mode");
};

boot();
