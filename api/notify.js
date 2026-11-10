// Called by the website for the signed-in student. Body {kind}:
//   "welcome"  a short thank-you text, sent once, right after the account is created
//   "confirm"  (default) a booking confirmation text per booked session, with the join link if staff have set one
// Safe to call repeatedly: each text is sent only once.
const { bodyOf, requireUser, limit, tooMany } = require('./_lib');
const sms = require('./_sms');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireUser(req, res); if (!ctx) return;
  if (!sms.configured()) return res.status(200).json({ ok: true, skipped: 'SMS is not set up yet.' });
  const wait = limit('notify:' + ctx.user.id, 6, 60000);   // each call can send a text, so cap it
  if (wait) return tooMany(res, wait);
  const { admin, user } = ctx, kind = bodyOf(req).kind === 'welcome' ? 'welcome' : 'confirm';

  const { data: me } = await admin.from('students').select('name, phone, welcome_sent_at').eq('user_id', user.id).maybeSingle();
  if (!me) return res.status(200).json({ ok: true, skipped: 'Not a student.' });

  if (kind === 'welcome') {
    if (me.welcome_sent_at) return res.status(200).json({ ok: true, sent: 0 });
    // Claim first (only one caller can flip the column from null), so two tabs never send two texts.
    const { data: won } = await admin.from('students').update({ welcome_sent_at: new Date().toISOString() }).eq('user_id', user.id).is('welcome_sent_at', null).select('user_id');
    if (!won || !won.length) return res.status(200).json({ ok: true, sent: 0 });
    const r = await sms.sendAll([{ phone: me.phone, message: sms.templates.welcome(me.name) }]);
    if (!r.sent) await admin.from('students').update({ welcome_sent_at: null }).eq('user_id', user.id); // allow a later retry
    return res.status(200).json({ ok: true, sent: r.sent });
  }

  const { data: bks } = await admin.from('bookings').select('session_id, sessions(id, track, title, grasag, starts_at, ends_at)').eq('student_id', user.id);
  let sent = 0;
  for (const b of bks || []) {
    const s = b.sessions; if (!s) continue;
    // Claim the "confirm" slot first; if it already exists nothing comes back and we skip (no duplicate text).
    const { data: claimed } = await admin.from('email_log').upsert({ student_id: user.id, session_id: s.id, kind: 'confirm' }, { onConflict: 'student_id,session_id,kind', ignoreDuplicates: true }).select();
    if (!claimed || !claimed.length) continue;
    const { data: lk } = await admin.from('session_links').select('url').eq('session_id', s.id).maybeSingle();
    const r = await sms.sendAll([{ phone: me.phone, message: sms.templates.confirm(me.name, s, lk && lk.url) }]);
    if (r.sent) sent++; else await admin.from('email_log').delete().match({ student_id: user.id, session_id: s.id, kind: 'confirm' }); // let a later call retry
  }
  return res.status(200).json({ ok: true, sent });
};
