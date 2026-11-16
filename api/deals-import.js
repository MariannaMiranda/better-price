// POST /api/deals-import   body: { csv: "store,product,kind,price,size,qty,unit,discount_type,discount_value,buy_qty,get_qty,valid_to\n..." }
// Requires Authorization: Bearer <supabase access token>. Rows are inserted AS THE USER (anon key + their JWT), so RLS
// guarantees ownership; the service-role key is never used here. No retailer feeds: this only parses text the user supplies.

const SUPABASE_URL = 'https://viemououczppxevejtvs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZW1vdW91Y3pwcHhldmVqdHZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDI4ODEsImV4cCI6MjA5MzQ3ODg4MX0.R90TUuaKTmXC9lObM3BccqNQzAuo_2K683dOFGPgARU';

const MAX_ROWS = 200;
const MAX_CSV_CHARS = 100_000;
const UNITS = new Set(['oz', 'lb', 'g', 'kg', 'ml', 'l', 'gal', 'count', 'sheets', 'ft', 'in', 'yd', 'm']);
const COLS = ['store', 'product', 'kind', 'price', 'size', 'qty', 'unit', 'discount_type', 'discount_value', 'buy_qty', 'get_qty', 'valid_to'];

async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.id ? data : null;
  } catch (e) { return null; }
}

// RFC 4180-style: quoted fields, escaped quotes (""), commas/newlines inside quotes.
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"' && cur === '') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

const num = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };

function toDeal(cells) {
  const g = (name) => (cells[COLS.indexOf(name)] ?? '').trim();
  const product = g('product').slice(0, 200), store = g('store').slice(0, 120);
  const kind = (g('kind') || 'weekly_ad').toLowerCase();
  const unit = g('unit').toLowerCase(), dtype = g('discount_type').toLowerCase();
  const price = num(g('price')), size = num(g('size')), qty = num(g('qty')) ?? 1;
  const dval = num(g('discount_value')), buy = num(g('buy_qty')), get = num(g('get_qty'));
  const to = g('valid_to');
  if (!product) return { error: 'missing product' };
  if (!['weekly_ad', 'coupon'].includes(kind)) return { error: 'kind must be weekly_ad or coupon' };
  if (!(price >= 0) || price > 10000) return { error: 'bad price' };
  if (!(size > 0) || size > 1e6) return { error: 'bad size' };
  if (!(qty > 0) || qty > 1000) return { error: 'bad qty' };
  if (!UNITS.has(unit)) return { error: `unknown unit "${unit}"` };
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { error: 'valid_to must be YYYY-MM-DD' };
  const d = { product_name: product, store, kind, pkg_price: price, pkg_size: size, pkg_qty: qty, pkg_unit: unit, valid_to: to || null, source: 'import' };
  if (dtype) {
    if (!['p', 'd', 'bogo'].includes(dtype)) return { error: 'discount_type must be p, d or bogo' };
    d.discount_type = dtype;
    if (dtype === 'bogo') {
      if (!Number.isInteger(buy) || !Number.isInteger(get) || buy < 1 || get < 1) return { error: 'bogo needs whole buy_qty and get_qty' };
      d.buy_qty = buy; d.get_qty = get;
    } else {
      if (!(dval >= 0)) return { error: 'bad discount_value' };
      if (dtype === 'p' && dval > 100) return { error: 'percent over 100' };
      d.discount_value = dval;
    }
  }
  return { deal: d };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });

  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) return res.status(400).json({ error: 'Paste some CSV rows first.' });
  if (csv.length > MAX_CSV_CHARS) return res.status(413).json({ error: 'That file is too large (100 KB max).' });

  let rows = parseCsv(csv);
  if (rows.length && String(rows[0][0]).trim().toLowerCase() === 'store') rows = rows.slice(1);   // optional header
  if (rows.length > MAX_ROWS) return res.status(413).json({ error: `Too many rows (${MAX_ROWS} max per import).` });

  const deals = [], problems = [];
  rows.forEach((cells, i) => {
    const r = toDeal(cells);
    if (r.deal) deals.push(r.deal); else problems.push(`row ${i + 1}: ${r.error}`);
  });
  if (!deals.length) return res.status(400).json({ error: 'No valid rows. ' + problems.slice(0, 3).join('; ') });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/deals`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(deals),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      console.error('deals-import insert failed:', r.status, (await r.text()).slice(0, 300));
      return res.status(502).json({ error: 'Could not save the deals. Nothing was imported.' });
    }
    return res.status(200).json({ imported: deals.length, skipped: problems.length, problems: problems.slice(0, 5) });
  } catch (err) {
    console.error('deals-import failed:', err);
    return res.status(502).json({ error: 'Could not save the deals. Nothing was imported.' });
  }
}
