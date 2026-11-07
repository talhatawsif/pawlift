-- 4c fix: private details must not vanish when a request has no request_private row (seeded demo data).
create or replace function public.get_leg_private_details(p_leg_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  l public.transport_legs;
  r public.transport_requests;
begin
  if uid is null or (select account_status from public.profiles where id = uid) is distinct from 'active' then
    raise exception 'You no longer have access to these details' using errcode = '42501';
  end if;
  select * into l from public.transport_legs where id = p_leg_id;
  if not found or l.status not in ('confirmed','en_route','collected')
     or not exists (
       select 1 from public.transport_assignments a
       where a.leg_id = l.id and a.volunteer_id = uid and a.status = 'confirmed'
     ) then
    raise exception 'You no longer have access to these details' using errcode = '42501';
  end if;
  select * into r from public.transport_requests where id = l.request_id;
  return (
    select jsonb_build_object(
      'animal_name', r.animal_name, 'species', r.species,
      'handling_requirements', r.handling_requirements, 'carrier_requirements', r.carrier_requirements,
      'medical_notes', rp.medical_notes, 'coordinator_instructions', rp.coordinator_instructions,
      'pickup', jsonb_build_object(
        'label', lf.label_public, 'suburb', sf.name, 'address', pf.exact_address,
        'contact_name', pf.contact_name, 'contact_phone', pf.contact_phone, 'instructions', pf.instructions,
        'lat', st_y(pf.exact_point::geometry), 'lng', st_x(pf.exact_point::geometry)),
      'dropoff', jsonb_build_object(
        'label', lt.label_public, 'suburb', st_.name, 'address', pt.exact_address,
        'contact_name', pt.contact_name, 'contact_phone', pt.contact_phone, 'instructions', pt.instructions,
        'lat', st_y(pt.exact_point::geometry), 'lng', st_x(pt.exact_point::geometry))
    )
    from public.locations lf
    join public.suburbs sf on sf.id = lf.suburb_id
    left join public.location_private pf on pf.location_id = lf.id
    join public.locations lt on lt.id = l.to_location_id
    join public.suburbs st_ on st_.id = lt.suburb_id
    left join public.location_private pt on pt.location_id = lt.id
    left join public.request_private rp on rp.request_id = r.id
    where lf.id = l.from_location_id
  );
end;
$$;
revoke all on function public.get_leg_private_details(uuid) from public, anon;
grant execute on function public.get_leg_private_details(uuid) to authenticated;
