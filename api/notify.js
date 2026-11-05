// Called by the website right after a student books: emails a confirmation (with the join link if staff have set one).
// Safe to call repeatedly: email_log makes sure each student gets one confirmation per session.
const { bodyOf, requireUser } = require('./_lib');
const mail = require('./_mail');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireUser(req, res); if (!ctx) return;
  if (!mail.configured()) return res.status(200).json({ ok: true, skipped: 'Email is not set up yet.' });
  const { admin, user } = ctx; void bodyOf;

  const { data: me } = await admin.from('students').select('name, email').eq('user_id', user.id).maybeSingle();
  if (!me) return res.status(200).json({ ok: true, skipped: 'Not a student.' });
  const { data: bks } = await admin.from('bookings').select('session_id, sessions(id, track, title, grasag, starts_at, ends_at)').eq('student_id', user.id);
  let sent = 0;
  for (const b of bks || []) {
    const s = b.sessions; if (!s) continue;
    // Claim the "confirm" slot first; if it already exists nothing comes back and we skip (no duplicate email).
    const { data: claimed } = await admin.from('email_log').upsert({ student_id: user.id, session_id: s.id, kind: 'confirm' }, { onConflict: 'student_id,session_id,kind', ignoreDuplicates: true }).select();
    if (!claimed || !claimed.length) continue;
    const { data: lk } = await admin.from('session_links').select('url').eq('session_id', s.id).maybeSingle();
    const r = await mail.sendAll([{ to: me.email, ...mail.templates.confirm(me.name, s, lk && lk.url) }]);
    if (r.sent) sent++; else await admin.from('email_log').delete().match({ student_id: user.id, session_id: s.id, kind: 'confirm' }); // let a later call retry
  }
  return res.status(200).json({ ok: true, sent });
};
