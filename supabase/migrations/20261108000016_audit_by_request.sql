-- 4c fix: the per-request audit view also matches events that carry only a leg id (e.g. confirm, release).
create or replace function public.list_org_audit(p_org_id uuid, p_request_id uuid default null, p_limit integer default 100)
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
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select g.id, g.action, g.entity_type, g.entity_id, g.created_at, g.reason,
        p.display_name as actor_name,
        coalesce(g.after ->> 'request_id', (select l.request_id::text from public.transport_legs l where l.id::text = g.after ->> 'leg_id')) as request_id
      from public.audit_logs g
      left join public.profiles p on p.id = g.actor_id
      where g.org_id = p_org_id
        and (p_request_id is null
             or g.after ->> 'request_id' = p_request_id::text
             or g.entity_id = p_request_id
             or g.entity_id in (select id from public.transport_legs where request_id = p_request_id)
             or (g.after ->> 'leg_id') in (select id::text from public.transport_legs where request_id = p_request_id))
      order by g.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 200)
    ) t
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_org_audit(uuid, uuid, integer) from public, anon;
grant execute on function public.list_org_audit(uuid, uuid, integer) to authenticated;
