# Orbit Vercel setup

This folder contains the updated browser file and Vercel serverless functions for the plain JavaScript version of Orbit.

## Copy these files

- Replace your existing app.js with this folder's app.js.
- Copy the api folder into the root of your Vercel project.
- Keep your existing index.html, sounds.js, chat.js, CSS, images, and other app files.
- Make sure index.html loads app.js as a module: <script type="module" src="./app.js"></script>

## Vercel environment variables

Add these in Vercel Project Settings > Environment Variables for every environment you deploy:

FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
GROQ_API_KEY
GROQ_MODEL=llama-3.3-70b-versatile

Firebase values come from Firebase Console > Project settings > Your apps > Web app.
The Groq value must be a newly generated key after revoking the exposed key.

## Deploy

1. Put index.html, the updated app.js, existing static files, and api in the project root.
2. Import that repository into Vercel, or run Vercel from that directory.
3. Add the environment variables before deploying.
4. Deploy or redeploy.
5. Open /api/config on the deployed site; it should return Firebase web configuration.
6. Test the AI assistant; the browser should call /api/groq, not api.groq.com.

## Local testing

Vercel variables are not available to a file opened with file://. Use vercel dev from the app root after adding local values.
Do not commit a real .env file. Use .env.example as the template.
