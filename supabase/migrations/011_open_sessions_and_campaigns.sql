-- 011: (1) open sessions that staff create and every college can book, as an extra seat;
--      (2) email campaigns: staff send a message (with an optional button) to chosen colleges.
-- Additive and safe on a live database; safe to re-run.

-- ---------- 1. Open sessions ----------
-- An open session is a sessions row with track = 'open'. Students hold at most one open seat (bookings kind 'open'),
-- on top of their college and GRASAG seats.
alter table public.bookings drop constraint if exists bookings_kind_check;
alter table public.bookings add constraint bookings_kind_check check (kind in ('college', 'grasag', 'open'));

create or replace function public.book_session(p_session text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me      students;
  ss      sessions;
  k       text;
  cur_sid text;
begin
  if auth.uid() is null then raise exception 'NOT_STUDENT'; end if;
  select * into me from students where user_id = auth.uid();
  if not found then raise exception 'NOT_STUDENT'; end if;

  select * into ss from sessions where id = p_session;
  if not found then raise exception 'NO_SESSION'; end if;
  k := case when ss.grasag then 'grasag' when ss.track = 'open' then 'open' else 'college' end;

  -- Serialise this student's own bookings, then lock the old and new session rows
  -- in id order so two students swapping seats can never deadlock each other.
  perform pg_advisory_xact_lock(hashtext(me.user_id::text));
  select session_id into cur_sid from bookings where student_id = me.user_id and kind = k;
  if cur_sid = p_session then return; end if;
  perform 1 from sessions where id in (p_session, coalesce(cur_sid, p_session)) order by id for update;
  select * into ss from sessions where id = p_session;   -- fresh copy after the lock

  if ss.closed then raise exception 'SESSION_CLOSED'; end if;

  if ss.grasag then
    if me.level not like 'Postgraduate%' then raise exception 'NOT_POSTGRAD'; end if;
  elsif ss.track <> 'open' and not exists (select 1 from colleges c where c.id = me.college and c.track = ss.track) then
    raise exception 'WRONG_COLLEGE';
  end if;

  -- No overlap with any other seat the student holds.
  if exists (select 1 from bookings b join sessions s on s.id = b.session_id
              where b.student_id = me.user_id and b.kind <> k
                and s.starts_at < ss.ends_at and ss.starts_at < s.ends_at) then
    raise exception 'CLASH';
  end if;

  if ss.booked >= ss.capacity then raise exception 'SESSION_FULL'; end if;

  insert into bookings (student_id, kind, session_id) values (me.user_id, k, p_session)
  on conflict (student_id, kind) do update set session_id = excluded.session_id, created_at = now();
end $$;

revoke execute on function public.book_session(text) from public, anon;
grant  execute on function public.book_session(text) to authenticated;

-- ---------- 2. Email campaigns ----------
create table if not exists public.campaigns (
  id         bigserial primary key,
  sent_by    uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  subject    text not null,
  body       text not null,
  cta_label  text,
  cta_url    text,
  colleges   text[] not null,
  filter     text not null default 'all' check (filter in ('all', 'booked', 'unbooked')),
  total      int not null default 0,
  sent       int not null default 0,
  failed     int not null default 0,
  status     text not null default 'running' check (status in ('running', 'done'))
);

create table if not exists public.campaign_queue (
  id          bigserial primary key,
  campaign_id bigint not null references public.campaigns(id) on delete cascade,
  student_id  uuid references public.students(user_id) on delete cascade,
  to_email    text,
  name        text not null,
  status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts    int  not null default 0,
  claimed_at  timestamptz,
  sent_at     timestamptz
);
create index if not exists campaign_queue_progress_idx on public.campaign_queue(campaign_id, status);

alter table public.campaigns      enable row level security;   -- no policies: only the server can touch them
alter table public.campaign_queue enable row level security;

create or replace function public.claim_campaign_batch(p_campaign bigint, p_n int) returns setof public.campaign_queue
language sql security definer set search_path = public as $$
  update campaign_queue q
     set status = 'sending', attempts = q.attempts + 1, claimed_at = now()
   where q.id in (
     select id from campaign_queue
      where campaign_id = p_campaign and attempts < 3
        and (status = 'pending' or (status = 'sending' and claimed_at < now() - interval '2 minutes'))
      order by id limit p_n for update skip locked)
  returning q.*;
$$;
revoke execute on function public.claim_campaign_batch(bigint, int) from public, anon, authenticated;
grant  execute on function public.claim_campaign_batch(bigint, int) to service_role;
