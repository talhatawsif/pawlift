-- 1c: profile row on signup, and a read function for the signed-in user's shell context.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles and memberships are default-deny; the shell reads them through this function.
create or replace function public.get_my_context()
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

  select jsonb_build_object(
    'user_id', p.id,
    'display_name', p.display_name,
    'account_status', p.account_status,
    'is_demo', p.is_demo,
    'is_admin', exists (select 1 from public.platform_admins a where a.user_id = uid),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'org_id', o.id,
        'org_name', o.name,
        'org_verification', o.verification_status,
        'status', m.status,
        'is_coordinator', m.is_coordinator,
        'is_volunteer', m.is_volunteer,
        'is_foster_carer', m.is_foster_carer
      ) order by o.name)
      from public.organisation_members m
      join public.organisations o on o.id = m.org_id
      where m.user_id = uid and m.status in ('active', 'requested', 'invited')
    ), '[]'::jsonb)
  )
  into result
  from public.profiles p
  where p.id = uid;

  return result;
end;
$$;

revoke all on function public.get_my_context() from public, anon;
grant execute on function public.get_my_context() to authenticated;
