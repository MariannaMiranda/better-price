export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body;

    // Detect if any message contains image_url content (vision request)
    const hasImages = (body.messages || []).some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
    );

    // Vision-capable models (Groq free tier)
    const visionModels = [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.2-11b-vision-preview',
      'llama-3.2-90b-vision-preview',
    ];

    // Text-only models
    const textModels = [
      'llama-3.3-70b-versatile',
      'llama3-70b-8192',
      'llama3-8b-8192',
      'mixtral-8x7b-32768',
    ];

    // Pick model list based on whether this is a vision request
    const preferredModels = hasImages ? visionModels : textModels;

    // If a specific model was requested, try it first then fall back
    const requestedModel = body.model;
    const tryModels =
      requestedModel && preferredModels.includes(requestedModel)
        ? [requestedModel, ...preferredModels.filter(m => m !== requestedModel)]
        : preferredModels;

    let lastError = null;

    for (const model of tryModels) {
      let messages = body.messages;
      let groqBody;

      if (hasImages && visionModels.includes(model)) {
        // Vision models on Groq don't support a separate 'system' role message.
        // Flatten the system prompt into the first user message instead.
        if (body.system) {
          const firstUserIdx = messages.findIndex(m => m.role === 'user');
          if (firstUserIdx !== -1) {
            const firstUser = messages[firstUserIdx];
            const systemBlock = { type: 'text', text: '[Context]\n' + body.system + '\n\n[User]' };
            const content = Array.isArray(firstUser.content)
              ? [systemBlock, ...firstUser.content]
              : [systemBlock, { type: 'text', text: firstUser.content }];
            messages = [
              ...messages.slice(0, firstUserIdx),
              { ...firstUser, content },
              ...messages.slice(firstUserIdx + 1),
            ];
          }
        }
        groqBody = { model, max_tokens: body.max_tokens || 1000, messages };
      } else {
        // Text models: inject system as a 'system' role message at the top
        groqBody = {
          model,
          max_tokens: body.max_tokens || 1000,
          messages: body.system
            ? [{ role: 'system', content: body.system }, ...messages]
            : messages,
        };
      }

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + process.env.GROQ_API_KEY,
        },
        body: JSON.stringify(groqBody),
      });

      const data = await response.json();

      if (response.ok) {
        const text = data.choices?.[0]?.message?.content || '';
        return res.status(200).json({ text });
      }

      // If the model is not found / unsupported, try the next one
      const errMsg = data?.error?.message || '';
      lastError = errMsg;
      if (
        errMsg.toLowerCase().includes('model') ||
        errMsg.toLowerCase().includes('not found') ||
        errMsg.toLowerCase().includes('not support') ||
        response.status === 404
      ) {
        continue;
      }

      // Any other error (bad API key, rate limit, etc.) — surface it immediately
      return res.status(response.status).json({ error: errMsg || 'Groq API error' });
    }

    // Every model in the list failed
    return res
      .status(500)
      .json({ error: 'All models failed. Last error: ' + lastError });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
