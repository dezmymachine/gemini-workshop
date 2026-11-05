-- Migration 003: send broadcast emails through a queue, in batches of 100.
-- Run AFTER migration 002. Safe to run on a live project (adds columns and a table; existing rows are kept).
-- Run in Supabase: SQL Editor > New query > Run.

alter table public.session_broadcasts add column if not exists total  int  not null default 0;
alter table public.session_broadcasts add column if not exists url    text;
alter table public.session_broadcasts add column if not exists status text not null default 'done' check (status in ('running', 'done'));
update public.session_broadcasts set total = sent + failed where total = 0;

-- One row per email waiting to go out (or already sent) for a broadcast.
create table if not exists public.email_queue (
  id           bigserial primary key,
  broadcast_id bigint not null references public.session_broadcasts(id) on delete cascade,
  student_id   uuid references public.students(user_id) on delete cascade,
  to_email     text not null,
  name         text not null,
  status       text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts     int  not null default 0,
  claimed_at   timestamptz,
  sent_at      timestamptz
);
create index if not exists email_queue_progress_idx on public.email_queue(broadcast_id, status);
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
