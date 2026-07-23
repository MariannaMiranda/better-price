// POST /api/create-checkout-session
// Body: { plan: 'monthly' | 'yearly' }
// Requires Authorization: Bearer <supabase access token>

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://viemououczppxevejtvs.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY || '';
const STRIPE_PRICE_YEARLY = process.env.STRIPE_PRICE_YEARLY || '';

async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.id ? data : null;
  } catch (e) {
    return null;
  }
}

// Stripe's API takes application/x-www-form-urlencoded, including nested params
// like line_items[0][price]. This little helper flattens a JS object into that form.
function toFormBody(obj, prefix) {
  const parts = [];
  for (const key in obj) {
    const val = obj[key];
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (val === undefined || val === null) continue;
    if (typeof val === 'object' && !Array.isArray(val)) {
      parts.push(toFormBody(val, fullKey));
    } else if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (typeof item === 'object') parts.push(toFormBody(item, `${fullKey}[${i}]`));
        else parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(val)}`);
    }
  }
  return parts.join('&');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe is not configured yet (missing STRIPE_SECRET_KEY).' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = await getUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Please log in first.' });
    }

    const plan = req.body?.plan === 'yearly' ? 'yearly' : 'monthly';
    const priceId = plan === 'yearly' ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY;
    if (!priceId) {
      return res.status(500).json({ error: `Stripe price for "${plan}" is not configured yet.` });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const params = {
      mode: 'subscription',
      client_reference_id: user.id,
      customer_email: user.email,
      success_url: `${origin}/?upgraded=1`,
      cancel_url: `${origin}/`,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id } },
      metadata: { user_id: user.id },
    };

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: toFormBody(params),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: data?.error?.message || 'Could not create checkout session.' });
    }

    return res.status(200).json({ url: data.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
