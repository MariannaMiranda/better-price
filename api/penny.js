export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'API key not configured. Set GROQ_API_KEY in Vercel environment variables.' });
  }

  try {
    const body = req.body;

    // Detect if the request contains image content (vision request)
    const hasImages = body.messages?.some(m =>
      Array.isArray(m.content) &&
      m.content.some(c => c.type === 'image_url')
    );

    // Vision-capable models (ordered by preference, free tier on Groq)
    const visionModels = [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
    ];

    // Text-only models (ordered by preference)
    const textModels = [
      'llama-3.3-70b-versatile',
      'llama3-70b-8192',
      'llama3-8b-8192',
      'mixtral-8x7b-32768',
    ];

    // Pick model list based on whether images are present
    const models = hasImages ? visionModels : textModels;

    // If the caller specified a model, try it first (only if it's in the right category)
    const requestedModel = body.model;
    const tryModels = models.includes(requestedModel)
      ? [requestedModel, ...models.filter(m => m !== requestedModel)]
      : models;

    let lastError = null;
    let lastStatus = 500;

    for (const model of tryModels) {
      const groqBody = { ...body, model };

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        },
        body: JSON.stringify(groqBody),
      });

      const data = await response.json();

      if (response.ok) {
        const text = data.choices?.[0]?.message?.content || '';
        return res.status(200).json({ text });
      }

      const errMsg = data?.error?.message || data?.error?.code || 'Unknown error';
      lastError = errMsg;
      lastStatus = response.status;

      // Rate limit — surface immediately so frontend can show a friendly wait message
      if (response.status === 429) {
        return res.status(429).json({ error: 'Rate limit reached. Please wait a moment and try again.' });
      }

      // Auth error — no point retrying
      if (response.status === 401) {
        return res.status(401).json({ error: 'Invalid API key.' });
      }

      // Model not available — try next
      if (
        errMsg.toLowerCase().includes('model') ||
        errMsg.toLowerCase().includes('not found') ||
        errMsg.toLowerCase().includes('not support') ||
        errMsg.toLowerCase().includes('vision') ||
        response.status === 404
      ) {
        continue;
      }

      // Other client error — return immediately
      if (response.status >= 400 && response.status < 500) {
        return res.status(response.status).json({ error: errMsg });
      }
      // Server error — try next model
    }

    return res.status(lastStatus).json({ error: 'All models unavailable. Last error: ' + lastError });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
