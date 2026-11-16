-- 009: remember which joining link each student was emailed, so a student who books (or switches back into)
-- a session after its link was broadcast still gets the link once. Safe to run on a live database and to re-run.

-- link_url: the joining link that message carried (null = it had no link).
alter table public.email_log add column if not exists link_url text;

-- New kind 'link': a "here is your joining link" email sent to someone who joined after the broadcast.
alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check check (kind in ('confirm', 'reminder', 'link'));

-- Looking up "was this student sent this broadcast?" by student.
create index if not exists email_queue_student_idx on public.email_queue(student_id);
