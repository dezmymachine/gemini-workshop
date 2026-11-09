// Daily reminder trigger. Cloudflare Pages has no cron of its own, so this tiny separate Worker calls
// /api/remind once a day (the same job Vercel's cron runs). Needs SITE_URL and CRON_SECRET (see wrangler.toml).
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch(env.SITE_URL.replace(/\/$/, '') + '/api/remind', { headers: { Authorization: 'Bearer ' + env.CRON_SECRET } }));
  }
};
