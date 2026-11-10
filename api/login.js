// Student sign-in by student number. The student-number -> email lookup happens here, on the server,
// so the browser (and anyone else) never gets to see which email belongs to which student number.
// Always answers with the same generic error, so it can't be used to discover which numbers exist.
const { createClient } = require('@supabase/supabase-js');
const { limit, clientIp, tooMany } = require('./_lib');

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

  // Floods from one address (a whole campus can share one address, so this is generous), then password
  // guessing on one student number (8 tries per 10 minutes, whoever is trying).
  let wait = limit('ip:' + clientIp(req), 300, 60000);
  if (wait) return tooMany(res, wait);
  wait = limit('num:' + num.toUpperCase().replace(/[^A-Z0-9]/g, ''), 8, 600000);
  if (wait) return tooMany(res, wait, 'Too many sign-in attempts for this student number. Please wait ' + Math.ceil(wait / 60) + ' minute(s) and try again.');

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, svc, opts);
  const { data: email, error } = await admin.rpc('login_email', { p_num: num });
  if (error) return bad(res, 500, 'Sign-in is unavailable right now. Please try again.');
  if (!email) return bad(res, 401, GENERIC);

  const { data, error: signErr } = await createClient(url, anon, opts).auth.signInWithPassword({ email, password: pw });
  if (signErr || !data || !data.session) {
    if (signErr && /rate limit/i.test(signErr.message)) return tooMany(res, 30);
    if (signErr && /not confirmed/i.test(signErr.message)) return bad(res, 401, 'Please confirm your email first. Check your inbox for the link we sent.');
    return bad(res, 401, GENERIC);
  }
  return res.status(200).json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
};
