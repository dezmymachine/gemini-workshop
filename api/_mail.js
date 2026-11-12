// Sending email over SMTP (Amazon SES) with nodemailer, from our own domain.
// Settings (Vercel environment variables): SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS (SES "SMTP credentials",
// not the AWS access key) and MAIL_FROM, e.g. "Gemini Workshop <workshop@kecworkshops.com>".
// MAIL_TRANSPORT=json is a dry run for local testing: nothing is sent, each message is printed to the log.
//
// TEMPORARY (until Amazon SES approves production access): when RESEND_API_KEY is set, email goes through Resend
// instead of SMTP, and only for the kinds in RESEND_KINDS (default: welcome,confirm = registration and booking).
// To go back to SES: delete RESEND_API_KEY in Vercel (or set MAIL_PROVIDER=smtp) and redeploy. No code change.
const nodemailer = require('nodemailer');
const { label, when } = require('./_sms');

function dryRun() { return process.env.MAIL_TRANSPORT === 'json'; }
function provider() { return process.env.RESEND_API_KEY && process.env.MAIL_PROVIDER !== 'smtp' ? 'resend' : 'smtp'; }
function resendKinds() { return String(process.env.RESEND_KINDS || 'welcome,confirm').split(',').map((k) => k.trim()).filter(Boolean); }
// kind (optional): welcome | confirm | reminder | broadcast. Without it: "can email be sent at all?"
function configured(kind) {
  if (dryRun()) return true;
  if (provider() === 'resend') return !kind || resendKinds().includes(kind);
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);
}
function fromAddress() { return (provider() === 'resend' && process.env.RESEND_FROM) || process.env.MAIL_FROM || 'Gemini Workshop <workshop@kecworkshops.com>'; }
function replyAddress() {
  const m = /<([^>]+)>/.exec(fromAddress());
  return process.env.MAIL_REPLY_TO || (m ? m[1] : fromAddress());
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function normalizeEmail(e) { const v = String(e == null ? '' : e).trim().toLowerCase(); return EMAIL_RE.test(v) ? v : ''; }

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

// ---------- Messages: same wording as the texts, plus a subject and a simple HTML version ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NOLINK = 'Your joining link will be sent before the session.';

function sessionLine(s) { const w = when(s); return `${label(s)}, ${w.day}, ${w.time} GMT`; }

// Builds { subject, text, html } from a few short paragraphs. A paragraph can be { link } for the join button.
function compose(subject, paras) {
  const text = paras.map((p) => (p.link ? `Join link: ${p.link}` : p)).join('\n\n') +
    `\n\nGemini Workshop\nReply to this email if you have a question.`;
  const body = paras.map((p) => p.link
    ? `<p style="margin:20px 0"><a href="${esc(p.link)}" style="background:#1a73e8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">Join the session</a></p><p style="margin:0 0 16px;font-size:13px;color:#5f6368">Or open this link: <a href="${esc(p.link)}" style="color:#1a73e8">${esc(p.link)}</a></p>`
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
    [`Hi ${name}, here is the joining link for your Gemini Workshop session: ${sessionLine(s)}.`, { link }])
};

// items: [{ email, subject, text, html }]. Sends one message each (they are personalised).
// Returns { sent, failed, error, ok, refused }: ok[i] = item i went out; refused[i] = the address is refused for good
// (invalid, or SES will not send to it), so it should not be tried again.
async function sendAll(items) {
  if (provider() === 'resend' && !dryRun()) return resendAll(items);
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

// ---------- Resend (temporary) ----------
// One request per message when there is one; the batch endpoint (up to 100 per request) when there are more.
async function resendCall(path, body) {
  try {
    const r = await fetch('https://api.resend.com' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, error: r.ok ? '' : (j.message || j.name || ('Resend error ' + r.status)) };
  } catch (e) { return { ok: false, status: 0, error: (e && e.message) || 'Resend unreachable' }; }
}

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
    const r = await resendCall('/emails', msg(items[i]));
    if (r.ok) { sent++; ok[i] = true; return; }
    failed++; error = r.error;
    if (r.status === 422) refused[i] = true;   // Resend rejected this address/message itself: do not retry it
  }
  for (let k = 0; k < idx.length; k += 100) {
    const chunk = idx.slice(k, k + 100);
    if (chunk.length === 1) { await one(chunk[0]); continue; }
    const r = await resendCall('/emails/batch', chunk.map((i) => msg(items[i])));
    if (r.ok) { chunk.forEach((i) => { sent++; ok[i] = true; }); continue; }
    if (r.status === 422 || r.status === 400) { for (const i of chunk) await one(i); continue; }   // find the bad one
    chunk.forEach(() => failed++); error = r.error;   // rate limit / quota / outage: try again later
  }
  return { sent, failed, error, ok, refused };
}

module.exports = { configured, normalizeEmail, templates, sendAll };
