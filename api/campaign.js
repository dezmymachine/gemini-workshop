// Emails page: staff (super admins and organisers) send a message to the students of chosen colleges.
// POST actions:
//   start   { colleges: [ids], filter: 'all' | 'booked' | 'unbooked', subject, message, cta_label?, cta_url? }
//           booked = holds a college or GRASAG seat (an open-session seat alone does not count)
//   process { id }   send the next batch of 100, return progress
//   retry   { id }   put failed messages back in the queue
//   list             the 20 most recent campaigns
const { bad, bodyOf, requireStaff, validLink } = require('./_lib');
const send = require('./_send');
const camp = require('./_campaign');
const NOT_SET_UP = 'Email is not set up yet. Add RESEND_API_KEY and MAIL_FROM on the server.';
const FILTERS = ['all', 'booked', 'unbooked'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireStaff(req, res); if (!ctx) return;
  const { admin, user } = ctx, body = bodyOf(req), action = body.action || 'start';

  try {
    if (action === 'list') {
      const { data, error } = await admin.from('campaigns').select('id, created_at, subject, colleges, filter, total, sent, failed, status').order('id', { ascending: false }).limit(20);
      if (error) throw error;
      return res.status(200).json({ campaigns: data || [] });
    }

    if (action === 'process' || action === 'retry') {
      if (!send.configured()) return bad(res, 500, NOT_SET_UP);
      const id = Number(body.id);
      if (!id) return bad(res, 400, 'Missing email.');
      if (action === 'retry') {
        await admin.from('campaign_queue').update({ status: 'pending', attempts: 0 }).eq('campaign_id', id).eq('status', 'failed');
        await admin.from('campaigns').update({ status: 'running' }).eq('id', id);
      }
      const p = action === 'retry' ? await camp.progress(admin, id) : await camp.processBatch(admin, id);
      return p ? res.status(200).json(p) : bad(res, 404, 'That email no longer exists.');
    }

    if (action !== 'start') return bad(res, 400, 'Unknown action.');
    const subject = String(body.subject || '').trim(), message = String(body.message || '').trim();
    const ctaLabel = String(body.cta_label || '').trim(), ctaUrl = String(body.cta_url || '').trim();
    const filter = FILTERS.includes(body.filter) ? body.filter : 'all';
    const { data: cols, error: e0 } = await admin.from('colleges').select('id');
    if (e0) throw e0;
    const known = new Set((cols || []).map((c) => c.id));
    const colleges = [...new Set(Array.isArray(body.colleges) ? body.colleges.map(String) : [])].filter((c) => known.has(c));
    if (!colleges.length) return bad(res, 400, 'Choose at least one college.');
    if (!subject || subject.length > 150) return bad(res, 400, 'Write a subject of up to 150 characters.');
    if (!message || message.length > 5000) return bad(res, 400, 'Write a message of up to 5000 characters.');
    if (ctaLabel || ctaUrl) {
      if (!ctaLabel || ctaLabel.length > 40) return bad(res, 400, 'Give the button a label of up to 40 characters, or leave both button fields empty.');
      if (!validLink(ctaUrl)) return bad(res, 400, 'The button link must be a full link starting with https://, or leave both button fields empty.');
    }
    if (!send.configured()) return bad(res, 500, NOT_SET_UP);

    // One campaign at a time, so two sends never overlap.
    const { data: running } = await admin.from('campaigns').select('id, subject').eq('status', 'running').limit(1);
    if (running && running.length) return bad(res, 400, 'Another email ("' + running[0].subject + '") is still being sent. Resume or finish it first.');

    const people = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('students').select('user_id, name, email, email_status, bookings(kind)').in('college', colleges).order('user_id').range(from, from + 999);
      if (error) throw error;
      (data || []).forEach((r) => {
        const booked = (r.bookings || []).some((b) => b.kind === 'college' || b.kind === 'grasag');
        if (filter === 'booked' && !booked) return;
        if (filter === 'unbooked' && booked) return;
        people.push({ student_id: r.user_id, name: r.name, email: r.email });
      });
      if (!data || data.length < 1000) break;
    }
    if (!people.length) return bad(res, 400, 'No students match: nobody would receive this email.');

    const { data: c, error: e1 } = await admin.from('campaigns').insert({
      sent_by: user.id, subject, body: message, cta_label: ctaUrl ? ctaLabel : null, cta_url: ctaUrl || null,
      colleges, filter, total: people.length, status: 'running'
    }).select('id, created_at').single();
    if (e1) throw e1;
    for (let i = 0; i < people.length; i += 500) {
      const { error } = await admin.from('campaign_queue').insert(people.slice(i, i + 500).map((p) => ({ campaign_id: c.id, student_id: p.student_id, to_email: p.email, name: p.name })));
      if (error) throw error;
    }
    return res.status(200).json({ id: c.id, total: people.length, sent: 0, failed: 0, pending: people.length, status: 'running', at: c.created_at });
  } catch (e) {
    return bad(res, 400, (e && e.message) || 'Something went wrong.');
  }
};
