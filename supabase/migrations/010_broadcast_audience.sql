-- 010: a link broadcast can go to everyone booked in a session, or only its undergraduates / postgraduates.
-- audience records which group each broadcast was for. Safe to run on a live database and to re-run.
alter table public.session_broadcasts add column if not exists audience text not null default 'all';
alter table public.session_broadcasts drop constraint if exists session_broadcasts_audience_check;
alter table public.session_broadcasts add constraint session_broadcasts_audience_check check (audience in ('all', 'ug', 'pg'));
