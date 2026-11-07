-- Public view: open, published requests only. No private columns, no exact points.
-- security_invoker = off so anon can read the view without table grants; the view
-- itself is the access boundary (explicit column list, open + published + not demo-mixed).
create view public.public_requests with (security_invoker = false) as
select
  r.id,
  r.reference,
  r.animal_name,
  r.species,
  r.photo_path,
  r.urgency,
  r.required_date,
  r.deadline,
  r.handling_requirements,
  r.carrier_requirements,
  r.is_demo,
  o.name as org_name,
  o.verification_status as org_verification_status,
  lo.label_public as origin_label,
  so.name as origin_suburb,
  st_y(lo.approx_point::geometry) as origin_lat,
  st_x(lo.approx_point::geometry) as origin_lng,
  ld.label_public as destination_label,
  sd.name as destination_suburb,
  st_y(ld.approx_point::geometry) as destination_lat,
  st_x(ld.approx_point::geometry) as destination_lng,
  (select min(l.window_start) from public.transport_legs l where l.request_id = r.id) as window_start,
  (select max(l.window_end) from public.transport_legs l where l.request_id = r.id) as window_end
from public.transport_requests r
join public.organisations o on o.id = r.org_id
join public.locations lo on lo.id = r.origin_location_id
join public.suburbs so on so.id = lo.suburb_id
join public.locations ld on ld.id = r.destination_location_id
join public.suburbs sd on sd.id = ld.suburb_id
where r.status = 'open' and r.published_at is not null;

revoke all on public.public_requests from anon, authenticated;
grant select on public.public_requests to anon, authenticated;
