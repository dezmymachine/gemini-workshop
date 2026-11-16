// Every message to students goes out by email, from our own domain.
// Provider: Resend (https://resend.com) whenever RESEND_API_KEY is set. Settings (Vercel environment variables):
//   RESEND_API_KEY, MAIL_FROM (or RESEND_FROM), e.g. "Gemini Workshop <workshop@kecworkshops.com>", optional MAIL_REPLY_TO.
// Dormant fallback: SMTP (Amazon SES) through nodemailer, used only when there is no Resend key or MAIL_PROVIDER=smtp:
//   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS.
// MAIL_TRANSPORT=json is a dry run for local testing: nothing is sent, each message is printed to the log.
const crypto = require('crypto');
const nodemailer = require('nodemailer');

function dryRun() { return process.env.MAIL_TRANSPORT === 'json'; }
function provider() { return process.env.RESEND_API_KEY && process.env.MAIL_PROVIDER !== 'smtp' ? 'resend' : 'smtp'; }
function configured() {
  if (dryRun()) return true;
  if (provider() === 'resend') return true;
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);
}
function fromAddress() { return (provider() === 'resend' && process.env.RESEND_FROM) || process.env.MAIL_FROM || 'Gemini Workshop <workshop@kecworkshops.com>'; }
function replyAddress() {
  const m = /<([^>]+)>/.exec(fromAddress());
  return process.env.MAIL_REPLY_TO || (m ? m[1] : fromAddress());
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function normalizeEmail(e) { const v = String(e == null ? '' : e).trim().toLowerCase(); return EMAIL_RE.test(v) ? v : ''; }

// ---------- Session wording (Ghana time is GMT, so UTC formatting is Ghana time) ----------
const TRACK_CODE = { 'd1-coe': 'CoE', 'd1-cos': 'CoS', 'd2-cohss': 'CoHSS', 'd2-cabe': 'CABE', 'd3-cohs': 'CoHS', 'd3-canr': 'CANR/IDL' };
function when(s) {
  const a = new Date(s.starts_at), b = new Date(s.ends_at);
  const day = a.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const hm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return { day, time: hm(a) + '-' + hm(b) };
}
function label(s) { return s.grasag ? 'GRASAG Session' : (TRACK_CODE[s.track] || s.track) + ' ' + s.title; }

// ---------- Messages: a subject, a plain-text version and a simple HTML version ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NOLINK = 'Your joining link will be sent before the session.';

function sessionLine(s) { const w = when(s); return `${label(s)}, ${w.day}, ${w.time} GMT`; }

// Builds { subject, text, html } from a few short paragraphs. A paragraph can be { link } for the join button.
// (Check for an object: every string has a built-in .link() method, so p.link alone is always truthy.)
const isLink = (p) => p && typeof p === 'object' && !!p.link;
function compose(subject, paras) {
  const text = paras.map((p) => (isLink(p) ? `${p.text || 'Join link'}: ${p.link}` : p)).join('\n\n') +
    `\n\nGemini Workshop\nReply to this email if you have a question.`;
  const body = paras.map((p) => isLink(p)
    ? `<p style="margin:20px 0"><a href="${esc(p.link)}" style="background:#1a73e8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">${esc(p.button || 'Join the session')}</a></p><p style="margin:0 0 16px;font-size:13px;color:#5f6368">Or open this link: <a href="${esc(p.link)}" style="color:#1a73e8">${esc(p.link)}</a></p>`
    : `<p style="margin:0 0 16px">${esc(p)}</p>`).join('');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f8fc;font-family:Arial,Helvetica,sans-serif;color:#202124;font-size:15px;line-height:1.5">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px">` +
    `<p style="margin:0 0 20px;font-weight:bold;font-size:18px">Gemini Workshop</p>${body}` +
    `<p style="margin:24px 0 0;font-size:13px;color:#5f6368">Reply to this email if you have a question.</p></div></body></html>`;
  return { subject, text, html };
}

const templates = {
  welcome: (name) => compose("You're registered: Gemini Workshop",
    [`Hi ${name}, you're registered for the Gemini Workshop.`, 'Sign in to choose your session if you have not done so yet. ' + NOLINK]),
  confirm: (name, s, link) => compose(`Booking confirmed: ${label(s)}`,
    [`Hi ${name}, you're registered for the Gemini Workshop: ${sessionLine(s)}.`, link ? { link } : NOLINK]),
  reminder: (name, s, link) => compose(`Tomorrow: your Gemini Workshop session (${label(s)})`,
    [`Hi ${name}, reminder: your Gemini Workshop session (${label(s)}) is tomorrow, ${when(s).day}, ${when(s).time} GMT.`, link ? { link } : NOLINK]),
  broadcast: (name, s, link) => compose(`Your Gemini Workshop link: ${label(s)}`,
    [`Hi ${name}, here is the joining link for your Gemini Workshop session: ${sessionLine(s)}.`, { link }]),
  // A session given to the student by the organisers (api/assign.js).
  assigned: (name, s, link) => compose(`Your Gemini Workshop session: ${label(s)}`,
    [`Hi ${name}, you registered for the Gemini Workshop but had not chosen a session, so the organisers have given you a seat: ${sessionLine(s)}.`,
     link ? { link } : NOLINK,
     'If this time does not suit you, sign in with your student number and password to change to another session.']),
  // For students who registered but have not chosen a session (tools/nudge-unbooked.js).
  nudge: (name, site) => compose('Choose your Gemini Workshop session',
    [`Hi ${name}, you registered for the Gemini Workshop but you have not chosen a session yet.`,
     'Sign in with your student number and password and pick a session. Seats are limited, so please book soon. Your joining link will be sent to you before your session.',
     { link: site, button: 'Choose my session', text: 'Sign in here' }])
};

// items: [{ email, subject, text, html, key? }]. One personalised message each.
// key: a stable id for the message (for example the queue row), used so a retried request is never sent twice.
// Returns { sent, failed, error, ok, refused }: ok[i] = item i went out; refused[i] = the address is refused for good
// (invalid, or the provider will not send to it), so it should not be tried again.
async function sendAll(items) {
  if (provider() === 'resend' && !dryRun()) return resendAll(items);
  return smtpAll(items);
}

// ---------- Resend ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One API call, retried on rate limits (429), server errors (5xx) and network errors: 3 retries, about 1 s, 2 s, 3 s apart
// (or what Retry-After asks for, up to 5 s). The Idempotency-Key makes those retries safe: Resend sends a key only once.
async function resendCall(path, body, idemKey) {
  let last = { ok: false, status: 0, error: 'Resend unreachable' };
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(last.wait || attempt * 1000);
    try {
      const headers = { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' };
      if (idemKey) headers['Idempotency-Key'] = idemKey;
      const r = await fetch('https://api.resend.com' + path, { method: 'POST', headers, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, status: r.status, error: '' };
      const ra = Number(r.headers && r.headers.get && r.headers.get('retry-after'));
      last = { ok: false, status: r.status, error: j.message || j.name || ('Resend error ' + r.status), wait: ra > 0 ? Math.min(ra, 5) * 1000 : 0 };
      if (r.status !== 429 && r.status < 500) return last;   // 4xx: retrying the same request will not help
    } catch (e) { last = { ok: false, status: 0, error: (e && e.message) || 'Resend unreachable' }; }
  }
  return last;
}

// Same messages (same keys and content) = same Idempotency-Key. Only when every message has a key.
function idemKeyFor(msgs, keys) {
  if (!keys.length || keys.some((k) => !k)) return '';
  return crypto.createHash('sha256').update(JSON.stringify([keys, msgs])).digest('hex');
}

// A 400/422 that is about the recipient ("Invalid `to` field…"). Any other validation error (a wrong sender, a bad
// setting) is our fault, not the student's, so it must never mark addresses as refused: it is retried later instead.
function badRecipient(r) { return (r.status === 422 || r.status === 400) && /`to`|\bto\b field|recipient/i.test(r.error || ''); }

async function resendAll(items) {
  let sent = 0, failed = 0, error = '';
  const ok = items.map(() => false), refused = items.map(() => false);
  const from = fromAddress(), replyTo = replyAddress();
  const msg = (it) => ({
    from, to: [normalizeEmail(it.email)], reply_to: replyTo, subject: it.subject, text: it.text, html: it.html,
    headers: { 'List-Unsubscribe': `<mailto:${replyTo}?subject=unsubscribe>` }
  });
  const idx = [];
  items.forEach((it, i) => { if (normalizeEmail(it.email)) idx.push(i); else { failed++; refused[i] = true; } });

  async function one(i) {
    const m = msg(items[i]);
    const r = await resendCall('/emails', m, idemKeyFor([m], [items[i].key]));
    if (r.ok) { sent++; ok[i] = true; return; }
    failed++; error = r.error;
    if (badRecipient(r)) refused[i] = true;   // Resend rejected this address itself: do not retry it
  }
  for (let k = 0; k < idx.length; k += 100) {
    const chunk = idx.slice(k, k + 100);
    if (chunk.length === 1) { await one(chunk[0]); continue; }
    const msgs = chunk.map((i) => msg(items[i]));
    const r = await resendCall('/emails/batch', msgs, idemKeyFor(msgs, chunk.map((i) => items[i].key)));
    if (r.ok) { chunk.forEach((i) => { sent++; ok[i] = true; }); continue; }
    if (badRecipient(r)) { for (const i of chunk) await one(i); continue; }   // one bad address in the batch: find it
    failed += chunk.length; error = r.error;   // rate limit / outage / in progress (409): left for a later attempt
  }
  return { sent, failed, error, ok, refused };
}

// ---------- SMTP (dormant fallback, also the local dry run) ----------
let transport = null;
function getTransport() {
  if (transport) return transport;
  transport = dryRun()
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465, requireTLS: (Number(process.env.SMTP_PORT) || 587) === 587,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        pool: true, maxConnections: 3, rateDelta: 1000, rateLimit: 10   // SES starts at 14 a second; stay under it
      });
  return transport;
}

async function smtpAll(items) {
  const t = getTransport(); let sent = 0, failed = 0, error = '';
  const ok = items.map(() => false), refused = items.map(() => false);
  const from = fromAddress(), replyTo = replyAddress();
  await Promise.all(items.map(async (it, i) => {
    const to = normalizeEmail(it.email);
    if (!to) { failed++; refused[i] = true; return; }
    try {
      const info = await t.sendMail({
        from, to, replyTo, subject: it.subject, text: it.text, html: it.html,
        headers: { 'List-Unsubscribe': `<mailto:${replyTo}?subject=unsubscribe>` }
      });
      if (dryRun()) console.log('[mail dry run]', info.message);
      sent++; ok[i] = true;
    } catch (e) {
      failed++; error = (e && e.message) || 'Email service error';
      // 5xx from SES = this address is refused for good (for example on the suppression list); 4xx / network = try later.
      if (e && e.responseCode >= 500 && e.responseCode < 600 && !/auth|credential|throttl|rate|quota|not verified|sandbox/i.test(error)) refused[i] = true;
    }
  }));
  return { sent, failed, error, ok, refused };
}

module.exports = { configured, normalizeEmail, templates, sendAll, label, when };
