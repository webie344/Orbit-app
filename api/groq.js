function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: "GROQ_API_KEY is not configured on the server" } });
  }

  try {
    const { messages } = parseBody(req.body);
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: "messages must be a non-empty array" } });
    }

    const safeMessages = messages
      .filter((message) => message && ["system", "user", "assistant"].includes(message.role) && typeof message.content === "string")
      .map((message) => ({ role: message.role, content: message.content.slice(0, 12000) }))
      .slice(-16);

    if (safeMessages.length === 0) {
      return res.status(400).json({ error: { message: "No valid messages were provided" } });
    }

    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: safeMessages,
        max_tokens: 280,
        temperature: 0.9,
      }),
    });

    const responseBody = await upstream.json().catch(() => ({ error: { message: "Invalid response from Groq" } }));
    return res.status(upstream.status).json(responseBody);
  } catch {
    return res.status(500).json({ error: { message: "Unable to contact the AI service" } });
  }
}
