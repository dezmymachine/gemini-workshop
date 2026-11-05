// Hands the browser the public Supabase settings from Vercel's environment variables.
// The anon (publishable) key is safe to expose: row level security protects the data.
module.exports = (req, res) => {
  // Cached at Vercel's edge for 5 minutes, so thousands of page loads don't each run this function.
  // A new deployment (needed after changing environment variables) clears the cache.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || ''
  });
};
