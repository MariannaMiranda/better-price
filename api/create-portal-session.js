// POST /api/create-portal-session
// Requires Authorization: Bearer <supabase access token>
// Lets an existing Pro subscriber manage or cancel their subscription.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://viemououczppxevejtvs.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZW1vdW91Y3pwcHhldmVqdHZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDI4ODEsImV4cCI6MjA5MzQ3ODg4MX0.R90TUuaKTmXC9lObM3BccqNQzAuo_2K683dOFGPgARU';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

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

function toFormBody(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!STRIPE_SECRET_KEY || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Billing is not configured yet.' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const user = await getUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Please log in first.' });
    }

    const subR = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user.id}&select=stripe_customer_id`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    const subRows = subR.ok ? await subR.json() : [];
    const customerId = subRows?.[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({ error: 'No billing account found for this user yet.' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: toFormBody({ customer: customerId, return_url: `${origin}/` }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: data?.error?.message || 'Could not open billing portal.' });
    }
    return res.status(200).json({ url: data.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
