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
  if (!SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Account deletion is not configured.' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });

  const sbH = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

  try {
    // Do not delete the auth user unless billing state was checked and any subscription was canceled.
    const sr = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(user.id)}&select=stripe_subscription_id`, {
      headers: sbH,
      signal: AbortSignal.timeout(8000),
    });
    if (!sr.ok) {
      console.error('delete-account subscription lookup failed:', sr.status, (await sr.text()).slice(0, 300));
      return res.status(502).json({ error: 'Could not verify your subscription. Account deletion aborted.' });
    }
    const subscriptions = await sr.json();
    if (!Array.isArray(subscriptions)) {
      console.error('delete-account subscription lookup returned an invalid response');
      return res.status(502).json({ error: 'Could not verify your subscription. Account deletion aborted.' });
    }

    const subId = subscriptions[0]?.stripe_subscription_id;
    if (subId) {
      if (!STRIPE_SECRET_KEY) {
        return res.status(500).json({ error: 'Subscription cancellation is not configured. Account deletion aborted.' });
      }
      const c = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!c.ok && c.status !== 404) {
        console.error('delete-account Stripe cancellation failed:', c.status, (await c.text()).slice(0, 300));
        return res.status(502).json({ error: 'Could not cancel subscription. Account deletion aborted.' });
      }
    }

    // Shared lists survive: hand every household-shared list this user owns to another member BEFORE deletion.
    const hand = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bp_prepare_account_deletion_v2`, {
      method: 'POST',
      headers: { ...sbH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: user.id }),
      signal: AbortSignal.timeout(8000),
    });
    if (!hand.ok) {
      console.error('bp_prepare_account_deletion_v2 failed:', hand.status, (await hand.text()).slice(0, 300));
      return res.status(502).json({ error: 'Could not prepare your shared lists. Account deletion aborted.' });
    }

    // Delete Supabase Auth user (cascades user_data/subscriptions if foreign keys are configured)
    const d = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: sbH,
      signal: AbortSignal.timeout(8000),
    });
    if (!d.ok) {
      console.error('delete-account auth deletion failed:', d.status, (await d.text()).slice(0, 300));
      return res.status(502).json({ error: 'Could not delete user account.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('delete-account request failed:', err);
    return res.status(502).json({ error: 'Could not safely complete account deletion. Please try again.' });
  }
}
 
