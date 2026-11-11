// Sending SMS through mNotify (https://mnotify.com) with plain fetch: no extra library needed.
// Settings (Vercel environment variables): MNOTIFY_API_KEY, optional MNOTIFY_SENDER (a Sender ID registered in
// the mNotify dashboard, 11 characters at most; "mNotify" is used until you have your own).

const TRACK_CODE = { 'd1-coe': 'CoE', 'd1-cos': 'CoS', 'd2-cohss': 'CoHSS', 'd2-cabe': 'CABE', 'd3-cohs': 'CoHS', 'd3-canr': 'CANR/IDL' };

function configured() { return !!process.env.MNOTIFY_API_KEY; }

// Ghana numbers: "024 123 4567", "+233241234567", "233241234567" and "241234567" all become "0241234567".
// Anything else returns '' (the number cannot be texted).
function normalizePhone(p) {
  let d = String(p == null ? '' : p).replace(/[^0-9]/g, '');
  if (d.startsWith('00233')) d = d.slice(5);
  else if (d.startsWith('233')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return /^[2-5][0-9]{8}$/.test(d) ? '0' + d : '';
}

// Ghana time is GMT, so UTC formatting is Ghana time.
function when(s) {
  const a = new Date(s.starts_at), b = new Date(s.ends_at);
  const day = a.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const hm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return { day, time: hm(a) + '-' + hm(b) };
}
function label(s) { return s.grasag ? 'GRASAG Session' : (TRACK_CODE[s.track] || s.track) + ' ' + s.title; }

const NOLINK = 'Your joining link will be sent before the session.';
const templates = {
  // At registration no session is chosen yet, so the session, date and time parts wait for the booking text (confirm).
  welcome:   (name) => `Hi ${name}, you're registered for the Gemini Workshop. Your joining link will be sent before the session.`,
  confirm:   (name, s, link) => `Hi ${name}, you're registered for the Gemini Workshop: ${label(s)}, ${when(s).day}, ${when(s).time} GMT. ` + (link ? `Join link: ${link}` : NOLINK),
  reminder:  (name, s, link) => `Hi ${name}, reminder: your Gemini Workshop session (${label(s)}) is tomorrow, ${when(s).day}, ${when(s).time} GMT. ` + (link ? `Join link: ${link}` : NOLINK),
  // No name in the broadcast, so one message can go to 100 numbers in a single call.
  broadcast: (s, link) => `Gemini Workshop: ${label(s)}, ${when(s).day}, ${when(s).time} GMT. Join link: ${link}`
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One API call: the same message to up to 100 numbers. Returns { sent, failed } counts.
async function sendOne(numbers, message) {
  const base = process.env.MNOTIFY_API_BASE || 'https://api.mnotify.com';
  try {
    const r = await fetch(base + '/api/sms/quick?key=' + encodeURIComponent(process.env.MNOTIFY_API_KEY), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: numbers, sender: process.env.MNOTIFY_SENDER || 'mNotify', message, is_schedule: false, schedule_date: '' })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || String(j.code) !== '2000') return { sent: 0, failed: numbers.length, error: j.message || 'SMS service error' };
    const sum = j.summary || {}, rejected = Number(sum.total_rejected) || 0;
    return { sent: Math.max(0, numbers.length - rejected), failed: rejected, credits: sum.credit_left };
  } catch (e) { return { sent: 0, failed: numbers.length, error: 'Could not reach the SMS service' }; }
}

// items: [{ phone, message }]. Messages that are identical share calls of up to 100 numbers.
// Numbers that are not valid Ghana numbers count as failed. Returns { sent, failed, error, ok }, where ok[i]
// says whether item i went out in an accepted call (mNotify does not say which single number it rejected).
async function sendAll(items) {
  const groups = new Map(); let sent = 0, failed = 0, error = '', calls = 0;
  const ok = items.map(() => false);
  items.forEach((it, idx) => {
    const n = normalizePhone(it.phone);
    if (!n) { failed++; return; }
    if (!groups.has(it.message)) groups.set(it.message, []);
    groups.get(it.message).push({ n, idx });
  });
  for (const [message, list] of groups) {
    for (let i = 0; i < list.length; i += 100) {
      if (calls++) await sleep(300);
      const part = list.slice(i, i + 100);
      const r = await sendOne(part.map((p) => p.n), message);
      sent += r.sent; failed += r.failed; if (r.error) error = r.error;
      if (r.sent) part.forEach((p) => { ok[p.idx] = true; });
    }
  }
  return { sent, failed, error, ok };
}

module.exports = { configured, normalizePhone, templates, sendAll, label, when };
