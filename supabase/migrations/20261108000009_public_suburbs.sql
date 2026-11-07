-- 3a: public suburb search for the manual location fallback (works signed out).
-- Suburb names, postcodes and approximate centroids are public reference data. Read-only.
create or replace function public.list_public_suburbs(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'postcode', s.postcode,
    'lat', st_y(s.centroid::geometry), 'lng', st_x(s.centroid::geometry)
  ) order by s.name), '[]'::jsonb)
  from (
    select * from public.suburbs
    where btrim(coalesce(p_query, '')) = ''
       or lower(name) like lower(btrim(p_query)) || '%'
       or postcode like btrim(p_query) || '%'
    order by name limit 50
  ) s;
$$;

revoke all on function public.list_public_suburbs(text) from public;
grant execute on function public.list_public_suburbs(text) to anon, authenticated;
