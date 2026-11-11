// Amazon SES tells us about bounces and spam complaints through an SNS topic that posts here:
//   https://<site>/api/mail-events?key=<SES_EVENTS_SECRET>
// A permanent bounce or a complaint marks the student's email as bad, and from then on they get SMS instead.
// Every message is checked twice: the secret key in the URL, and Amazon's signature on the message itself.
const crypto = require('crypto');
const { adminClient, bodyOf } = require('./_lib');

const certCache = new Map();
// Only certificates served by Amazon SNS itself are trusted. SNS_CERT_HOST is for local tests only.
function trustedCertUrl(u) {
  try {
    const url = new URL(u);
    if (process.env.SNS_CERT_HOST) return url.host === process.env.SNS_CERT_HOST;
    return url.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname) && url.pathname.endsWith('.pem');
  } catch (e) { return false; }
}

function stringToSign(m) {
  const keys = m.Type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return keys.filter((k) => m[k] !== undefined).map((k) => k + '\n' + m[k] + '\n').join('');
}

async function verify(m) {
  if (!m || !m.Signature || !trustedCertUrl(m.SigningCertURL)) return false;
  let pem = certCache.get(m.SigningCertURL);
  if (!pem) {
    const r = await fetch(m.SigningCertURL); if (!r.ok) return false;
    pem = await r.text(); certCache.set(m.SigningCertURL, pem);
  }
  const v = crypto.createVerify(m.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1');
  v.update(stringToSign(m), 'utf8');
  try { return v.verify(pem, m.Signature, 'base64'); } catch (e) { return false; }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.SES_EVENTS_SECRET;
  if (req.method !== 'POST' || !secret || !safeEqual((req.query && req.query.key) || '', secret)) return res.status(403).json({ error: 'Not allowed.' });
  const m = bodyOf(req);
  if (!(await verify(m))) return res.status(403).json({ error: 'Bad signature.' });
  if (process.env.SES_TOPIC_ARN && m.TopicArn !== process.env.SES_TOPIC_ARN) return res.status(403).json({ error: 'Unknown topic.' });

  if (m.Type === 'SubscriptionConfirmation') {
    const r = await fetch(m.SubscribeURL).catch(() => null);
    return res.status(200).json({ ok: !!(r && r.ok), confirmed: !!(r && r.ok) });
  }
  if (m.Type !== 'Notification') return res.status(200).json({ ok: true });

  let ev = {}; try { ev = JSON.parse(m.Message); } catch (e) { return res.status(200).json({ ok: true }); }
  const type = ev.notificationType || ev.eventType;
  let status = null, addrs = [];
  if (type === 'Bounce' && ev.bounce && ev.bounce.bounceType === 'Permanent') { status = 'bounced'; addrs = (ev.bounce.bouncedRecipients || []).map((r) => r.emailAddress); }
  if (type === 'Complaint' && ev.complaint) { status = 'complained'; addrs = (ev.complaint.complainedRecipients || []).map((r) => r.emailAddress); }
  if (!status || !addrs.length) return res.status(200).json({ ok: true, ignored: type || 'unknown' });

  const admin = adminClient();
  if (!admin) return res.status(500).json({ error: 'Missing Supabase settings.' });
  let marked = 0;
  for (const a of addrs) {
    const email = String(a || '').trim().toLowerCase(); if (!email) continue;
    // ilike without wildcards = case-insensitive exact match (students typed their email in any case).
    const { data } = await admin.from('students').update({ email_status: status, email_bad_at: new Date().toISOString() })
      .ilike('email', email.replace(/[\\%_]/g, '\\$&')).select('user_id');
    marked += (data || []).length;
  }
  return res.status(200).json({ ok: true, status, marked });
};
