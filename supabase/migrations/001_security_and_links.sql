-- Migration 001 (step 1): stop the public from looking up a student's email by student number.
-- Safe to run on a live project (no data is touched). Run it in Supabase: SQL Editor > New query > Run.
-- IMPORTANT: deploy the new site code (api/login.js + index.html) BEFORE or together with this,
-- otherwise student sign-in stops working until the new code is live.

revoke execute on function public.login_email(text) from public, anon, authenticated;
grant  execute on function public.login_email(text) to service_role;
