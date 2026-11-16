// POST /api/delete-account
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://viemououczppxevejtvs.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.id ? data : null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });

  const sbH = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

  // Cancel Stripe subscription if one exists
  const sr = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user.id}&select=stripe_subscription_id`, { headers: sbH });
  const subId = (await sr.json())?.[0]?.stripe_subscription_id;
  if (subId && STRIPE_SECRET_KEY) {
    const c = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    if (!c.ok && c.status !== 404) {
      return res.status(502).json({ error: 'Could not cancel subscription. Account deletion aborted.' });
    }
  }

  // Shared lists survive: hand every household-shared list this user owns to another member BEFORE the auth user (and,
  // via ON DELETE CASCADE, everything it owns) is removed. 404 = migration not applied yet, nothing to hand off.
  const hand = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bp_prepare_account_deletion`, {
    method: 'POST',
    headers: { ...sbH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user: user.id }),
  });
  if (!hand.ok && hand.status !== 404) {
    console.error('bp_prepare_account_deletion failed:', hand.status, (await hand.text()).slice(0, 300));
    return res.status(502).json({ error: 'Could not prepare your shared lists. Account deletion aborted.' });
  }

  // Delete Supabase Auth user (cascades user_data/subscriptions if foreign keys are configured)
  const d = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: sbH });
  if (!d.ok) return res.status(502).json({ error: 'Could not delete user account.' });

  return res.status(200).json({ ok: true });
}
