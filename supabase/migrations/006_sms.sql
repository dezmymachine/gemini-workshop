-- Migration 006: messages go out by SMS (mNotify) instead of email. Run AFTER migration 005.
-- Safe on a live project: only adds columns and relaxes one rule; existing rows are kept.
-- Run in Supabase: SQL Editor > New query > Run.
-- (The tables keep their old names email_queue / email_log; they now hold text messages.)

alter table public.email_queue add column if not exists to_phone text;
update public.email_queue q set to_phone = s.phone from public.students s where q.student_id = s.user_id and q.to_phone is null;
alter table public.email_queue alter column to_email drop not null;

alter table public.students add column if not exists welcome_sent_at timestamptz;
