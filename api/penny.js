export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body;

    // Detect if any message contains image content
    const hasImage = (body.messages || []).some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === 'image_url' || c.type === 'image')
    );

    if (hasImage) {
      // Route to Groq vision model — free tier, supports image input
      // Convert Anthropic-style image format to OpenAI/Groq format if needed
      const messages = (body.messages || []).map(m => {
        if (!Array.isArray(m.content)) return m;
        const converted = m.content.map(c => {
          if (c.type === 'image' && c.source?.type === 'base64') {
            // Anthropic format → OpenAI format
            return {
              type: 'image_url',
              image_url: {
                url: `data:${c.source.media_type};base64,${c.source.data}`
              }
            };
          }
          return c;
        });
        return { ...m, content: converted };
      });

      // Prepend system message if present
      const fullMessages = body.system
        ? [{ role: 'system', content: body.system }, ...messages]
        : messages;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: body.max_tokens || 1000,
          messages: fullMessages,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        const text = data.choices?.[0]?.message?.content || '';
        return res.status(200).json({ text });
      }

      // Vision model failed — fall back to text response
      const errMsg = data?.error?.message || 'Vision model error';
      return res.status(200).json({
        text: "I can see you attached an image, but I'm having trouble processing it right now. Could you describe what's in the photo? I'm happy to help with prices, products, or your grocery list."
      });
    }

    // Text-only: try models in order until one works
    const models = [
      'llama-3.3-70b-versatile',
      'llama3-70b-8192',
      'llama3-8b-8192',
      'mixtral-8x7b-32768',
    ];

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

      const errMsg = data?.error?.message || '';
      lastError = errMsg;
      if (
        errMsg.toLowerCase().includes('model') ||
        errMsg.toLowerCase().includes('not found') ||
        response.status === 404
      ) {
        continue;
      }

      return res.status(response.status).json({ error: errMsg || 'Groq error' });
    }

    return res.status(500).json({ error: 'All models failed. Last error: ' + lastError });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
