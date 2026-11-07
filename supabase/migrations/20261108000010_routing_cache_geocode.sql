-- 3b: route cache access for server routing code, and geocoded exact points for locations.
-- The app never uses the service role, so the cache is reached through these RPCs only.

-- Cache read: signed-in active users; entries older than 24 h are ignored.
create or replace function public.get_cached_route(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.route_cache;
begin
  perform public.require_active_user();
  select * into r from public.route_cache where cache_key = p_key and created_at > now() - interval '24 hours';
  if not found then
    return null;
  end if;
  return jsonb_build_object('provider', r.provider, 'duration_s', r.duration_s,
    'distance_m', r.distance_m, 'legs', r.legs);
end;
$$;

-- Cache write: only real provider results ('ors'); DEMO fixtures are never cached.
-- Values are bounds-checked. Known limit: any active user could store a wrong estimate for a key (D29).
create or replace function public.put_cached_route(
  p_key text, p_provider text, p_duration_s integer, p_distance_m integer, p_legs jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_active_user();
  if p_provider is distinct from 'ors' then
    raise exception 'Only provider results are cached' using errcode = '22023';
  end if;
  if p_key is null or length(p_key) not between 8 and 200
     or p_duration_s not between 0 and 86400 or p_distance_m not between 0 and 2000000
     or (p_legs is not null and (jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) > 10)) then
    raise exception 'Invalid route' using errcode = '22023';
  end if;
  insert into public.route_cache (cache_key, provider, duration_s, distance_m, legs)
  values (p_key, p_provider, p_duration_s, p_distance_m, p_legs)
  on conflict (cache_key) do update
    set provider = excluded.provider, duration_s = excluded.duration_s, distance_m = excluded.distance_m,
        legs = excluded.legs, created_at = now(), updated_at = now();
end;
$$;

-- A changed address invalidates its geocoded point.
create or replace function public.clear_stale_exact_point()
returns trigger
language plpgsql
as $$
begin
  if new.exact_address is distinct from old.exact_address then
    new.exact_point := null;
  end if;
  return new;
end;
$$;
create trigger location_private_clear_point before update on public.location_private
  for each row execute function public.clear_stale_exact_point();

-- Coordinator stores the geocoded point for a location's private address.
create or replace function public.set_location_exact_point(p_location_id uuid, p_lat double precision, p_lng double precision)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  loc public.locations;
begin
  select * into loc from public.locations where id = p_location_id;
  if not found or not public.is_active_coordinator(uid, loc.org_id) then
    raise exception 'Location not found' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -39.5 and -33.9 or p_lng not between 140.9 and 150.1 then
    raise exception 'That point is outside Victoria' using errcode = '22023';
  end if;
  update public.location_private
    set exact_point = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, updated_at = now()
  where location_id = loc.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'location.geocode', 'location', loc.id, loc.org_id, jsonb_build_object('has_point', true));
end;
$$;

revoke all on function public.get_cached_route(text) from public, anon;
revoke all on function public.put_cached_route(text, text, integer, integer, jsonb) from public, anon;
revoke all on function public.set_location_exact_point(uuid, double precision, double precision) from public, anon;
grant execute on function public.get_cached_route(text) to authenticated;
grant execute on function public.put_cached_route(text, text, integer, integer, jsonb) to authenticated;
grant execute on function public.set_location_exact_point(uuid, double precision, double precision) to authenticated;
