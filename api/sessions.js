// Session settings for staff (super admins and organisers): meeting links, closing a session to new bookings,
// and creating / deleting open sessions (track 'open': every college can book one, as an extra seat).
const { bad, bodyOf, requireStaff, validLink } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireStaff(req, res); if (!ctx) return;
  const { admin } = ctx, body = bodyOf(req);

  try {
    if (body.action === 'list') {
      const { data: links, error } = await admin.from('session_links').select('session_id, url');
      if (error) throw error;
      const { data: bc, error: e2 } = await admin.from('session_broadcasts').select('id, session_id, sent_at, total, sent, failed, status, audience').order('id', { ascending: false }).limit(2000);
      if (e2) throw e2;
      const last = {};
      (bc || []).forEach((r) => { if (!last[r.session_id]) last[r.session_id] = { id: r.id, at: r.sent_at, total: r.total, sent: r.sent, failed: r.failed, status: r.status, audience: r.audience || 'all', pending: Math.max(0, r.total - r.sent - r.failed) }; });
      const out = {}; (links || []).forEach((l) => { out[l.session_id] = l.url; });
      const { data: cl } = await admin.from('sessions').select('id').eq('closed', true);
      const closed = {}; (cl || []).forEach((r) => { closed[r.id] = true; });
      return res.status(200).json({ links: out, last, closed });
    }

    if (body.action === 'setLink') {
      const sid = String(body.session_id || '');
      const url = String(body.url || '').trim();
      const { data: s } = await admin.from('sessions').select('id').eq('id', sid).maybeSingle();
      if (!s) return bad(res, 400, 'Unknown session.');
      if (!url) {
        const { error } = await admin.from('session_links').delete().eq('session_id', sid);
        if (error) throw error;
        return res.status(200).json({ ok: true, url: '' });
      }
      if (!validLink(url)) return bad(res, 400, 'Enter a full link starting with https:// (for example https://meet.google.com/abc-defg-hij).');
      const { error } = await admin.from('session_links').upsert({ session_id: sid, url, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ ok: true, url });
    }
    if (body.action === 'setClosed') {
      // Closed = nobody can book or switch into it (enforced in book_session). People already booked keep their seat.
      const sid = String(body.session_id || ''), closed = body.closed === true;
      const { data, error } = await admin.from('sessions').update({ closed }).eq('id', sid).select('id, closed');
      if (error) throw error;
      if (!data || !data.length) return bad(res, 400, 'Unknown session.');
      return res.status(200).json({ ok: true, closed: data[0].closed });
    }
    if (body.action === 'create') {
      // Open session. Times arrive as ISO strings (Ghana time = UTC).
      const title = String(body.title || '').trim().replace(/\s+/g, ' ');
      const a = new Date(body.starts_at), b = new Date(body.ends_at), cap = body.capacity == null || body.capacity === '' ? 400 : Number(body.capacity);
      if (title.length < 3 || title.length > 80) return bad(res, 400, 'Give the session a title of 3 to 80 characters.');
      if (isNaN(a) || isNaN(b)) return bad(res, 400, 'Choose a date, a start time and an end time.');
      if (a <= new Date()) return bad(res, 400, 'The start time must be in the future.');
      if (b <= a) return bad(res, 400, 'The end time must be after the start time.');
      if (b - a > 8 * 3600 * 1000) return bad(res, 400, 'A session can be at most 8 hours long.');
      if (!Number.isInteger(cap) || cap < 1 || cap > 5000) return bad(res, 400, 'Capacity must be a whole number from 1 to 5000.');
      // Same calendar day as existing sessions: share their day (so the schedule groups them together).
      const ymd = a.toISOString().slice(0, 10), dayFrom = ymd + 'T00:00:00Z', dayTo = new Date(Date.parse(dayFrom) + 86400000).toISOString();
      const { data: same, error: e1 } = await admin.from('sessions').select('day_key').gte('starts_at', dayFrom).lt('starts_at', dayTo).limit(1);
      if (e1) throw e1;
      const day = (same && same[0] && same[0].day_key) || 'd' + ymd.replace(/-/g, '');
      const row = {
        id: 'open-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), track: 'open', day_key: day,
        slot: a.getUTCHours() * 100 + a.getUTCMinutes(), title, grasag: false, capacity: cap,
        starts_at: a.toISOString(), ends_at: b.toISOString()
      };
      const { error } = await admin.from('sessions').insert(row);
      if (error) throw error;
      return res.status(200).json({ ok: true, session: row });
    }
    if (body.action === 'delete') {
      // Only an open session, and only while nobody is booked (a booked seat is never removed silently).
      const sid = String(body.session_id || '');
      const { data: s, error: e1 } = await admin.from('sessions').select('id, track, booked').eq('id', sid).maybeSingle();
      if (e1) throw e1;
      if (!s) return bad(res, 400, 'Unknown session.');
      if (s.track !== 'open') return bad(res, 400, 'Only open sessions created here can be deleted.');
      if (s.booked > 0) return bad(res, 400, 'Students have booked this session, so it cannot be deleted. Close it instead.');
      const { data: del, error } = await admin.from('sessions').delete().eq('id', sid).eq('booked', 0).select('id');
      if (error) throw error;
      if (!del || !del.length) return bad(res, 400, 'Someone booked this session just now, so it was not deleted. Close it instead.');
      return res.status(200).json({ ok: true });
    }
    return bad(res, 400, 'Unknown action.');
  } catch (e) {
    return bad(res, 400, (e && e.message) || 'Something went wrong.');
  }
};
