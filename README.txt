ORBIT SHARE + GOOGLE INDEXING UPDATE
====================================

Put these files into your GitHub/Vercel project:

1. Replace your existing files:
   app.js
   index.html
   style.css

2. Copy the api folder into the project root:
   api/post/[id].js
   api/sitemap.js

3. Copy vercel.json into the project root.

4. Copy robots.txt and sitemap.xml into the project root.

5. Put your Orbit preview image at:
   public/orbit.png
   (or at the project root if your current site already serves root images there.)

6. Keep your existing chat.js, notifications.js, features.js, additional.js,
   b.js, manifest.json, service worker, and other assets as they are.

What changed:
- Orbit post links now use /post/POST_ID instead of a hash-only URL.
- The share dialog includes device Share, WhatsApp, Telegram, and Copy link.
- Supported phones can attach the actual post image/video through device sharing.
- Other apps receive a crawlable link with a post image preview.
- The homepage preview uses /orbit.png.
- robots.txt and sitemap.xml are included for Google Search Console.

After publishing:
- Confirm https://appConnect.vercel.app/orbit.png opens in a browser.
- Confirm https://appConnect.vercel.app/robots.txt opens.
- Confirm https://appConnect.vercel.app/sitemap.xml opens.
- Submit https://appConnect.vercel.app/ in Google Search Console.

Important:
The dynamic post preview reads posts through Firebase's public REST endpoint.
If your Firestore rules only allow signed-in users to read posts, external
previews cannot read those posts. In that case, shared post reads must be made
public safely, or a private server credential must be added in Vercel settings.
Do not paste a private credential into app.js.
