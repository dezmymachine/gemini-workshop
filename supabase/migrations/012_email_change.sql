-- 012: students can correct their email from their Profile. The new address is checked with a 6-digit code first.
-- One pending change per student; only the server touches this table. Additive and safe to re-run.
create table if not exists public.email_changes (
  user_id    uuid primary key references public.students(user_id) on delete cascade,
  new_email  text not null,
  code_hash  text not null,            -- sha256 of code + user id; the code itself is never stored
  expires_at timestamptz not null,     -- 15 minutes after the code was sent
  attempts   int not null default 0,   -- wrong codes typed (max 5)
  sent_count int not null default 1,   -- codes sent in the current hour (max 3)
  created_at timestamptz not null default now()
);
alter table public.email_changes enable row level security;   -- no policies: only the server can read or write it
