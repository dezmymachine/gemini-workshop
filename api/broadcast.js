// "Send link to booked students", sent by email through a queue in batches of 100 (see _queue.js).
// Super admins and organisers only. Actions:
//   start   {session_id, audience}  queue one message per booked student (or return the one already in progress);
//           audience: 'all' (default), 'ug' = undergraduates only, 'pg' = postgraduates only.
//           Nobody is sent the same link for the same session twice: anyone who already received this exact link
//           (an earlier broadcast, a booking confirmation, or a "here is your link" email) is skipped,
//           unless resend: true (staff ticked "Send again as a reminder"), which sends to everyone in the group.
//   process {id}          send the next batch and return progress
//   retry   {id}          put failed messages back in the queue
const { bad, bodyOf, requireStaff } = require('./_lib');
const send = require('./_send');
const queue = require('./_queue');
const GROUP = { all: 'all booked students', ug: 'undergraduates', pg: 'postgraduates' };
const AUD = { all: 'all booked students', ug: 'the undergraduates', pg: 'the postgraduates' };
const NOT_SET_UP = 'Email is not set up yet. Add RESEND_API_KEY and MAIL_FROM on the server.';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireStaff(req, res); if (!ctx) return;
  const { admin, user } = ctx, body = bodyOf(req), action = body.action || 'start';

  try {
    if (action === 'process' || action === 'retry') {
      if (!send.configured()) return bad(res, 500, NOT_SET_UP);
      const id = Number(body.id);
      if (!id) return bad(res, 400, 'Missing broadcast.');
      if (action === 'retry') {
        await admin.from('email_queue').update({ status: 'pending', attempts: 0 }).eq('broadcast_id', id).eq('status', 'failed');
        await admin.from('session_broadcasts').update({ status: 'running' }).eq('id', id);
      }
      const p = action === 'retry' ? await queue.progress(admin, id) : await queue.processBatch(admin, id);
      return p ? res.status(200).json(p) : bad(res, 404, 'That broadcast no longer exists.');
    }

    if (action !== 'start') return bad(res, 400, 'Unknown action.');
    const sid = String(body.session_id || '');
    const audience = ['ug', 'pg'].includes(body.audience) ? body.audience : 'all';
    const resend = body.resend === true;
    const wanted = (lv) => audience === 'all' || (audience === 'pg') === /^Postgraduate/.test(lv || '');
    const { data: s } = await admin.from('sessions').select('id').eq('id', sid).maybeSingle();
    if (!s) return bad(res, 400, 'Unknown session.');
    const { data: lk } = await admin.from('session_links').select('url').eq('session_id', sid).maybeSingle();
    if (!lk) return bad(res, 400, 'Add the meeting link for this session first.');
    if (!send.configured()) return bad(res, 500, NOT_SET_UP);

    // Already sending for this session? Same group: carry on with that one. Another group: wait for it to finish,
    // so two sends can never queue the same students at the same time.
    const { data: running } = await admin.from('session_broadcasts').select('id, audience').eq('session_id', sid).eq('status', 'running').order('id', { ascending: false }).limit(1);
    if (running && running.length) {
      if ((running[0].audience || 'all') === audience) return res.status(200).json({ ...(await queue.progress(admin, running[0].id)), audience });
      return bad(res, 400, 'The link is still being sent to ' + AUD[running[0].audience || 'all'] + ' of this session. Resume or finish that first.');
    }

    // Who already has this exact link for this session (so they are not emailed it again).
    const has = new Set();
    for (let from = 0; !resend; from += 1000) {
      const { data, error } = await admin.from('email_queue').select('student_id, session_broadcasts!inner(session_id, url)')
        .eq('status', 'sent').eq('session_broadcasts.session_id', sid).eq('session_broadcasts.url', lk.url).order('id').range(from, from + 999);
      if (error) throw error;
      (data || []).forEach((r) => has.add(r.student_id));
      if (!data || data.length < 1000) break;
    }
    if (!resend) {
      const { data: logged, error: e0 } = await admin.from('email_log').select('student_id').eq('session_id', sid).eq('link_url', lk.url).not('channel', 'is', null);
      if (e0) throw e0;
      (logged || []).forEach((r) => has.add(r.student_id));
    }

    const people = []; let already = 0;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('bookings').select('student_id, students(name, email, level)').eq('session_id', sid).order('student_id').range(from, from + 999);
      if (error) return bad(res, 400, error.message);
      (data || []).forEach((r) => { if (!r.students || !wanted(r.students.level)) return; if (has.has(r.student_id)) { already++; return; } people.push({ student_id: r.student_id, name: r.students.name, email: r.students.email }); });
      if (!data || data.length < 1000) break;
    }
    if (!people.length) {
      if (already) return bad(res, 400, 'Everyone in this group (' + GROUP[audience] + ') has already been sent this link (' + already + ' student' + (already === 1 ? '' : 's') + '). Nobody was emailed again. To send it again as a reminder, press Send link and tick "Send again as a reminder".');
      return bad(res, 400, audience === 'all' ? 'No one has booked this session yet.' : 'No ' + (audience === 'pg' ? 'postgraduate' : 'undergraduate') + ' students have booked this session.');
    }

    const { data: bc, error: e1 } = await admin.from('session_broadcasts').insert({ session_id: sid, sent_by: user.id, url: lk.url, total: people.length, status: 'running', sent: 0, failed: 0, audience }).select('id, sent_at').single();
    if (e1) throw e1;
    for (let i = 0; i < people.length; i += 500) {
      const { error } = await admin.from('email_queue').insert(people.slice(i, i + 500).map((p) => ({ broadcast_id: bc.id, student_id: p.student_id, to_email: p.email, name: p.name })));
      if (error) throw error;
    }
    return res.status(200).json({ id: bc.id, total: people.length, sent: 0, failed: 0, pending: people.length, status: 'running', at: bc.sent_at, audience, already });
  } catch (e) {
    return bad(res, 400, (e && e.message) || 'Something went wrong.');
  }
};
