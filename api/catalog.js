// Public session list and seat counts, shared by every open page.
// Vercel's CDN keeps the answer for 5 seconds, so during a rush the database is asked about once every
// 5 seconds per region instead of once per open tab. Counts can be a few seconds old; booking still checks
// the real capacity in the database (book_session), so a stale number can never overbook a session.
const { adminClient } = require('./_lib');

module.exports = async (req, res) => {
  const admin = adminClient();
  if (!admin) { res.setHeader('Cache-Control', 'no-store'); return res.status(500).json({ error: 'The server is missing its Supabase settings.' }); }
  try {
    const [s, c] = await Promise.all([
      admin.from('sessions').select('id,track,day_key,slot,title,grasag,capacity,starts_at,ends_at').order('starts_at', { ascending: true }),
      admin.rpc('session_counts')
    ]);
    if (s.error) throw s.error;
    if (c.error) throw c.error;
    const counts = {}, capacity = {};
    (c.data || []).forEach((x) => { counts[x.session_id] = +x.booked; capacity[x.session_id] = +x.capacity; });
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=30');
    return res.status(200).json({ sessions: s.data || [], counts, capacity, at: new Date().toISOString() });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Busy, please try again.' });
  }
};
