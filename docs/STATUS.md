# PawLift — status

Updated: 2026-11-08 · Relays removed (D37). Batch 5 no longer exists. Batches 1–4 done.

## Current
- Batches 1–4 DONE. Batch 5 (relays) removed by product decision D37; one leg per request, enforced in the database.
- Next: checkpoint **6a**.

## Done
- Product brief → `docs/BRIEF.md`; architecture, decisions (D1–D34), data model, lifecycle, batch gates → `docs/PLAN.md`

## Environment (verified 2026-11-08)
- macOS; node v26.13.0, npm 11.20.0, git 2.50.1, gh 2.103.3 (logged in as talhatawsif).
- Next 16.4.5, React 19.3, Tailwind 4, maplibre-gl 6.16, vitest 5.1, sharp 0.35.
- Supabase `pawlift-dev` and `.env.local` exist. Not yet created: openrouteservice key.

## Blockers
None.

## Exact next action
Checkpoint **6a** (PLAN §12, §10): notifications UI and preferences, pg_cron reminders and sweeps (assignment expiry, journey deletion). Plan mode first (touches database). There is no `upstream_change` notification any more.

Notes: `db push --remote --yes` needed in agent mode (ask first). "Confirm email" still ON in pawlift-dev. Pages that read cookies wrap an async content component in `<Suspense>` (see `src/app/page.tsx`); in dev the fallback `<main>Loading…</main>` stays in the DOM, so read all `main` elements. Browser pane must be *shown* (`show_pane preview`). Generated RPC types make nullable args non-null; cast at the call site. Never render lucide components at module scope on the server. Dev server often already runs on :3000 (use it; `preview_start` fails). Demo rows are visible only to demo personas (DEMO switcher: Priya volunteer, Sam coordinator); `npm run demo:reset` refreshes windows (seed time → +7 days) and now clears audit rows first.

## Relays removed (D37)
- Reverted the code, UI and tests of commits `8607d29` (5a leg editor) and `20eeb1c` (5b handovers) with `git revert --no-commit`; migrations `...000019` and `...000020` stay in the repo because they were applied, and migration `...000021_single_leg.sql` undoes them. Removed files: `src/components/LegEditor.tsx`, `tests/db/legs.test.ts`, `tests/db/handover.test.ts`; split/merge/update-leg actions, the Legs section, `dispute_handover` and relay/handover UI and fields.
- Database: `transport_legs` has `unique (request_id)` and `check (seq = 1)`; dropped `split_leg`, `merge_legs`, `update_leg`, `list_request_legs`, `validate_leg_chain`, `leg_edit_guard`, `dispute_handover`, `refresh_progress_status`; single-leg bodies restored for publish/update/progress/read RPCs; `handover_point` location kind, `handover_dispute` incident type and disputed confirmations removed. Kept `confirm_receipt(request, note)` (foster carer with receipt right at the destination, or owning coordinator on behalf); `complete_request` records receipt if missing. No new incident rules.
- Tested: `npm run test:db` 199/199 (new `tests/db/single-leg.test.ts`: second leg refused by the database, removed RPCs gone, `handover_point` rejected, receipt authorisation); `npm test` 36/36; lint, typecheck, build pass.
- Unverified: no browser check (the only UI change is removal); `confirm_receipt` has no screen yet (foster receiving workflow is 6b; coordinators use "mark complete"); relay-era demo seed rows do not exist.

## 4c summary
- Implemented: migrations `...000015` (RPCs `start_leg`, `confirm_pickup`, `confirm_delivery`, `complete_request`, `report_incident`, `resolve_incident`, `get_leg_private_details`, `list_my_assignments`, `get_request_detail`, `list_org_assignments`, `list_org_incidents`, `list_org_audit`), `...000016` (audit by request matches leg events), `...000017` (claims allowed until `window_end`, D34), `...000018` (private details left-join `request_private`); D33, D34 in PLAN. Pages: `/requests/[id]` (claim, idempotency key), `/assignments`, `/assignments/[id]` (private details, nav links, start/pickup/delivery/withdraw/report), `/org/[id]/dashboard` (needs-a-driver first; confirm, turn down, offer, withdraw offer, reassign, complete, resolve incident), `/org/[id]/audit`. Links from the map detail panel, route matches, account menu, org page. `scripts/demo-reset.mjs` now seeds contacts and `request_private` and clears audit rows.
- Tested: `npm run test:db` 191/191 (17 new in `tests/db/progress.test.ts`: window guards, order, private-details revocation by withdraw/reassign/cancel/delivery/suspension, no private fields in lists, completion guards, incidents, org isolation, claim window rule); `npm test` 36/36; lint, typecheck, build pass; `demo:reset` ran twice. Browser (pawlift-dev, DEMO personas): Priya claims Biscuit from the map detail panel → Sam confirms on the dashboard → Priya sees addresses, contacts and medical notes → start, pickup, delivery → details disappear → Sam completes → dashboard shows Completed → audit page lists six events. One 4a test changed (hold now caps at window end).
- Unverified: offer/accept, decline, withdraw, reassign, turn-down, release and incident forms in the browser (db tests only); Sam's notification list (no UI until 6a); mobile layout and keyboard use of new pages; navigation links open correctly (demo seed has addresses only, no exact points); route-match "View details" link (map detail panel link was clicked); `en_route` and `collected` screens were passed through but not inspected visually; `list_org_incidents` shows at most 50; relays and foster receipt not built (Batch 5/6); pg_cron not scheduled (6a); size requirements not enforced.

## 4b summary
- Implemented: migrations `...000012`–`...000014` (offers, accept/decline, withdraw incl. late, reassign, cancel with assignments); D32 in PLAN.
- Tested: `test:db` 174/174 at the time (25 new in `tests/db/offers.test.ts`). The 4b "revocation tested only as assignment status" gap is closed by `progress.test.ts`.
- Unverified: reassign-with-offer is an extension beyond PLAN §5.1.

## 4a summary
- Implemented: migration `...000011` (`claim_leg`, `confirm_assignment`, `release_assignment`, expiry sweep, helpers); D31.
- Tested: 20 tests in `tests/db/assignments.test.ts` (5-way parallel claim, idempotent retry, eligibility, overlap, expiry). The db tests share a few volunteers because Supabase auth rate-limits sign-ins.
- Unverified: pg_cron not scheduled (6a); `db push` target is labelled "production" by the CLI but is the only project, pawlift-dev.

## 3c summary
- Implemented: `src/lib/matching/`, `src/lib/nav-links/`, `src/app/journey/actions.ts`, `SearchCard`, `RouteMatches`, `scripts/demo-reset.mjs`; D30.
- Tested: 17 unit tests; browser: Priya, St Albans → Geelong shows Biscuit "+8 min driving", labelled DEMO.
- Unverified: **ORS request/response shapes never run against a real key** (hand-made bodies only); links open in the three apps; desktop layout; matcher treats relays as one pickup → drop-off.

## Earlier checkpoints (details in git history)
- 3b: routing adapter, cache RPCs, DEMO fixtures, geocoding (D29). 3a: map home, bottom sheet, suburb fallback (D28). Unverified: real browser geolocation; suburb centroids are approximate.
- 2d: requests, photo sanitising, publish guards (D26, D27). 2c: locations, destinations, foster homes (D24, D25). 2b: invitations, membership, volunteer profile and verification (D21–D23). 2a: org registration and admin verification. 1a–1d: scaffold, migrations, auth, db test harness.
- Standing unverified: mobile layout and keyboard navigation across pages; foster carers cannot edit their own home; signed-out invite links need sign-in then reopen.
