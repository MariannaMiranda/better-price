// POST /api/create-checkout-session
// Body: { plan: 'trial' | 'monthly' | 'yearly' }
// 'trial' = 7 days free, no card required, auto-cancels if never upgraded.
// 'monthly' / 'yearly' = billed immediately, no trial.
// Requires Authorization: Bearer <supabase access token>
// Returns { clientSecret } for Stripe's EMBEDDED checkout (mounted in-page via
// Stripe.js) instead of a redirect URL — the person never leaves the app.

const SUPABASE_URL = 'https://viemououczppxevejtvs.supabase.co'; // public project URL — hardcoded, not env-driven, to avoid a stale/wrong Vercel env var silently overriding it
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZW1vdW91Y3pwcHhldmVqdHZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDI4ODEsImV4cCI6MjA5MzQ3ODg4MX0.R90TUuaKTmXC9lObM3BccqNQzAuo_2K683dOFGPgARU'; // public anon key — hardcoded for the same reason
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
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const er = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user.id}&select=plan,status,stripe_customer_id`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    const existing = er.ok ? (await er.json())?.[0] : null;
    if (existing?.plan === 'pro') {
      return res.status(409).json({ error: 'You already have an active plan. Use Manage Billing.' });
    }
    if (plan === 'trial' && existing?.stripe_customer_id) {
      return res.status(409).json({ error: 'Your free trial has already been used.' });
    }
    const plan = req.body?.plan === 'yearly' ? 'yearly'
      : req.body?.plan === 'trial' ? 'trial'
      : 'monthly';

    // Trial checkouts anchor to the monthly price but never actually charge it —
    // Stripe skips card collection when trial_period_days makes the due-today total $0,
    // and trial_settings.end_behavior cancels the subscription automatically if the
    // trial ends with no payment method on file (i.e. the person never upgraded).
    const priceId = plan === 'yearly' ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY;
    if (!priceId) {
      return res.status(500).json({ error: `Stripe price for "${plan}" is not configured yet.` });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const params = {
      mode: 'subscription',
      ui_mode: 'embedded_page',
      client_reference_id: user.id,
      customer_email: user.email,
      return_url: `${origin}/?embedded_return=1`,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: plan === 'trial'
        ? {
            trial_period_days: 7,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            metadata: { user_id: user.id },
          }
        : { metadata: { user_id: user.id } },
      metadata: { user_id: user.id },
    };
    if (plan === 'trial') {
      params.payment_method_collection = 'if_required';
    }

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

    return res.status(200).json({ clientSecret: data.client_secret });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
