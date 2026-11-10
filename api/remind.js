// Runs once a day (see vercel.json "crons"). Vercel calls it with "Authorization: Bearer <CRON_SECRET>".
//  1. Texts a reminder to everyone booked on a session that happens tomorrow (Ghana time = UTC).
//  2. Safety net: texts any booking confirmation that was missed (for example a student closed the tab).
// Reports sessions that still have no meeting link so staff can add one.
const { adminClient } = require('./_lib');
const sms = require('./_sms');
const queue = require('./_queue');

const BUDGET_MS = 8000; // stay inside a short function time limit; anything left is picked up next run (nothing is sent twice)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function allBookings(admin, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from('bookings').select('student_id, session_id, students(name, phone), sessions(id, track, title, grasag, starts_at, ends_at)').order('student_id').range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q; if (error) throw error;
    out.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret || String(req.headers.authorization || '') !== 'Bearer ' + secret) return res.status(401).json({ error: 'Not allowed.' });
  const admin = adminClient();
  if (!admin) return res.status(500).json({ error: 'Missing Supabase settings.' });
  if (!sms.configured()) return res.status(200).json({ ok: true, skipped: 'SMS is not set up yet.' });

  const started = Date.now();
  try {
    const now = new Date();
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const tomorrow = { from: new Date(dayStart).toISOString(), to: new Date(dayStart + 86400000).toISOString() };

    // Read the whole log page by page: the database returns at most 1000 rows per request, so a single
    // read would silently miss older entries and the same student could be texted twice.
    const done = new Set();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('email_log').select('student_id, session_id, kind').order('student_id').order('session_id').order('kind').range(from, from + 999);
      if (error) throw error;
      (data || []).forEach((l) => done.add(l.kind + '|' + l.student_id + '|' + l.session_id));
      if (!data || data.length < 1000) break;
    }
    const { data: links } = await admin.from('session_links').select('session_id, url');
    const link = {}; (links || []).forEach((l) => { link[l.session_id] = l.url; });

    const plan = []; // { kind, row }
    (await allBookings(admin)).forEach((b) => {
      if (!b.students || !b.sessions) return;
      const key = (k) => k + '|' + b.student_id + '|' + b.session_id;
      const startsAt = b.sessions.starts_at;
      if (new Date(startsAt) > now && !done.has(key('confirm'))) plan.push({ kind: 'confirm', b });
      if (startsAt >= tomorrow.from && startsAt < tomorrow.to && !done.has(key('reminder'))) plan.push({ kind: 'reminder', b });
    });

    // Send in layers of 100, oldest first, and stop before the time budget runs out.
    let sent = 0, failed = 0, remaining = 0;
    for (const kind of ['confirm', 'reminder']) {
      const group = plan.filter((p) => p.kind === kind);
      for (let i = 0; i < group.length; i += queue.BATCH) {
        if (Date.now() - started > BUDGET_MS) { remaining += group.length - i; break; }
        const chunk = group.slice(i, i + queue.BATCH);
        const r = await sms.sendAll(chunk.map((p) => ({ phone: p.b.students.phone, message: sms.templates[kind](p.b.students.name, p.b.sessions, link[p.b.session_id]) })));
        sent += r.sent; failed += r.failed;
        if (r.sent) await admin.from('email_log').upsert(chunk.map((p) => ({ student_id: p.b.student_id, session_id: p.b.session_id, kind })), { onConflict: 'student_id,session_id,kind', ignoreDuplicates: true });
        await sleep(600);
      }
    }

    // Finish any broadcast that was left half-sent (for example the staff member closed the page).
    let resumed = 0;
    const { data: open } = await admin.from('session_broadcasts').select('id').eq('status', 'running').order('id');
    for (const bc of open || []) {
      for (;;) {
        if (Date.now() - started > BUDGET_MS) break;
        const p = await queue.processBatch(admin, bc.id);
        if (!p || p.status === 'done') { resumed++; break; }
        await sleep(600);
      }
    }

    const { data: tmr } = await admin.from('sessions').select('id').gte('starts_at', tomorrow.from).lt('starts_at', tomorrow.to);
    const missing = (tmr || []).map((s) => s.id).filter((id) => !link[id]);
    return res.status(200).json({ ok: true, sent, failed, remaining, broadcastsFinished: resumed, sessionsMissingLink: missing });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || 'Something went wrong.' });
  }
};
