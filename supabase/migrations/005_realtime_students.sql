-- Migration 005: the staff portal also hears about new registrations straight away.
-- Safe to run more than once. Run in Supabase: SQL Editor > New query > Run.
-- Row level security still applies: a college coordinator only receives their own college's students.

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'students') then
    alter publication supabase_realtime add table public.students;
  end if;
end $$;
