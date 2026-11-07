# PawLift — status

Updated: 2026-11-08 · Checkpoint 2d done (Batch 2 complete).

## Current
- Batch 1, checkpoint **1a** DONE (scaffold + static map-first shell, repo pushed).
- Checkpoint **1b** DONE (migrations applied to pawlift-dev, types generated).
- Checkpoint **1c** DONE (auth, profile trigger, role-aware shell, demo persona switcher).
- Checkpoint **1d** DONE (`npm run test:db` harness + RLS tests; Batch 1 gate met).
- Checkpoint **2a** DONE (org registration, admin verification, resubmission).
- Checkpoint **2b** DONE (invitations, join flow, membership requests, volunteer profile, guidelines, admin volunteer verification).
- Checkpoint **2c** DONE (locations, confirmed destinations, foster approval and foster home).
- Checkpoint **2d** DONE (requests, photo sanitising, publish guards, public listing).
- Next: Batch 3, checkpoint **3a** (map home, bottom sheet, nearby ordering).

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
Batch 3, checkpoint 3a (PLAN §12): map home, bottom sheet, nearby ordering, location explainer + manual suburb fallback, "Showing Western Melbourne" state. Read `/requests` (`src/app/requests/page.tsx`) and `public_requests` for the data. The demo seed/`demo:reset` is still not written; do it before demo-dependent work (3c at the latest).

Notes: `db push --remote` needs `--yes` in agent mode (ask the user first). "Confirm email" still ON in pawlift-dev. Pages that read cookies must wrap an async content component in `<Suspense>`; see `src/app/org/[id]/page.tsx`. Browser pane must be *shown* (`show_pane preview`) or Suspense pages stay on "Loading…". Generated RPC types make nullable args non-null; cast at the call site.

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

## 1d summary
- Implemented: `vitest.db.config.ts`, `tests/db/helpers.ts` (refuses unless project ref is in `DEMO_PROJECT_REFS`; creates/cleans up throwaway users and orgs), `tests/db/rls.test.ts`, `tests/unit/no-service-role-in-src.test.ts`, script `test:db`.
- Tested: `npm run test:db` 53/53 pass against pawlift-dev (anon and signed-in users denied select/insert/update/delete on all 21 tables; no self-grant of admin, coordinator, org verification, volunteer verification or account status; `get_my_context` isolates orgs; `public_requests` readable, private columns absent). `npm test` 2/2, lint, typecheck, build pass. Cleanup verified (0 leftover test users/orgs).
- Unverified: positive-path RLS (no policies exist yet); the `public_requests` private-column check probes a few guessed names and a `select *` only (no rows seeded).

## 1c summary
- Implemented: migration `...000003` (profile trigger, `get_my_context()` RPC), `@supabase/ssr` clients (`src/lib/supabase/server.ts`, `src/proxy.ts`), sign-in/sign-up pages and actions (`src/app/auth/actions.ts`), `AccountMenu` (role labels from memberships, sign out), `DemoSwitcher` (server-checked `APP_ENV=demo`).
- Tested: lint, typecheck, test, build pass. Sign-in with a service-role-created confirmed user worked in the browser; trigger created the profile (`is_demo=false`); sign-out works; switcher absent with `APP_ENV=production`, present with `demo`; persona click redirects with a "not seeded" notice. Test user deleted.
- Unverified: sign-up end to end (Confirm email is on, no email read); persona sign-in (demo users arrive with the seed); role menu with real memberships; mobile layout. Menu has no links to `/org` or `/admin` yet (routes don't exist).
- Untracked `AGENTS.md` (appeared from a package install) left uncommitted.

## Last session log
- 1a: scaffolded via create-next-app (in scratchpad, copied in), added maplibre-gl, lucide-react, vitest (D17). Ran lint/typecheck/test/build: all pass.
- 1b (partial): wrote `supabase/migrations/20261108000001_core_tables.sql` (all §3 tables + `suburbs`, RLS enabled and all grants revoked, no policies) and `...000002_public_requests_view.sql`. `db push --remote` clean; dry-run shows up to date; anon REST gets 42501 on profiles/location_private/audit_logs, `public_requests` returns []. typecheck/lint/test/build pass. Dated placeholders; `suburbs` table added (PLAN §3 references suburb_id but doesn't list it) — add to PLAN once confirmed.
