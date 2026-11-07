-- 6a: notification inbox (read through RPCs only), reminder preference, scheduled reminders and sweeps,
-- journey cleanup. Notification rows are still written inside the RPCs that cause them (notify_user /
-- notify_coordinators). Saved journeys and nearby / route-match notifications are not part of this migration.

-- ---------------------------------------------------------------- inbox reads and writes

create or replace function public.list_my_notifications(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select n.id, n.type, n.request_id, n.leg_id, n.read_at, n.created_at,
        r.reference, r.animal_name,
        (select a.id from public.transport_assignments a
          where a.leg_id = n.leg_id and a.volunteer_id = uid
          order by a.created_at desc limit 1) as assignment_id,
        case when r.id is not null and public.is_active_coordinator(uid, r.org_id) then r.org_id end as org_id
      from public.notifications n
      left join public.transport_requests r on r.id = n.request_id
      where n.user_id = uid
      order by n.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.count_my_unread_notifications()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return 0; end if;
  return (select count(*)::integer from public.notifications where user_id = uid and read_at is null);
end;
$$;

-- Marks the caller's own unread notifications read (all of them when p_ids is null). Other users' ids are ignored.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  n integer;
begin
  update public.notifications set read_at = now(), updated_at = now()
  where user_id = uid and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------- reminder preference

create or replace function public.get_my_notification_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object(
    'reminders_enabled',
    coalesce((select reminders_enabled from public.notification_preferences where user_id = uid), true)
  );
end;
$$;

create or replace function public.set_my_notification_preferences(p_reminders_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
begin
  if p_reminders_enabled is null then raise exception 'Choose on or off' using errcode = '22023'; end if;
  insert into public.notification_preferences (user_id, reminders_enabled)
  values (uid, p_reminders_enabled)
  on conflict (user_id) do update set reminders_enabled = excluded.reminders_enabled, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------- scheduled jobs (no client access)

-- 24 h reminder: pickup window opens in more than 2 h and at most 24 h (volunteer and coordinators).
-- 2 h reminder: pickup window opens within 2 h (volunteer). Only for confirmed, not yet started legs.
-- p_now exists so tests can fix the clock. Deduped per assignment and reminder.
create or replace function public.send_assignment_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  n integer := 0;
  kind text;
begin
  for a in
    select x.id as assignment_id, x.volunteer_id, l.id as leg_id, l.window_start,
           r.id as request_id, r.org_id
    from public.transport_assignments x
    join public.transport_legs l on l.id = x.leg_id
    join public.transport_requests r on r.id = l.request_id
    join public.profiles p on p.id = x.volunteer_id
    where x.status = 'confirmed' and l.status = 'confirmed'
      and l.window_start > p_now and l.window_start <= p_now + interval '24 hours'
      and p.account_status = 'active'
  loop
    kind := case when a.window_start <= p_now + interval '2 hours' then '2h' else '24h' end;
    if coalesce((select reminders_enabled from public.notification_preferences where user_id = a.volunteer_id), true) then
      perform public.notify_user(a.volunteer_id, 'reminder_' || kind, a.request_id, a.leg_id,
        'remind:' || a.assignment_id || ':' || kind);
      n := n + 1;
    end if;
    if kind = '24h' then
      perform public.notify_coordinators(a.org_id, 'reminder_24h', a.request_id, a.leg_id,
        'remind:' || a.assignment_id || ':24h', null);
    end if;
  end loop;
  return n;
end;
$$;

-- Journeys are private and kept for 7 days after departure (PLAN §3).
create or replace function public.delete_expired_journeys(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.journeys where depart_at < p_now - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.send_assignment_reminders(timestamptz) from public, anon, authenticated;
revoke all on function public.delete_expired_journeys(timestamptz) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'list_my_notifications(integer)', 'count_my_unread_notifications()', 'mark_notifications_read(uuid[])',
    'get_my_notification_preferences()', 'set_my_notification_preferences(boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- pg_cron
-- Lazy expiry inside the assignment RPCs stays (D11); cron makes the sweep and reminders happen without traffic.
create extension if not exists pg_cron;

select cron.schedule('pawlift-sweep-assignments', '*/5 * * * *', $$select public.sweep_expired_assignments()$$);
select cron.schedule('pawlift-reminders', '*/15 * * * *', $$select public.send_assignment_reminders()$$);
select cron.schedule('pawlift-journey-cleanup', '0 16 * * *', $$select public.delete_expired_journeys()$$);
