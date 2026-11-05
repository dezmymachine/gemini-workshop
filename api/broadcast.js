// "Email link to booked students", sent through a queue in batches of 100 (see _queue.js).
// Super admins and organisers only. Actions:
//   start   {session_id}  queue one email per booked student (or return the one already in progress)
//   process {id}          send the next batch and return progress
//   retry   {id}          put failed emails back in the queue
const { bad, bodyOf, requireStaff } = require('./_lib');
const mail = require('./_mail');
const queue = require('./_queue');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireStaff(req, res); if (!ctx) return;
  const { admin, user } = ctx, body = bodyOf(req), action = body.action || 'start';

  try {
    if (action === 'process' || action === 'retry') {
      if (!mail.configured()) return bad(res, 500, 'Email is not set up yet. Add RESEND_API_KEY and MAIL_FROM in the server settings.');
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
    const { data: s } = await admin.from('sessions').select('id').eq('id', sid).maybeSingle();
    if (!s) return bad(res, 400, 'Unknown session.');
    const { data: lk } = await admin.from('session_links').select('url').eq('session_id', sid).maybeSingle();
    if (!lk) return bad(res, 400, 'Add the meeting link for this session first.');
    if (!mail.configured()) return bad(res, 500, 'Email is not set up yet. Add RESEND_API_KEY and MAIL_FROM in the server settings.');

    // Already sending for this session? Carry on with that one instead of queueing everyone twice.
    const { data: running } = await admin.from('session_broadcasts').select('id').eq('session_id', sid).eq('status', 'running').order('id', { ascending: false }).limit(1);
    if (running && running.length) return res.status(200).json(await queue.progress(admin, running[0].id));

    const people = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('bookings').select('student_id, students(name, email)').eq('session_id', sid).order('student_id').range(from, from + 999);
      if (error) return bad(res, 400, error.message);
      (data || []).forEach((r) => { if (r.students && r.students.email) people.push({ student_id: r.student_id, name: r.students.name, email: r.students.email }); });
      if (!data || data.length < 1000) break;
    }
    if (!people.length) return bad(res, 400, 'No one has booked this session yet.');

    const { data: bc, error: e1 } = await admin.from('session_broadcasts').insert({ session_id: sid, sent_by: user.id, url: lk.url, total: people.length, status: 'running', sent: 0, failed: 0 }).select('id, sent_at').single();
    if (e1) throw e1;
    for (let i = 0; i < people.length; i += 500) {
      const { error } = await admin.from('email_queue').insert(people.slice(i, i + 500).map((p) => ({ broadcast_id: bc.id, student_id: p.student_id, to_email: p.email, name: p.name })));
      if (error) throw error;
    }
    return res.status(200).json({ id: bc.id, total: people.length, sent: 0, failed: 0, pending: people.length, status: 'running', at: bc.sent_at });
  } catch (e) {
    return bad(res, 400, (e && e.message) || 'Something went wrong.');
  }
};
