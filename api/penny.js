// ── Freemium config ──
// "chat" = plain text messages to Penny. "scan" = any message that includes a
// photo (barcode/price-tag photo reads, landing-page image chat, etc).
// Free-tier caps live here so they're easy to tweak in one place.
const LIMITS = {
  chat: { max: 20, windowMs: 3 * 60 * 60 * 1000 },  // 20 messages / 3 hours
  scan: { max: 5,  windowMs: 24 * 60 * 60 * 1000 }, // 5 scans / day
};

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://viemououczppxevejtvs.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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
    return (row && row.plan === 'pro' && row.status === 'active') ? 'pro' : 'free';
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

    // ── Freemium enforcement ──
    // Only applies to logged-in users (the client sends a Supabase access token
    // in the Authorization header). The logged-out landing-page widget is not
    // gated here — it's a lighter marketing chat, not the main app experience.
    const kind = hasImages ? 'scan' : 'chat';
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token && SERVICE_ROLE_KEY) {
      const user = await getUserFromToken(token);
      if (user) {
        const plan = await getPlan(user.id);
        if (plan !== 'pro') {
          const usage = await checkAndIncrementUsage(user.id, kind);
          if (!usage.allowed) {
            const friendly = kind === 'scan'
              ? "You've used all 5 of your free scans today. Upgrade to Pro for unlimited scanning."
              : "You've used your 20 free messages for this 3-hour window. Upgrade to Pro for unlimited Penny.";
            return res.status(402).json({ error: friendly, limitReached: true, kind, resetAt: usage.resetAt });
          }
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
