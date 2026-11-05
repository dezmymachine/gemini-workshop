-- Migration 004: lets the staff portal update itself the moment someone books or cancels (Supabase Realtime).
-- Safe to run more than once. Run in Supabase: SQL Editor > New query > Run.
-- Row level security still decides what each staff member receives, so a college coordinator
-- only hears about bookings from their own college.

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_links') then
    alter publication supabase_realtime add table public.session_links;
  end if;
end $$;
