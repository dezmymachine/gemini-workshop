// Sending email through Resend (https://resend.com) with plain fetch: no extra library needed.
// Settings (Vercel environment variables): RESEND_API_KEY, MAIL_FROM, optional SITE_URL.

const TRACK_CODE = { 'd1-coe': 'CoE', 'd1-cos': 'CoS', 'd2-cohss': 'CoHSS', 'd2-cabe': 'CABE', 'd3-cohs': 'CoHS', 'd3-canr': 'CANR · IDL' };

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function configured() { return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM); }

// Ghana time is GMT, so UTC formatting is Ghana time.
function when(s) {
  const a = new Date(s.starts_at), b = new Date(s.ends_at);
  const day = a.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const hm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return { day, time: hm(a) + ' – ' + hm(b) };
}
function label(s) { return s.grasag ? 'GRASAG Session' : (TRACK_CODE[s.track] || s.track) + ' ' + s.title; }

function layout(name, intro, s, link, outro) {
  const w = when(s);
  const text = `Hi ${name},\n\n${intro}\n\n${label(s)}\n${w.day}, ${w.time} (Ghana time)\n` +
    (link ? `Join link: ${link}\n` : 'We will email you the join link before the session.\n') + (outro ? `\n${outro}\n` : '') +
    '\nGemini & Google Workspace Workshop';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#202124">
<h2 style="margin:0 0 12px">Gemini &amp; Google Workspace Workshop</h2>
<p>Hi ${esc(name)},</p><p>${esc(intro)}</p>
<div style="background:#E8F0FE;border-radius:10px;padding:14px 16px;margin:16px 0">
<strong>${esc(label(s))}</strong><br>${esc(w.day)}<br>${esc(w.time)} (Ghana time)</div>
${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#1A73E8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:22px;font-weight:bold">Join the session</a></p><p style="font-size:13px;color:#5F6368">Or copy this link: ${esc(link)}</p>` : '<p>We will email you the join link before the session.</p>'}
${outro ? `<p style="font-size:14px">${esc(outro)}</p>` : ''}
<p style="font-size:13px;color:#5F6368">Please sign in to your student Google account before the session.</p></div>`;
  return { html, text };
}

const OUTRO = 'Sign in to your student Google account before the session starts.';
const templates = {
  confirm:   (name, s, link) => ({ subject: `You're booked: ${label(s)}, ${when(s).day}`, ...layout(name, "You're booked. Here are your session details.", s, link, OUTRO) }),
  reminder:  (name, s, link) => ({ subject: `Reminder: your workshop session is tomorrow (${when(s).time})`, ...layout(name, 'A reminder that your session is tomorrow.', s, link, OUTRO) }),
  broadcast: (name, s, link) => ({ subject: `Join link for your workshop session: ${when(s).day}`, ...layout(name, 'Here is the link to join your session.', s, link, OUTRO) })
};

// messages: [{ to, subject, html, text }]. Sends in batches of 100. Returns { sent, failed }.
async function sendAll(messages) {
  const base = process.env.RESEND_API_BASE || 'https://api.resend.com';
  let sent = 0, failed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({ from: process.env.MAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }));
    try {
      const r = await fetch(base + '/emails/batch', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(chunk) });
      if (r.ok) sent += chunk.length; else failed += chunk.length;
    } catch (e) { failed += chunk.length; }
    if (i + 100 < messages.length) await new Promise((r) => setTimeout(r, 600)); // stay under Resend's rate limit
  }
  return { sent, failed };
}

module.exports = { configured, templates, sendAll, label, when };
