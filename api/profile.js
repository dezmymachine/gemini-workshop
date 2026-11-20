// A signed-in student corrects their email (Profile page). Two steps:
//   requestCode { new_email, password }  checks the password, emails a 6-digit code to the NEW address
//   confirm     { code }                 checks the code, then changes the email
// The email is stored twice and the two must always match, because sign-in looks up the email by student number
// (students.email) and then signs in to the Supabase account (auth.users.email). So the account is changed first,
// then students; if the second step fails the account is put back.
// After the change the student gets their upcoming sessions (with joining links) at the new address.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { bad, bodyOf, requireUser, limit, tooMany } = require('./_lib');
const mail = require('./_mail');
const send = require('./_send');

const CODE_MINUTES = 15, MAX_ATTEMPTS = 5, MAX_CODES_PER_HOUR = 3;
const hash = (code, uid) => crypto.createHash('sha256').update(String(code) + '|' + uid).digest('hex');
const TAKEN = 'That email is already used by another account. Use a different email.';

// Checks a student's current password without touching their session in the browser.
async function passwordOk(email, password) {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  return !error && !!(data && data.session);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method && req.method !== 'POST') return bad(res, 405, 'Use POST.');
  const ctx = await requireUser(req, res); if (!ctx) return;
  const { admin, user } = ctx, body = bodyOf(req), action = body.action;
  const wait = limit('profile:' + user.id, 10, 10 * 60000);
  if (wait) return tooMany(res, wait, 'Too many attempts. Please wait ' + Math.ceil(wait / 60) + ' minute(s) and try again.');

  try {
    const { data: me, error: e0 } = await admin.from('students').select('user_id, name, email').eq('user_id', user.id).maybeSingle();
    if (e0) throw e0;
    if (!me) return bad(res, 403, 'Only students can change their email here.');

    if (action === 'requestCode') {
      if (!mail.configured()) return bad(res, 500, 'Email is not set up yet. Please contact the organisers.');
      const next = mail.normalizeEmail(body.new_email), pw = String(body.password || '').slice(0, 256);
      if (!next) return bad(res, 400, 'Enter a valid email address, for example name@gmail.com.');
      if (next === mail.normalizeEmail(me.email)) return bad(res, 400, 'That is already your email. Enter the new address.');
      if (!pw) return bad(res, 400, 'Enter your current password.');
      const { data: used } = await admin.from('students').select('user_id').ilike('email', next.replace(/[\\%_]/g, (c) => '\\' + c)).neq('user_id', user.id).limit(1);
      if (used && used.length) return bad(res, 400, TAKEN);
      if (!(await passwordOk(me.email, pw))) return bad(res, 400, 'Your current password is incorrect.');

      // At most 3 codes an hour per student.
      const { data: prev } = await admin.from('email_changes').select('sent_count, created_at').eq('user_id', user.id).maybeSingle();
      const recent = prev && Date.now() - Date.parse(prev.created_at) < 3600000;
      const sentCount = recent ? prev.sent_count + 1 : 1;
      if (recent && prev.sent_count >= MAX_CODES_PER_HOUR) return bad(res, 429, 'You have asked for 3 codes in the last hour. Please wait and try again later.');

      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const row = { user_id: user.id, new_email: next, code_hash: hash(code, user.id), expires_at: new Date(Date.now() + CODE_MINUTES * 60000).toISOString(), attempts: 0, sent_count: sentCount, created_at: recent ? prev.created_at : new Date().toISOString() };
      const { error: e1 } = await admin.from('email_changes').upsert(row, { onConflict: 'user_id' });
      if (e1) throw e1;
      const r = await mail.sendAll([{ email: next, key: 'emailcode|' + user.id + '|' + Date.now(), ...mail.templates.emailCode(me.name, code) }]);
      if (!r.ok || !r.ok[0]) {
        await admin.from('email_changes').delete().eq('user_id', user.id);
        if (r.refused && r.refused[0]) return bad(res, 400, 'We could not send to that address. Check it is typed correctly.');
        return bad(res, 500, 'We could not send the code right now. Please try again in a minute.');
      }
      return res.status(200).json({ sent: true, email: next, minutes: CODE_MINUTES });
    }

    if (action === 'confirm') {
      const code = String(body.code || '').replace(/\D/g, '');
      const { data: ch } = await admin.from('email_changes').select('*').eq('user_id', user.id).maybeSingle();
      if (!ch) return bad(res, 400, 'No email change is waiting. Start again and we will send you a new code.');
      if (Date.parse(ch.expires_at) < Date.now()) return bad(res, 400, 'That code has expired. Ask for a new code.');
      if (ch.attempts >= MAX_ATTEMPTS) return bad(res, 400, 'Too many wrong codes. Ask for a new code.');
      if (code.length !== 6 || hash(code, user.id) !== ch.code_hash) {
        const left = MAX_ATTEMPTS - ch.attempts - 1;
        await admin.from('email_changes').update({ attempts: ch.attempts + 1 }).eq('user_id', user.id);
        return bad(res, 400, left > 0 ? 'That code is not right. ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left.' : 'Too many wrong codes. Ask for a new code.');
      }

      const oldEmail = me.email, next = ch.new_email;
      // 1. The account (what sign-in uses). Confirmed straight away: the code already proved the address.
      const { error: ea } = await admin.auth.admin.updateUserById(user.id, { email: next, email_confirm: true });
      if (ea) {
        if (/already|registered|exists|duplicate/i.test(ea.message || '')) return bad(res, 400, TAKEN);
        throw ea;
      }
      // 2. The student record (what the sign-in lookup and all emails use). If this fails, put the account back.
      const { error: es } = await admin.from('students').update({ email: next, email_status: 'ok', email_bad_at: null }).eq('user_id', user.id);
      if (es) {
        await admin.auth.admin.updateUserById(user.id, { email: oldEmail, email_confirm: true });
        return bad(res, 500, 'We could not save your new email, so nothing was changed. Please try again.');
      }
      await admin.from('email_changes').delete().eq('user_id', user.id);

      // 3. Catch-up: their upcoming sessions, with joining links, at the new address.
      let sent = 0;
      try {
        const { data: bks } = await admin.from('bookings').select('session_id, sessions(id, track, title, grasag, starts_at, ends_at)').eq('student_id', user.id);
        const upcoming = (bks || []).map((b) => b.sessions).filter((s) => s && Date.parse(s.ends_at) > Date.now());
        if (upcoming.length && send.configured()) {
          const { data: lks } = await admin.from('session_links').select('session_id, url').in('session_id', upcoming.map((s) => s.id));
          const link = {}; (lks || []).forEach((l) => { link[l.session_id] = l.url; });
          const stamp = Date.now();
          const r = await send.deliver(admin, 'confirm', upcoming.map((s) => ({ student_id: user.id, name: me.name, email: next, email_status: 'ok', session: s, link: link[s.id] || null, key: 'emailfix|' + user.id + '|' + s.id + '|' + stamp })));
          const logged = [];
          upcoming.forEach((s, k) => { if (r.results[k] && r.results[k].ok) logged.push({ student_id: user.id, session_id: s.id, kind: 'confirm', channel: 'email', link_url: link[s.id] || null }); });
          sent = logged.length;
          if (logged.length) await admin.from('email_log').upsert(logged, { onConflict: 'student_id,session_id,kind' });
        }
      } catch (e) { /* the email change itself succeeded; the daily job is the safety net for links */ }
      return res.status(200).json({ ok: true, email: next, sent });
    }

    return bad(res, 400, 'Unknown action.');
  } catch (e) {
    return bad(res, 400, (e && e.message) || 'Something went wrong.');
  }
};
