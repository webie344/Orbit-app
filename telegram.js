/* =============================================================
   Drop — telegram.js
   -------------------------------------------------------------
   Tiny client-side helper for the Telegram link flow.
   Sits next to app.js. Loaded lazily by app.js when the user
   has Telegram enabled in CONFIG.

   It does TWO things:

     1.  connect(uid)
         Generates a one-time link code, stores it in Firestore
         under  telegramLinks/{code}  with the user's uid, and
         returns a URL of the form:
             https://t.me/<botUsername>?start=<code>
         The user opens that URL, taps "Start" in Telegram, and
         the bot picks up the /start <code> message, looks up
         the code, and writes the user's chat_id back into
         users/{uid}.telegramChatId .

     2.  disconnect(uid)
         Clears  telegramChatId  on the user doc. Notifications
         stop arriving on Telegram.

   Why is there no send() here?
   ----------------------------
   Notification delivery is fully automatic. Whenever the web
   app writes to  users/{uid}/notifications/{id}  (which it
   already does for the in-app bell icon), the bot picks the
   change up over Firestore in real time and sends a Telegram
   message to the right person. The browser never has to know.
   ============================================================= */

import {
    doc,
    setDoc,
    updateDoc,
    deleteField,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const config = {
    botUsername: "",
    db: null,
    uid: null
};

// ---------- helpers ----------

function makeCode() {
    // 12 chars, URL-safe, easy to read. Telegram /start payloads
    // allow up to 64 alphanumeric characters, so we have lots of
    // headroom.
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
}

// ---------- public API ----------

export const Telegram = {

    /**
     * Configure once at startup.
     *   botUsername  — your bot's username, no @ (e.g. "DropAppBot")
     *   db           — the Firestore instance from app.js
     *   uid          — the current user's uid (used as a default)
     */
    configure(opts) {
        Object.assign(config, opts || {});
    },

    /**
     * Returns true if the given profile has a linked Telegram chat.
     */
    isLinked(profile) {
        return !!profile?.telegramChatId;
    },

    /**
     * Start the link flow. Writes a single-use code into
     *   telegramLinks/{code} = { uid, createdAt }
     * and returns the t.me URL the user should open.
     *
     * The bot, when it receives  /start <code>  from a Telegram
     * user, will:
     *   1. read telegramLinks/{code}
     *   2. update users/{uid} with { telegramChatId, telegramUsername }
     *   3. delete telegramLinks/{code}
     */
    async connect(uid) {
        if (!config.botUsername) {
            throw new Error("Telegram bot username not configured");
        }
        if (!config.db) throw new Error("Telegram db not configured");
        const useUid = uid || config.uid;
        if (!useUid) throw new Error("Telegram connect requires a uid");

        const code = makeCode();
        try {
            await setDoc(doc(config.db, "telegramLinks", code), {
                uid: useUid,
                createdAt: serverTimestamp()
            });
        } catch (err) {
            console.warn("telegram link write failed:", err);
            throw err;
        }

        return `https://t.me/${config.botUsername}?start=${encodeURIComponent(code)}`;
    },

    /**
     * Stop sending Telegram notifications to this user. Clears
     * the stored chat id so the bot has nothing to deliver to.
     */
    async disconnect(uid) {
        if (!config.db) throw new Error("Telegram db not configured");
        const useUid = uid || config.uid;
        if (!useUid) throw new Error("Telegram disconnect requires a uid");

        try {
            await updateDoc(doc(config.db, "users", useUid), {
                telegramChatId: deleteField(),
                telegramUsername: deleteField(),
                telegramNotifyEnabled: false
            });
        } catch (err) {
            console.warn("telegram disconnect (firestore):", err);
            throw err;
        }
    }
};

// Expose for quick console debugging.
if (typeof window !== "undefined") {
    window.Telegram = Telegram;
}
