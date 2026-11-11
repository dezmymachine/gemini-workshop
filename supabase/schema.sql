-- =====================================================================
-- Gemini & Google Workspace Workshop — Supabase database
-- Run this whole file once in Supabase: SQL Editor > New query > Run.
-- Safe to re-run: it drops and recreates the workshop objects
-- (this ERASES existing registrations, so only re-run before launch).
-- =====================================================================

drop trigger if exists on_auth_user_created on auth.users;
drop table if exists public.email_queue cascade;
drop table if exists public.session_broadcasts cascade;
drop table if exists public.email_log cascade;
drop table if exists public.session_links cascade;
drop table if exists public.bookings cascade;
drop table if exists public.students cascade;
drop table if exists public.staff cascade;
drop table if exists public.sessions cascade;
drop table if exists public.colleges cascade;

-- ---------- Reference data ----------
create table public.colleges (
  id    text primary key,
  name  text not null,
  track text not null
);

create table public.sessions (
  id        text primary key,
  track     text not null,
  day_key   text not null,
  slot      int  not null,
  title     text not null,
  grasag    boolean not null default false,
  capacity  int  not null default 400 check (capacity > 0),
  booked    int  not null default 0,          -- kept up to date by a trigger on bookings
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  check (booked >= 0 and booked <= capacity),
  check (ends_at > starts_at)
);

insert into public.colleges (id, name, track) values
  ('CoE',   'College of Engineering',                     'd1-coe'),
  ('CoS',   'College of Science',                         'd1-cos'),
  ('CoHSS', 'College of Humanities & Social Sciences',    'd2-cohss'),
  ('CABE',  'College of Art & Built Environment',         'd2-cabe'),
  ('CoHS',  'College of Health Sciences',                 'd3-cohs'),
  ('CANR',  'College of Agriculture & Natural Resources', 'd3-canr'),
  ('IDL',   'Distance Learning (IDL)',                    'd3-canr');

-- Times are Ghana time (GMT, +00)
insert into public.sessions (id, track, day_key, slot, title, grasag, capacity, starts_at, ends_at) values
  ('d1-coe-1','d1-coe','d1',1,'Session 1',false,400,'2026-11-17 10:00+00','2026-11-17 11:30+00'),
  ('d1-coe-2','d1-coe','d1',2,'Session 2',false,400,'2026-11-17 12:30+00','2026-11-17 14:00+00'),
  ('d1-coe-3','d1-coe','d1',3,'Session 3',false,400,'2026-11-17 15:00+00','2026-11-17 16:30+00'),
  ('d1-coe-4','d1-coe','d1',4,'Session 4',false,400,'2026-11-17 17:30+00','2026-11-17 19:00+00'),
  ('d1-cos-1','d1-cos','d1',1,'Session 1',false,400,'2026-11-17 10:00+00','2026-11-17 11:30+00'),
  ('d1-cos-2','d1-cos','d1',2,'Session 2',false,400,'2026-11-17 12:30+00','2026-11-17 14:00+00'),
  ('d1-cos-3','d1-cos','d1',3,'Session 3',false,400,'2026-11-17 15:00+00','2026-11-17 16:30+00'),
  ('d1-cos-4','d1-cos','d1',4,'Session 4',false,400,'2026-11-17 17:30+00','2026-11-17 19:00+00'),
  ('d2-cohss-1','d2-cohss','d2',1,'Session 1',false,400,'2026-11-18 10:00+00','2026-11-18 11:30+00'),
  ('d2-cohss-2','d2-cohss','d2',2,'Session 2',false,400,'2026-11-18 12:30+00','2026-11-18 14:00+00'),
  ('d2-cohss-3','d2-cohss','d2',3,'Session 3',false,400,'2026-11-18 15:00+00','2026-11-18 16:30+00'),
  ('d2-cohss-4','d2-cohss','d2',4,'Session 4',false,400,'2026-11-18 17:30+00','2026-11-18 19:00+00'),
  ('d2-cohss-5','d2-cohss','d2',5,'Session 5',false,400,'2026-11-18 19:30+00','2026-11-18 21:00+00'),
  ('d2-cabe-1','d2-cabe','d2',1,'Session 1',false,400,'2026-11-18 10:00+00','2026-11-18 11:30+00'),
  ('d2-cabe-2','d2-cabe','d2',2,'Session 2',false,400,'2026-11-18 12:30+00','2026-11-18 14:00+00'),
  ('d2-cabe-3','d2-cabe','d2',3,'Session 3',false,400,'2026-11-18 15:00+00','2026-11-18 16:30+00'),
  ('d2-cabe-4','d2-cabe','d2',4,'Session 4',false,400,'2026-11-18 17:30+00','2026-11-18 19:00+00'),
  ('d3-cohs-1','d3-cohs','d3',1,'Session 1',false,400,'2026-11-19 10:00+00','2026-11-19 11:30+00'),
  ('d3-cohs-2','d3-cohs','d3',2,'Session 2',false,400,'2026-11-19 12:30+00','2026-11-19 14:00+00'),
  ('d3-cohs-3','d3-cohs','d3',3,'Session 3',false,400,'2026-11-19 15:00+00','2026-11-19 16:30+00'),
  ('d3-cohs-4','d3-cohs','d3',4,'Session 4',false,400,'2026-11-19 17:30+00','2026-11-19 19:00+00'),
  ('d3-canr-1','d3-canr','d3',1,'Session 1',false,400,'2026-11-19 10:00+00','2026-11-19 11:30+00'),
  ('d3-canr-2','d3-canr','d3',2,'Session 2',false,400,'2026-11-19 12:30+00','2026-11-19 14:00+00'),
  ('d3-canr-3','d3-canr','d3',3,'Session 3',false,400,'2026-11-19 15:00+00','2026-11-19 16:30+00'),
  ('d3-canr-4','d3-canr','d3',4,'Session 4',false,400,'2026-11-19 17:30+00','2026-11-19 19:00+00'),
  ('d1-grasag-1','d1-grasag','d1',1,'GRASAG Session',true,400,'2026-11-17 10:00+00','2026-11-17 11:30+00'),
  ('d2-grasag-1','d2-grasag','d2',1,'GRASAG Session',true,400,'2026-11-18 10:00+00','2026-11-18 11:30+00'),
  ('d3-grasag-1','d3-grasag','d3',1,'GRASAG Session',true,400,'2026-11-19 10:00+00','2026-11-19 11:30+00');

-- ---------- People ----------
create table public.students (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  student_number text not null check (length(trim(student_number)) > 0),
  student_key    text not null unique,          -- student number, upper-case, letters/digits only
  name           text not null check (length(trim(name)) > 0),
  email          text not null,
  phone          text not null check (length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 9),
  college        text not null references public.colleges(id),
  programme      text not null check (length(trim(programme)) > 0),
  level          text not null check (level in ('Level 100','Level 200','Level 300','Level 400','Level 500','Level 600','Postgraduate (Masters)','Postgraduate (PhD)')),
  created_at     timestamptz not null default now(),
  welcome_sent_at timestamptz,                  -- set once the welcome message has been sent
  email_status   text not null default 'ok' check (email_status in ('ok', 'bounced', 'complained')), -- SES bounce/complaint: text instead
  email_bad_at   timestamptz
);

create table public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  email      text not null,
  role       text not null check (role in ('super', 'organiser', 'coord')),
  college    text references public.colleges(id),
  created_at timestamptz not null default now(),
  check (role <> 'coord' or college is not null)
);

create table public.bookings (
  student_id uuid not null references public.students(user_id) on delete cascade,
  kind       text not null check (kind in ('college', 'grasag')),
  session_id text not null references public.sessions(id),
  created_at timestamptz not null default now(),
  primary key (student_id, kind)                -- one college seat + one GRASAG seat per student
);
create index bookings_session_idx on public.bookings(session_id);
create index students_college_idx on public.students(college);

-- Keep sessions.booked in step with the bookings table (inserts, switches, cancellations, deleted accounts)
create or replace function public.bookings_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('DELETE','UPDATE') then update sessions set booked = booked - 1 where id = old.session_id; end if;
  if tg_op in ('INSERT','UPDATE') then update sessions set booked = booked + 1 where id = new.session_id; end if;
  return null;
end $$;

create trigger bookings_count_trg
  after insert or delete or update of session_id on public.bookings
  for each row execute function public.bookings_count();

-- ---------- Helpers ----------
create or replace function public.norm_key(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from staff where user_id = auth.uid() $$;

create or replace function public.my_college() returns text
language sql stable security definer set search_path = public as
$$ select college from staff where user_id = auth.uid() $$;

-- New sign-ups marked as students get a student profile automatically
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if coalesce(m->>'kind', '') = 'student' then
    insert into students (user_id, student_number, student_key, name, email, phone, college, programme, level)
    values (new.id, trim(m->>'student_number'), norm_key(m->>'student_number'), trim(m->>'name'),
            new.email, trim(m->>'phone'), m->>'college', trim(m->>'programme'), m->>'level');
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Functions the website calls ----------
create or replace function public.student_number_taken(p_num text) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from students where student_key = norm_key(p_num)) $$;

create or replace function public.login_email(p_num text) returns text
language sql stable security definer set search_path = public as
$$ select email from students where student_key = norm_key(p_num) $$;

create or replace function public.session_counts() returns table (session_id text, booked int, capacity int)
language sql stable security definer set search_path = public as
$$ select id, booked, capacity from sessions $$;

create or replace function public.my_staff() returns table (name text, email text, role text, college text)
language sql stable security definer set search_path = public as
$$ select name, email, role, college from staff where user_id = auth.uid() $$;

-- Book a seat. Locks the session row so the capacity can never be exceeded,
-- even when many students book the last seats at the same moment.
create or replace function public.book_session(p_session text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me      students;
  ss      sessions;
  other   sessions;
  k       text;
  cur_sid text;
begin
  if auth.uid() is null then raise exception 'NOT_STUDENT'; end if;
  select * into me from students where user_id = auth.uid();
  if not found then raise exception 'NOT_STUDENT'; end if;

  select * into ss from sessions where id = p_session;
  if not found then raise exception 'NO_SESSION'; end if;
  k := case when ss.grasag then 'grasag' else 'college' end;

  -- Serialise this student's own bookings, then lock the old and new session rows
  -- in id order so two students swapping seats can never deadlock each other.
  perform pg_advisory_xact_lock(hashtext(me.user_id::text));
  select session_id into cur_sid from bookings where student_id = me.user_id and kind = k;
  if cur_sid = p_session then return; end if;
  perform 1 from sessions where id in (p_session, coalesce(cur_sid, p_session)) order by id for update;
  select * into ss from sessions where id = p_session;   -- fresh copy after the lock

  if ss.grasag then
    if me.level not like 'Postgraduate%' then raise exception 'NOT_POSTGRAD'; end if;
  elsif not exists (select 1 from colleges c where c.id = me.college and c.track = ss.track) then
    raise exception 'WRONG_COLLEGE';
  end if;

  select s.* into other from bookings b join sessions s on s.id = b.session_id
   where b.student_id = me.user_id and b.kind <> k;
  if other.id is not null and other.starts_at < ss.ends_at and ss.starts_at < other.ends_at then
    raise exception 'CLASH';
  end if;

  if ss.booked >= ss.capacity then raise exception 'SESSION_FULL'; end if;

  insert into bookings (student_id, kind, session_id) values (me.user_id, k, p_session)
  on conflict (student_id, kind) do update set session_id = excluded.session_id, created_at = now();
end $$;

create or replace function public.cancel_booking(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare cur_sid text;
begin
  if auth.uid() is null then return; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  select session_id into cur_sid from bookings where student_id = auth.uid() and kind = p_kind;
  if cur_sid is null then return; end if;
  perform 1 from sessions where id = cur_sid for update;
  delete from bookings where student_id = auth.uid() and kind = p_kind;
end $$;

revoke execute on function public.book_session(text)   from public, anon;
revoke execute on function public.cancel_booking(text) from public, anon;
revoke execute on function public.my_staff()           from public, anon;
grant  execute on function public.book_session(text)   to authenticated;
grant  execute on function public.cancel_booking(text) to authenticated;
grant  execute on function public.my_staff()           to authenticated;

-- The student-number -> email lookup is only used by the server (api/login.js, service role).
-- Keeping it callable by the public would let anyone harvest students' emails.
revoke execute on function public.login_email(text) from public, anon, authenticated;
grant  execute on function public.login_email(text) to service_role;

-- ---------- Row level security: who can read what ----------
alter table public.colleges enable row level security;
alter table public.sessions enable row level security;
alter table public.students enable row level security;
alter table public.staff    enable row level security;
alter table public.bookings enable row level security;

create policy "anyone reads colleges" on public.colleges for select using (true);
create policy "anyone reads sessions" on public.sessions for select using (true);

create policy "students read own profile" on public.students for select
  using (user_id = (select auth.uid()));
create policy "staff read students in scope" on public.students for select
  using ((select my_role()) in ('super', 'organiser') or ((select my_role()) = 'coord' and college = (select my_college())));

create policy "students read own bookings" on public.bookings for select
  using (student_id = (select auth.uid()));
create policy "staff read bookings in scope" on public.bookings for select
  using ((select my_role()) in ('super', 'organiser')
         or ((select my_role()) = 'coord' and exists (select 1 from students s where s.user_id = bookings.student_id and s.college = (select my_college()))));

create policy "staff read own row; super admins read all" on public.staff for select
  using (user_id = (select auth.uid()) or (select my_role()) = 'super');

-- No insert/update/delete policies: bookings only change through book_session / cancel_booking,
-- and staff accounts only change through the website's /api/staff function (service role).

-- ---------- Meeting links and email bookkeeping ----------
-- One meeting link (for example a Google Meet) per session. Kept in its own table because the
-- sessions table is readable by everyone, and the link must only reach staff and booked students.
create table public.session_links (
  session_id text primary key references public.sessions(id) on delete cascade,
  url        text not null check (url ~* '^https://'),
  updated_at timestamptz not null default now()
);

-- Which automatic messages (email or SMS) each student has already received (stops duplicates).
create table public.email_log (
  student_id uuid not null references public.students(user_id) on delete cascade,
  session_id text not null references public.sessions(id) on delete cascade,
  kind       text not null check (kind in ('confirm', 'reminder')),
  channel    text check (channel in ('email', 'sms')),   -- how the message reached the student
  sent_at    timestamptz not null default now(),
  primary key (student_id, session_id, kind)
);

-- One row each time staff press "Email link to booked students".
create table public.session_broadcasts (
  id         bigserial primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  sent_by    uuid references auth.users(id) on delete set null,
  sent_at    timestamptz not null default now(),
  sent       int not null default 0,
  failed     int not null default 0,
  total      int not null default 0,
  url        text,
  status     text not null default 'done' check (status in ('running', 'done'))
);
create index session_broadcasts_session_idx on public.session_broadcasts(session_id, sent_at desc);

alter table public.session_links      enable row level security;
alter table public.email_log          enable row level security;
alter table public.session_broadcasts enable row level security;

-- Students can read the link only for a session they have booked. Super admins and organisers can read all links.
create policy "students read links of their sessions" on public.session_links for select
  using (exists (select 1 from public.bookings b where b.student_id = (select auth.uid()) and b.session_id = session_links.session_id));
create policy "staff read links" on public.session_links for select
  using ((select public.my_role()) in ('super', 'organiser'));

-- One row per email waiting to go out (or already sent) for a broadcast.
create table public.email_queue (
  id           bigserial primary key,
  broadcast_id bigint not null references public.session_broadcasts(id) on delete cascade,
  student_id   uuid references public.students(user_id) on delete cascade,
  to_email     text,                             -- used when the student gets email (public mailbox)
  to_phone     text,
  name         text not null,
  status       text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts     int  not null default 0,
  claimed_at   timestamptz,
  sent_at      timestamptz
);
create index email_queue_progress_idx on public.email_queue(broadcast_id, status);
alter table public.email_queue enable row level security;   -- no policies: only the server can touch it

-- Takes the next batch of waiting emails for a broadcast. "skip locked" means two senders running at the
-- same moment never pick the same email, so nobody is emailed twice. Emails stuck "sending" for over
-- 2 minutes (a crashed sender) are picked up again, up to 3 attempts.
create or replace function public.claim_email_batch(p_broadcast bigint, p_n int) returns setof public.email_queue
language sql security definer set search_path = public as $$
  update email_queue q
     set status = 'sending', attempts = q.attempts + 1, claimed_at = now()
   where q.id in (
     select id from email_queue
      where broadcast_id = p_broadcast and attempts < 3
        and (status = 'pending' or (status = 'sending' and claimed_at < now() - interval '2 minutes'))
      order by id limit p_n for update skip locked)
  returning q.*;
$$;
revoke execute on function public.claim_email_batch(bigint, int) from public, anon, authenticated;
grant  execute on function public.claim_email_batch(bigint, int) to service_role;

-- No insert/update/delete policies anywhere: links and logs only change through the server functions (service role).
-- email_log and session_broadcasts have no policies at all, so only the server can read them.

-- ---------- Live updates for the staff portal ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_links') then
    alter publication supabase_realtime add table public.session_links;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'students') then
    alter publication supabase_realtime add table public.students;
  end if;
end $$;

-- =====================================================================
-- FIRST SUPER ADMIN (do this once, after running everything above)
-- 1. Supabase > Authentication > Users > Add user > Create new user
--    (enter your email + a password, tick "Auto Confirm User").
-- 2. Run this, with your own name and email:
--
-- insert into public.staff (user_id, name, email, role)
-- select id, 'Your Name', email, 'super' from auth.users where email = 'you@example.com';
-- =====================================================================
