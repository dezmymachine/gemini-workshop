-- Migration 007: email (Amazon SES) for students with a public mailbox such as Gmail, SMS for the rest.
-- Run AFTER migration 006. Safe on a live project: only adds columns; existing rows are kept.
-- Run in Supabase: SQL Editor > New query > Run.

-- 'ok' until SES reports a permanent bounce or a spam complaint; then the student is texted instead.
alter table public.students add column if not exists email_status text not null default 'ok';
alter table public.students drop constraint if exists students_email_status_check;
alter table public.students add constraint students_email_status_check check (email_status in ('ok', 'bounced', 'complained'));
alter table public.students add column if not exists email_bad_at timestamptz;

-- How each automatic message reached the student.
alter table public.email_log add column if not exists channel text check (channel in ('email', 'sms'));
