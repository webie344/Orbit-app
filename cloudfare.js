/* =============================================================================
   Drop — Cloudflare Worker (free tier, no credit card required)
   -----------------------------------------------------------------------------
   Sends real phone push notifications via Firebase Cloud Messaging (FCM)
   AND optional Telegram messages, on behalf of the Drop web app.

   ENDPOINTS (all POST, JSON body):
     /notify   { recipientUid, notificationId }
        → reads users/{recipientUid}/notifications/{notificationId} from
          Firestore and pushes it to all the user's devices + Telegram.

     /post   { postId }
        → reads posts/{postId} and fans out a "your friend just dropped"
          push to every friend of the poster.

     /telegram/start   { uid }
        → returns { code, botLink }. The user opens the bot and sends
          "/link CODE" to claim their account.

     /telegram/check   { uid, code }
        → polls Telegram getUpdates for that code; if found, saves the
          chat_id onto users/{uid} and returns { ok: true }.

     /telegram/disconnect   { uid }
        → clears users/{uid}.telegramChatId.

   CRON (set in wrangler.toml or Dashboard → Triggers):
     Runs hourly. Sends "It's drop time!" to every user whose preferred
     prompt time matches the current hour in their local timezone.

   ENVIRONMENT VARIABLES (Dashboard → Settings → Variables):
     FIREBASE_SERVICE_ACCOUNT  (Encrypted)  full service-account JSON, as a string
     FIREBASE_PROJECT_ID                    e.g. "crypto-6517d"
     ALLOWED_ORIGIN                         your site URL, or "*"  (default "*")
     TELEGRAM_BOT_TOKEN        (Encrypted)  optional, from @BotFather
     TELEGRAM_BOT_USERNAME                  optional, e.g. "DropAppBot"

   HOW TO DEPLOY (no command line required):
     1. Sign up at cloudflare.com (free, no card).
     2. Workers & Pages → Create Worker → name it "drop-notifications".
     3. Click "Quick edit" and paste this whole file in.
     4. Settings → Variables → add the variables above.
        For FIREBASE_SERVICE_ACCOUNT, download the JSON from:
        Firebase Console → Project Settings → Service Accounts
        → "Generate new private key" → paste the full JSON string.
     5. Triggers → Cron Triggers → add  "0 * * * *"  (every hour).
     6. Save and Deploy. Copy the worker URL (looks like
        https://drop-notifications.<your-name>.workers.dev) and put it
        in app.js → CONFIG.cloudflareWorker.url.
   ============================================================================= */

let _accessToken = null;
let _accessTokenExpiry = 0;

/* -------------------------------- CORS -------------------------------- */

function corsHeaders(env) {
    return {
        "Access-Control-Allow-Origin": env?.ALLOWED_ORIGIN || "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400"
    };
}

function jsonResponse(env, body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(env), "Content-Type": "application/json" }
    });
}

/* ----------------------- Google OAuth (service account) ----------------------- */

async function getAccessToken(env) {
    if (_accessToken && Date.now() < _accessTokenExpiry) return _accessToken;

    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: sa.client_email,
        scope: [
            "https://www.googleapis.com/auth/firebase.messaging",
            "https://www.googleapis.com/auth/datastore"
        ].join(" "),
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now
    };
    const jwt = await signJwt(claim, sa.private_key);

    const resp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: jwt
        })
    });
    const data = await resp.json();
    if (!data.access_token) {
        throw new Error("OAuth token exchange failed: " + JSON.stringify(data));
    }
    _accessToken = data.access_token;
    _accessTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return _accessToken;
}

async function signJwt(claim, privateKeyPem) {
    const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
    const header = { alg: "RS256", typ: "JWT" };
    const data = `${enc(header)}.${enc(claim)}`;

    const pem = privateKeyPem
        .replace(/-----BEGIN PRIVATE KEY-----/, "")
        .replace(/-----END PRIVATE KEY-----/, "")
        .replace(/\s/g, "");
    const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
        "pkcs8",
        der.buffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(data)
    );
    return `${data}.${b64url(new Uint8Array(sig))}`;
}

function b64url(bytes) {
    let s = "";
    bytes.forEach(b => s += String.fromCharCode(b));
    return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/* ------------------------------ Firestore REST ------------------------------ */

function fsBase(env) {
    return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function fsCall(env, method, path, body) {
    const token = await getAccessToken(env);
    const url = path.startsWith("http") ? path : `${fsBase(env)}/${path}`;
    const resp = await fetch(url, {
        method,
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (resp.status === 404) return null;
    if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Firestore ${method} ${path} failed: ${resp.status} ${t}`);
    }
    return resp.status === 204 ? null : await resp.json();
}

function fromFsValue(v) {
    if (v == null) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("nullValue" in v) return null;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFsValue);
    if ("mapValue" in v) return flattenFields(v.mapValue.fields || {});
    return null;
}
function flattenFields(fields) {
    const out = {};
    for (const k in fields) out[k] = fromFsValue(fields[k]);
    return out;
}
function flattenDoc(d) {
    if (!d || !d.fields) return null;
    return flattenFields(d.fields);
}
function toFsValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "string") return { stringValue: v };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") {
        return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
    if (typeof v === "object") {
        const fields = {};
        for (const k in v) fields[k] = toFsValue(v[k]);
        return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
}

/* ------------------------------ FCM v1 sender ------------------------------ */

async function sendFcmToUser(env, uid, notification, data) {
    if (!uid) return { sent: 0, failed: 0 };
    const tokensDoc = await fsCall(env, "GET", `users/${uid}/fcmTokens`);
    const tokens = (tokensDoc?.documents || []).map(d => d.name.split("/").pop());
    if (!tokens.length) return { sent: 0, failed: 0 };

    let sent = 0, failed = 0;
    const accessToken = await getAccessToken(env);
    const url = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;
    const stringData = {};
    Object.entries({ ...data, title: notification.title, body: notification.body || "" })
        .forEach(([k, v]) => { stringData[k] = String(v ?? ""); });

    await Promise.all(tokens.map(async (token) => {
        try {
            const resp = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: {
                        token,
                        notification: {
                            title: notification.title,
                            body: notification.body || ""
                        },
                        data: stringData,
                        webpush: {
                            fcmOptions: { link: data.url || "/" },
                            notification: { icon: "/icon-192.png", badge: "/icon-192.png" }
                        }
                    }
                })
            });
            if (resp.ok) { sent++; return; }
            failed++;
            const errText = await resp.text();
            // Clean up dead tokens
            if (resp.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(errText)) {
                await fsCall(env, "DELETE", `users/${uid}/fcmTokens/${token}`).catch(() => {});
            }
        } catch {
            failed++;
        }
    }));
    return { sent, failed };
}

/* ------------------------------ Telegram sender ------------------------------ */

async function tgSendToUser(env, uid, text) {
    if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, reason: "no-bot" };
    const userDoc = await fsCall(env, "GET", `users/${uid}`);
    const profile = flattenDoc(userDoc);
    const chatId = profile?.telegramChatId;
    if (!chatId) return { ok: false, reason: "no-chat" };
    const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
    });
    return { ok: resp.ok };
}

/* ------------------------------ Composers ------------------------------ */

function composeFromNotification(notif) {
    const from = notif.fromUsername || "someone";
    const titles = {
        like:            "❤️ New like",
        comment:         "💬 New comment",
        reaction:        "✨ New reaction",
        friend_request:  "👋 New friend request",
        friend_accepted: "🎉 Friend request accepted",
        view:            "👀 Someone saw your drop",
        mention:         "📣 You were mentioned",
        tagged_in_drop:  "📸 You were tagged in a drop"
    };
    const bodies = {
        like:            `@${from} liked your drop`,
        comment:         `@${from} commented: ${notif.commentText || ""}`.trim(),
        reaction:        `@${from} reacted to your drop`,
        friend_request:  `@${from} wants to be friends`,
        friend_accepted: `@${from} is now your friend`,
        view:            `@${from} saw your drop`,
        mention:         `@${from} mentioned you`,
        tagged_in_drop:  `@${from} tagged you in their drop`
    };
    const type = notif.type || "default";
    return {
        title: titles[type] || "Drop",
        body:  bodies[type] || notif.message || "You have a new notification",
        url:   notif.postId ? `/#/post/${notif.postId}`
            : (type === "friend_request" || type === "friend_accepted") ? "/#/friends"
            : "/#/notifications",
        type,
        postId: notif.postId || ""
    };
}

/* ------------------------------ HTTP handlers ------------------------------ */

async function handleNotify(req, env) {
    const { recipientUid, notificationId } = await req.json();
    if (!recipientUid || !notificationId) {
        return jsonResponse(env, { error: "missing recipientUid or notificationId" }, 400);
    }
    const notifDoc = await fsCall(env, "GET",
        `users/${recipientUid}/notifications/${notificationId}`);
    if (!notifDoc) return jsonResponse(env, { error: "notification not found" }, 404);

    const notif = flattenDoc(notifDoc);
    const composed = composeFromNotification(notif);

    const fcm = await sendFcmToUser(env, recipientUid,
        { title: composed.title, body: composed.body },
        { type: composed.type, postId: composed.postId, url: composed.url });
    const tg = await tgSendToUser(env, recipientUid,
        `${composed.title}\n${composed.body}`);

    return jsonResponse(env, { ok: true, fcm, telegram: tg });
}

async function handlePost(req, env) {
    const { postId } = await req.json();
    if (!postId) return jsonResponse(env, { error: "missing postId" }, 400);

    const postDoc = await fsCall(env, "GET", `posts/${postId}`);
    if (!postDoc) return jsonResponse(env, { error: "post not found" }, 404);

    const post = flattenDoc(postDoc);
    if (post.circleId) return jsonResponse(env, { ok: true, skipped: "circle" });
    if (!post.uid || !post.username) return jsonResponse(env, { error: "bad post" }, 400);

    const friendsResp = await fsCall(env, "GET", `users/${post.uid}/friends`);
    const friendIds = (friendsResp?.documents || []).map(d => d.name.split("/").pop());
    if (!friendIds.length) return jsonResponse(env, { ok: true, sent: 0 });

    const title = "📸 Your friend just dropped";
    const body = `@${post.username} dropped today's prompt`;
    let fcmTotal = 0, tgTotal = 0;
    await Promise.all(friendIds.map(async (fid) => {
        const fcm = await sendFcmToUser(env, fid, { title, body },
            { type: "drop", postId, url: `/#/post/${postId}` });
        fcmTotal += fcm.sent;
        const tg = await tgSendToUser(env, fid, `${title}\n${body}`);
        if (tg.ok) tgTotal++;
    }));
    return jsonResponse(env, { ok: true, fcm: fcmTotal, telegram: tgTotal });
}

/* ------------------------------ Telegram link flow ------------------------------ */

async function handleTelegramStart(req, env) {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME) {
        return jsonResponse(env, { error: "telegram not configured" }, 400);
    }
    const { uid } = await req.json();
    if (!uid) return jsonResponse(env, { error: "missing uid" }, 400);

    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    await fsCall(env, "PATCH",
        `users/${uid}?updateMask.fieldPaths=telegramLinkCode&updateMask.fieldPaths=telegramLinkExpires`,
        { fields: {
            telegramLinkCode:    toFsValue(code),
            telegramLinkExpires: toFsValue(Date.now() + 10 * 60 * 1000)
        }});
    return jsonResponse(env, {
        code,
        botLink: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`
    });
}

async function handleTelegramCheck(req, env) {
    if (!env.TELEGRAM_BOT_TOKEN) {
        return jsonResponse(env, { error: "telegram not configured" }, 400);
    }
    const { uid, code } = await req.json();
    if (!uid || !code) return jsonResponse(env, { error: "missing uid or code" }, 400);

    const resp = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?limit=100`
    );
    const data = await resp.json();
    if (!data.ok) return jsonResponse(env, { error: "telegram getUpdates failed" }, 500);

    const upper = code.toUpperCase();
    let chatId = null;
    for (const upd of (data.result || [])) {
        const msg = upd.message;
        if (!msg || !msg.text) continue;
        const t = msg.text.trim().toUpperCase();
        if (t === `/START ${upper}` || t === `/LINK ${upper}` || t === upper) {
            chatId = msg.chat.id;
            break;
        }
    }
    if (!chatId) return jsonResponse(env, { ok: false });

    await fsCall(env, "PATCH",
        `users/${uid}?updateMask.fieldPaths=telegramChatId&updateMask.fieldPaths=telegramLinkCode`,
        { fields: {
            telegramChatId:   toFsValue(String(chatId)),
            telegramLinkCode: toFsValue(null)
        }});
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: "✅ You're connected to Drop. You'll get notifications here when friends drop, like, or comment."
        })
    });
    return jsonResponse(env, { ok: true });
}

async function handleTelegramDisconnect(req, env) {
    const { uid } = await req.json();
    if (!uid) return jsonResponse(env, { error: "missing uid" }, 400);
    await fsCall(env, "PATCH",
        `users/${uid}?updateMask.fieldPaths=telegramChatId`,
        { fields: { telegramChatId: toFsValue(null) }});
    return jsonResponse(env, { ok: true });
}

/* ------------------------------ Daily reminder cron ------------------------------ */

async function handleScheduled(env) {
    const utcNow = new Date();
    const utcMinutes = utcNow.getUTCHours() * 60 + utcNow.getUTCMinutes();

    const queryBody = {
        structuredQuery: {
            from: [{ collectionId: "users" }],
            where: {
                fieldFilter: {
                    field: { fieldPath: "pushEnabled" },
                    op: "EQUAL",
                    value: { booleanValue: true }
                }
            }
        }
    };
    const rows = await fsCall(env, "POST",
        `${fsBase(env)}:runQuery`, queryBody);

    const sends = [];
    for (const row of (rows || [])) {
        if (!row.document) continue;
        const u = flattenDoc(row.document);
        const t = u.promptTimeLocal || "";
        const m = /^(\d{2}):(\d{2})$/.exec(t);
        if (!m) continue;
        const localMin = (+m[1]) * 60 + (+m[2]);
        // tzOffsetMin = minutes WEST of UTC (matches JS Date.getTimezoneOffset)
        const tzOff = Number(u.tzOffsetMin || 0);
        // Convert user's local time to UTC minutes
        const userUtcMin = ((localMin + tzOff) % 1440 + 1440) % 1440;
        const diff = Math.abs(userUtcMin - utcMinutes);
        if (diff < 30 || diff > 1410) {
            const uid = row.document.name.split("/").pop();
            sends.push({
                uid,
                title: "📸 It's drop time!",
                body:  "Your daily prompt is open. Capture the moment."
            });
        }
    }
    await Promise.all(sends.map(async (s) => {
        await sendFcmToUser(env, s.uid,
            { title: s.title, body: s.body },
            { type: "reminder", url: "/#/" });
        await tgSendToUser(env, s.uid, `${s.title}\n${s.body}`);
    }));
}

/* ------------------------------ Main entry ------------------------------ */

export default {
    async fetch(req, env) {
        if (req.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders(env) });
        }
        const url = new URL(req.url);
        try {
            switch (url.pathname) {
                case "/":                     return jsonResponse(env, { ok: true, name: "drop-notifications" });
                case "/notify":               return await handleNotify(req, env);
                case "/post":                 return await handlePost(req, env);
                case "/telegram/start":       return await handleTelegramStart(req, env);
                case "/telegram/check":       return await handleTelegramCheck(req, env);
                case "/telegram/disconnect":  return await handleTelegramDisconnect(req, env);
                default:                      return jsonResponse(env, { error: "not found" }, 404);
            }
        } catch (err) {
            return jsonResponse(env, { error: String(err?.message || err) }, 500);
        }
    },
    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleScheduled(env));
    }
};


