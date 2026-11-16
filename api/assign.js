// Staff (super admins and organisers) give a college session to students who have not booked one.
// POST { session_id, students: [student numbers, up to 100] }
// Same rules as a student booking (book_session in the database):
//   - only sessions for the student's own college, not GRASAG, not already started, not closed;
//   - a student who already has a college seat is never moved (insert ... on conflict do nothing);
//   - the seat limit is enforced by the database (sessions.booked <= capacity, kept by the bookings trigger),
//     so a session can never be overfilled, even while students are booking it at the same moment;
//   - no clash with the student's GRASAG seat.
// Each newly booked student is emailed straight away (with the joining link if it is already set).
// The email is logged as their booking confirmation, so the daily job does not send another one;
// if the email fails the log entry is removed and the daily job retries it.
const { bad, bodyOf, requireStaff } = require('./_lib');
const send = require('./_send');

const MAX = 100;
const keyOf = (n) => String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isFull = (e) => e && (e.code === '23514' || /check constraint|booked/i.test(e.message || ''));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireStaff(req, res); if (!ctx) return;
  const { admin } = ctx, body = bodyOf(req);
  const sid = String(body.session_id || '');
  const nums = Array.isArray(body.students) ? body.students.map(String).filter((x) => keyOf(x)) : [];
  if (!nums.length) return bad(res, 400, 'Choose at least one student.');
  if (nums.length > MAX) return bad(res, 400, 'Send at most ' + MAX + ' students at a time.');

  try {
    const { data: s, error: e1 } = await admin.from('sessions').select('id, track, title, grasag, capacity, booked, starts_at, ends_at, closed').eq('id', sid).maybeSingle();
    if (e1) throw e1;
    if (!s) return bad(res, 400, 'Unknown session.');
    if (s.grasag) return bad(res, 400, 'GRASAG sessions cannot be given out here.');
    if (new Date(s.starts_at) <= new Date()) return bad(res, 400, 'That session has already started.');
    if (s.closed) return bad(res, 400, 'That session is closed to new bookings. Reopen it first or choose another session.');

    const skipped = [], byKey = new Map();
    nums.forEach((n) => { if (!byKey.has(keyOf(n))) byKey.set(keyOf(n), n); });
    const { data: studs, error: e2 } = await admin.from('students').select('user_id, student_number, student_key, name, email, email_status, college').in('student_key', [...byKey.keys()]);
    if (e2) throw e2;
    const { data: cols, error: e3 } = await admin.from('colleges').select('id, track');
    if (e3) throw e3;
    const trackOf = {}; (cols || []).forEach((c) => { trackOf[c.id] = c.track; });
    const found = new Map((studs || []).map((x) => [x.student_key, x]));
    for (const [k, n] of byKey) if (!found.has(k)) skipped.push({ i: n, reason: 'not registered' });

    // Existing seats of these students (college seat = already booked; GRASAG seat = check the times do not clash).
    const ids = (studs || []).map((x) => x.user_id);
    const { data: bks, error: e4 } = ids.length
      ? await admin.from('bookings').select('student_id, kind, sessions(starts_at, ends_at)').in('student_id', ids)
      : { data: [] };
    if (e4) throw e4;
    const has = {}, grasag = {};
    (bks || []).forEach((b) => { if (b.kind === 'college') has[b.student_id] = 1; else grasag[b.student_id] = b.sessions; });

    let todo = [];
    (studs || []).forEach((x) => {
      const g = grasag[x.user_id];
      if (trackOf[x.college] !== s.track) skipped.push({ i: x.student_number, reason: 'different college' });
      else if (has[x.user_id]) skipped.push({ i: x.student_number, reason: 'already has a session' });
      else if (g && new Date(g.starts_at) < new Date(s.ends_at) && new Date(s.starts_at) < new Date(g.ends_at)) skipped.push({ i: x.student_number, reason: 'clashes with their GRASAG session' });
      else todo.push(x);
    });

    // Book: all at once when the seats clearly allow it; one by one if the session fills up meanwhile.
    const room = Math.max(0, s.capacity - s.booked);
    todo.slice(room).forEach((x) => skipped.push({ i: x.student_number, reason: 'session full' }));
    todo = todo.slice(0, room);
    const rowOf = (x) => ({ student_id: x.user_id, kind: 'college', session_id: sid });
    const won = new Set();
    if (todo.length) {
      const { data, error } = await admin.from('bookings').upsert(todo.map(rowOf), { onConflict: 'student_id,kind', ignoreDuplicates: true }).select('student_id');
      if (!error) (data || []).forEach((r) => won.add(r.student_id));
      else if (isFull(error)) {
        let full = false;
        for (const x of todo) {
          if (full) { skipped.push({ i: x.student_number, reason: 'session full' }); continue; }
          const r = await admin.from('bookings').upsert(rowOf(x), { onConflict: 'student_id,kind', ignoreDuplicates: true }).select('student_id');
          if (r.error) { if (isFull(r.error)) { full = true; skipped.push({ i: x.student_number, reason: 'session full' }); } else throw r.error; }
          else (r.data || []).forEach((y) => won.add(y.student_id));
        }
      } else throw error;
      todo.forEach((x) => { if (!won.has(x.user_id) && !skipped.some((k) => k.i === x.student_number)) skipped.push({ i: x.student_number, reason: 'already has a session' }); });
    }
    const booked = todo.filter((x) => won.has(x.user_id));

    // Email them (claim the confirmation slot first so nobody gets it twice).
    let emailed = 0, emailFailed = 0;
    if (booked.length) {
      const { data: claimed } = await admin.from('email_log')
        .upsert(booked.map((x) => ({ student_id: x.user_id, session_id: sid, kind: 'confirm' })), { onConflict: 'student_id,session_id,kind', ignoreDuplicates: true })
        .select('student_id');
      const mine = new Set((claimed || []).map((r) => r.student_id));
      const items = booked.filter((x) => mine.has(x.user_id));
      if (items.length) {
        const { data: lk } = await admin.from('session_links').select('url').eq('session_id', sid).maybeSingle();
        const r = await send.deliver(admin, 'assigned', items.map((x) => ({
          student_id: x.user_id, name: x.name, email: x.email, email_status: x.email_status,
          session: s, link: lk && lk.url, key: 'confirm|' + x.user_id + '|' + sid })));
        const okIds = [], failIds = [];
        items.forEach((x, k) => (r.results[k].ok ? okIds : failIds).push(x.user_id));
        emailed = okIds.length; emailFailed = failIds.length;
        if (okIds.length) await admin.from('email_log').update({ channel: 'email' }).eq('session_id', sid).eq('kind', 'confirm').in('student_id', okIds);
        if (failIds.length) await admin.from('email_log').delete().eq('session_id', sid).eq('kind', 'confirm').in('student_id', failIds); // daily job retries
      }
    }

    const { data: after } = await admin.from('sessions').select('capacity, booked').eq('id', sid).maybeSingle();
    return res.status(200).json({
      assigned: booked.length,
      assignedNumbers: booked.map((x) => x.student_number),
      skipped, emailed, emailFailed,
      left: after ? Math.max(0, after.capacity - after.booked) : null
    });
  } catch (e) {
    return bad(res, 400, (e && e.message) || 'Something went wrong.');
  }
};
