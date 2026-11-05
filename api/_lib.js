// Shared helpers for the server functions. Files starting with "_" are not exposed as web addresses.
const { createClient } = require('@supabase/supabase-js');

function bad(res, code, msg) { return res.status(code).json({ error: msg }); }

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

module.exports = { bad, adminClient, bodyOf, tokenOf, requireUser, requireStaff, validLink };
