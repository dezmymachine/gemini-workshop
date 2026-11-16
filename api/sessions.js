// Session settings for staff (super admins and organisers): meeting links, and closing a session to new bookings.
const { bad, bodyOf, requireStaff, validLink } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ctx = await requireStaff(req, res); if (!ctx) return;
  const { admin } = ctx, body = bodyOf(req);

  try {
    if (body.action === 'list') {
      const { data: links, error } = await admin.from('session_links').select('session_id, url');
      if (error) throw error;
      const { data: bc, error: e2 } = await admin.from('session_broadcasts').select('id, session_id, sent_at, total, sent, failed, status').order('id', { ascending: false }).limit(2000);
      if (e2) throw e2;
      const last = {};
      (bc || []).forEach((r) => { if (!last[r.session_id]) last[r.session_id] = { id: r.id, at: r.sent_at, total: r.total, sent: r.sent, failed: r.failed, status: r.status, pending: Math.max(0, r.total - r.sent - r.failed) }; });
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
    return bad(res, 400, 'Unknown action.');
  } catch (e) {
    return bad(res, 400, (e && e.message) || 'Something went wrong.');
  }
};
