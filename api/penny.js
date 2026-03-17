export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body;

    // Try models in order until one works
    const models = [
      'llama-3.3-70b-versatile',
      'llama3-70b-8192',
      'llama3-8b-8192',
      'mixtral-8x7b-32768',
    ];

    // Use the model from the request body if provided, otherwise try the list
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

      // If model not found, try next one
      const errMsg = data?.error?.message || '';
      lastError = errMsg;
      if (
        errMsg.toLowerCase().includes('model') ||
        errMsg.toLowerCase().includes('not found') ||
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
