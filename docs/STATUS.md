# PawLift — status

Updated: 2026-11-08 · Checkpoint 3c done (Batch 3 complete).

## Current
- Batch 1, checkpoint **1a** DONE (scaffold + static map-first shell, repo pushed).
- Checkpoint **1b** DONE (migrations applied to pawlift-dev, types generated).
- Checkpoint **1c** DONE (auth, profile trigger, role-aware shell, demo persona switcher).
- Checkpoint **1d** DONE (`npm run test:db` harness + RLS tests; Batch 1 gate met).
- Checkpoint **2a** DONE (org registration, admin verification, resubmission).
- Checkpoint **2b** DONE (invitations, join flow, membership requests, volunteer profile, guidelines, admin volunteer verification).
- Checkpoint **2c** DONE (locations, confirmed destinations, foster approval and foster home).
- Checkpoint **2d** DONE (requests, photo sanitising, publish guards, public listing).
- Checkpoint **3a** DONE (map home, bottom sheet, nearby ordering, location explainer, suburb fallback).
- Checkpoint **3b** DONE (routing adapter, cache RPCs, DEMO fixtures, coordinator geocoding).
- Checkpoint **3c** DONE (matching engine, journey planner UI, nav links, `demo:reset` seed). Batch 3 gate met.
- Next: Batch 4, checkpoint **4a**: do NOT build via /next; start manually in plan mode.

## Done
- Revised product brief → `docs/BRIEF.md`
- Architecture, decisions, data model, access matrix, lifecycle, claim/relay/foster rules, matching, notifications, demo strategy, batch gates → `docs/PLAN.md`

## Environment (verified 2026-11-08)
- macOS; node v26.13.0, npm 11.20.0, git 2.50.1, gh 2.103.3 (logged in as talhatawsif).
- Next 16.4.5, React 19.3, Tailwind 4, maplibre-gl 6.16, vitest 5.1, sharp 0.35.
- Supabase `pawlift-dev` and `.env.local` exist. Not yet created: openrouteservice key.

## Blockers
None.

## Exact next action
Checkpoint **4a** (PLAN §12): `claim_leg`, `confirm_assignment`, `release_assignment`, expiry sweep, concurrency test (parallel claims → exactly one succeeds), idempotent retry test. It touches assignments, so start it manually in plan mode with the full checkpoint prompt.

Notes: `db push --remote --yes` needed in agent mode (ask first). "Confirm email" still ON in pawlift-dev. Pages that read cookies must wrap an async content component in `<Suspense>`; see `src/app/page.tsx`. Browser pane must be *shown* (`show_pane preview`). Generated RPC types make nullable args non-null; cast at the call site. Never render lucide components at module scope on the server (use static SVG, see `MapView.tsx`). Dev server often already runs on :3000. Demo rows are visible only to demo personas (sign in via the DEMO switcher, e.g. Priya); `npm run demo:reset` refreshes request windows (they run seed time → +7 days).

## 3c summary
- Implemented: `src/lib/matching/` (`prefilter`, `evaluate`, `orderMatches`, `matchJourney`; wait ≤20 min, 5 min handling at each end, ≤5 routed candidates + baseline = ≤6 calls); `src/lib/nav-links/` (Google, Apple, Waze); `src/app/journey/actions.ts` (`findRouteMatches`, nothing stored); `SearchCard` (suburb destination, depart time, max detour), `RouteMatches` ("On your route" + "Also nearby"), `BottomSheet` `top` slot; `scripts/demo-reset.mjs` + `npm run demo:reset`; DEMO fixtures retuned (St Albans–Melton 16, Melton–Geelong 52, same place 2 min); D30 in PLAN.
- Tested: `npm test` 36/36 (17 new in `tests/unit/matching.test.ts`: detour arithmetic, pickup before drop-off, window, 20 min wait, deadline, capability filter, max detour, prefilter, ordering, DEMO match, no-fixture failure); `test:db` 129/129; lint, typecheck, build pass; `demo:reset` succeeded twice. Browser (pawlift-dev, Priya persona): St Albans → Geelong shows Biscuit "+8 min driving · about 10 min", labelled DEMO, no live claim.
- Unverified: ORS path of the matcher (no key; request/response shapes still untested); links open correctly in the three apps; keyboard use of the destination combobox; desktop layout; matcher treats relays as one pickup → drop-off; capability filter in the UI (only the unfiltered path was run); `findRouteMatches` has no rate limit beyond the 6-call budget. `demo:reset` seeds people, orgs, locations, 4 requests only; offers, relay, completed transport and verification records wait for Batch 4+ tables; seeded Priya's UI path for cat-with-carrier filter not checked.

## 3b summary
- Implemented: migration `...000010_routing_cache_geocode.sql` (`get_cached_route`, `put_cached_route`, `set_location_exact_point`, trigger clearing the point on address change); `src/lib/routing/` (`types`, `demo`, `ors`, `index` with `getRoute`, `RouteBudget`, `geocodeAddress`); `GeocodeButton` and `geocodeLocation` action on `/org/[id]/locations`; D29 in PLAN.
- Tested: `npm run test:db` 129/129 (5 new in `tests/db/routing.test.ts`); `npm test` 19/19 (12 new in `tests/unit/routing.test.ts`: key rounding, fixtures, no-key = DEMO only, budget, 429/500 mapping, parsing); lint, typecheck, build pass.
- Unverified: **the ORS request and response shapes were written from memory of the API and never run against a real key** (parsing is unit-tested on hand-made bodies only); geocode button in the browser; DEMO fixture minutes are guesses; no UI shows route estimates yet (3c); the 24 h expiry is checked at read, with no cleanup job.

## 3a summary
- Implemented: migration `...000009_public_suburbs.sql` (`list_public_suburbs`, anon-callable); `src/lib/geo/distance.ts`; `HomeClient`, `BottomSheet` (peek/half/full, drag + keyboard), `RequestCard`, `LocationExplainer`, `SearchCard` (origin chip), `MapView` (paw pins, selected enlarges, urgent amber), `src/app/suburbs/actions.ts`; D28 in PLAN. Home reads `public_requests`.
- Tested: `npm run test:db` 124/124 (3 new in `tests/db/suburbs.test.ts`); `npm test` 7/7 (3 new distance); lint, typecheck, build pass. Browser (real pawlift-dev, 3 throwaway published requests, since deleted): list and pins render, suburb picker works signed out, choosing Williamstown re-sorts nearest-first and flies the map, card opens detail in the sheet.
- Unverified: real browser geolocation grant/deny (only the suburb path was run); pin click → card; sheet drag gesture and keyboard arrows; desktop layout (sheet is max-w-md, not the left-panel layout); focus trap in the explainer; suburb centroids are approximate; destination field and search button are disabled until 3c.

## 2d summary
- Implemented: migrations `...000007_requests.sql` (RPCs `create_request`, `update_request`, `set_request_photo`, `publish_request`, `cancel_request`, `get_request_for_coordinator`, `list_org_requests`; storage buckets and policies; `public_requests` demo isolation) and `...000008` (conflict code); `src/lib/requests.ts`, `src/lib/time/melbourne.ts`; pages `/org/[id]/requests[/new|/id]`, public `/requests`; `RequestForm`, `RequestActions`; sharp photo pipeline; D26, D27 in PLAN.
- Tested: `npm run test:db` 121/121 (19 new in `tests/db/requests.test.ts`); `npm test` 4/4; lint, typecheck, build pass. Browser (real pawlift-dev, throwaway user/org, since deleted): create draft, upload photo (draft photo not publicly fetchable), publish, request appears on `/requests` with suburbs only, photo public after publish. EXIF/GPS stripped confirmed with a synthetic JPEG.
- Unverified: edit/cancel/remove-photo buttons in the browser; mobile layout beyond a narrow pane; keyboard navigation; a failed photo copy at publish only shows a note (no retry); public copy of a photo stays after cancel; `/requests` has no link from the map home yet; windows entered in Melbourne time tested only by unit test.
- Test helpers now delete requests before orgs and null `release_authority_attested_by` before deleting users.

## 2c summary
- Implemented: migration `20261108000006_locations_fosters.sql` (RPCs `list_suburbs`, `create_location`, `update_location`, `confirm_destination`, `list_org_locations`, `set_foster_status`, `upsert_foster_home`, `get_my_foster_homes`; ~40 seeded suburbs); `src/lib/locations.ts`; `/org/[id]/locations`, `/foster`, foster controls on `/org/[id]/members`; `LocationForm`; account-menu link; D24, D25 in PLAN.
- Tested: `npm run test:db` 102/102 (19 new in `tests/db/locations.test.ts`: coordinator/verified guards, centroid-only public point, private-field isolation, direct table denial, confirmation cleared on move, handover point refused, foster approve/home/idempotency/revoke, audit, demo flag). lint, typecheck, `npm test` 2/2, build pass.
- Unverified: browser UI for all new pages (not exercised); mobile layout; keyboard navigation; **suburb centroids are approximate hand-typed values**; foster carers cannot yet edit their own home; `can_confirm_receipt` checkbox is not pre-filled from current state.

## 2b summary
- Implemented: migration `20261108000005_membership_volunteers.sql` (16 RPCs: invitations create/revoke/list/preview/accept, joinable orgs, request/decide membership, org member list, volunteer profile upsert, guidelines, resubmit, own profile, admin list/get/decide volunteer; helpers `is_verified_volunteer`, `is_active_coordinator`, `invitation_state`); `src/lib/membership.ts`, `src/lib/guidelines.ts`; pages `/org/[id]/members`, `/join`, `/join/[token]`, `/volunteer`, `/admin/volunteers[/id]`; `InviteForm`, `AcceptInvitation`, `VolunteerForm`; `DecisionForm` generalised (takes the action); D21–D23 in PLAN.
- Tested: `npm run test:db` 83/83 (20 new in `tests/db/membership.test.ts`: invite guards, max uses, email-bound, revoke/expiry, org-suspended, request/approve/remove, coordinator guard, demo isolation, profile validation, guidelines, verification transitions, admin-only). lint, typecheck, `npm test` 2/2, build pass. Browser (real pawlift-dev, throwaway users, since deleted): coordinator creates open link → volunteer accepts → saves profile → accepts guidelines → admin verifies; DB confirmed.
- Unverified: browser UI for requests/approve/remove, email-bound invites and mailto link, revoke, rejection/resubmission and suspend (db tests only); mobile layout; keyboard navigation; clipboard copy button. Signed-out users opening an invite must sign in then reopen the link (sign-in has no return-path yet).

## 2a summary
- Implemented: migration `20261108000004_org_registration_verification.sql` (`register_organisation`, `resubmit_organisation`, `admin_decide_organisation`, `get_org_for_coordinator`, `admin_list_organisations`, `require_active_user`, append-only trigger); `src/lib/org.ts`; actions `src/app/org/actions.ts`, `src/app/admin/actions.ts`; pages `/org/new`, `/org/[id]`, `/admin/organisations`, `/admin/organisations/[id]`; `OrgForm`, `DecisionForm`; account menu links; D19/D20 in PLAN.
- Tested: `npm run test:db` 63/63 (10 new: registration, cap, suspended, admin-only, guards, transitions, immutability, resubmission). lint, typecheck, `npm test` 2/2, build pass. Browser (real pawlift-dev, throwaway users, since deleted): register → pending page; non-admin gets 404 on `/admin`; admin rejects (empty reason refused, then with reason); coordinator sees reason, resubmits, status returns to pending.
- Unverified: admin "Verify" and suspend/reinstate buttons in the browser (covered by db tests only); mobile layout; keyboard navigation; `suburbs` read policy still not needed.
- `.claude/launch.json` (dev server config) and `AGENTS.md` left untracked.
