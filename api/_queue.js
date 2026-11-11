// Broadcast queue. Starting a broadcast only writes one row per student into email_queue (fast).
// Each call to processBatch() then sends the next 50 waiting messages (email or SMS per student, see _send.js), so a big class is sent in layers and no
// single request runs long. The website keeps calling it until nothing is left; if the page is closed,
// staff can press "Resume" and the daily job (api/remind.js) also finishes anything left over.
const send = require('./_send');
const BATCH = 50;   // about 5 s per call at 10 emails a second

async function tally(admin, id) {
  const t = { pending: 0, sending: 0, sent: 0, failed: 0 };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('email_queue').select('status').eq('broadcast_id', id).order('id').range(from, from + 999);
    if (error) throw error;
    (data || []).forEach((r) => { t[r.status] = (t[r.status] || 0) + 1; });
    if (!data || data.length < 1000) break;
  }
  return t;
}

function shape(bc, t) {
  const left = t.pending + t.sending;
  return { id: bc.id, total: bc.total, sent: t.sent, failed: t.failed, pending: left, status: left === 0 ? 'done' : 'running', at: bc.sent_at };
}

async function progress(admin, id) {
  const { data: bc } = await admin.from('session_broadcasts').select('id, total, sent_at').eq('id', id).maybeSingle();
  return bc ? shape(bc, await tally(admin, id)) : null;
}

// Sends the next batch. Returns progress, or null if the broadcast does not exist.
async function processBatch(admin, id) {
  const { data: bc } = await admin.from('session_broadcasts').select('id, session_id, url, total, status, sent_at').eq('id', id).maybeSingle();
  if (!bc) return null;
  if (bc.status === 'running') {
    const { data: claimed, error } = await admin.rpc('claim_email_batch', { p_broadcast: id, p_n: BATCH });
    if (error) throw error;
    if (claimed && claimed.length) {
      const { data: s } = await admin.from('sessions').select('id, track, title, grasag, starts_at, ends_at').eq('id', bc.session_id).maybeSingle();
      // Current email status (a bounce since queueing moves the student to SMS).
      const ids = claimed.map((q) => q.student_id).filter(Boolean), status = {};
      if (ids.length) {
        const { data: st } = await admin.from('students').select('user_id, email_status').in('user_id', ids);
        (st || []).forEach((x) => { status[x.user_id] = x.email_status; });
      }
      const r = await send.deliver(admin, 'broadcast', claimed.map((q) => ({
        student_id: q.student_id, name: q.name, email: q.to_email, email_status: status[q.student_id], phone: q.to_phone, session: s, link: bc.url
      })));
      const now = new Date().toISOString(), sent = [], retry = [], dead = [];
      claimed.forEach((q, i) => {
        const x = r.results[i];
        if (x.ok) sent.push(q.id);
        else if (x.unusable || q.attempts >= 3) dead.push(q.id);   // unusable address/number: never retry
        else retry.push(q.id);                                      // try again later, give up after 3 attempts
      });
      if (sent.length) await admin.from('email_queue').update({ status: 'sent', sent_at: now }).in('id', sent);
      if (retry.length) await admin.from('email_queue').update({ status: 'pending' }).in('id', retry);
      if (dead.length) await admin.from('email_queue').update({ status: 'failed', sent_at: null }).in('id', dead);
    }
  }
  const t = await tally(admin, id), p = shape(bc, t);
  await admin.from('session_broadcasts').update({ sent: p.sent, failed: p.failed, status: p.status }).eq('id', id);
  return p;
}

module.exports = { BATCH, tally, progress, processBatch };
