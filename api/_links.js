// Makes sure a student who joins a session after its joining link was broadcast still gets the link, once.
// Every message that carries a link records it in email_log.link_url; broadcasts are recorded in email_queue.
const send = require('./_send');

// True when the session's link has been broadcast and this student has not been sent this exact link
// (by their confirmation, the reminder, an earlier "link" email or the broadcast itself).
// Before any broadcast the student is left alone: the broadcast will reach everyone booked at that time.
async function needsLink(admin, studentId, sessionId, url) {
  const { data: bc } = await admin.from('session_broadcasts').select('id').eq('session_id', sessionId).limit(1);
  if (!bc || !bc.length) return false;
  const { data: got } = await admin.from('email_log').select('kind').eq('student_id', studentId).eq('session_id', sessionId).eq('link_url', url).limit(1);
  if (got && got.length) return false;
  const { data: q } = await admin.from('email_queue').select('id, session_broadcasts!inner(session_id, url)')
    .eq('student_id', studentId).eq('status', 'sent').eq('session_broadcasts.session_id', sessionId).eq('session_broadcasts.url', url).limit(1);
  return !(q && q.length);
}

// Claims the 'link' slot for this link (so two calls never send it twice), sends the link email, and gives the
// claim back if sending failed so a later call retries. Returns true when sent.
async function sendLink(admin, who, s, url) {
  const match = { student_id: who.student_id, session_id: s.id, kind: 'link' };
  let prev = null;
  const { data: ins } = await admin.from('email_log').upsert({ ...match, link_url: url }, { onConflict: 'student_id,session_id,kind', ignoreDuplicates: true }).select('student_id');
  if (!ins || !ins.length) {
    // A 'link' row exists from an older link: take it over only if it still holds a different link.
    const { data: old } = await admin.from('email_log').select('link_url').match(match).maybeSingle();
    if (!old || old.link_url === url) return false;
    prev = old.link_url;
    const { data: won } = await admin.from('email_log').update({ link_url: url, sent_at: new Date().toISOString() }).match(match).eq('link_url', prev).select('student_id');
    if (!won || !won.length) return false;
  }
  const r = await send.deliver(admin, 'broadcast', [{ ...who, session: s, link: url, key: 'link|' + who.student_id + '|' + s.id + '|' + url }]);
  if (r.sent) { await admin.from('email_log').update({ channel: r.results[0].channel }).match(match); return true; }
  if (prev === null) await admin.from('email_log').delete().match(match).eq('link_url', url);
  else await admin.from('email_log').update({ link_url: prev }).match(match).eq('link_url', url);
  return false;
}

module.exports = { needsLink, sendLink };
