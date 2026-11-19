// Sends student messages. Everything goes by email (see _mail.js).
// A student is skipped ('none') only when the address is invalid or was marked bounced / reported as spam.
const mail = require('./_mail');

function configured() { return mail.configured(); }

// student: { email, email_status }. Returns 'email' or 'none'.
function channelFor(student) {
  const okEmail = (student.email_status || 'ok') === 'ok' && !!mail.normalizeEmail(student.email);
  return okEmail && mail.configured() ? 'email' : 'none';
}

// The message for one student. kind: welcome | confirm | reminder | broadcast | assigned | announce.
function build(kind, it) {
  if (kind === 'welcome') return mail.templates.welcome(it.name);
  if (kind === 'announce') return mail.templates.announce(it.name, it.campaign);
  return mail.templates[kind](it.name, it.session, it.link);
}

// items: [{ student_id, name, email, email_status, session, link, key }], all of one kind.
// key: a stable id per message (queue row, or kind|student|session) so a retried request never sends twice.
// Returns { sent, failed, error, results: [{ ok, channel, unusable }] } in the same order as items.
// unusable = do not try this one again (no usable address, or the address was refused, which also marks it bounced).
async function deliver(admin, kind, items) {
  const results = items.map(() => ({ ok: false, channel: 'none', unusable: true }));
  const byMail = [];
  items.forEach((it, i) => { if (channelFor(it) === 'email') byMail.push(i); });
  let error = '';

  if (byMail.length) {
    const r = await mail.sendAll(byMail.map((i) => ({ email: items[i].email, key: items[i].key, ...build(kind, items[i]) })));
    if (r.error) error = r.error;
    const marks = [];
    byMail.forEach((i, k) => {
      results[i] = { ok: r.ok[k], channel: 'email', unusable: !!r.refused[k] };
      if (r.refused[k] && admin && items[i].student_id) marks.push(markBad(admin, items[i].student_id, 'bounced'));
    });
    await Promise.all(marks);
  }

  const sent = results.filter((x) => x.ok).length;
  return { sent, failed: results.length - sent, error, results };
}

function markBad(admin, studentId, status) {
  return admin.from('students').update({ email_status: status, email_bad_at: new Date().toISOString() }).eq('user_id', studentId).then(() => {}, () => {});
}

module.exports = { configured, channelFor, deliver };
