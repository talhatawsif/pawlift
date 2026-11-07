-- 2c: locations (public/private split), confirmed destinations, foster association and foster home.
-- All state changes go through security-definer RPCs that audit in the same transaction.

-- ---------------------------------------------------------------- suburb reference data
-- APPROXIMATE centroids typed by hand (unverified). Replace with an official dataset before launch.
insert into public.suburbs (name, postcode, centroid)
select v.name, v.postcode, st_setsrid(st_makepoint(v.lng, v.lat), 4326)::geography
from (values
  ('St Albans','3021',-37.744,144.800),('Sunshine','3020',-37.788,144.832),
  ('Sunshine West','3020',-37.790,144.810),('Footscray','3011',-37.800,144.900),
  ('Williamstown','3016',-37.857,144.896),('Altona','3018',-37.868,144.830),
  ('Altona Meadows','3028',-37.880,144.790),('Laverton','3028',-37.865,144.771),
  ('Werribee','3030',-37.900,144.660),('Werribee South','3030',-37.935,144.670),
  ('Hoppers Crossing','3029',-37.882,144.700),('Point Cook','3030',-37.907,144.752),
  ('Tarneit','3029',-37.832,144.694),('Truganina','3029',-37.810,144.737),
  ('Wyndham Vale','3024',-37.890,144.610),('Melton','3337',-37.683,144.580),
  ('Caroline Springs','3023',-37.737,144.737),('Deer Park','3023',-37.775,144.771),
  ('Sydenham','3037',-37.703,144.774),('Taylors Lakes','3038',-37.708,144.800),
  ('Keilor','3036',-37.722,144.830),('Kealba','3021',-37.730,144.812),
  ('Albanvale','3021',-37.745,144.775),('Kings Park','3021',-37.725,144.775),
  ('Maribyrnong','3032',-37.775,144.890),('Avondale Heights','3034',-37.775,144.865),
  ('Braybrook','3019',-37.784,144.857),('Yarraville','3013',-37.815,144.889),
  ('Newport','3015',-37.842,144.885),('Brooklyn','3012',-37.828,144.848),
  ('Tullamarine','3043',-37.700,144.880),('Essendon','3040',-37.754,144.915),
  ('Melbourne','3000',-37.814,144.963),('Sunbury','3429',-37.578,144.727),
  ('Bacchus Marsh','3340',-37.675,144.437),('Little River','3211',-37.965,144.507),
  ('Lara','3212',-38.025,144.407),('Corio','3214',-38.103,144.360),
  ('Geelong','3220',-38.150,144.361),('Torquay','3228',-38.330,144.327)
) as v(name, postcode, lat, lng)
on conflict (name, postcode) do nothing;

create or replace function public.list_suburbs(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(btrim(coalesce(p_query, '')));
begin
  if auth.uid() is null then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'postcode', s.postcode) order by s.name)
    from (
      select * from public.suburbs
      where q = '' or lower(name) like q || '%' or postcode like q || '%'
      order by name limit 100
    ) s
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- helpers

-- Shared validation for create/update. Returns the org row after confirming the caller coordinates it.
create or replace function public.loc_check_text(p_label text, p_address text, p_name text, p_phone text, p_instr text)
returns void
language plpgsql
immutable
as $$
begin
  if p_label is null or char_length(btrim(p_label)) not between 2 and 80 then
    raise exception 'Public label must be 2 to 80 characters' using errcode = '22023';
  end if;
  if p_address is null or char_length(btrim(p_address)) not between 5 and 200 then
    raise exception 'Exact address must be 5 to 200 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(p_name, '')) > 100 or char_length(coalesce(p_phone, '')) > 30
     or char_length(coalesce(p_instr, '')) > 1000 then
    raise exception 'Contact or instruction text too long' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------- locations

create or replace function public.create_location(
  p_org_id uuid,
  p_kind text,
  p_label_public text,
  p_suburb_id uuid,
  p_exact_address text,
  p_contact_name text,
  p_contact_phone text,
  p_instructions text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  org public.organisations;
  sub public.suburbs;
  loc_id uuid;
begin
  select * into org from public.organisations where id = p_org_id;
  if not found or not public.is_active_coordinator(uid, p_org_id) then
    raise exception 'Organisation not found' using errcode = '42501';
  end if;
  if org.verification_status <> 'verified' then
    raise exception 'Only a verified organisation can add locations' using errcode = '55000';
  end if;
  if p_kind not in ('pound','shelter','rescue_facility','vet','handover_point','other') then
    raise exception 'Invalid location kind' using errcode = '22023';
  end if;
  select * into sub from public.suburbs where id = p_suburb_id;
  if not found then
    raise exception 'Choose a suburb' using errcode = '22023';
  end if;
  perform public.loc_check_text(p_label_public, p_exact_address, p_contact_name, p_contact_phone, p_instructions);
  if (select count(*) from public.locations where org_id = p_org_id) >= 50 then
    raise exception 'Too many locations' using errcode = '54000';
  end if;

  insert into public.locations (org_id, kind, label_public, suburb_id, approx_point, is_demo)
  values (p_org_id, p_kind, btrim(p_label_public), sub.id, sub.centroid, org.is_demo)
  returning id into loc_id;
  insert into public.location_private (location_id, exact_address, contact_name, contact_phone, instructions)
  values (loc_id, btrim(p_exact_address), nullif(btrim(coalesce(p_contact_name, '')), ''),
          nullif(btrim(coalesce(p_contact_phone, '')), ''), nullif(btrim(coalesce(p_instructions, '')), ''));

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'location.create', 'location', loc_id, p_org_id,
    jsonb_build_object('kind', p_kind, 'label', btrim(p_label_public), 'suburb_id', sub.id));
  return loc_id;
end;
$$;

create or replace function public.update_location(
  p_location_id uuid,
  p_label_public text,
  p_suburb_id uuid,
  p_exact_address text,
  p_contact_name text,
  p_contact_phone text,
  p_instructions text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  loc public.locations;
  priv public.location_private;
  sub public.suburbs;
  unconfirm boolean;
begin
  select * into loc from public.locations where id = p_location_id for update;
  if not found or not public.is_active_coordinator(uid, loc.org_id) then
    raise exception 'Location not found' using errcode = '42501';
  end if;
  if loc.kind = 'foster_home' then
    raise exception 'Foster homes are edited from the member list' using errcode = '55000';
  end if;
  select * into sub from public.suburbs where id = p_suburb_id;
  if not found then
    raise exception 'Choose a suburb' using errcode = '22023';
  end if;
  perform public.loc_check_text(p_label_public, p_exact_address, p_contact_name, p_contact_phone, p_instructions);
  select * into priv from public.location_private where location_id = loc.id;
  -- Any change to where it is invalidates a prior confirmation.
  unconfirm := loc.is_confirmed_destination
    and (loc.suburb_id <> sub.id or priv.exact_address is distinct from btrim(p_exact_address));

  update public.locations set
    label_public = btrim(p_label_public), suburb_id = sub.id, approx_point = sub.centroid,
    is_confirmed_destination = case when unconfirm then false else is_confirmed_destination end,
    confirmed_by = case when unconfirm then null else confirmed_by end,
    confirmed_at = case when unconfirm then null else confirmed_at end,
    updated_at = now()
  where id = loc.id;
  update public.location_private set
    exact_address = btrim(p_exact_address),
    contact_name = nullif(btrim(coalesce(p_contact_name, '')), ''),
    contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
    instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
    updated_at = now()
  where location_id = loc.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, before, after)
  values (uid, 'location.update', 'location', loc.id, loc.org_id,
    jsonb_build_object('label', loc.label_public, 'suburb_id', loc.suburb_id),
    jsonb_build_object('label', btrim(p_label_public), 'suburb_id', sub.id, 'confirmation_cleared', unconfirm));
end;
$$;

create or replace function public.confirm_destination(p_location_id uuid, p_confirm boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  loc public.locations;
  org_status text;
begin
  select * into loc from public.locations where id = p_location_id for update;
  if not found or not public.is_active_coordinator(uid, loc.org_id) then
    raise exception 'Location not found' using errcode = '42501';
  end if;
  if p_confirm then
    select verification_status into org_status from public.organisations where id = loc.org_id;
    if org_status <> 'verified' then
      raise exception 'Organisation is not verified' using errcode = '55000';
    end if;
    if loc.kind = 'handover_point' then
      raise exception 'A handover point cannot be a final destination' using errcode = '55000';
    end if;
    if loc.kind = 'foster_home' and not exists (
      select 1 from public.organisation_members m
      where m.org_id = loc.org_id and m.user_id = loc.linked_user_id
        and m.status = 'active' and m.is_foster_carer
    ) then
      raise exception 'The foster carer is not approved' using errcode = '55000';
    end if;
  end if;
  update public.locations set
    is_confirmed_destination = p_confirm,
    confirmed_by = case when p_confirm then uid else null end,
    confirmed_at = case when p_confirm then now() else null end,
    updated_at = now()
  where id = loc.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, case when p_confirm then 'location.confirm' else 'location.unconfirm' end,
    'location', loc.id, loc.org_id, jsonb_build_object('kind', loc.kind));
end;
$$;

create or replace function public.list_org_locations(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_active_coordinator(uid, p_org_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'kind', l.kind, 'label_public', l.label_public,
      'suburb_id', l.suburb_id, 'suburb', s.name, 'postcode', s.postcode,
      'is_confirmed_destination', l.is_confirmed_destination, 'confirmed_at', l.confirmed_at,
      'linked_user_id', l.linked_user_id,
      'exact_address', p.exact_address, 'contact_name', p.contact_name,
      'contact_phone', p.contact_phone, 'instructions', p.instructions
    ) order by l.kind, l.label_public)
    from public.locations l
    join public.suburbs s on s.id = l.suburb_id
    left join public.location_private p on p.location_id = l.id
    where l.org_id = p_org_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- foster carers

create or replace function public.set_foster_status(p_member_id uuid, p_is_foster boolean, p_can_confirm_receipt boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  mem public.organisation_members;
  org_status text;
begin
  select * into mem from public.organisation_members where id = p_member_id for update;
  if not found or not public.is_active_coordinator(uid, mem.org_id) then
    raise exception 'Member not found' using errcode = '42501';
  end if;
  if mem.status <> 'active' then
    raise exception 'Only an active member can be a foster carer' using errcode = '55000';
  end if;
  if p_is_foster then
    select verification_status into org_status from public.organisations where id = mem.org_id;
    if org_status <> 'verified' then
      raise exception 'Organisation is not verified' using errcode = '55000';
    end if;
  end if;

  update public.organisation_members set
    is_foster_carer = p_is_foster,
    foster_can_confirm_receipt = p_is_foster and coalesce(p_can_confirm_receipt, false),
    foster_approved_by = case when p_is_foster then uid else null end,
    foster_approved_at = case when p_is_foster then coalesce(foster_approved_at, now()) else null end
  where id = mem.id;

  if not p_is_foster then
    -- Revoking approval makes the home an invalid destination straight away.
    update public.locations set is_confirmed_destination = false, confirmed_by = null,
      confirmed_at = null, updated_at = now()
    where org_id = mem.org_id and linked_user_id = mem.user_id and kind = 'foster_home';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, before, after)
  values (uid, case when p_is_foster then 'foster.approve' else 'foster.revoke' end, 'membership', mem.id, mem.org_id,
    jsonb_build_object('is_foster_carer', mem.is_foster_carer, 'user_id', mem.user_id),
    jsonb_build_object('is_foster_carer', p_is_foster, 'can_confirm_receipt', p_is_foster and coalesce(p_can_confirm_receipt, false)));
end;
$$;

create or replace function public.upsert_foster_home(
  p_member_id uuid,
  p_suburb_id uuid,
  p_exact_address text,
  p_contact_name text,
  p_contact_phone text,
  p_instructions text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  mem public.organisation_members;
  org public.organisations;
  sub public.suburbs;
  loc public.locations;
  priv public.location_private;
  unconfirm boolean := false;
  loc_id uuid;
  label_ text;
begin
  select * into mem from public.organisation_members where id = p_member_id;
  if not found or not public.is_active_coordinator(uid, mem.org_id) then
    raise exception 'Member not found' using errcode = '42501';
  end if;
  if mem.status <> 'active' or not mem.is_foster_carer then
    raise exception 'Approve the member as a foster carer first' using errcode = '55000';
  end if;
  select * into org from public.organisations where id = mem.org_id;
  select * into sub from public.suburbs where id = p_suburb_id;
  if not found then
    raise exception 'Choose a suburb' using errcode = '22023';
  end if;
  label_ := 'Foster home, ' || sub.name;
  perform public.loc_check_text(label_, p_exact_address, p_contact_name, p_contact_phone, p_instructions);

  select * into loc from public.locations
  where org_id = mem.org_id and linked_user_id = mem.user_id and kind = 'foster_home' for update;
  if found then
    select * into priv from public.location_private where location_id = loc.id;
    unconfirm := loc.is_confirmed_destination
      and (loc.suburb_id <> sub.id or priv.exact_address is distinct from btrim(p_exact_address));
    loc_id := loc.id;
    update public.locations set label_public = label_, suburb_id = sub.id, approx_point = sub.centroid,
      is_confirmed_destination = case when unconfirm then false else is_confirmed_destination end,
      confirmed_by = case when unconfirm then null else confirmed_by end,
      confirmed_at = case when unconfirm then null else confirmed_at end,
      updated_at = now()
    where id = loc.id;
    update public.location_private set exact_address = btrim(p_exact_address),
      contact_name = nullif(btrim(coalesce(p_contact_name, '')), ''),
      contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
      instructions = nullif(btrim(coalesce(p_instructions, '')), ''), updated_at = now()
    where location_id = loc.id;
  else
    insert into public.locations (org_id, kind, label_public, suburb_id, approx_point, linked_user_id, is_demo)
    values (mem.org_id, 'foster_home', label_, sub.id, sub.centroid, mem.user_id, org.is_demo)
    returning id into loc_id;
    insert into public.location_private (location_id, exact_address, contact_name, contact_phone, instructions)
    values (loc_id, btrim(p_exact_address), nullif(btrim(coalesce(p_contact_name, '')), ''),
            nullif(btrim(coalesce(p_contact_phone, '')), ''), nullif(btrim(coalesce(p_instructions, '')), ''));
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'foster_home.upsert', 'location', loc_id, mem.org_id,
    jsonb_build_object('suburb_id', sub.id, 'confirmation_cleared', unconfirm));
  return loc_id;
end;
$$;

-- The carer sees only their own home(s), one per approving organisation.
create or replace function public.get_my_foster_homes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'location_id', l.id, 'org_id', l.org_id, 'org_name', o.name, 'suburb', s.name, 'postcode', s.postcode,
      'is_confirmed_destination', l.is_confirmed_destination,
      'can_confirm_receipt', m.foster_can_confirm_receipt,
      'exact_address', p.exact_address, 'contact_name', p.contact_name,
      'contact_phone', p.contact_phone, 'instructions', p.instructions
    ) order by o.name)
    from public.locations l
    join public.organisation_members m on m.org_id = l.org_id and m.user_id = uid
      and m.status = 'active' and m.is_foster_carer
    join public.organisations o on o.id = l.org_id
    join public.suburbs s on s.id = l.suburb_id
    left join public.location_private p on p.location_id = l.id
    where l.linked_user_id = uid and l.kind = 'foster_home'
  ), '[]'::jsonb);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'list_suburbs(text)',
    'create_location(uuid,text,text,uuid,text,text,text,text)',
    'update_location(uuid,text,uuid,text,text,text,text)',
    'confirm_destination(uuid,boolean)',
    'list_org_locations(uuid)',
    'set_foster_status(uuid,boolean,boolean)',
    'upsert_foster_home(uuid,uuid,text,text,text,text)',
    'get_my_foster_homes()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.loc_check_text(text,text,text,text,text) from public, anon, authenticated;
