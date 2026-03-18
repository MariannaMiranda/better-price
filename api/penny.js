export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
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

      // If model not found or doesn't support the request type, try next
      const errMsg = data?.error?.message || '';
      lastError = errMsg;
      if (
        errMsg.toLowerCase().includes('model') ||
        errMsg.toLowerCase().includes('not found') ||
        errMsg.toLowerCase().includes('not support') ||
        errMsg.toLowerCase().includes('vision') ||
        response.status === 404
      ) {
        continue;
      }

      // Any other error (bad key, rate limit, etc.) — return immediately
      return res.status(response.status).json({ error: errMsg || 'Groq error' });
    }

    // All models failed
    return res.status(500).json({ error: 'All models failed. Last error: ' + lastError });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
