// Student sign-in by student number. The student-number -> email lookup happens here, on the server,
// so the browser (and anyone else) never gets to see which email belongs to which student number.
// Always answers with the same generic error, so it can't be used to discover which numbers exist.
const { createClient } = require('@supabase/supabase-js');

const GENERIC = 'Student number or password is incorrect.';
function bad(res, code, msg) { return res.status(code).json({ error: msg }); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'Use POST.');
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svc) return bad(res, 500, 'The server is missing its Supabase settings.');

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const num = String(body.student_number || '').slice(0, 64);
  const pw = String(body.password || '').slice(0, 256);
  if (!num.trim() || !pw) return bad(res, 400, 'Enter your student number and password.');

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, svc, opts);
  const { data: email, error } = await admin.rpc('login_email', { p_num: num });
  if (error) return bad(res, 500, 'Sign-in is unavailable right now. Please try again.');
  if (!email) return bad(res, 401, GENERIC);

  const { data, error: signErr } = await createClient(url, anon, opts).auth.signInWithPassword({ email, password: pw });
  if (signErr || !data || !data.session) {
    if (signErr && /rate limit/i.test(signErr.message)) return bad(res, 429, 'Too many attempts. Please wait a minute and try again.');
    if (signErr && /not confirmed/i.test(signErr.message)) return bad(res, 401, 'Please confirm your email first. Check your inbox for the link we sent.');
    return bad(res, 401, GENERIC);
  }
  return res.status(200).json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
};
