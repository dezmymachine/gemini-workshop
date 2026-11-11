// Hands the browser the public Supabase settings from Vercel's environment variables.
// The anon (publishable) key is safe to expose: row level security protects the data.
// emailDomains lets the staff page show who gets email and who gets SMS with the same rule as the server.
const { emailDomains } = require('./_send');
module.exports = (req, res) => {
  // Cached at Vercel's edge for 5 minutes, so thousands of page loads don't each run this function.
  // A new deployment (needed after changing environment variables) clears the cache.
  const url = process.env.SUPABASE_URL || '', anonKey = process.env.SUPABASE_ANON_KEY || '';
  // Never cache an empty answer, so adding the variables fixes the site straight away.
  res.setHeader('Cache-Control', url && anonKey ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' : 'no-store');
  res.status(200).json({ url, anonKey, emailDomains: emailDomains() });
};
