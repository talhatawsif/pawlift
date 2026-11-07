# PawLift — status

Updated: 2026-11-08 · Checkpoint 5b done (handover flow). Batch 5 in progress.

## Current
- Batches 1–4 DONE. Checkpoints 5a (leg editor) and 5b (handover flow) DONE.
- Next: checkpoint **5c**.

## Done
- Product brief → `docs/BRIEF.md`; architecture, decisions (D1–D34), data model, lifecycle, batch gates → `docs/PLAN.md`

## Environment (verified 2026-11-08)
- macOS; node v26.13.0, npm 11.20.0, git 2.50.1, gh 2.103.3 (logged in as talhatawsif).
- Next 16.4.5, React 19.3, Tailwind 4, maplibre-gl 6.16, vitest 5.1, sharp 0.35.
- Supabase `pawlift-dev` and `.env.local` exist. Not yet created: openrouteservice key.

## Blockers
None.

## Exact next action
Checkpoint **5c** (PLAN §12, §7): downstream disruption notices (`upstream_change`), reconfirmation on edits, parent completion rule (every leg delivered, all receipts confirmed, no unresolved dispute), splitting a collected leg via an incident. Plan mode first (touches RPCs). Relay matching is still one pickup → drop-off (D30).

Notes: `db push --remote --yes` needed in agent mode (ask first). "Confirm email" still ON in pawlift-dev. Pages that read cookies wrap an async content component in `<Suspense>` (see `src/app/page.tsx`); in dev the fallback `<main>Loading…</main>` stays in the DOM, so read all `main` elements. Browser pane must be *shown* (`show_pane preview`). Generated RPC types make nullable args non-null; cast at the call site. Never render lucide components at module scope on the server. Dev server often already runs on :3000 (use it; `preview_start` fails). Demo rows are visible only to demo personas (DEMO switcher: Priya volunteer, Sam coordinator); `npm run demo:reset` refreshes windows (seed time → +7 days) and now clears audit rows first.

## 5b summary
- Implemented: migration `...000020` (`refresh_progress_status`, relay-aware `progress_lock_internal`/`start_leg`/`confirm_pickup`/`confirm_delivery`, new `dispute_handover` and `confirm_receipt`, `complete_request` insert-if-missing, `list_my_assignments`/`list_org_assignments`/`get_request_detail` extended); D36. UI: relay label and "I've received the animal" / "Something's not right" on `/assignments/[id]`; "Animal arrived safely" / "Something's not right" on the coordinator dashboard (last leg only). Types regenerated.
- Tested: `npm run test:db` 220/220 (12 new in `tests/db/handover.test.ts`: two-driver relay, early pickup refused, dispute blocks and unblocks leg 2, completion blocked by dispute, receipt authorisation for coordinator/other org/foster with and without the right/wrong home, disputed receipt re-confirm, relay reads, claim screen shows next open leg); `npm test` 36/36; lint, typecheck, build pass.
- Unverified: **relay and handover UI not exercised in a browser** (demo seed has no handover point); mobile layout and keyboard use; foster receipt has no UI (6b); `complete_request` still allowed without an explicit receipt (rule tightening is 5c); intermediate delivered legs now appear under "On the way" on the dashboard; relays are not matched leg by leg (D30); a request that has started (leg 1 en_route) is no longer `open`, so later unclaimed legs cannot be claimed after that.

## 5a summary
- Implemented: migration `...000019` (`validate_leg_chain`, `leg_edit_guard`, `split_leg`, `merge_legs`, `update_leg`, `list_request_legs`; `publish_request`, `update_request`, `get_request_for_coordinator` made multi-leg aware; `leg_count` added); D35 in PLAN. UI: "Legs" section on `/org/[id]/requests/[requestId]` via `src/components/LegEditor.tsx`, actions `splitLeg`/`mergeLegs`/`updateLeg` in `src/app/org/[id]/requests/actions.ts`. Types regenerated.
- Tested: `npm run test:db` 208/208 (17 new in `tests/db/legs.test.ts`: split/merge round trip, renumbering, 5-leg cap, handover-kind and cross-org rejection, chronology, deadline, access denial, stale version, blocked once a leg is not open, audit rows, relay publish, `update_request` refusal); `npm test` 36/36; lint, typecheck, build pass.
- Unverified: **the Legs UI was not exercised in a browser** (demo seed has no handover points; add one on the locations page first); mobile layout and keyboard use; `update_request` compares the first leg's window exactly, so a relay seeded with sub-minute times would need the leg editor; relay requests are not matched leg by leg (D30); relays cannot yet be driven (5b).

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
