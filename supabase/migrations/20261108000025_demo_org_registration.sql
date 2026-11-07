-- 7b (D43): an organisation inherits the registrant's demo flag, so a demo persona can never create a
-- real organisation (and through it real locations and requests). Same body as ...000004 otherwise.
-- create or replace keeps the existing grants.
create or replace function public.register_organisation(
  p_name text,
  p_type text,
  p_registration_details text,
  p_contact_name text,
  p_contact_email text,
  p_contact_phone text,
  p_operating_area text,
  p_website text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  oid uuid;
  name_ text := btrim(coalesce(p_name, ''));
begin
  if char_length(name_) < 2 or char_length(name_) > 120 then
    raise exception 'Organisation name must be 2 to 120 characters' using errcode = '22023';
  end if;
  if p_type not in ('rescue_group','charity','council_pound','shelter','vet_clinic','other') then
    raise exception 'Invalid organisation type' using errcode = '22023';
  end if;
  if char_length(coalesce(p_registration_details, '')) > 1000
     or char_length(coalesce(p_description, '')) > 2000
     or char_length(coalesce(p_operating_area, '')) > 200
     or char_length(coalesce(p_website, '')) > 300
     or char_length(coalesce(p_contact_name, '')) > 120
     or char_length(coalesce(p_contact_email, '')) > 200
     or char_length(coalesce(p_contact_phone, '')) > 40 then
    raise exception 'A field is too long' using errcode = '22023';
  end if;
  if (
    select count(*) from public.organisation_members m
    join public.organisations o on o.id = m.org_id
    where m.user_id = uid and m.is_coordinator and m.status = 'active'
      and o.verification_status = 'pending'
  ) >= 3 then
    raise exception 'Too many organisations awaiting verification' using errcode = '54000';
  end if;

  insert into public.organisations (
    name, type, registration_details, contact_name, contact_email, contact_phone,
    operating_area, website, description, is_demo
  ) values (
    name_, p_type, nullif(btrim(p_registration_details), ''), nullif(btrim(p_contact_name), ''),
    nullif(btrim(p_contact_email), ''), nullif(btrim(p_contact_phone), ''),
    nullif(btrim(p_operating_area), ''), nullif(btrim(p_website), ''), nullif(btrim(p_description), ''),
    coalesce((select p.is_demo from public.profiles p where p.id = uid), false)
  ) returning id into oid;

  -- Bootstrap: the registrant is the first coordinator of their own pending organisation.
  insert into public.organisation_members (org_id, user_id, is_coordinator, status, approved_by, approved_at)
  values (oid, uid, true, 'active', uid, now());

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after, reason)
  values (uid, 'organisation.register', 'organisation', oid, oid,
    jsonb_build_object('name', name_, 'type', p_type, 'verification_status', 'pending'),
    'Registrant became first coordinator (bootstrap)');

  return oid;
end;
$$;
