
/*
 * Vercel serverless route for public Orbit post previews.
 *
 * It reads the public Firestore document with the same Firebase web project
 * configuration used by app.js. It does not contain a private credential.
 *
 * If Firestore rules require a signed-in user to read posts, this route will
 * return the generic Orbit preview instead. In that case, make only the
 * shareable post fields publicly readable or add a private Vercel Firebase
 * Admin credential through Vercel Environment Variables.
 */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC9jF-ocy6HjsVzWVVlAyXW-4aIFgA79-A",
  projectId: "crypto-6517d",
};

const SITE_ORIGIN = "https://appConnect.vercel.app";
const DEFAULT_TITLE = "Orbit — Your Space to Learn, Connect, and Create.";
const DEFAULT_DESCRIPTION = "A new gravity for your circles.";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/orbit.png`;

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const decodeFirestoreValue = (value) => {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(decodeFirestoreValue);
  }
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, item]) => [
        key,
        decodeFirestoreValue(item),
      ]),
    );
  }
  return value;
};

const mediaItems = (media) => {
  if (!media) return [];
  return Array.isArray(media) ? media.filter(Boolean) : [media];
};

const previewImageFor = (post) => {
  const media = mediaItems(post.media)[0];
  if (!media?.url) return DEFAULT_IMAGE;
  if (media.type === "video") {
    return String(media.url)
      .replace(/\.mp4(\?.*)?$/i, ".jpg")
      .replace(/\.webm(\?.*)?$/i, ".jpg")
      .replace(/\.mov(\?.*)?$/i, ".jpg");
  }
  return media.url;
};

const fetchPost = async (id) => {
  const path = encodeURIComponent(id);
  const endpoint =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}` +
    `/databases/(default)/documents/posts/${path}?key=${FIREBASE_CONFIG.apiKey}`;
  const response = await fetch(endpoint);
  if (!response.ok) return null;
  const document = await response.json();
  return Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [
      key,
      decodeFirestoreValue(value),
    ]),
  );
};

export default async function handler(request, response) {
  const id = request.query?.id;
  const postUrl = `${SITE_ORIGIN}/post/${encodeURIComponent(id || "")}`;
  let post = null;

  if (id) {
    try {
      post = await fetchPost(id);
    } catch {
      post = null;
    }
  }

  const caption = String(post?.text || "").trim();
  const title = caption
    ? `${caption.slice(0, 80)}${caption.length > 80 ? "…" : ""}`
    : DEFAULT_TITLE;
  const description = caption || DEFAULT_DESCRIPTION;
  const image = previewImageFor(post || {});
  const media = mediaItems(post?.media)[0];

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  response.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(postUrl)}">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(postUrl)}">
    <meta property="og:image" content="${escapeHtml(image)}">
    <meta property="og:image:alt" content="Orbit post preview">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(image)}">
    ${media?.type === "video" ? `<meta property="og:video" content="${escapeHtml(media.url)}">
    <meta property="og:video:type" content="video/mp4">` : ""}
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <img src="${escapeHtml(image)}" alt="Orbit post preview" style="max-width:100%">
    </main>
    <script>
      setTimeout(function () {
        window.location.replace("/#post/${encodeURIComponent(id || "")}");
      }, 100);
    </script>
  </body>
</html>`);
}
