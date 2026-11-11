// Read-only report: how many students would get email and how many SMS, by email domain.
// Run from the project folder:   set -a; . ./.env; set +a; node tools/channel-report.js
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Changes nothing and sends nothing.
const { createClient } = require('@supabase/supabase-js');
const { isPublicMailbox, domainOf, emailDomains } = require('../api/_send');
const { normalizePhone } = require('../api/_sms');

(async () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first (load .env).'); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const rows = []; let cols = 'user_id, email, email_status, phone';
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('students').select(cols).order('user_id').range(from, from + 999);
    if (error && /email_status/.test(error.message) && cols.includes('email_status')) { cols = 'user_id, email, phone'; from -= 1000; continue; }
    if (error) { console.error(error.message); process.exit(1); }
    rows.push(...(data || [])); if (!data || data.length < 1000) break;
  }

  const domains = new Map(); let email = 0, sms = 0, none = 0, bad = 0;
  for (const r of rows) {
    const d = domainOf(r.email) || '(invalid email)';
    domains.set(d, (domains.get(d) || 0) + 1);
    const ok = (r.email_status || 'ok') === 'ok'; if (!ok) bad++;
    if (ok && isPublicMailbox(r.email)) email++;
    else if (normalizePhone(r.phone)) sms++;
    else none++;
  }

  const pct = (n) => rows.length ? (100 * n / rows.length).toFixed(1) + '%' : '0%';
  console.log(`Students: ${rows.length}\n`);
  console.log(`By email (public mailbox): ${email}  ${pct(email)}`);
  console.log(`By SMS (school/other address${bad ? ' or bounced' : ''}): ${sms}  ${pct(sms)}`);
  if (none) console.log(`Can't be reached (no public email, no valid phone): ${none}`);
  if (bad) console.log(`Emails marked bounced/spam: ${bad}`);
  console.log(`\nEmail domains counted as public: ${emailDomains().join(', ')}\n`);
  console.log('Top domains:');
  [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([d, n]) => {
    const ch = isPublicMailbox('x@' + d) ? 'email' : 'sms';
    console.log(`  ${String(n).padStart(6)}  ${d.padEnd(32)} ${ch}`);
  });
  console.log(`\nOne message to everyone: ${sms} SMS (credits) + ${email} emails (about $${(email * 0.0001).toFixed(2)} on SES).`);
})();
