const firebaseEnvironmentVariables = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
};

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const config = Object.fromEntries(
    Object.entries(firebaseEnvironmentVariables).map(([configKey, envKey]) => [
      configKey,
      process.env[envKey],
    ]),
  );

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([configKey]) => configKey);

  if (missing.length) {
    return res.status(500).json({ error: "Firebase configuration is incomplete", missing });
  }

  return res.status(200).json(config);
}
