const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC9jF-ocy6HjsVzWVVlAyXW-4aIFgA79-A",
  projectId: "crypto-6517d",
};

const SITE_ORIGIN = "https://appConnect.vercel.app";

export default async function handler(_request, response) {
  const urls = [`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/explore`];

  try {
    const endpoint =
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}` +
      `/databases/(default)/documents/posts?orderBy=createdAt%20desc&pageSize=500` +
      `&key=${FIREBASE_CONFIG.apiKey}`;
    const result = await fetch(endpoint);

    if (result.ok) {
      const data = await result.json();
      for (const document of data.documents || []) {
        const id = document.name?.split("/").pop();
        if (id) urls.push(`${SITE_ORIGIN}/post/${encodeURIComponent(id)}`);
      }
    }
  } catch {
    // The homepage and Explore URLs are still returned if posts are private.
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}
</urlset>`;

  response.setHeader("Content-Type", "application/xml; charset=utf-8");
  response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
  response.status(200).send(xml);
}
