// POST /api/stripe-webhook
// Configure this URL in Stripe Dashboard → Developers → Webhooks.
// Listens for: checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted

import crypto from 'crypto';

// Turn off Vercel's automatic JSON body parsing — Stripe's signature check
// needs the exact raw bytes of the request body, not a re-serialized object.
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://viemououczppxevejtvs.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Verifies Stripe's "Stripe-Signature" header without needing the stripe npm package.
function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const { t: timestamp, v1: signature } = parts;
  if (!timestamp || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (e) {
    return false;
  }
}

async function upsertSubscription(row) {
  await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!STRIPE_WEBHOOK_SECRET || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Webhook is not configured yet.' });
  }

  const rawBody = await getRawBody(req);

  if (!verifyStripeSignature(rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
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
            status: 'active',
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
        const userId = sub.metadata?.user_id;
        if (userId) {
          const active = sub.status === 'active' || sub.status === 'trialing';
          await upsertSubscription({
            user_id: userId,
            plan: active ? 'pro' : 'free',
            status: sub.status,
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null,
            trial_end: sub.trial_end
              ? new Date(sub.trial_end * 1000).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id;
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

      default:
        break; // ignore other event types
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
