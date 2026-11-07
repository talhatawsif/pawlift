-- 2b: invitations, membership, volunteer profile, guideline acceptance, volunteer verification.
-- All state changes go through security-definer RPCs that audit in the same transaction.

-- Internal helper for later checkpoints: verified volunteer on an active account.
create or replace function public.is_verified_volunteer(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.volunteer_profiles v
    join public.profiles p on p.id = v.user_id
    where v.user_id = p_uid and v.verification_status = 'verified' and p.account_status = 'active'
  );
$$;
revoke all on function public.is_verified_volunteer(uuid) from public, anon, authenticated;

-- Internal helper: caller is an active coordinator of the org.
create or replace function public.is_active_coordinator(p_uid uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organisation_members m
    where m.org_id = p_org and m.user_id = p_uid and m.is_coordinator and m.status = 'active'
  );
$$;
revoke all on function public.is_active_coordinator(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- invitations

create or replace function public.create_invitation(
  p_org_id uuid,
  p_email text,
  p_expires_days integer,
  p_max_uses integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  org public.organisations;
  email_ text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  days_ integer := coalesce(p_expires_days, 14);
  uses_ integer := coalesce(p_max_uses, 1);
  token_ text;
  inv_id uuid;
begin
  select * into org from public.organisations where id = p_org_id;
  if not found or not public.is_active_coordinator(uid, p_org_id) then
    raise exception 'Organisation not found' using errcode = '42501';
  end if;
  if org.verification_status <> 'verified' then
    raise exception 'Only a verified organisation can invite volunteers' using errcode = '55000';
  end if;
  if email_ is not null and (char_length(email_) > 200 or email_ !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if days_ < 1 or days_ > 30 then
    raise exception 'Expiry must be 1 to 30 days' using errcode = '22023';
  end if;
  if email_ is not null then
    uses_ := 1;
  elsif uses_ < 1 or uses_ > 100 then
    raise exception 'Uses must be 1 to 100' using errcode = '22023';
  end if;
  if (select count(*) from public.invitations i
      where i.org_id = p_org_id and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses) >= 50 then
    raise exception 'Too many active invitations' using errcode = '54000';
  end if;

  token_ := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invitations (org_id, token_hash, email, roles, created_by, expires_at, max_uses)
  values (p_org_id, encode(sha256(convert_to(token_, 'utf8')), 'hex'), email_,
          '{"volunteer": true}'::jsonb, uid, now() + make_interval(days => days_), uses_)
  returning id into inv_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'invitation.create', 'invitation', inv_id, p_org_id,
    jsonb_build_object('email_bound', email_ is not null, 'max_uses', uses_, 'expires_days', days_));

  return token_;
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  inv public.invitations;
begin
  select * into inv from public.invitations where id = p_invitation_id for update;
  if not found or not public.is_active_coordinator(uid, inv.org_id) then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if inv.revoked_at is null then
    update public.invitations set revoked_at = now() where id = inv.id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id)
    values (uid, 'invitation.revoke', 'invitation', inv.id, inv.org_id);
  end if;
end;
$$;

create or replace function public.list_invitations(p_org_id uuid)
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
      'id', i.id, 'email', i.email, 'expires_at', i.expires_at, 'max_uses', i.max_uses,
      'uses', i.uses, 'revoked_at', i.revoked_at, 'created_at', i.created_at,
      'status', case
        when i.revoked_at is not null then 'revoked'
        when i.expires_at <= now() then 'expired'
        when i.uses >= i.max_uses then 'used'
        else 'active' end
    ) order by i.created_at desc)
    from public.invitations i where i.org_id = p_org_id
  ), '[]'::jsonb);
end;
$$;

-- Shared lookup: returns the invitation row plus a reason it cannot be used (null = usable).
create or replace function public.invitation_state(p_token text)
returns table (inv_id uuid, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  inv public.invitations;
  org_status text;
begin
  select * into inv from public.invitations
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if not found then
    return query select null::uuid, 'invalid'::text;
    return;
  end if;
  select verification_status into org_status from public.organisations where id = inv.org_id;
  return query select inv.id, case
    when inv.revoked_at is not null then 'revoked'
    when inv.expires_at <= now() then 'expired'
    when inv.uses >= inv.max_uses then 'used'
    when org_status is distinct from 'verified' then 'org_not_verified'
    else null end;
end;
$$;
revoke all on function public.invitation_state(text) from public, anon, authenticated;

create or replace function public.preview_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  st record;
  inv public.invitations;
  org public.organisations;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  select * into st from public.invitation_state(p_token);
  if st.inv_id is null then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;
  select * into inv from public.invitations where id = st.inv_id;
  select * into org from public.organisations where id = inv.org_id;
  return jsonb_build_object(
    'valid', st.reason is null,
    'reason', st.reason,
    'org_name', org.name,
    'org_type', org.type,
    'email_bound', inv.email is not null,
    'email_matches', inv.email is null or lower(coalesce(auth.jwt() ->> 'email', '')) = inv.email
  );
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  st record;
  inv public.invitations;
  mem public.organisation_members;
begin
  select * into st from public.invitation_state(p_token);
  if st.inv_id is null or st.reason is not null then
    raise exception 'Invitation is not valid' using errcode = 'P0002';
  end if;
  select * into inv from public.invitations where id = st.inv_id for update;
  -- Re-check under the row lock.
  if inv.revoked_at is not null or inv.expires_at <= now() or inv.uses >= inv.max_uses then
    raise exception 'Invitation is not valid' using errcode = 'P0002';
  end if;
  if inv.email is not null and lower(coalesce(auth.jwt() ->> 'email', '')) <> inv.email then
    raise exception 'Invitation was sent to a different email address' using errcode = '42501';
  end if;

  select * into mem from public.organisation_members where org_id = inv.org_id and user_id = uid for update;
  if found and mem.status = 'active' then
    -- Already a member: no use consumed; ensure volunteer flag.
    if not mem.is_volunteer then
      update public.organisation_members set is_volunteer = true where id = mem.id;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
      values (uid, 'membership.volunteer_added', 'membership', mem.id, inv.org_id, jsonb_build_object('via', 'invitation'));
    end if;
    return inv.org_id;
  end if;

  if found then
    update public.organisation_members
      set status = 'active', is_volunteer = true, approved_by = inv.created_by, approved_at = now()
      where id = mem.id;
  else
    insert into public.organisation_members (org_id, user_id, is_volunteer, status, approved_by, approved_at)
    values (inv.org_id, uid, true, 'active', inv.created_by, now())
    returning id into mem.id;
  end if;
  update public.invitations set uses = uses + 1 where id = inv.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, after)
  values (uid, 'membership.join_by_invitation', 'membership', mem.id, inv.org_id,
    jsonb_build_object('invitation_id', inv.id, 'email_bound', inv.email is not null));
  return inv.org_id;
end;
$$;

-- ---------------------------------------------------------------- membership

create or replace function public.list_joinable_organisations()
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
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'type', o.type, 'operating_area', o.operating_area,
      'is_demo', o.is_demo,
      'my_status', (select m.status from public.organisation_members m where m.org_id = o.id and m.user_id = uid)
    ) order by o.name)
    from public.organisations o
    where o.verification_status = 'verified'
      and (o.is_demo = coalesce((select p.is_demo from public.profiles p where p.id = uid), false))
  ), '[]'::jsonb);
end;
$$;

create or replace function public.request_membership(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  org public.organisations;
  mem_id uuid;
begin
  select * into org from public.organisations where id = p_org_id;
  if not found or org.verification_status <> 'verified' then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  if org.is_demo is distinct from coalesce((select p.is_demo from public.profiles p where p.id = uid), false) then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.organisation_members m where m.org_id = p_org_id and m.user_id = uid) then
    raise exception 'You already have a membership or request with this organisation' using errcode = '55000';
  end if;
  insert into public.organisation_members (org_id, user_id, is_volunteer, status)
  values (p_org_id, uid, true, 'requested')
  returning id into mem_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id)
  values (uid, 'membership.request', 'membership', mem_id, p_org_id);
end;
$$;

create or replace function public.decide_membership(p_member_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  mem public.organisation_members;
  new_status text;
begin
  if p_decision not in ('approve','decline','remove') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  select * into mem from public.organisation_members where id = p_member_id for update;
  if not found or not public.is_active_coordinator(uid, mem.org_id) then
    raise exception 'Member not found' using errcode = '42501';
  end if;
  if mem.user_id = uid or mem.is_coordinator then
    raise exception 'Coordinators cannot be changed here' using errcode = '55000';
  end if;
  if p_decision in ('approve','decline') and mem.status <> 'requested' then
    raise exception 'Only a pending request can be approved or declined' using errcode = '55000';
  end if;
  if p_decision = 'remove' and mem.status <> 'active' then
    raise exception 'Only an active member can be removed' using errcode = '55000';
  end if;
  new_status := case p_decision when 'approve' then 'active' else 'removed' end;

  update public.organisation_members set
    status = new_status,
    approved_by = case when p_decision = 'approve' then uid else approved_by end,
    approved_at = case when p_decision = 'approve' then now() else approved_at end
  where id = mem.id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, org_id, before, after)
  values (uid, 'membership.' || p_decision, 'membership', mem.id, mem.org_id,
    jsonb_build_object('status', mem.status, 'user_id', mem.user_id),
    jsonb_build_object('status', new_status));
end;
$$;

create or replace function public.list_org_members(p_org_id uuid)
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
      'id', m.id, 'user_id', m.user_id, 'display_name', p.display_name, 'status', m.status,
      'is_coordinator', m.is_coordinator, 'is_volunteer', m.is_volunteer,
      'is_foster_carer', m.is_foster_carer, 'joined_at', m.approved_at, 'created_at', m.created_at,
      'volunteer_status', v.verification_status, 'species_ok', v.species_ok,
      'max_size', v.max_size, 'has_carrier', v.has_carrier, 'availability', v.availability
    ) order by m.status, p.display_name)
    from public.organisation_members m
    join public.profiles p on p.id = m.user_id
    left join public.volunteer_profiles v on v.user_id = m.user_id
    where m.org_id = p_org_id and m.status in ('requested','active')
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------- volunteer profile

create or replace function public.upsert_volunteer_profile(
  p_species_ok text[],
  p_max_size text,
  p_has_carrier boolean,
  p_vehicle_notes text,
  p_availability jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  species_ text[] := coalesce(p_species_ok, '{}');
  avail jsonb := coalesce(p_availability, '{}'::jsonb);
  notes_ text := nullif(btrim(coalesce(p_vehicle_notes, '')), '');
  existed boolean;
begin
  if not (species_ <@ array['cat','dog','other']) then
    raise exception 'Invalid species' using errcode = '22023';
  end if;
  if p_max_size is not null and p_max_size not in ('small','medium','large') then
    raise exception 'Invalid size' using errcode = '22023';
  end if;
  if char_length(coalesce(notes_, '')) > 500 then
    raise exception 'Vehicle notes are too long' using errcode = '22023';
  end if;
  if jsonb_typeof(avail) <> 'object' or char_length(avail::text) > 2000 then
    raise exception 'Availability is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(avail) k where k not in ('days','notes')
  ) or (avail ? 'days' and (
    jsonb_typeof(avail -> 'days') <> 'array'
    or exists (select 1 from jsonb_array_elements_text(avail -> 'days') d
               where d not in ('mon','tue','wed','thu','fri','sat','sun'))
  )) or (avail ? 'notes' and jsonb_typeof(avail -> 'notes') <> 'string') then
    raise exception 'Availability is invalid' using errcode = '22023';
  end if;

  select exists (select 1 from public.volunteer_profiles where user_id = uid) into existed;
  insert into public.volunteer_profiles (user_id, species_ok, max_size, has_carrier, vehicle_notes, availability)
  values (uid, species_, p_max_size, coalesce(p_has_carrier, false), notes_, avail)
  on conflict (user_id) do update set
    species_ok = excluded.species_ok, max_size = excluded.max_size,
    has_carrier = excluded.has_carrier, vehicle_notes = excluded.vehicle_notes,
    availability = excluded.availability;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after)
  values (uid, case when existed then 'volunteer.update_profile' else 'volunteer.create_profile' end,
    'volunteer', uid, jsonb_build_object('species_ok', species_, 'max_size', p_max_size, 'has_carrier', coalesce(p_has_carrier, false)));
end;
$$;

create or replace function public.accept_guidelines(p_version text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
begin
  if p_version is distinct from 'v1' then
    raise exception 'Unknown guidelines version' using errcode = '22023';
  end if;
  if not exists (select 1 from public.volunteer_profiles where user_id = uid) then
    raise exception 'Save your volunteer profile first' using errcode = '55000';
  end if;
  update public.volunteer_profiles
    set guidelines_version_accepted = p_version, guidelines_accepted_at = now()
    where user_id = uid;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after)
  values (uid, 'volunteer.accept_guidelines', 'volunteer', uid, jsonb_build_object('version', p_version));
end;
$$;

create or replace function public.resubmit_volunteer()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  vp public.volunteer_profiles;
begin
  select * into vp from public.volunteer_profiles where user_id = uid for update;
  if not found or vp.verification_status <> 'rejected' then
    raise exception 'Only a rejected application can be resubmitted' using errcode = '55000';
  end if;
  update public.volunteer_profiles set verification_status = 'pending' where user_id = uid;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before, after)
  values (uid, 'volunteer.resubmit', 'volunteer', uid,
    jsonb_build_object('verification_status', 'rejected'), jsonb_build_object('verification_status', 'pending'));
end;
$$;

create or replace function public.get_my_volunteer_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    return null;
  end if;
  select to_jsonb(v) - 'is_demo' || jsonb_build_object(
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('decision', r.decision, 'reason', r.reason, 'decided_at', r.decided_at)
        order by r.decided_at desc)
      from public.verification_records r where r.subject_type = 'volunteer' and r.subject_id = uid
    ), '[]'::jsonb))
  into result
  from public.volunteer_profiles v where v.user_id = uid;
  return result;
end;
$$;

-- ---------------------------------------------------------------- admin volunteer verification

create or replace function public.admin_list_volunteers(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from public.platform_admins where user_id = uid) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', v.user_id, 'display_name', p.display_name,
      'verification_status', v.verification_status,
      'guidelines_accepted', v.guidelines_accepted_at is not null,
      'created_at', v.created_at, 'updated_at', v.updated_at, 'is_demo', v.is_demo
    ) order by v.updated_at asc)
    from public.volunteer_profiles v
    join public.profiles p on p.id = v.user_id
    where p_status = 'all' or v.verification_status = p_status
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_get_volunteer(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null or not exists (select 1 from public.platform_admins where user_id = uid) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select to_jsonb(v) || jsonb_build_object(
    'display_name', p.display_name,
    'orgs', coalesce((
      select jsonb_agg(o.name order by o.name)
      from public.organisation_members m join public.organisations o on o.id = m.org_id
      where m.user_id = v.user_id and m.status = 'active'
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'decision', r.decision, 'checks', r.checks_performed, 'reason', r.reason, 'decided_at', r.decided_at)
        order by r.decided_at desc)
      from public.verification_records r where r.subject_type = 'volunteer' and r.subject_id = v.user_id
    ), '[]'::jsonb))
  into result
  from public.volunteer_profiles v join public.profiles p on p.id = v.user_id
  where v.user_id = p_user_id;
  return result;
end;
$$;

create or replace function public.admin_decide_volunteer(
  p_user_id uuid,
  p_decision text,
  p_checks jsonb,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := public.require_active_user();
  vp public.volunteer_profiles;
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
  checks_ jsonb := coalesce(p_checks, '[]'::jsonb);
begin
  if not exists (select 1 from public.platform_admins where user_id = uid) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_decision not in ('verified','rejected','suspended') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if jsonb_typeof(checks_) <> 'array' or jsonb_array_length(checks_) > 20 then
    raise exception 'Checks must be a list of up to 20 items' using errcode = '22023';
  end if;
  if char_length(coalesce(reason_, '')) > 2000 or char_length(checks_::text) > 4000 then
    raise exception 'Reason or checks too long' using errcode = '22023';
  end if;

  select * into vp from public.volunteer_profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'Volunteer not found' using errcode = 'P0002';
  end if;
  if not (
    (vp.verification_status = 'pending' and p_decision in ('verified','rejected'))
    or (vp.verification_status = 'verified' and p_decision = 'suspended')
    or (vp.verification_status = 'suspended' and p_decision = 'verified')
  ) then
    raise exception 'That decision is not allowed from status %', vp.verification_status using errcode = '55000';
  end if;
  if p_decision = 'verified' then
    if jsonb_array_length(checks_) = 0 then
      raise exception 'Record the checks performed before verifying' using errcode = '22023';
    end if;
    if vp.guidelines_accepted_at is null then
      raise exception 'The volunteer has not accepted the guidelines' using errcode = '55000';
    end if;
  end if;
  if p_decision in ('rejected','suspended') and reason_ is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  insert into public.verification_records (subject_type, subject_id, decision, checks_performed, reason, decided_by)
  values ('volunteer', p_user_id, p_decision, checks_, reason_, uid);
  update public.volunteer_profiles set verification_status = p_decision where user_id = p_user_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before, after, reason)
  values (uid, 'volunteer.' || p_decision, 'volunteer', p_user_id,
    jsonb_build_object('verification_status', vp.verification_status),
    jsonb_build_object('verification_status', p_decision), reason_);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_invitation(uuid,text,integer,integer)',
    'revoke_invitation(uuid)',
    'list_invitations(uuid)',
    'preview_invitation(text)',
    'accept_invitation(text)',
    'list_joinable_organisations()',
    'request_membership(uuid)',
    'decide_membership(uuid,text)',
    'list_org_members(uuid)',
    'upsert_volunteer_profile(text[],text,boolean,text,jsonb)',
    'accept_guidelines(text)',
    'resubmit_volunteer()',
    'get_my_volunteer_profile()',
    'admin_list_volunteers(text)',
    'admin_get_volunteer(uuid)',
    'admin_decide_volunteer(uuid,text,jsonb,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
