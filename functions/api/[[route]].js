// Cloudflare Pages Functions entry for every /api/* address.
// The handlers in /api were written for Vercel (Node-style req/res). This small adapter lets Cloudflare run
// the same files unchanged: it builds a req/res pair, calls the handler and turns the result into a Response.
// Environment variables (Supabase keys, MNOTIFY_*, CRON_SECRET) are read through process.env, which Cloudflare fills
// in because of the nodejs_compat flag (see wrangler.toml).
import config from '../../api/config.js';
import login from '../../api/login.js';
import staff from '../../api/staff.js';
import sessions from '../../api/sessions.js';
import notify from '../../api/notify.js';
import broadcast from '../../api/broadcast.js';
import remind from '../../api/remind.js';

const handlers = { config, login, staff, sessions, notify, broadcast, remind };

export async function onRequest({ request, params }) {
  const name = Array.isArray(params.route) ? params.route[0] : params.route;
  const handler = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : null;
  if (!handler) return new Response('Not found', { status: 404 });

  const url = new URL(request.url);
  const headers = {}; request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  const req = { method: request.method, headers, body, query: Object.fromEntries(url.searchParams) };

  return new Promise((resolve, reject) => {
    const out = new Headers(); let code = 200, done = false;
    const finish = (text) => { if (done) return; done = true; resolve(new Response(text, { status: code, headers: out })); };
    const res = {
      get statusCode() { return code; }, set statusCode(c) { code = c; },
      setHeader(k, v) { out.set(k, String(v)); return res; },
      status(c) { code = c; return res; },
      json(o) { out.set('Content-Type', 'application/json'); finish(JSON.stringify(o)); return res; },
      send(t) { finish(typeof t === 'string' ? t : JSON.stringify(t)); return res; },
      end(t) { finish(t == null ? '' : String(t)); return res; }
    };
    Promise.resolve(handler(req, res)).then(() => finish(''), reject);
  }).catch(() => new Response(JSON.stringify({ error: 'Something went wrong.' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
}
