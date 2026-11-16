// One-off: email every student who registered but has not booked a session, asking them to choose one.
// Run from the project folder (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY in .env):
//   node tools/nudge-unbooked.js          count only, sends nothing
//   node tools/nudge-unbooked.js --send   send
// Safe to re-run: students already emailed are listed in .local/nudge-sent.json and skipped, and each email
// has an idempotency key. A sent nudge also sets welcome_sent_at, so the daily job's welcome safety net skips them.
const fs = require('fs'), path = require('path');
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
delete process.env.MAIL_TRANSPORT;
const { createClient } = require('@supabase/supabase-js');
const mail = require('../api/_mail');
const SITE = process.env.SITE_URL || 'https://www.kecworkshops.com/login';
const DONE_FILE = path.join(__dirname, '..', '.local', 'nudge-sent.json');

async function all(admin, table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(cols).order(table === 'students' ? 'user_id' : 'student_id').range(from, from + 999);
    if (error) throw error; out.push(...data); if (data.length < 1000) break;
  }
  return out;
}

(async () => {
  const send = process.argv.includes('--send');
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const done = new Set(fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')) : []);
  const [students, bookings] = await Promise.all([all(admin, 'students', 'user_id, name, email, email_status'), all(admin, 'bookings', 'student_id')]);
  const booked = new Set(bookings.map((b) => b.student_id));
  const unbooked = students.filter((s) => !booked.has(s.user_id));
  const todo = unbooked.filter((s) => !done.has(s.user_id) && (s.email_status || 'ok') === 'ok' && mail.normalizeEmail(s.email));
  console.log(`Students ${students.length}, not booked ${unbooked.length}, already nudged ${unbooked.length - unbooked.filter((s) => !done.has(s.user_id)).length}, to email now ${todo.length}`);
  if (!send) { console.log('Count only. Add --send to send.'); return; }
  if (!mail.configured()) throw new Error('RESEND_API_KEY missing');

  let sent = 0, failed = 0, lastErr = '';
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const r = await mail.sendAll(chunk.map((s) => ({ email: s.email, key: 'nudge|' + s.user_id, ...mail.templates.nudge(s.name, SITE) })));
    const ok = chunk.filter((s, k) => r.ok[k]).map((s) => s.user_id);
    ok.forEach((id) => done.add(id));
    fs.mkdirSync(path.dirname(DONE_FILE), { recursive: true }); fs.writeFileSync(DONE_FILE, JSON.stringify([...done]));
    if (ok.length) await admin.from('students').update({ welcome_sent_at: new Date().toISOString() }).in('user_id', ok).is('welcome_sent_at', null);
    sent += r.sent; failed += r.failed; if (r.error) lastErr = r.error;
    console.log(`  ${Math.min(i + 100, todo.length)}/${todo.length}: sent ${sent}, failed ${failed}${r.error ? ' (' + r.error + ')' : ''}`);
    await new Promise((res) => setTimeout(res, 600));
  }
  console.log(`Done: sent ${sent}, failed ${failed}${lastErr ? '. Last error: ' + lastErr + '. Run again to retry the failed ones.' : ''}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
