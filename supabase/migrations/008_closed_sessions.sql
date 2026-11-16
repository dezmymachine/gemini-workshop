-- 008: staff can close a session to new bookings.
-- A closed session keeps everyone already booked (seat, link, reminders); students can still cancel or
-- switch out of it, but nobody can book or switch into it. Enforced here, inside book_session, so a stale
-- page or a hand-made request cannot get round it. Safe to run on a live database and safe to re-run.

alter table public.sessions add column if not exists closed boolean not null default false;

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

  if ss.closed then raise exception 'SESSION_CLOSED'; end if;

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

revoke execute on function public.book_session(text) from public, anon;
grant  execute on function public.book_session(text) to authenticated;
