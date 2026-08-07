ORBIT SHARE + GOOGLE INDEXING UPDATE
====================================

IMPORTANT: The live site at https://orbit-appconnect.vercel.app/ is currently
still serving the old files. This ZIP only updates your project after you
commit the files to the GitHub repository connected to that Vercel site.

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
- Wait for Vercel to finish the deployment connected to your GitHub commit.
- Open https://orbit-appconnect.vercel.app/ in a private/incognito tab.
- Confirm https://orbit-appconnect.vercel.app/orbit.png opens in a browser.
- Confirm https://orbit-appconnect.vercel.app/robots.txt opens.
- Confirm https://orbit-appconnect.vercel.app/sitemap.xml opens.
- View the homepage source and search for "appConnect.vercel.app".
  There must be zero results. If it appears, the old index.html is still live.
- Submit https://orbit-appconnect.vercel.app/ in Google Search Console.

Important:
The dynamic post preview reads posts through Firebase's public REST endpoint.
If your Firestore rules only allow signed-in users to read posts, external
previews cannot read those posts. In that case, shared post reads must be made
public safely, or a private server credential must be added in Vercel settings.
Do not paste a private credential into app.js.

PHONE DEPLOYMENT CHECKLIST
--------------------------
1. Open the GitHub repository connected to orbit-appconnect.vercel.app.
2. Replace the existing app.js, index.html and style.css.
3. Create api/post/[id].js and api/sitemap.js using the paths shown above.
4. Create or replace vercel.json, robots.txt and sitemap.xml in the repository root.
5. Add public/orbit.png (create the public folder by naming the upload path
   public/orbit.png if GitHub offers that option).
6. Commit all changes to the branch Vercel is watching, usually main.
7. Open Vercel and wait until the deployment says Ready.
8. Test the four URLs listed above. Do not test the ZIP file itself as a URL.
