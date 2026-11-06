// POST /api/create-checkout-session
import crypto from 'crypto';

const SUPABASE_URL = 'https://viemououczppxevejtvs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZW1vdW91Y3pwcHhldmVqdHZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDI4ODEsImV4cCI6MjA5MzQ3ODg4MX0.R90TUuaKTmXC9lObM3BccqNQzAuo_2K683dOFGPgARU';
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

function toFormBody(obj, prefix) {
  const parts = [];
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const val = obj[key];
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (val === undefined || val === null) continue;
    if (typeof val === 'object') {
      parts.push(toFormBody(val, fullKey));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(val)}`);
    }
  }
  return parts.filter(Boolean).join('&');
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

    const plan = req.body?.plan === 'yearly' ? 'yearly'
      : req.body?.plan === 'trial' ? 'trial'
      : 'monthly';

    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const er = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user.id}&select=plan,status,stripe_customer_id`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    const existing = er.ok ? (await er.json())?.[0] : null;

    if (existing?.plan === 'pro') {
      // alreadyActive/plan/status let the client re-sync its UI to Pro and surface "Manage Billing"
      // instead of just showing an error toast.
      return res.status(409).json({
        error: 'You already have an active plan. Use Manage Billing.',
        alreadyActive: true,
        plan: 'pro',
        status: existing.status || 'active',
      });
    }
    if (plan === 'trial' && existing?.stripe_customer_id) {
      return res.status(409).json({ error: 'Your free trial has already been used.', trialUsed: true });
    }

    const priceId = plan === 'yearly' ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY;
    if (!priceId) {
      return res.status(500).json({ error: `Stripe price for "${plan}" is not configured yet.` });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const params = {
      mode: 'subscription',
      ui_mode: 'embedded_page',
      client_reference_id: user.id,
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email }),
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
