// =========================================================================
// Orbit — send-notification.js
// Vercel Serverless Function — sends a Web Push notification.
//
// ⚠️  IMPORTANT — when uploading to GitHub, create a folder called "api"
//     and put this file inside it so the path is:  api/send-notification.js
//     Vercel automatically turns files in /api into serverless endpoints.
//
// Required environment variables (set in Vercel dashboard):
//   VAPID_PUBLIC_KEY   — the public key from your key pair
//   VAPID_PRIVATE_KEY  — the private key from your key pair (keep secret!)
//   VAPID_SUBJECT      — mailto:you@yourdomain.com
// =========================================================================

const webpush = require("web-push");

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:cypriandavidonyebuchi@orbit.app",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ⚠️  `icon` and `image` must be destructured here — otherwise the
  //     sender's profile picture / post thumbnail never reaches the
  //     push payload, even though the client sends them.
  const { subscription, title, body, url, icon, image } = req.body;

  if (!subscription || !title) {
    return res.status(400).json({ error: "Missing subscription or title" });
  }

  const payload = JSON.stringify({
    title: title || "Orbit",
    body: body || "",
    url: url || "/",
    // Use the sender's profile picture (or whatever icon the client sent)
    // and fall back to the app icon only when nothing was provided.
    icon: icon || "/icon-192.png",
    badge: "/icon-192.png",
    // Optional large preview image (post/comment thumbnail, chat photo, etc.)
    // Only included when present — sw.js ignores it otherwise.
    ...(image ? { image } : {}),
  });

  try {
    await webpush.sendNotification(subscription, payload);
    return res.status(200).json({ success: true });
  } catch (err) {
    // 410 = subscription expired/invalid — client should re-subscribe
    if (err.statusCode === 410) {
      return res.status(410).json({ error: "Subscription expired" });
    }
    console.error("Push send error:", err);
    return res.status(500).json({ error: "Failed to send notification" });
  }
};
