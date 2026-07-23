// ── Freemium config ──
// "chat" = plain text messages to Penny. "scan" = any message that includes a
// photo (barcode/price-tag photo reads, landing-page image chat, etc).
// Free-tier caps live here so they're easy to tweak in one place.
const LIMITS = {
  chat: { max: 10, windowMs: 24 * 60 * 60 * 1000 }, // 10 messages / day
  scan: { max: 5,  windowMs: 24 * 60 * 60 * 1000 }, // 5 scans / day
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://viemououczppxevejtvs.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SERPER_API_KEY = process.env.SERPER_API_KEY || '';

// ── Live web search (Pro only) ──
// Cheap heuristic: only spend a search credit when the message actually looks
// time-sensitive. General/how-to/recipe questions never trigger a search.
const SEARCH_TRIGGER_RX = /\b(today|currently|current price|current cost|latest|this week|this month|this year|right now|recent(ly)?|as of (today|now)|price of|cost of|on sale|any (deals|sales)|new (price|update)|update(d)? price|202[4-9]|what'?s new|happening now)\b/i;

function shouldSearch(text) {
  return !!text && SEARCH_TRIGGER_RX.test(text);
}

// Pulls the plain text out of the most recent user message, whether its
// content is a bare string or a vision-style array of {type, text} parts.
function getLatestUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      const textPart = m.content.find(c => c.type === 'text');
      if (textPart) return textPart.text;
    }
  }
  return '';
}

// Real-time Google results via Serper.dev. Returns a short text block ready
// to drop into the model's context, or null if search isn't configured/fails
// (failing silently here is intentional — Penny should still answer without
// search rather than error out over a search hiccup).
async function webSearch(query) {
  if (!SERPER_API_KEY) return null;
  try {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const bits = [];
    if (data.answerBox?.answer) bits.push(`Featured answer: ${data.answerBox.answer}`);
    else if (data.answerBox?.snippet) bits.push(`Featured answer: ${data.answerBox.snippet}`);
    (data.organic || []).slice(0, 4).forEach(o => {
      if (o.title && o.snippet) bits.push(`${o.title} — ${o.snippet} (${o.link})`);
    });
    if (!bits.length) return null;
    return bits.join('\n');
  } catch (e) {
    return null;
  }
}

// Verify the user's Supabase access token and return their user object (or null).
async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY || SERVICE_ROLE_KEY,
      },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.id ? data : null;
  } catch (e) {
    return null;
  }
}

// Look up plan status. Defaults to 'free' if no row, no service key, or any error —
// fails safe toward "still limited" rather than accidentally granting Pro.
async function getPlan(userId) {
  if (!SERVICE_ROLE_KEY) return 'free';
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=plan,status`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    if (!r.ok) return 'free';
    const rows = await r.json();
    const row = rows && rows[0];
    return (row && row.plan === 'pro' && (row.status === 'active' || row.status === 'trialing')) ? 'pro' : 'free';
  } catch (e) {
    return 'free';
  }
}

// Rolling-window usage check + increment against the usage_counters table.
// Returns { allowed, remaining, resetAt }.
async function checkAndIncrementUsage(userId, kind) {
  const { max, windowMs } = LIMITS[kind];
  const now = Date.now();

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/usage_counters?user_id=eq.${userId}&kind=eq.${kind}&select=count,window_start`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
  );
  const rows = r.ok ? await r.json() : [];
  const row = rows && rows[0];

  let count = 0;
  let windowStart = now;

  if (row) {
    const started = new Date(row.window_start).getTime();
    if (now - started < windowMs) {
      count = row.count;
      windowStart = started;
    }
  }

  if (count >= max) {
    return { allowed: false, remaining: 0, resetAt: new Date(windowStart + windowMs).toISOString() };
  }

  const newCount = count + 1;
  await fetch(`${SUPABASE_URL}/rest/v1/usage_counters`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id: userId,
      kind,
      count: newCount,
      window_start: new Date(windowStart).toISOString(),
    }),
  });

  return { allowed: true, remaining: max - newCount, resetAt: new Date(windowStart + windowMs).toISOString() };
}

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


    const kind = hasImages ? 'scan' : 'chat';
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    let plan = 'free';
    if (token && SERVICE_ROLE_KEY) {
      const user = await getUserFromToken(token);
      if (user) {
        plan = await getPlan(user.id);
        if (plan !== 'pro') {
          const usage = await checkAndIncrementUsage(user.id, kind);
          if (!usage.allowed) {
            const friendly = kind === 'scan'
              ? "You've used all 5 of your free scans today. Upgrade to Pro for unlimited scanning."
              : "You've used your 10 free Penny messages for today. Upgrade to Pro for unlimited Penny.";
            return res.status(402).json({ error: friendly, limitReached: true, kind, resetAt: usage.resetAt });
          }
        }
      }
    }

    // Live web search — Pro only, and only when the message actually looks
    // time-sensitive, to keep search-credit spend in line with paid users.
    let messages = body.messages || [];
    if (plan === 'pro' && !hasImages && SERPER_API_KEY) {
      const query = getLatestUserText(messages);
      if (shouldSearch(query)) {
        const results = await webSearch(query);
        if (results) {
          const searchMsg = {
            role: 'system',
            content: `Live web search results for "${query}" (retrieved ${new Date().toDateString()}):\n\n${results}\n\nUse this real information — not older training knowledge — for anything time-sensitive like prices, sales, or recent news. If these results don't actually answer the question, say so honestly instead of guessing.`,
          };
          messages = [...messages.slice(0, -1), searchMsg, messages[messages.length - 1]];
        }
      }
    }

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

    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    async function fetchGroqWithRetry(groqBody, maxRetries = 3) {
      let attempt = 0;
      while (true) {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
          },
          body: JSON.stringify(groqBody),
        });

        if (response.status !== 429 || attempt >= maxRetries) {
          return response;
        }

        const retryAfterHeader = response.headers.get('retry-after');
        const waitMs = retryAfterHeader
          ? Math.min(parseFloat(retryAfterHeader) * 1000, 4000)
          : 500 * Math.pow(2, attempt); // 500ms, 1000ms, 2000ms
        await sleep(waitMs);
        attempt++;
      }
    }

    for (const model of tryModels) {
      const groqBody = { ...body, messages, model };

      const response = await fetchGroqWithRetry(groqBody);

      const data = await response.json();

      if (response.ok) {
        const text = data.choices?.[0]?.message?.content || '';
        return res.status(200).json({ text });
      }

      const errMsg = data?.error?.message || data?.error?.code || 'Unknown error';
      lastError = errMsg;
      lastStatus = response.status;

      // Rate limit that survived the retries — surface it so the frontend can
      // show a friendly wait message.
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
