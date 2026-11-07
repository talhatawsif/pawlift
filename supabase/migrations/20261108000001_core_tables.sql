-- b1.b: core tables (PLAN §3). All tables RLS-enabled with NO policies (default deny).
-- Policies and RPCs arrive in later checkpoints. Status columns are never client-writable.

create extension if not exists postgis;
create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- Reference: bundled Victorian suburb centroids (public data)
create table public.suburbs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  postcode text not null,
  state text not null default 'VIC',
  centroid geography(point, 4326) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, postcode)
);
create index suburbs_centroid_gix on public.suburbs using gist (centroid);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  phone text, -- private
  home_suburb_id uuid references public.suburbs (id),
  nav_app text not null default 'google' check (nav_app in ('google','apple','waze')),
  account_status text not null default 'active' check (account_status in ('active','suspended')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_home_suburb_idx on public.profiles (home_suburb_id);
create index profiles_account_status_idx on public.profiles (account_status);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('rescue_group','charity','council_pound','shelter','vet_clinic','other')),
  registration_details text,
  contact_name text,
  contact_email text,
  contact_phone text,
  operating_area text,
  website text,
  description text,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected','suspended')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organisations_verification_idx on public.organisations (verification_status);

create table public.organisation_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  is_coordinator boolean not null default false,
  is_volunteer boolean not null default false,
  is_foster_carer boolean not null default false,
  status text not null default 'requested' check (status in ('invited','requested','active','removed')),
  foster_approved_by uuid references auth.users (id),
  foster_approved_at timestamptz,
  foster_can_confirm_receipt boolean not null default false,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index org_members_user_idx on public.organisation_members (user_id);
create index org_members_status_idx on public.organisation_members (status);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  token_hash text not null unique,
  email text, -- null = open link
  roles jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (org_id);

create table public.volunteer_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  species_ok text[] not null default '{}' check (species_ok <@ array['cat','dog','other']),
  max_size text,
  has_carrier boolean not null default false,
  vehicle_notes text,
  availability jsonb not null default '{}'::jsonb,
  guidelines_version_accepted text,
  guidelines_accepted_at timestamptz,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected','suspended')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index volunteer_profiles_verification_idx on public.volunteer_profiles (verification_status);

create table public.verification_records ( -- append-only
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('organisation','volunteer')),
  subject_id uuid not null,
  decision text not null,
  checks_performed jsonb not null default '[]'::jsonb,
  reason text,
  decided_by uuid not null references auth.users (id),
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index verification_records_subject_idx on public.verification_records (subject_type, subject_id);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  kind text not null check (kind in ('pound','shelter','rescue_facility','vet','foster_home','handover_point','other')),
  label_public text not null,
  suburb_id uuid not null references public.suburbs (id),
  approx_point geography(point, 4326) not null,
  is_confirmed_destination boolean not null default false,
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  linked_user_id uuid references auth.users (id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index locations_org_idx on public.locations (org_id);
create index locations_suburb_idx on public.locations (suburb_id);
create index locations_kind_idx on public.locations (kind);
create index locations_linked_user_idx on public.locations (linked_user_id);
create index locations_approx_gix on public.locations using gist (approx_point);

create table public.location_private (
  location_id uuid primary key references public.locations (id) on delete cascade,
  exact_address text,
  exact_point geography(point, 4326),
  contact_name text,
  contact_phone text,
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transport_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  reference text not null unique,
  animal_name text not null,
  species text not null check (species in ('cat','dog','other')),
  photo_path text,
  urgency text not null default 'routine' check (urgency in ('routine','soon','urgent')),
  required_date date,
  deadline timestamptz,
  handling_requirements text,
  carrier_requirements text,
  status text not null default 'draft' check (status in ('draft','open','assigned','confirmed','en_route','collected','delivered','completed','cancelled')),
  release_authority_attested_by uuid references auth.users (id),
  release_authority_attested_at timestamptz,
  origin_location_id uuid references public.locations (id),
  destination_location_id uuid references public.locations (id),
  published_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  version integer not null default 1,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transport_requests_org_idx on public.transport_requests (org_id);
create index transport_requests_status_idx on public.transport_requests (status);
create index transport_requests_origin_idx on public.transport_requests (origin_location_id);
create index transport_requests_dest_idx on public.transport_requests (destination_location_id);

create table public.request_private (
  request_id uuid primary key references public.transport_requests (id) on delete cascade,
  medical_notes text,
  coordinator_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transport_legs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.transport_requests (id) on delete cascade,
  seq integer not null check (seq > 0),
  from_location_id uuid not null references public.locations (id),
  to_location_id uuid not null references public.locations (id),
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null default 'open' check (status in ('open','offered','reserved','confirmed','en_route','collected','delivered','cancelled')),
  started_at timestamptz,
  collected_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, seq),
  check (window_end > window_start)
);
create index transport_legs_status_idx on public.transport_legs (status);
create index transport_legs_from_idx on public.transport_legs (from_location_id);
create index transport_legs_to_idx on public.transport_legs (to_location_id);
create index transport_legs_window_idx on public.transport_legs (window_start);

create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  origin_point geography(point, 4326) not null,
  destination_point geography(point, 4326) not null,
  depart_at timestamptz not null,
  max_detour_min integer not null default 15 check (max_detour_min >= 0),
  notify_matches boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index journeys_user_idx on public.journeys (user_id);
create index journeys_depart_idx on public.journeys (depart_at);

create table public.transport_assignments (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.transport_legs (id) on delete cascade,
  volunteer_id uuid not null references auth.users (id),
  kind text not null check (kind in ('claim','offer')),
  status text not null check (status in ('offered','reserved','confirmed','completed','declined','withdrawn','released','expired','reassigned','cancelled')),
  journey_id uuid references public.journeys (id) on delete set null,
  idempotency_key text not null,
  reserved_until timestamptz,
  offer_expires_at timestamptz,
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (volunteer_id, idempotency_key)
);
create index assignments_leg_idx on public.transport_assignments (leg_id);
create index assignments_volunteer_idx on public.transport_assignments (volunteer_id);
create index assignments_journey_idx on public.transport_assignments (journey_id);
create index assignments_status_idx on public.transport_assignments (status);
-- One active assignment per leg (race-proof claim)
create unique index assignments_one_active_per_leg
  on public.transport_assignments (leg_id) where status in ('offered','reserved','confirmed');

create table public.handover_confirmations (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.transport_legs (id) on delete cascade,
  role text not null check (role in ('giver','receiver')),
  confirmed_by uuid not null references auth.users (id),
  on_behalf_of uuid references auth.users (id),
  confirmed_at timestamptz not null default now(),
  outcome text not null default 'ok' check (outcome in ('ok','disputed')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leg_id, role)
);
create index handover_leg_idx on public.handover_confirmations (leg_id);

create table public.route_cache (
  cache_key text primary key,
  provider text not null check (provider in ('ors','demo')),
  duration_s integer not null,
  distance_m integer not null,
  legs jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.transport_requests (id) on delete cascade,
  leg_id uuid references public.transport_legs (id) on delete set null,
  raised_by uuid references auth.users (id),
  type text not null check (type in ('delay','animal_welfare','vehicle','handover_dispute','late_withdrawal','no_show','other')),
  severity text not null default 'low' check (severity in ('low','high')),
  description text,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  resolution text,
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index incidents_request_idx on public.incidents (request_id);
create index incidents_leg_idx on public.incidents (leg_id);
create index incidents_status_idx on public.incidents (status);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  request_id uuid references public.transport_requests (id) on delete cascade,
  leg_id uuid references public.transport_legs (id) on delete cascade,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb, -- non-sensitive only
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nearby_enabled boolean not null default false,
  nearby_radius_km integer not null default 10 check (nearby_radius_km > 0),
  reminders_enabled boolean not null default true,
  route_match_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  org_id uuid references public.organisations (id) on delete set null,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_org_idx on public.audit_logs (org_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

-- updated_at triggers
do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Default-deny RLS: enabled + forced on every table, and no policies yet.
-- (suburbs gets a read-only policy in 1c/3a; it is public reference data.)
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
