-- 7a: release review fixes.
-- 1. Route cache is per user (D41): one user can no longer plant a wrong "live" estimate that others see.
-- 2. Pin search_path on the four remaining non-definer functions (advisor warning).
-- 3. admin_list_requests: read-only request oversight for platform admins, no private fields (D42).

-- ---------------------------------------------------------------- 1. per-user route cache
delete from public.route_cache;  -- cache only; safe to drop
alter table public.route_cache drop constraint route_cache_pkey;
alter table public.route_cache add column user_id uuid not null references auth.users (id) on delete cascade;
alter table public.route_cache add primary key (user_id, cache_key);

create or replace function public.get_cached_route(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  r public.route_cache;
begin
  select * into r from public.route_cache
  where user_id = uid and cache_key = p_key and created_at > now() - interval '24 hours';
  if not found then
    return null;
  end if;
  return jsonb_build_object('provider', r.provider, 'duration_s', r.duration_s,
    'distance_m', r.distance_m, 'legs', r.legs);
end;
$$;

create or replace function public.put_cached_route(
  p_key text, p_provider text, p_duration_s integer, p_distance_m integer, p_legs jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
begin
  if p_provider is distinct from 'ors' then
    raise exception 'Only provider results are cached' using errcode = '22023';
  end if;
  if p_key is null or length(p_key) not between 8 and 200
     or p_duration_s not between 0 and 86400 or p_distance_m not between 0 and 2000000
     or (p_legs is not null and (jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) > 10)) then
    raise exception 'Invalid route' using errcode = '22023';
  end if;
  insert into public.route_cache (user_id, cache_key, provider, duration_s, distance_m, legs)
  values (uid, p_key, p_provider, p_duration_s, p_distance_m, p_legs)
  on conflict (user_id, cache_key) do update
    set provider = excluded.provider, duration_s = excluded.duration_s, distance_m = excluded.distance_m,
        legs = excluded.legs, created_at = now(), updated_at = now();
end;
$$;

revoke all on function public.get_cached_route(text) from public, anon;
revoke all on function public.put_cached_route(text, text, integer, integer, jsonb) from public, anon;
grant execute on function public.get_cached_route(text) to authenticated;
grant execute on function public.put_cached_route(text, text, integer, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------- 2. pinned search_path
alter function public.block_verification_record_changes() set search_path = public;
alter function public.clear_stale_exact_point() set search_path = public;
alter function public.loc_check_text(text, text, text, text, text) set search_path = public;
alter function public.req_check_text(text, text, text, text, text) set search_path = public;

-- ---------------------------------------------------------------- 3. admin request oversight
-- Public-level fields plus status and the current driver's display name. No addresses, contacts,
-- medical notes or instructions: those stay behind admin_view_private_details (reason-gated, logged).
create or replace function public.admin_list_requests(p_status text default 'active', p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_admin();
  lim integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if p_status is null or p_status not in ('active', 'draft', 'completed', 'cancelled', 'all') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.updated_at desc) from (
      select r.id, r.reference, r.animal_name, r.species, r.urgency, r.status, r.is_demo,
        o.id as org_id, o.name as org_name,
        so.name as origin_suburb, sd.name as destination_suburb,
        l.window_start, l.window_end,
        r.published_at, r.completed_at, r.cancelled_at, r.updated_at,
        a.status as assignment_status, vp.display_name as volunteer_name
      from public.transport_requests r
      join public.organisations o on o.id = r.org_id
      left join public.locations lo on lo.id = r.origin_location_id
      left join public.suburbs so on so.id = lo.suburb_id
      left join public.locations ld on ld.id = r.destination_location_id
      left join public.suburbs sd on sd.id = ld.suburb_id
      left join public.transport_legs l on l.request_id = r.id
      left join lateral (
        select x.status, x.volunteer_id from public.transport_assignments x
        where x.leg_id = l.id and x.status in ('offered', 'reserved', 'confirmed', 'completed')
        order by x.created_at desc limit 1
      ) a on true
      left join public.profiles vp on vp.id = a.volunteer_id
      where case p_status
        when 'all' then true
        when 'active' then r.status in ('open', 'assigned', 'confirmed', 'en_route', 'collected', 'delivered')
        else r.status = p_status
      end
      order by r.updated_at desc
      limit lim
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_requests(text, integer) from public, anon;
grant execute on function public.admin_list_requests(text, integer) to authenticated;
