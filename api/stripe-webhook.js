// POST /api/stripe-webhook
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://viemououczppxevejtvs.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyStripeSignature(rawBuf, sigHeader, secret, toleranceSec = 300) {
  if (!sigHeader) return false;
  let t;
  const sigs = [];
  for (const part of sigHeader.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') t = v;
    if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${t}.`), rawBuf]))
    .digest();

  return sigs.some((s) => {
    const b = Buffer.from(s, 'hex');
    return b.length === expected.length && crypto.timingSafeEqual(b, expected);
  });
}

async function upsertSubscription(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const errText = await r.text();
    // Ignore FK constraint if user was deleted
    if (errText.includes('23503')) return;
    throw new Error(`subscriptions upsert ${r.status}: ${errText}`);
  }
}

async function userIdForCustomer(customerId) {
  if (!customerId) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=user_id`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
  );
  return r.ok ? (await r.json())?.[0]?.user_id : null;
}

const periodEnd = (sub) => sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!STRIPE_WEBHOOK_SECRET || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Webhook is not configured.' });
  }

  const rawBuf = await getRawBody(req);
  if (!verifyStripeSignature(rawBuf, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBuf.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id || session.client_reference_id;
        if (userId) {
          await upsertSubscription({
            user_id: userId,
            plan: 'pro',
            status: session.payment_status === 'no_payment_required' ? 'trialing' : 'active',
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id || (await userIdForCustomer(sub.customer));
        if (userId) {
          const active = sub.status === 'active' || sub.status === 'trialing';
          const pe = periodEnd(sub);
          await upsertSubscription({
            user_id: userId,
            plan: active ? 'pro' : 'free',
            status: sub.status,
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            current_period_end: pe ? new Date(pe * 1000).toISOString() : null,
            trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id || (await userIdForCustomer(sub.customer));
        if (userId) {
          await upsertSubscription({
            user_id: userId,
            plan: 'free',
            status: 'canceled',
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('stripe-webhook failure:', event?.id, err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
