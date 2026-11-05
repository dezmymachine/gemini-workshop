// Broadcast email queue. Starting a broadcast only writes one row per student into email_queue (fast).
// Each call to processBatch() then sends the next 100 waiting emails, so a big class is sent in layers and no
// single request runs long. The website keeps calling it until nothing is left; if the page is closed,
// staff can press "Resume" and the daily job (api/remind.js) also finishes anything left over.
const mail = require('./_mail');
const BATCH = 100;

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
      const r = await mail.sendAll(claimed.map((q) => ({ to: q.to_email, ...mail.templates.broadcast(q.name, s, bc.url) })));
      const ids = claimed.map((q) => q.id);
      if (r.sent) {
        await admin.from('email_queue').update({ status: 'sent', sent_at: new Date().toISOString() }).in('id', ids);
      } else {                                   // the whole batch failed: try again later, give up after 3 attempts
        const retry = claimed.filter((q) => q.attempts < 3).map((q) => q.id), dead = claimed.filter((q) => q.attempts >= 3).map((q) => q.id);
        if (retry.length) await admin.from('email_queue').update({ status: 'pending' }).in('id', retry);
        if (dead.length) await admin.from('email_queue').update({ status: 'failed' }).in('id', dead);
      }
    }
  }
  const t = await tally(admin, id), p = shape(bc, t);
  await admin.from('session_broadcasts').update({ sent: p.sent, failed: p.failed, status: p.status }).eq('id', id);
  return p;
}

module.exports = { BATCH, tally, progress, processBatch };
