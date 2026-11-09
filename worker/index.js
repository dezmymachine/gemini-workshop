// Cloudflare Worker entry. Serves the static page (dist/) and runs the files in /api unchanged.
//  - /api/<name>  -> the Vercel-style handler api/<name>.js, through a small req/res adapter
//  - everything else is the page (assets); unknown addresses such as /register return index.html (see wrangler.toml)
//  - the daily cron trigger runs the reminder job directly (no HTTP call, no extra Worker)
// Settings (Supabase keys, MNOTIFY_*, CRON_SECRET) are read through process.env, which Cloudflare fills in
// because of the nodejs_compat flag.
import config from '../api/config.js';
import login from '../api/login.js';
import staff from '../api/staff.js';
import sessions from '../api/sessions.js';
import notify from '../api/notify.js';
import broadcast from '../api/broadcast.js';
import remind from '../api/remind.js';

const handlers = { config, login, staff, sessions, notify, broadcast, remind };

function run(handler, req) {
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = /^\/api\/([a-z]+)\/?$/.exec(url.pathname);
    const handler = m && Object.prototype.hasOwnProperty.call(handlers, m[1]) ? handlers[m[1]] : null;
    if (!handler) return url.pathname.startsWith('/api/') ? new Response('Not found', { status: 404 }) : env.ASSETS.fetch(request);

    const headers = {}; request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
    return run(handler, { method: request.method, headers, body, query: Object.fromEntries(url.searchParams) });
  },

  // Daily at 08:00 UTC (= Ghana time), see [triggers] in wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(remind, { method: 'GET', headers: { authorization: 'Bearer ' + (process.env.CRON_SECRET || '') }, query: {} }));
  }
};
