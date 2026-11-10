// Shared helpers for the server functions. Files starting with "_" are not exposed as web addresses.
const { createClient } = require('@supabase/supabase-js');

function bad(res, code, msg) { return res.status(code).json({ error: msg }); }

// ---------- Traffic limits ----------
// A small in-memory counter per server instance (fixed time window). It is best-effort: Vercel may run several
// instances, each with its own counter, but that is enough to stop one caller from flooding an endpoint or
// guessing passwords, without adding any database writes during a rush.
const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now >= h.reset) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  h.n++;
  if (hits.size > 50000) for (const [k, v] of hits) { if (now >= v.reset) hits.delete(k); }   // keep memory small
  return h.n <= max ? 0 : Math.ceil((h.reset - now) / 1000);   // 0 = allowed, otherwise seconds to wait
}
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers['x-real-ip'] || '') || 'unknown';
}
const BUSY = 'Lots of students are using the site right now. Please wait a moment and try again.';
function tooMany(res, wait, msg) { res.setHeader('Retry-After', String(wait)); return bad(res, 429, msg || BUSY); }

function adminClient() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function bodyOf(req) {
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b;
}

function tokenOf(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }

// Checks the caller's sign-in token. Returns { admin, user } or sends an error response and returns null.
async function requireUser(req, res) {
  if (req.method !== 'POST') { bad(res, 405, 'Use POST.'); return null; }
  const admin = adminClient();
  if (!admin) { bad(res, 500, 'The server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.'); return null; }
  const token = tokenOf(req);
  if (!token) { bad(res, 401, 'Please sign in again.'); return null; }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data || !data.user) { bad(res, 401, 'Please sign in again.'); return null; }
  const wait = limit('user:' + data.user.id, 120, 60000);   // 120 calls a minute per signed-in person
  if (wait) { tooMany(res, wait); return null; }
  return { admin, user: data.user };
}

// Same, but the caller must be staff with one of the given roles (default: super admin or organiser).
async function requireStaff(req, res, roles) {
  const ctx = await requireUser(req, res); if (!ctx) return null;
  const { data: me } = await ctx.admin.from('staff').select('user_id, role').eq('user_id', ctx.user.id).maybeSingle();
  if (!me || !(roles || ['super', 'organiser']).includes(me.role)) { bad(res, 403, 'Only super admins and organisers can do this.'); return null; }
  return { ...ctx, me };
}

function validLink(u) {
  if (typeof u !== 'string' || u.length > 500 || /\s/.test(u)) return false;
  try { const x = new URL(u); return x.protocol === 'https:' && !!x.hostname; } catch (e) { return false; }
}

module.exports = { bad, adminClient, bodyOf, tokenOf, requireUser, requireStaff, validLink, limit, clientIp, tooMany };
