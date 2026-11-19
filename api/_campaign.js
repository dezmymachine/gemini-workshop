// Email campaign queue (the Emails page). Same design as the link-broadcast queue in _queue.js, on its own tables
// (campaigns, campaign_queue) so the two never interfere. Starting a campaign writes one row per student; each
// processBatch() call sends the next 100 (one Resend batch request). The page keeps calling it until nothing is
// left; staff can press Resume, and the daily job (api/remind.js) finishes anything left over.
const send = require('./_send');
const BATCH = 100;

// A row claimed on its last attempt by a call that then crashed would stay 'sending' forever: mark it failed.
async function sweepStuck(admin, id) {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await admin.from('campaign_queue').update({ status: 'failed', sent_at: null })
    .eq('campaign_id', id).eq('status', 'sending').gte('attempts', 3).lt('claimed_at', cutoff);
}

async function tally(admin, id) {
  const t = { pending: 0, sending: 0, sent: 0, failed: 0 };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('campaign_queue').select('status').eq('campaign_id', id).order('id').range(from, from + 999);
    if (error) throw error;
    (data || []).forEach((r) => { t[r.status] = (t[r.status] || 0) + 1; });
    if (!data || data.length < 1000) break;
  }
  return t;
}

function shape(c, t) {
  const left = t.pending + t.sending;
  return { id: c.id, total: c.total, sent: t.sent, failed: t.failed, pending: left, status: left === 0 ? 'done' : 'running', at: c.created_at };
}

async function progress(admin, id) {
  const { data: c } = await admin.from('campaigns').select('id, total, created_at').eq('id', id).maybeSingle();
  return c ? shape(c, await tally(admin, id)) : null;
}

// Sends the next batch. Returns progress, or null if the campaign does not exist.
async function processBatch(admin, id) {
  const { data: c } = await admin.from('campaigns').select('id, subject, body, cta_label, cta_url, total, status, created_at').eq('id', id).maybeSingle();
  if (!c) return null;
  if (c.status === 'running') {
    const { data: claimed, error } = await admin.rpc('claim_campaign_batch', { p_campaign: id, p_n: BATCH });
    if (error) throw error;
    if (claimed && claimed.length) {
      // Current email status (an address marked bounced since queueing is skipped).
      const ids = claimed.map((q) => q.student_id).filter(Boolean), status = {};
      if (ids.length) {
        const { data: st } = await admin.from('students').select('user_id, email_status').in('user_id', ids);
        (st || []).forEach((x) => { status[x.user_id] = x.email_status; });
      }
      const r = await send.deliver(admin, 'announce', claimed.map((q) => ({
        student_id: q.student_id, name: q.name, email: q.to_email, email_status: status[q.student_id], campaign: c, key: 'c' + q.id
      })));
      const now = new Date().toISOString(), sent = [], retry = [], dead = [];
      claimed.forEach((q, i) => {
        const x = r.results[i];
        if (x.ok) sent.push(q.id);
        else if (x.unusable || q.attempts >= 3) dead.push(q.id);
        else retry.push(q.id);
      });
      if (sent.length) await admin.from('campaign_queue').update({ status: 'sent', sent_at: now }).in('id', sent);
      if (retry.length) await admin.from('campaign_queue').update({ status: 'pending' }).in('id', retry);
      if (dead.length) await admin.from('campaign_queue').update({ status: 'failed', sent_at: null }).in('id', dead);
    }
  }
  await sweepStuck(admin, id);
  const t = await tally(admin, id), p = shape(c, t);
  await admin.from('campaigns').update({ sent: p.sent, failed: p.failed, status: p.status }).eq('id', id);
  return p;
}

module.exports = { BATCH, tally, progress, processBatch };
