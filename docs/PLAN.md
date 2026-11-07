# PawLift — approved plan (Batch 0)

Status: drafted 2026-11-08 in planning chat. Defaults in §14 apply unless the user changes them.
Product requirements live in `docs/BRIEF.md`; this file records how we build them.

---

## 1. Architecture

- **App:** Next.js (App Router, Server Components, Server Actions), TypeScript strict, Tailwind CSS. System font stack (no web-font download). Icons: lucide-react.
- **Backend:** one hosted Supabase project `pawlift-dev` (Sydney region) for development, demo and tests. Auth (email + password), Postgres with PostGIS and pg_cron, RLS on every table, Storage. A separate production project is created only at launch.
- **Data access:** `@supabase/ssr` with the user's session and the anon/publishable key. Reads use RLS-protected tables and public views. **All state changes call Postgres RPC functions** that check `auth.uid()`, roles, verification and current state, lock rows, write `audit_logs`, insert notifications, and commit atomically.
- **Service role:** only in `scripts/` (seed, reset, test setup). Never in `src/`. A lint rule or test fails the build if `src/` imports it.
- **Maps:** MapLibre GL JS with OpenFreeMap vector tiles (no key). Attribution shown.
- **Routing:** `src/lib/routing/` adapter interface with two providers:
  - `ors` — openrouteservice, server-side only, key in env, base URL in env (use the address shown on the official signup page).
  - `demo` — deterministic fixtures for seeded demo suburbs plus a labelled fallback formula. Every result carries `source`.
- **Navigation handoff:** per-stop deep links to Google Maps, Apple Maps or Waze (`src/lib/nav-links/`). Preference stored on profile. No integration with live navigation sessions.
- **Geocoding:** bundled, openly licensed Victorian suburb/postcode centroid list for manual location and public approximate points. Exact addresses geocoded server-side via ORS only when coordinators save a location; result cached on the location row.
- **Scheduling:** pg_cron jobs (reminders, expiry sweeps, journey deletion). Every mutation also expires stale reservations lazily, so correctness never depends on cron timing.
- **Tests:** Vitest for pure logic; `test:db` Vitest suite that signs in as seeded test users against `pawlift-dev` to test RLS and RPCs; Playwright end-to-end in Batch 7.
- **Migrations:** hand-written SQL in `supabase/migrations/`, applied with `npx supabase db push` (no Docker needed). Types via `supabase gen types --linked`.
- **Hosting:** Vercel (preview first; public deploy needs the user's explicit OK).

## 2. Decisions log

| # | Decision | Reason |
|---|---|---|
| D1 | Hosted Supabase dev project, no local Docker stack | Beginner-friendly; free tier; brief allows hosted |
| D2 | No Supabase-free "simulation" app mode; DEMO fallback only for routing | Halves build/test work. Brief §13: a no-credentials mode is optional |
| D3 | OpenFreeMap + MapLibre display; ORS routing; deep-link navigation; no Google Maps Platform | Zero cost, no card; user request |
| D4 | State changes only via security-definer RPCs; audit written in the same transaction | Atomicity, unforgeable audit, one place for guards |
| D5 | Private details in separate tables, read via access functions | Column-level RLS is error-prone |
| D6 | "Matched" is derived (candidates exist), never stored | Brief: matched must never imply consent |
| D7 | "Needs assistance" = open incident flag; progress state preserved | Brief §7 allows; keeps history intact |
| D8 | Every request has exactly one leg (enforced in the database, D37). The `transport_legs` table is kept so assignments, progress and receipts attach to a leg | One assignment model; relays were removed (D37) |
| D9 | Foster carers = membership flag + org-owned `foster_home` location (org-linked model, no separate foster table) | Simplest isolation per organisation |
| D10 | Email invitations = invitation bound to an email address, sent by the coordinator via copy-link or `mailto:` | No paid email service; fits existing org tools |
| D11 | pg_cron for reminders/sweeps plus lazy expiry in RPCs | No external scheduler; correct even if cron lags |
| D12 | Animal photos re-encoded server-side (EXIF/GPS stripped, resized), random file names, public bucket only after publish | Photos are meant to be public; metadata is not |
| D13 | Volunteer verification by platform admins only (MVP) | Brief §5; see open question Q1 |
| D14 | Matching prefilters in PostGIS, routes only the top 5 candidates, caches results | Keeps ORS free quota sufficient |
| D15 | Admin access to private details goes through a function requiring a reason, logged to audit | "Legitimate operational need" made enforceable |
| D16 | Light theme only for MVP | Scope; revisit after launch |
| D17 | Added `maplibre-gl`, `lucide-react`, `vitest` (all in the approved stack); `@types/node` raised to ^24 | Vitest 5 peer requires `@types/node` ≥22; Node 26 installed |
| D18 | Added `@supabase/ssr` and `@supabase/supabase-js` (approved stack); profile created by `auth.users` trigger; shell reads profile/memberships through `get_my_context()` RPC; `is_demo` never set by the trigger (seed sets it with service role) | Tables are default-deny; real users must not self-flag as demo |
| D19 | Registrant becomes the active coordinator of their own `pending` organisation at registration (audited bootstrap); max 3 pending orgs per user. Pending orgs cannot publish (enforced in 2d) | Someone must be able to see and resubmit the application; cap limits spam |
| D20 | Org verification transitions: pending→verified/rejected, verified→suspended, suspended→verified; `verified` needs recorded checks, `rejected`/`suspended` need a reason; rejected→pending only via coordinator resubmission. `verification_records` blocks UPDATE always and DELETE except for the service role (test cleanup) | Honest, auditable decisions; append-only history |
| D21 | Invitation tokens are random (two UUIDs), stored only as sha256 hash, returned once at creation; email-bound invitations match the signed-in user's JWT email (case-insensitive) and are single-use; every invalid state returns one generic error | No pgcrypto/email service needed; tokens unrecoverable from the DB |
| D22 | Accepting an invitation makes the user an active volunteer member at once (the coordinator vouched); self-service requests need coordinator approval; removed users cannot re-request (must be re-invited); coordinators cannot be removed via `decide_membership`; demo and real users cannot see or join each other's orgs | Simple, abuse-resistant; matches Access rules |
| D23 | Volunteer verification mirrors D20 (pending→verified/rejected, verified↔suspended, rejected→pending via `resubmit_volunteer`); `verified` needs recorded checks and accepted guidelines (`v1`, DRAFT text in `src/lib/guidelines.ts`); admins see no phone numbers; `is_verified_volunteer()` is the internal recheck for later checkpoints | Honest verification; no implied background checks |

| D24 | `suburbs` seeded with ~40 Western Melbourne/Geelong suburbs using hand-typed APPROXIMATE centroids (unverified); read via `list_suburbs` RPC. Location `approx_point` is always the suburb centroid; `exact_point` stays null until geocoding (3b) | Public screens must never carry exact coordinates; replace seed with an official dataset before launch |
| D25 | Confirmed destinations: coordinator of a verified org only; changing suburb or address clears confirmation; a foster home can be confirmed only while its carer is approved, and revoking approval unconfirms it. One foster_home location per carer per org, edited only via `upsert_foster_home` | Prevents stale or unapproved destinations (PLAN §8) |
| D26 | Added `sharp` as a direct dependency (already installed transitively by Next) for D12 photo re-encoding: EXIF rotation applied, then all metadata dropped, max 1280px, WebP. Drafts live in private bucket `request-photos`; on publish the server action copies the file to public bucket `animal-photos` (storage policy allows this only for the photo of an open request) | D12 requires server-side sanitising; drafts must not be publicly reachable |
| D27 | `public_requests` shows only rows whose `is_demo` matches the caller's profile (anon = real). Stale-version conflicts use SQLSTATE 55006, not 40001, because the API layer retries 40001 until timeout. Requests are editable and cancellable only while every leg is `open`; later changes arrive with Batch 4 | Demo/real isolation in the public listing; avoids a hang; keeps 2d inside its scope |
| D28 | `list_public_suburbs(text)` RPC is callable by `anon` and returns suburb name, postcode and approximate centroid only; the `suburbs` table stays deny-all. Home nearby ordering is client-side straight-line distance from the public approximate origin point, labelled as such. No new dependency | Manual suburb fallback must work signed out; no extra routing call before 3b |

| D29 | Routing adapter in `src/lib/routing` (no new dependency; plain `fetch`). No `ORS_API_KEY` → DEMO hand-typed suburb-pair fixtures only, never straight-line times. Cache goes through `get_cached_route`/`put_cached_route` RPCs (24 h, rounded ~100 m key, `ors` results only); known limit: any active user could store a wrong estimate for a key. Geocoding via ORS `geocode/search` stores `exact_point` through `set_location_exact_point` (coordinator only, audited; cleared by trigger when the address changes). |
| D30 | Matching (`src/lib/matching`) runs in TypeScript over `public_requests` rows, not a SQL prefilter: no migration and it is unit-testable. A request is matched as one pickup → drop-off (min/max of leg windows), so each request is one pickup → drop-off. Journey inputs are used per search and not stored (saved journeys: 6a). `demo:reset` (`scripts/demo-reset.mjs`) seeds with direct service-role inserts, giving requests a window from seed time to +7 days, and puts all demo locations under Western Paws Rescue because requests must use their own org's locations. No new dependency. |
| D31 | Assignment RPCs (`claim_leg`, `confirm_assignment`, `release_assignment`) share `assignment_eligibility_error`: verified, active, guidelines `v1` (mirrored in SQL; bump needs a migration), species in `species_ok`, `has_carrier` whenever carrier text is present (size is free text, not enforced), no overlapping active assignment, demo flag matches. Claims need `window_start > now()`. Expiry runs lazily at the top of each RPC via `sweep_expired_assignments` (pg_cron in 6a); a raised error rolls the sweep back, so expiry is also checked explicitly at confirm. Lock order leg then assignment. |
| D32 | Offers and exits (migrations 000012–000014): `offer_leg` only to active volunteer members of the request's org, expiry `least(24 h, window_start − 1 h)`; `accept_offer`/`decline_offer`/`withdraw_offer`; `withdraw` (reserved or confirmed; late = confirmed and within 2 h of `window_start` → high `late_withdrawal` incident); `reassign` (reason required, optionally offers to a new volunteer in the same transaction); `cancel_request` now ends every active assignment as `cancelled` for open/assigned/confirmed/en_route requests unless a leg is collected. Offers get a server-made `idempotency_key`. A raised error rolls back the lazy sweep, so an expired offer is swept by the next successful RPC. Revocation = assignment leaves offered/reserved/confirmed; the private-details reader (4c) must key on that. |
| D33 | Progress and reads (migrations 000015–000018): `start_leg` (from 3 h before `window_start`), `confirm_pickup`, `confirm_delivery` (assignment → `completed`, giver row), `complete_request` (coordinator, receiver row `on_behalf_of`, blocked by open high incidents), `report_incident` (assignee or coordinator; types delay/animal_welfare/vehicle/no_show/other), `resolve_incident`, `get_leg_private_details` (confirmed assignment and leg confirmed/en_route/collected; denied once delivered, so the drop-off address stays available after pickup), read RPCs `list_my_assignments`, `get_request_detail` (with `claim_block` reason), `list_org_assignments`, `list_org_incidents`, `list_org_audit`. One leg per request (D37). |
| D34 | A claim is allowed until `window_end` (was: until `window_start`) and holds to `least(now + 4 h, window_end)`; offers keep `window_start − 1 h`. Reason: a pickup window is "any time between start and end", and seeded demo windows start at seed time. |
| D35 | **Superseded by D37.** Leg editor (migration 000019): `split_leg`, `merge_legs`, `update_leg`, `list_request_legs`; shared `validate_leg_chain` enforces PLAN §7 (continuity, chronology, deadline, same org, intermediate stops must be `handover_point`, max 5 legs) on every edit and at publish. Edits only while the request is draft/open and every leg is `open` (as D27); reconfirmation of confirmed legs is 5c. `update_request` refuses origin, destination and first-leg time changes once there is more than one leg (they belong to the leg editor). Stale version = 55006. No new dependency. |
| D36 | **Superseded by D37.** Handovers (migration 000020): relays can be driven. `progress_lock_internal` no longer refuses multi-leg requests; it refuses legs downstream of an unresolved `handover_dispute`. `refresh_progress_status` derives en_route / collected / delivered from all legs. `confirm_pickup` on leg i+1 needs leg i delivered and upserts the receiver row for leg i (replacing a resolved `disputed` row); `dispute_handover` (next driver, leg i+1 en_route) writes a `disputed` receiver row and a high `handover_dispute` incident on leg i; `confirm_receipt` (owning-org coordinator `on_behalf_of`, or approved foster carer with `foster_can_confirm_receipt` linked to the destination) records or disputes the final receipt; `complete_request` keeps its rules but inserts the receiver row only if missing and refuses a disputed one. `get_request_detail` shows the first open leg so later legs are claimable. D33 "single-leg only" no longer applies. No new dependency. |
| D37 | **No volunteer-to-volunteer handovers and no multi-driver relays in the MVP.** Animals are handed over by professionals at pickup, driven by one volunteer, and received by a professional or an approved foster carer at the destination. Reason: animal welfare; a non-professional handover can strand an animal if a driver does not turn up. Implementation (migration 000021, undoing 000019 and 000020 which stay in history because they were applied): `transport_legs` allows one leg per request (`unique (request_id)`, `check (seq = 1)`), leg editor, split/merge, `dispute_handover`, `refresh_progress_status` and the chain validator are dropped, `handover_point` locations, `handover_dispute` incidents and disputed confirmations no longer exist, single-leg bodies of the progress and request RPCs are restored. Kept: `confirm_receipt(request, note)` — final-destination receipt by an approved foster carer with `foster_can_confirm_receipt` linked to the destination, or the owning organisation's coordinator (`on_behalf_of`); `complete_request` records the receipt on the coordinator's behalf if none exists. No new incident rules. Relays can return post-MVP only with a new decision. | Product decision |
| D38 | Notifications and scheduling (migration 000022): clients read notifications only through `list_my_notifications` (own rows; returns reference, animal name, the caller's latest assignment on the leg, and `org_id` only for active coordinators of the request's org), `count_my_unread_notifications`, `mark_notifications_read` (own rows only); the only user preference exposed is `reminders_enabled` via `get_my_notification_preferences` / `set_my_notification_preferences`. `send_assignment_reminders(p_now)` (24 h reminder when the pickup window opens in >2 h and ≤24 h, volunteer and coordinators; 2 h reminder within 2 h, volunteer only; confirmed, not started legs; active volunteers; honours `reminders_enabled`; dedupe `remind:{assignment}:{24h|2h}`) and `delete_expired_journeys(p_now)` (7 days after `depart_at`) are not callable by clients; `p_now` is a test hook. pg_cron jobs: `pawlift-sweep-assignments` every 5 min, `pawlift-reminders` every 15 min, `pawlift-journey-cleanup` daily 16:00 UTC; lazy expiry in RPCs stays (D11). Deferred: saved journeys, `nearby_request` and `route_match` notifications (and their preference toggles). No new dependency. | Scope agreed for 6a |

Add new decisions here with a one-line reason (including any new dependency).

## 3. Data model (key columns only)

All tables: `id uuid pk`, `created_at`, `updated_at`; `is_demo boolean` where data can be seeded. Foreign keys, check constraints and indexes on every FK and status column.

- `profiles` — `id = auth.users.id`, display_name, phone (private), home_suburb_id, nav_app (`google|apple|waze`), account_status (`active|suspended`). Created by trigger on signup.
- `platform_admins` — user_id. No client writes.
- `organisations` — name, type (`rescue_group|charity|council_pound|shelter|vet_clinic|other`), registration_details, contact_name/email/phone (private), operating_area, website, description, verification_status (`pending|verified|rejected|suspended`), is_demo.
- `organisation_members` — org_id, user_id, is_coordinator, is_volunteer, is_foster_carer, status (`invited|requested|active|removed`), foster_approved_by/at, foster_can_confirm_receipt, approved_by/at. Unique (org_id, user_id).
- `invitations` — org_id, token_hash, email (nullable = open link), roles, created_by, expires_at, max_uses, uses, revoked_at.
- `volunteer_profiles` — user_id, species_ok (`cat|dog|other`[]), max_size, has_carrier, vehicle_notes, availability (jsonb weekly slots + notes), guidelines_version_accepted, guidelines_accepted_at, verification_status (`pending|verified|rejected|suspended`).
- `verification_records` — subject_type (`organisation|volunteer`), subject_id, decision, checks_performed (jsonb list of exactly what was checked), reason, decided_by, decided_at. Append-only.
- `locations` (public part) — org_id, kind (`pound|shelter|rescue_facility|vet|foster_home|other`), label_public, suburb_id, approx_point (suburb centroid), is_confirmed_destination, confirmed_by/at, linked_user_id (foster).
- `location_private` — location_id, exact_address, exact_point, contact_name, contact_phone, instructions. No direct client SELECT; read via `get_leg_private_details()`.
- `transport_requests` — org_id, reference, animal_name, species, photo_path, urgency (`routine|soon|urgent`), required_date, deadline, handling_requirements, carrier_requirements, status, release_authority_attested_by/at, origin_location_id, destination_location_id, published_at, completed_at, cancelled_at, cancel_reason, version, is_demo.
- `request_private` — request_id, medical_notes, coordinator_instructions.
- `transport_legs` — request_id, seq, from_location_id, to_location_id, window_start, window_end, status, started_at, collected_at, delivered_at, cancelled_at, version. Exactly one leg per request: unique (request_id), seq = 1 (D37).
- `transport_assignments` — leg_id, volunteer_id, kind (`claim|offer`), status, journey_id, idempotency_key, reserved_until, offer_expires_at, confirmed_by/at, ended_at, end_reason. **Partial unique index on leg_id where status in (`offered`,`reserved`,`confirmed`).** Unique (volunteer_id, idempotency_key).
- `handover_confirmations` — leg_id, role (`giver|receiver`), confirmed_by, on_behalf_of (nullable), confirmed_at, outcome (`ok`), note. A `giver` row is written at delivery, a `receiver` row at final-destination receipt (D37).
- `journeys` — user_id, origin_point, destination_point, depart_at, max_detour_min, notify_matches, expires_at. Owner-only. Deleted 7 days after depart_at.
- `route_cache` — cache_key (hash of rounded coordinates + profile), provider, duration_s, distance_m, legs jsonb, created_at. No client access; used by server routing code through an RPC.
- `incidents` — request_id, leg_id, raised_by, type (`delay|animal_welfare|vehicle|late_withdrawal|no_show|other`), severity (`low|high`), description, status (`open|acknowledged|resolved`), resolution, resolved_by/at.
- `notifications` — user_id, type, request_id, leg_id, dedupe_key, payload (non-sensitive), read_at. Unique (user_id, dedupe_key).
- `notification_preferences` — user_id, nearby_enabled (default false), nearby_radius_km, reminders_enabled (default true), route_match_enabled (default true).
- `audit_logs` — actor_id, action, entity_type, entity_id, org_id, before/after (redacted jsonb), reason, created_at. Insert only from RPCs; no client write policy.
- Views: `public_requests` (open published requests: species, name, photo, suburbs, approx points, window, deadline, urgency, requirements summary, org name). Never includes private columns.

## 4. Access matrix

Roles: **Anon** · **User** (signed in) · **Vol** (verified volunteer) · **Assigned** (confirmed volunteer on that leg) · **Foster** (receiving foster for that leg) · **Coord** (active coordinator of the owning org) · **Other coord** · **Admin**

| Data | Anon | User | Vol | Assigned | Foster | Coord | Other coord | Admin |
|---|---|---|---|---|---|---|---|---|
| Public request card (open, published) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Draft / cancelled request | – | – | – | – | – | ✓ | – | ✓ |
| Exact addresses, contacts, instructions for a leg | – | – | – | own leg endpoints only | own home only | ✓ | – | via logged reason |
| Medical notes | – | – | – | own request | – | ✓ | – | via logged reason |
| Foster identity and contact | – | – | – | final-leg driver: name + phone | self | ✓ (own org) | – | via logged reason |
| Volunteer directory (names, capabilities, availability) | – | – | – | – | – | own org members | – | ✓ |
| Journeys | – | owner | owner | owner | owner | – | – | – |
| Assignments | – | own | own | own | – | own org | – | ✓ |
| Incidents | – | own | own | own request | own leg | own org | – | ✓ |
| Organisation contacts and registration details | – | – | – | – | – | ✓ | – | ✓ |
| Public organisation card (name, type, area, verified badge) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Verification records | – | own | own | own | own | own org | – | ✓ |
| Notifications | – | own | own | own | own | own | own | own |
| Audit log | – | – | – | – | – | own org | – | ✓ |

Rules:
- Private leg details are available only while the assignment is `confirmed` and the leg is not yet delivered. Access ends immediately on withdrawal, reassignment or cancellation (the access function checks current state every call).
- Suspended accounts (profile, volunteer or organisation) lose all operational actions immediately; reads limited to own history.
- Demo and real data never mix: real users never see `is_demo` rows; demo personas see only demo rows.
- Storage: animal photos public only once sanitised and published; nothing else is public. No exact coordinates in API responses, logs, photo metadata or URLs.

## 5. Lifecycle

### 5.1 Leg states (stored)
`open → offered | reserved → confirmed → en_route → collected → delivered`, plus `cancelled`.

| From → To | Actor | RPC | Guards | Timestamp |
|---|---|---|---|---|
| open → reserved | volunteer | `claim_leg` | §6 eligibility; request open; no active assignment | assignment.created_at, reserved_until |
| open → offered | coordinator | `offer_leg` | volunteer is active org member + §6 eligibility | offer_expires_at |
| offered → confirmed | offered volunteer | `accept_offer` | re-check eligibility; offer not expired | confirmed_at |
| offered → open | volunteer / coord / expiry | `decline_offer` / `withdraw_offer` / sweep | — | ended_at |
| reserved → confirmed | coordinator | `confirm_assignment` | re-check eligibility; still reserved | confirmed_by/at |
| reserved → open | coord / volunteer / expiry | `release_assignment` / `withdraw` / sweep | — | ended_at |
| confirmed → en_route | assigned volunteer | `start_leg` | within 3 h before window_start or later | started_at |
| confirmed / en_route → open | assigned volunteer | `withdraw` | not collected; within 2 h of window_start → auto `late_withdrawal` incident | ended_at |
| confirmed / en_route → open | coordinator | `reassign` | not collected | ended_at, reason |
| en_route → collected | assigned volunteer | `confirm_pickup` | — | collected_at |
| collected → delivered | assigned volunteer | `confirm_delivery` | —; records the giver confirmation | delivered_at |
| any pre-collected → cancelled | coordinator | `cancel_request` | the leg is not collected | cancelled_at, reason |

A collected leg cannot be cancelled or reassigned directly: the coordinator uses an incident and contacts the volunteer.

### 5.2 Request states
Stored, recomputed by `refresh_request_status()` inside every leg RPC.
- **Draft** → **Open** via `publish_request` (coordinator). Guards: org verified (or demo org in demo env), caller active coordinator, destination confirmed, release authority attested, requirements present, legs form a valid chain (§7).
- **Open:** the leg is open or offered.
- **Matched** (derived, display only): open and at least one eligible candidate exists. Never stored.
- **Assigned:** the leg is reserved (awaiting coordinator).
- **Confirmed:** the leg is confirmed, not started.
- **En route:** the driver has started and not yet collected.
- **Collected:** the animal is collected, not yet delivered.
- **Delivered:** the leg is delivered. Receipt at the destination is confirmed by `confirm_receipt` or on completion (§7).
- **Completed:** coordinator `complete_request` from Delivered, with no open high-severity incidents.
- **Cancelled:** coordinator, from Draft/Open/Assigned/Confirmed/En route with nothing collected.
- **Needs assistance:** badge while any open incident has severity high. Does not change the stored status.

Edits after publish: changes to a leg's locations or window move its confirmed assignment back to `offered` (reconfirmation) and notify the volunteer.

## 6. Claims, offers, reservations, cancellation

- **Eligibility (re-checked in every RPC):** profile active; volunteer verified; current guidelines accepted; species and size/carrier requirements match capabilities; no other active assignment whose window overlaps; demo/real match.
- **Atomic claim:** `SELECT … FOR UPDATE` on the leg, then insert assignment; the partial unique index is the final guarantee. Losing concurrent claimers get "Someone else has just offered to take this one."
- **Idempotency:** clients send a UUID per action; repeated `claim_leg` with the same (volunteer, key) returns the existing row.
- **Reservation hold:** `reserved_until = least(now() + 4 h, window_start)`. Expired → assignment `expired`, leg `open`, volunteer and coordinators notified.
- **Offer validity:** `offer_expires_at = least(now() + 24 h, window_start − 1 h)`. One active offer per leg.
- **Withdrawal:** allowed until collected; late (within 2 h of window_start) creates an incident and urgent coordinator notification. After collection the volunteer reports an incident instead.
- **Reassignment:** ends the current assignment (`released`, reason recorded), revokes access instantly, leg returns to `open` or is offered to another volunteer.
- **Cancellation:** ends all active assignments as `cancelled`, notifies volunteers, revokes access, keeps full history.

## 7. Handover and receipt

No volunteer-to-volunteer handovers or relays in the MVP (D37).
- **At pickup:** a professional (pound, shelter, rescue or vet staff) hands the animal to the one assigned volunteer; the volunteer records it with `confirm_pickup`.
- **At the destination:** the volunteer records `confirm_delivery` (giver row in `handover_confirmations`).
- **Receipt:** the receiver is confirmed by the authorised foster carer (if `foster_can_confirm_receipt` and linked to the destination home), or the owning organisation's coordinator on their behalf (`on_behalf_of` recorded), via `confirm_receipt`. `complete_request` records the coordinator's receipt if none exists.
- **Problems** use the existing incident flow (`report_incident`, `resolve_incident`); there is no separate dispute flow.
- **Completion:** coordinator `complete_request` once the request is delivered and no high-severity incident is open.

## 8. Foster carers

- A coordinator invites or links a member with `is_foster_carer`; approval recorded as `foster_approved_by/at` for that organisation. PawLift does not certify foster carers; UI wording says "approved by <organisation>".
- Each approving org owns its own `foster_home` location for the carer (duplicated per org if needed, so orgs stay isolated).
- A foster carer can be a destination only when approved and the location is confirmed. They can also be a volunteer (separate flag, separate verification).
- Foster carers cannot publish requests unless they also hold `is_coordinator`.
- They see: their own home location, incoming deliveries for it (animal, suburb of origin, ETA window, driver first name and phone once confirmed), and a "Received" action if permitted.

## 9. Matching and routing

Input: origin, destination, depart_at (default now), max detour (default 15 min; 5–60), user's capabilities.

1. **Baseline:** route O → D (cached).
2. **Prefilter (SQL/PostGIS, free):** open legs with no active assignment, compatible species and requirements, user eligible; straight-line detour `d(O,P) + d(P,Q) + d(Q,D) − d(O,D)` within a generous bound derived from max detour; pickup window and deadline plausible for depart_at. Keep the best 5.
3. **Route candidates:** ORS directions O → P → Q → D (one call each, segment durations returned). Detour = total − baseline.
4. **Feasibility:** arrival at P within the pickup window (waiting allowed up to 20 min); add 5 min handling at P and at Q; arrival at Q ≤ deadline; detour ≤ max.
5. **Order:** feasible first, then urgency, then detour minutes.
6. **Display:** "+8 min driving · about 10 min for pickup and handover" with source label: "Estimate: openrouteservice (OpenStreetMap data), no live traffic" or "DEMO estimate".
7. **Quota guard:** ≤ 6 routing calls per search; cache 24 h by rounded (~100 m) coordinates; on ORS error/quota → show an honest "Couldn't calculate detours right now" state and nearby results only. Never substitute straight-line figures as travel times.
8. **Nearby list:** ordered by straight-line distance from user point or chosen suburb centroid to the pickup approx point, shown as "about 6 km away". Unknown location → "Showing Western Melbourne" label, no distances.
9. Journeys stay private (owner-only); notifications for saved future journeys use only the prefilter and say "Possible match — open to check the detour".

## 10. Notifications

Inserted inside the RPC that causes them, with `ON CONFLICT (user_id, dedupe_key) DO NOTHING`. Payloads contain suburbs and names only, never exact addresses.

| Type | Trigger | Recipients | Dedupe key |
|---|---|---|---|
| nearby_request | publish | opted-in verified volunteers within radius whose capabilities fit (max 50) | `nearby:{request}` |
| route_match | publish | owners of saved future journeys passing prefilter | `route:{request}:{journey}` |
| claim_received | claim | org coordinators | `claim:{assignment}` |
| offer_received | offer | volunteer | `offer:{assignment}` |
| assignment_confirmed | confirm / accept | volunteer + coordinators | `confirmed:{assignment}` |
| hold_expired | sweep | volunteer + coordinators | `expired:{assignment}` |
| reminder_24h / reminder_2h | pg_cron every 15 min | assigned volunteer (24 h also coordinators) | `remind:{assignment}:{24h|2h}` |
| picked_up / delivered | pickup / delivery | coordinators, next-leg driver, final receiver | `{status}:{leg}` |
| cancelled / reassigned | cancel / reassign / withdraw | affected volunteers and coordinators | `ended:{assignment}` |
| incident | incident opened | coordinators; admins if high | `incident:{id}` |

RLS: users read only their own notifications. Web push and email deferred.

## 11. Demo strategy

- Runs only in `pawlift-dev` with `APP_ENV=demo`. `npm run demo:reset` refuses unless the Supabase project ref is in `DEMO_PROJECT_REFS`. Deletes only `is_demo` rows and demo users (`@demo.pawlift.invalid`), then reseeds. Must succeed twice in a row.
- Demo approvals display "DEMO verification — not a real check".
- Persona switcher (demo env only) signs in seeded accounts using `DEMO_PASSWORD` from env.
- **Personas:** Demo Admin; Sam — coordinator, Western Paws Rescue (DEMO); Priya — volunteer, St Albans, cat carrier; Tom — volunteer, Sunshine, existing org volunteer; Lee — volunteer, Footscray; Jordan — volunteer, pending verification; Mia — foster carer + volunteer, Werribee.
- **Organisations and places (all fictional):** Western Paws Rescue (DEMO); Westgate Animal Pound (DEMO), Melton; Bayside Cat Haven (DEMO), Geelong; Kindpaws Vet (DEMO), Footscray. Exact addresses are obviously fictional.
- **Requests:** Biscuit the cat, pound in Melton → Geelong haven (route match for St Albans → Geelong; council pound transfer); dog in Sunshine → Footscray vet (nearby); dedicated offer to Tom; delivery to foster Mia; one completed historical transport; one draft; one urgent open request.
- Demo route fixtures cover every seeded suburb pair used by these stories; all labelled DEMO estimate.

## 12. Batches, checkpoints and acceptance gates

One checkpoint per session. Commit and push after each passing checkpoint.

**Batch 1 — Foundation**
- 1a Scaffold Next.js/TS/Tailwind/ESLint/Vitest; design tokens; static map-first shell (MapLibre + OpenFreeMap, bottom sheet placeholder); `.env.example`; README stub; private GitHub repo `pawlift` pushed. *Gate:* build, lint, typecheck, test pass; map renders; repo on GitHub.
- 1b Supabase link; migrations for §3 core tables, PostGIS, RLS default-deny on every table; generated types. *Gate:* `db push` clean; types compile.
- 1c Auth (sign up/in/out), profile trigger, role-aware shell from memberships, demo persona switcher (demo env only). *Gate:* sign-in works; switcher absent when `APP_ENV≠demo`.
- 1d `test:db` harness and first RLS tests: anon can't read private tables; users can't self-grant admin/coordinator/verified; cross-org member isolation; service role not imported in `src/`. *Gate:* all pass.

**Batch 2 — Supply**
- 2a Org registration; admin verification with recorded checks and reasons; resubmission path.
- 2b Invitations (open link and email-bound), join flow, membership requests, approve/remove; volunteer profile, guideline acceptance, admin volunteer verification.
- 2c Locations (public/private split), confirmed destinations, foster association and foster home.
- 2d Request create/edit (single leg auto-created), photo sanitising, publish guards, `public_requests` view and listing.
- *Gate:* unverified org cannot publish; drafts invisible to others; `public_requests` exposes no private columns; foster details invisible to other orgs and volunteers; demo/real isolation test.

**Batch 3 — Journeys**
- 3a Map home, bottom sheet, nearby ordering, location explainer + manual suburb fallback, "Showing Western Melbourne" state.
- 3b Routing adapter (`ors`, `demo`), cache, honest setup/error states; coordinator address geocoding.
- 3c Matching engine, journey planner UI, route-matched section with detour and source labels, navigation deep links.
- *Gate:* unit tests for detour arithmetic, pickup-before-drop-off, window/deadline feasibility, waiting allowance, capability filter, max detour; St Albans → Geelong shows Biscuit labelled DEMO; with no ORS key nothing claims to be live.

**Batch 4 — Transport (DEMO MILESTONE)**
- 4a `claim_leg`, `confirm_assignment`, `release_assignment`, expiry sweep; concurrency test (parallel claims → exactly one succeeds); idempotent retry test.
- 4b Offers to existing volunteers, accept/decline, withdraw (incl. late), reassign, cancel; access revocation tests; suspended-account tests.
- 4c Volunteer assignment screens (start, pickup, delivery, incident, navigation buttons); coordinator dashboard (needs-a-driver first), confirm and complete; audit trail view.
- *Gate:* BRIEF §13 volunteer story steps 1–10 work end to end by clicking; all 4a/4b tests pass.

**Batch 5 — removed (D37).** Relays and volunteer-to-volunteer handovers are out of the MVP; batch numbers are kept so references stay valid.

**Batch 6 — Operations**
- 6a Notifications UI, reminder preference, pg_cron reminders and sweeps, journey deletion (done, D38). Saved journeys with `nearby_request` / `route_match` notifications are a separate later checkpoint.
- 6b Foster receiving workflow; transport history; org settings; admin oversight, incidents, audit log, logged private-access.
- 6c Public pages: About, How it works, Transport safety, Terms and Privacy (marked DRAFT for professional review).
- *Gate:* dedupe test; recipient permission test; reminder timing test with a fixed clock; suspension immediately blocks actions.

**Batch 7 — Release**
- Opus review of requirement coverage (BRIEF §15) and security; Sonnet fixes.
- Accessibility pass (keyboard, focus, labels, contrast), responsive polish, Playwright e2e for both demo stories plus the foster demo.
- README complete; Vercel preview prepared (public deploy only with explicit OK).
- *Gate:* all suites green; demo reset succeeds twice; report verified capabilities, blockers and launch prerequisites.

## 13. Setup and credentials

User enters values directly into `.env.local` (never in chat):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the dashboard may call this the publishable key)
- `SUPABASE_SERVICE_ROLE_KEY` (secret key; scripts only)
- `APP_ENV=demo`, `DEMO_PROJECT_REFS=<project ref>`, `DEMO_PASSWORD=<any strong value>`
- `ORS_API_KEY`, `ORS_BASE_URL` (Batch 3; optional — DEMO fallback without them)

Supabase dashboard: create `pawlift-dev` (Sydney region). For development, email confirmation may be turned off to avoid default email rate limits; production must re-enable it with custom SMTP. Free projects can pause when inactive — restore from the dashboard.

## 14. Open questions (defaults apply until answered)

- **Q1 Volunteer verification:** default admin-only. Alternative: verified orgs may verify their own existing volunteers for that org's assignments only (faster onboarding).
- **Q2 Anonymous browsing:** default yes — public cards visible without signing in; claiming requires an account.
- **Q3 Timings:** reservation hold 4 h, offer 24 h, late withdrawal 2 h, max detour default 15 min, handling 5 min per stop.
