// Chooses email or SMS for each student and sends.
// Students who registered with a public mailbox they read on their phone (Gmail, Yahoo, Outlook, iCloud…) get email.
// Students who used a student or school address (most can't open it), or whose email bounced or was reported as
// spam, get an SMS instead. EMAIL_DOMAINS (comma list) replaces the built-in list without a code change.
const mail = require('./_mail');
const sms = require('./_sms');

const PUBLIC_DOMAINS = [
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com',
  'aol.com',
  'proton.me', 'protonmail.com'
];
function emailDomains() {
  const env = String(process.env.EMAIL_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  return env.length ? env : PUBLIC_DOMAINS;
}
function domainOf(email) { const e = mail.normalizeEmail(email); return e ? e.slice(e.lastIndexOf('@') + 1) : ''; }
function isPublicMailbox(email) { const d = domainOf(email); return !!d && emailDomains().includes(d); }

function configured() { return mail.configured() || sms.configured(); }

// student: { email, email_status, phone }. Returns 'email', 'sms' or 'none'.
function channelFor(student) {
  const okEmail = (student.email_status || 'ok') === 'ok' && !!mail.normalizeEmail(student.email);
  if (okEmail && mail.configured() && isPublicMailbox(student.email)) return 'email';
  if (sms.configured() && sms.normalizePhone(student.phone)) return 'sms';
  if (okEmail && mail.configured()) return 'email';   // no usable phone: the school inbox is better than nothing
  return 'none';
}

// The same message in both forms. kind: welcome | confirm | reminder | broadcast.
function build(kind, it) {
  if (kind === 'welcome') return { mail: mail.templates.welcome(it.name), text: sms.templates.welcome(it.name) };
  if (kind === 'broadcast') return { mail: mail.templates.broadcast(it.name, it.session, it.link), text: sms.templates.broadcast(it.session, it.link) };
  return { mail: mail.templates[kind](it.name, it.session, it.link), text: sms.templates[kind](it.name, it.session, it.link) };
}

// items: [{ student_id, name, email, email_status, phone, session, link }], all of one kind.
// Returns { sent, failed, error, results: [{ ok, channel, unusable }] } in the same order as items.
// An address SES refuses outright is marked bounced and that student is texted in the same call.
async function deliver(admin, kind, items) {
  const results = items.map(() => ({ ok: false, channel: 'none', unusable: true }));
  const byMail = [], bySms = [];
  items.forEach((it, i) => {
    const ch = channelFor(it);
    results[i].channel = ch;
    if (ch === 'email') byMail.push(i); else if (ch === 'sms') bySms.push(i);
  });
  let error = '';

  if (byMail.length) {
    const r = await mail.sendAll(byMail.map((i) => ({ email: items[i].email, ...build(kind, items[i]).mail })));
    if (r.error) error = r.error;
    const marks = [];
    byMail.forEach((i, k) => {
      if (!r.refused[k]) { results[i] = { ok: r.ok[k], channel: 'email', unusable: false }; return; }
      results[i] = { ok: false, channel: 'email', unusable: true };
      if (admin && items[i].student_id) marks.push(markBad(admin, items[i].student_id, 'bounced'));
      if (sms.configured() && sms.normalizePhone(items[i].phone)) bySms.push(i);   // text them instead, right now
    });
    await Promise.all(marks);
  }

  if (bySms.length) {
    const r = await sms.sendAll(bySms.map((i) => ({ phone: items[i].phone, message: build(kind, items[i]).text })));
    if (r.error) error = error || r.error;
    bySms.forEach((i, k) => { results[i] = { ok: r.ok[k], channel: 'sms', unusable: !sms.normalizePhone(items[i].phone) }; });
  }

  const sent = results.filter((x) => x.ok).length;
  return { sent, failed: results.length - sent, error, results };
}

function markBad(admin, studentId, status) {
  return admin.from('students').update({ email_status: status, email_bad_at: new Date().toISOString() }).eq('user_id', studentId).then(() => {}, () => {});
}

module.exports = { configured, channelFor, isPublicMailbox, domainOf, emailDomains, deliver, PUBLIC_DOMAINS };
