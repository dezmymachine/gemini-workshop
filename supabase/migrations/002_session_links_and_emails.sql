-- Migration 002: meeting links per session + email bookkeeping.
-- Safe to run on a live project (adds new tables only, touches no existing data).
-- Run in Supabase: SQL Editor > New query > Run.

-- One meeting link (for example a Google Meet) per session. Kept in its own table because the
-- sessions table is readable by everyone, and the link must only reach staff and booked students.
create table if not exists public.session_links (
  session_id text primary key references public.sessions(id) on delete cascade,
  url        text not null check (url ~* '^https://'),
  updated_at timestamptz not null default now()
);

-- Which automatic emails each student has already received (stops duplicates).
create table if not exists public.email_log (
  student_id uuid not null references public.students(user_id) on delete cascade,
  session_id text not null references public.sessions(id) on delete cascade,
  kind       text not null check (kind in ('confirm', 'reminder')),
  sent_at    timestamptz not null default now(),
  primary key (student_id, session_id, kind)
);

-- One row each time staff press "Email link to booked students".
create table if not exists public.session_broadcasts (
  id         bigserial primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  sent_by    uuid references auth.users(id) on delete set null,
  sent_at    timestamptz not null default now(),
  sent       int not null default 0,
  failed     int not null default 0
);
create index if not exists session_broadcasts_session_idx on public.session_broadcasts(session_id, sent_at desc);

alter table public.session_links      enable row level security;
alter table public.email_log          enable row level security;
alter table public.session_broadcasts enable row level security;

-- Students can read the link only for a session they have booked. Super admins and organisers can read all links.
drop policy if exists "students read links of their sessions" on public.session_links;
create policy "students read links of their sessions" on public.session_links for select
  using (exists (select 1 from public.bookings b where b.student_id = (select auth.uid()) and b.session_id = session_links.session_id));
drop policy if exists "staff read links" on public.session_links;
create policy "staff read links" on public.session_links for select
  using ((select public.my_role()) in ('super', 'organiser'));

-- No insert/update/delete policies anywhere: links and logs only change through the server functions (service role).
-- email_log and session_broadcasts have no policies at all, so only the server can read them.
