// Staff management for super admins: list, create, update and remove staff accounts.
// Runs on Vercel with the Supabase service role key, which never reaches the browser.
const { createClient } = require('@supabase/supabase-js');
const { limit, tooMany } = require('./_lib');

const ROLES = ['super', 'organiser', 'coord'];
const COLLEGES = ['CoE', 'CoS', 'CoHSS', 'CABE', 'CoHS', 'CANR', 'IDL'];

function bad(res, code, msg) { return res.status(code).json({ error: msg }); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return bad(res, 405, 'Use POST.');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return bad(res, 500, 'The server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return bad(res, 401, 'Please sign in again.');
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who || !who.user) return bad(res, 401, 'Please sign in again.');
  const wait = limit('user:' + who.user.id, 120, 60000);
  if (wait) return tooMany(res, wait);
  const { data: me } = await admin.from('staff').select('user_id, role').eq('user_id', who.user.id).maybeSingle();
  if (!me || me.role !== 'super') return bad(res, 403, 'Only a super admin can manage staff.');

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  try {
    if (body.action === 'list') {
      const { data, error } = await admin.from('staff').select('user_id, name, email, role, college').order('name');
      if (error) throw error;
      return res.status(200).json({ staff: data });
    }

    if (body.action === 'save') {
      const u = body.user || {};
      const email = String(u.email || '').trim().toLowerCase();
      const name = String(u.name || '').trim();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 400, 'Enter a name and a valid email.');
      if (!ROLES.includes(u.role)) return bad(res, 400, 'Choose a role.');
      if (u.role === 'coord' && !COLLEGES.includes(u.college)) return bad(res, 400, "Choose the coordinator's college.");
      if (u.password && String(u.password).length < 6) return bad(res, 400, 'Passwords need at least 6 characters.');
      const college = u.role === 'coord' ? u.college : null;

      let id = u.user_id || null;
      if (id) {
        if (id === me.user_id && u.role !== 'super') return bad(res, 400, "You can't remove your own super admin role.");
        const upd = { user_metadata: { kind: 'staff', name } };
        if (u.password) upd.password = String(u.password);
        const { error } = await admin.auth.admin.updateUserById(id, upd);
        if (error) throw error;
      } else {
        if (!u.password) return bad(res, 400, 'Set a password for this new staff member.');
        const { data, error } = await admin.auth.admin.createUser({
          email, password: String(u.password), email_confirm: true, user_metadata: { kind: 'staff', name }
        });
        if (error) {
          if (/already|registered|exists/i.test(error.message)) return bad(res, 400, 'That email already has an account. Use a different email for staff.');
          throw error;
        }
        id = data.user.id;
      }
      const { error: upErr } = await admin.from('staff').upsert({ user_id: id, name, email, role: u.role, college });
      if (upErr) throw upErr;
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'delete') {
      const id = body.user_id;
      if (!id) return bad(res, 400, 'Missing staff member.');
      if (id === me.user_id) return bad(res, 400, "You can't remove your own account.");
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return bad(res, 400, 'Unknown action.');
  } catch (e) {
    return bad(res, 400, (e && e.message) || 'Something went wrong.');
  }
};
