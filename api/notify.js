// Called by the website for the signed-in student. Body {kind}:
//   "welcome"  a short thank-you message, sent once, right after the account is created
//   "confirm"  (default) a booking confirmation per booked session, with the join link if staff have set one
// Email for students with a public mailbox (Gmail etc.), SMS for the rest (see _send.js).
// Safe to call repeatedly: each message is sent only once.
const { bodyOf, requireUser, limit, tooMany } = require('./_lib');
const send = require('./_send');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireUser(req, res); if (!ctx) return;
  if (!send.configured()) return res.status(200).json({ ok: true, skipped: 'Messages are not set up yet.' });
  const wait = limit('notify:' + ctx.user.id, 6, 60000);   // each call can send a message, so cap it
  if (wait) return tooMany(res, wait);
  const { admin, user } = ctx, kind = bodyOf(req).kind === 'welcome' ? 'welcome' : 'confirm';

  const { data: me } = await admin.from('students').select('name, email, email_status, phone, welcome_sent_at').eq('user_id', user.id).maybeSingle();
  if (!me) return res.status(200).json({ ok: true, skipped: 'Not a student.' });
  const who = { student_id: user.id, name: me.name, email: me.email, email_status: me.email_status, phone: me.phone };

  if (kind === 'welcome') {
    if (me.welcome_sent_at) return res.status(200).json({ ok: true, sent: 0 });
    // Claim first (only one caller can flip the column from null), so two tabs never send two messages.
    const { data: won } = await admin.from('students').update({ welcome_sent_at: new Date().toISOString() }).eq('user_id', user.id).is('welcome_sent_at', null).select('user_id');
    if (!won || !won.length) return res.status(200).json({ ok: true, sent: 0 });
    const r = await send.deliver(admin, 'welcome', [who]);
    if (!r.sent) await admin.from('students').update({ welcome_sent_at: null }).eq('user_id', user.id); // allow a later retry
    return res.status(200).json({ ok: true, sent: r.sent, channel: r.results[0].channel });
  }

  const { data: bks } = await admin.from('bookings').select('session_id, sessions(id, track, title, grasag, starts_at, ends_at)').eq('student_id', user.id);
  let sent = 0;
  for (const b of bks || []) {
    const s = b.sessions; if (!s) continue;
    // Claim the "confirm" slot first; if it already exists nothing comes back and we skip (no duplicate).
    const { data: claimed } = await admin.from('email_log').upsert({ student_id: user.id, session_id: s.id, kind: 'confirm' }, { onConflict: 'student_id,session_id,kind', ignoreDuplicates: true }).select();
    if (!claimed || !claimed.length) continue;
    const { data: lk } = await admin.from('session_links').select('url').eq('session_id', s.id).maybeSingle();
    const r = await send.deliver(admin, 'confirm', [{ ...who, session: s, link: lk && lk.url }]);
    if (r.sent) { sent++; await admin.from('email_log').update({ channel: r.results[0].channel }).match({ student_id: user.id, session_id: s.id, kind: 'confirm' }); }
    else await admin.from('email_log').delete().match({ student_id: user.id, session_id: s.id, kind: 'confirm' }); // let a later call retry
  }
  return res.status(200).json({ ok: true, sent });
};
