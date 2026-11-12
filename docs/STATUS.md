# PawLift — status

Updated: 2026-11-09 · Menu drawer and "Add lift" checkpoint done (UI only). Batch 7 gate passed earlier. MVP demo-ready, not launch-ready.

## Current
- Batches 1–4, 6 DONE. Batch 5 removed (D37). Batch 7 (7a–7c) DONE. All planned batches complete.
- Launch status and prerequisites: `docs/LAUNCH_REPORT.md`. Saved journeys with notifications still unbuilt (optional).

## Done
- Product brief → `docs/BRIEF.md`; architecture, decisions (D1–D44), data model, lifecycle, batch gates → `docs/PLAN.md`

## Environment (verified 2026-11-08)
- macOS; node v26.13.0, npm 11.20.0, git 2.50.1, gh 2.103.3 (logged in as talhatawsif).
- Next 16.4.5, React 19.3, Tailwind 4, maplibre-gl 6.16, vitest 5.1, sharp 0.35.
- Supabase `pawlift-dev` and `.env.local` exist. Not yet created: openrouteservice key.

## Blockers
None.

## Exact next action
Owner decisions (see `docs/LAUNCH_REPORT.md`): import the repo into Vercel with Deployment Protection and preview env vars per README, then say whether to check the preview; add an openrouteservice key to verify live routing. Optional next checkpoint: saved journeys with `nearby_request` / `route_match` notifications.

Notes: `db push --remote --yes` needed in agent mode (ask first). "Confirm email" still ON in pawlift-dev. Pages that read cookies wrap an async content component in `<Suspense>` (see `src/app/page.tsx`); in dev the fallback `<main>Loading…</main>` stays in the DOM and Next keeps the previous page mounted but hidden, so read the *visible* `main` (`tests/e2e/helpers.ts` `main()`). Browser pane must be *shown* (`show_pane preview`). Generated RPC types make nullable args non-null; cast at the call site. Never render lucide components at module scope on the server. Dev server often already runs on :3000 (use it; `preview_start` fails). Demo rows are visible only to demo personas (DEMO switcher: Priya volunteer, Sam coordinator); `npm run demo:reset` refreshes windows (seed time → +7 days) and now clears audit rows first.

## Design checkpoint 1 (2026-11-09, UI only)
- `docs/DESIGN.md` + tokens/classes in `globals.css` (`.btn-primary|secondary|text`, `.chip`, `.card`); `SpeciesAvatar` replaces no-photo icons (RequestCard, BottomSheet, RouteMatches); primary buttons app-wide now `btn-primary`; warm empty lines on map and Dashboard.
- d1.b: cat avatar redrawn; Add lift clears the search card and, for unverified orgs, explains instead of linking; friendly card for the locations gate; pickup list hides the chosen destination. One-step publish awaits plan approval.
- Checks: lint, typecheck, npm test, test:e2e (9 passed, axe incl.). Unverified: real phones; cat silhouette reads a bit blobby. "Add lift" now clamps below the search card (fixed, screenshot checked at 375 px).

## Menu and Add lift summary (2026-11-09, UI only, no migrations, no new dependencies)
- Implemented: `NavMenu` (server; role sections) + `NavDrawer` (client; native modal `<dialog>`, Escape, backdrop click, focus return, Tab wrap in `trapTab.ts`, `aria-current`) replace `AccountMenu`. Menu button sits in the map search card and in a new `src/app/org/[id]/layout.tsx` header (the earlier sidebar was dropped: the drawer replaces it). `DemoSwitcher` is now a section inside the drawer. `AddLift` on the map for active coordinators (one org: link to `/org/<id>/requests/new`; several: org picker dialog), hidden when the sheet is full. Dashboard has a "New request" button. `getMyContext` is wrapped in React `cache`. Failed DEMO persona switch opens the drawer.
- Tested: lint, typecheck, `npm test` pass; `npm run test:e2e` passes (organisation story now: map "Add lift" → form → publish → pin and card on the map; drawer keyboard test; axe at 1280 and 375 px incl. the drawer open). Sam walked in headless Chromium at 375 and 1280 px (screenshots checked: button clear of map controls and sheet).
- Unverified: pin for Sam's own new request (script checked too early; the e2e covers a fresh org); `test:db` not run (no database changes); real phones and screen readers; map tiles did not load in the headless run.
- Coordinator friction (rules unchanged): (1) "Add lift" shows for every active coordinator, including a pending or suspended organisation, which cannot publish; (2) the form is replaced by a text link until the org has two locations incl. a confirmed destination; (3) choosing the same pickup and destination did not navigate and I did not capture the message; (4) release-authority checkbox appears only on the draft page after saving, so publishing is two steps; (5) the draft is invisible on the map until published; (6) the pickup list includes foster homes and vets, and it is easy to choose the destination as pickup.
- Next action unchanged (owner decisions above). Demo data was reset with `npm run demo:reset`.

## 7c summary
- Implemented: complete `README.md` (architecture rules, env var names, setup, commands, demo personas and stories, Vercel preview steps with protection and no service-role key, layout); `docs/LAUNCH_REPORT.md` (gate results, BRIEF §15 evidence, not verified, launch prerequisites, known limits).
- Tested (gate): `demo:reset` twice PASS; lint, typecheck PASS; `npm test` 36/36; `npm run test:db` 223/223; `npm run test:e2e` 7/7; `npm run build` + `next start` smoke test (pages 200, 404, anonymous admin not found, headers, map renders, no console errors).
- Unverified: no Vercel deployment (needs the owner's account and OK); everything in the launch report's "Not verified" list.

## 7b summary
- Implemented: migration `...000025` (D43: organisations inherit the registrant's demo flag; a demo persona used to create a real organisation). `scripts/demo-reset.mjs` now clears verification records of demo orgs and by/about demo users (a reset failed after any demo admin decision). Playwright + axe (D44): `playwright.config.ts`, `tests/e2e/` (setup reseeds and signs each persona in once; volunteer, organisation and foster stories; keyboard; axe WCAG 2.1 A/AA at 1280 px and 375 px on 41 page visits incl. detail pages, plus no sideways scroll). Fixes: amber badge text contrast via `--urgent-strong`; starting-point dialog keeps focus inside and returns it to the opener; map moved after search card and list in Tab order; claim button says "I can take <name>" (BRIEF §3); `/requests` rows link to details.
- Tested: `npm run test:e2e` 7/7 twice in a row (each run reseeds); `npm run test:db` 223/223 (new: demo org registration); `npm test` 36/36; lint, typecheck, build pass.
- Unverified: real phones and screen readers (only emulated 375 px and axe); account menu does not close on Escape (native `<details>`); axe checks serious/critical only; dynamic states (route results, open dialogs, errors) scanned only through the stories, not by axe; offers, reassign, withdraw, incidents still db-tested only.

## 7a summary
- Reviewed: BRIEF §14/§15 coverage; Supabase security advisors and read-only catalog queries on pawlift-dev (RLS on every app table with no client policies, internal functions not executable by clients, definer functions pin search_path, storage policies, public view columns, hashed invite tokens); code scan (service role, redirects, logging, persona guard).
- Fixed: migration `...000024` — per-user route cache (D41; any user could previously plant a fake "live" time for everyone), pinned search_path on 4 functions, `admin_list_requests` (D42). New `/admin` dashboard and `/admin/requests` oversight (BRIEF §14 gaps), account menu links, baseline security headers in `next.config.ts`. Types regenerated.
- Tested: `npm run test:db` 222/222 (new: route cache isolation in `routing.test.ts`; oversight refusal, filters, driver, no private fields in `ops6b.test.ts`); `npm test` 36/36; lint, typecheck, build pass. Advisors re-run: search_path warnings gone, no new findings. Browser: headers present; Demo Admin saw dashboard counts and 3 DEMO active requests; Priya gets not-found on `/admin` pages with no data; map still renders; no console errors.
- Unverified: new account menu links not clicked; admin pages on mobile; full CSP not added (launch item); not-found admin pages return HTTP 200 when streamed (existing pattern, no data).

## 6c summary
- Implemented: static pages `/about`, `/how-it-works`, `/transport-safety` (renders `GUIDELINES`), `/terms`, `/privacy`; shared `src/components/InfoPage.tsx`; "About" links in `AccountMenu`. Terms, Privacy and Transport safety carry a DRAFT notice; no legal, safety or insurance guarantees.
- Tested: build, lint, typecheck pass; `npm test` 36/36; `npm run test:db` 220/220 (Batch 6 gate tests from 6a/6b still pass). Browser: all five pages return 200, DRAFT notice shown, `/transport-safety` viewed.
- Unverified: mobile layout and keyboard use; About link in the menu not clicked; copy needs professional review; the known dev cookies invariant error appeared once in the console (from an auth-reading route, not these static pages).

## 6b summary
- Implemented: migration `...000023` (`private_access_log`, `require_admin`, `list_my_incoming_deliveries`, `list_my_foster_history`, `list_transport_history`, `update_org_settings`, `admin_list_incidents`, `admin_list_audit`, `admin_view_private_details`, `admin_list_private_access`); D39, D40. UI: `/foster` incoming animals with "arrived safely" form and past arrivals; `/org/[id]/history`, `/org/[id]/settings`; `/admin/incidents`, `/admin/audit`, `/admin/private-access`; account menu links for admins. Types regenerated. Volunteer history already existed on `/assignments`.
- Tested: `npm run test:db` 220/220 (11 new in `tests/db/ops6b.test.ts`: foster isolation, driver contact hidden after delivery, receipt right, history isolation, settings guards and audit, admin refusal, reason required, access logged and visible on the org audit, suspended accounts); `npm test` 36/36; lint, typecheck, build pass. Browser: Sam saved and cleared settings (audit rows written), history empty state, Demo Admin incidents/audit/private-access pages, Mia's `/foster` page.
- Unverified: **"arrived safely" form and admin "View private details" submit not clicked in the browser** (no demo delivery to Mia; one dev-server cookies invariant error appeared during a scripted submit and did not recur on reload); history with real rows; mobile layout and keyboard use; the admin audit showed the raw action name "organisation.settings" (label added in `src/lib/assignments.ts` after the page loaded; not rechecked).

## 6a summary
- Implemented: migration `...000022` (inbox RPCs, reminder preference, `send_assignment_reminders`, `delete_expired_journeys`, pg_cron enabled and three jobs scheduled); D38. UI: `/notifications` (inbox, mark read, reminder toggle), unread count and dot in the account menu. Types regenerated.
- Tested: `npm run test:db` 207/207 (8 new in `tests/db/notifications.test.ts`: recipient isolation, mark read, suspended user, preferences, reminder timing with a fixed clock, dedupe, opt-out, cleanup, scheduled functions not callable by clients); `npm test` 36/36; lint, typecheck, build pass. Browser (Sam, DEMO): two temporary rows showed in the inbox, the account menu showed 2 unread, "Mark all as read" cleared it; rows removed afterwards.
- Unverified: **cron jobs not observed running** (the CLI refused a read of `cron.job` without consent; the migration applied without error); inbox links for each notification type; mobile layout and keyboard use; Priya's side (volunteer notifications) not clicked through.

## Relays removed (D37)
- Reverted the code, UI and tests of commits `8607d29` (5a leg editor) and `20eeb1c` (5b handovers) with `git revert --no-commit`; migrations `...000019` and `...000020` stay in the repo because they were applied, and migration `...000021_single_leg.sql` undoes them. Removed files: `src/components/LegEditor.tsx`, `tests/db/legs.test.ts`, `tests/db/handover.test.ts`; split/merge/update-leg actions, the Legs section, `dispute_handover` and relay/handover UI and fields.
- Database: `transport_legs` has `unique (request_id)` and `check (seq = 1)`; dropped `split_leg`, `merge_legs`, `update_leg`, `list_request_legs`, `validate_leg_chain`, `leg_edit_guard`, `dispute_handover`, `refresh_progress_status`; single-leg bodies restored for publish/update/progress/read RPCs; `handover_point` location kind, `handover_dispute` incident type and disputed confirmations removed. Kept `confirm_receipt(request, note)` (foster carer with receipt right at the destination, or owning coordinator on behalf); `complete_request` records receipt if missing. No new incident rules.
- Tested: `npm run test:db` 199/199 (new `tests/db/single-leg.test.ts`: second leg refused by the database, removed RPCs gone, `handover_point` rejected, receipt authorisation); `npm test` 36/36; lint, typecheck, build pass.
- Unverified: no browser check (the only UI change is removal); `confirm_receipt` has no screen yet (foster receiving workflow is 6b; coordinators use "mark complete"); relay-era demo seed rows do not exist.

## 4c summary
- Implemented: migrations `...000015` (RPCs `start_leg`, `confirm_pickup`, `confirm_delivery`, `complete_request`, `report_incident`, `resolve_incident`, `get_leg_private_details`, `list_my_assignments`, `get_request_detail`, `list_org_assignments`, `list_org_incidents`, `list_org_audit`), `...000016` (audit by request matches leg events), `...000017` (claims allowed until `window_end`, D34), `...000018` (private details left-join `request_private`); D33, D34 in PLAN. Pages: `/requests/[id]` (claim, idempotency key), `/assignments`, `/assignments/[id]` (private details, nav links, start/pickup/delivery/withdraw/report), `/org/[id]/dashboard` (needs-a-driver first; confirm, turn down, offer, withdraw offer, reassign, complete, resolve incident), `/org/[id]/audit`. Links from the map detail panel, route matches, account menu, org page. `scripts/demo-reset.mjs` now seeds contacts and `request_private` and clears audit rows.
- Tested: `npm run test:db` 191/191 (17 new in `tests/db/progress.test.ts`: window guards, order, private-details revocation by withdraw/reassign/cancel/delivery/suspension, no private fields in lists, completion guards, incidents, org isolation, claim window rule); `npm test` 36/36; lint, typecheck, build pass; `demo:reset` ran twice. Browser (pawlift-dev, DEMO personas): Priya claims Biscuit from the map detail panel → Sam confirms on the dashboard → Priya sees addresses, contacts and medical notes → start, pickup, delivery → details disappear → Sam completes → dashboard shows Completed → audit page lists six events. One 4a test changed (hold now caps at window end).
- Unverified: offer/accept, decline, withdraw, reassign, turn-down, release and incident forms in the browser (db tests only); Sam's notification list (no UI until 6a); mobile layout and keyboard use of new pages; navigation links open correctly (demo seed has addresses only, no exact points); route-match "View details" link (map detail panel link was clicked); `en_route` and `collected` screens were passed through but not inspected visually; `list_org_incidents` shows at most 50; relays and foster receipt not built (Batch 5/6); pg_cron not scheduled (6a); size requirements not enforced.

## Earlier checkpoints (details in git history)
- 4b: offers, accept/decline, withdraw (incl. late), reassign, cancel (D32; 25 db tests). 4a: claim, confirm, release, expiry sweep (D31; 5-way parallel claim, idempotent retry). 3c: matching, journey planner, route matches, nav links (D30). Unverified: ORS shapes never run live; nav links not opened in the apps.
- 3b: routing adapter, cache RPCs, DEMO fixtures, geocoding (D29). 3a: map home, bottom sheet, suburb fallback (D28). Unverified: real browser geolocation; suburb centroids are approximate.
- 2d: requests, photo sanitising, publish guards (D26, D27). 2c: locations, destinations, foster homes (D24, D25). 2b: invitations, membership, volunteer profile and verification (D21–D23). 2a: org registration and admin verification. 1a–1d: scaffold, migrations, auth, db test harness.
- Standing unverified: mobile layout and keyboard navigation across pages; foster carers cannot edit their own home; signed-out invite links need sign-in then reopen.

## Lift wording (2026-11-09, visible text only)
- "Lift" replaces request/opportunity/transport request in UI, notification and audit labels, BRIEF §3 and tests; routes, code, DB unchanged. PLAN §2 vocabulary note added.
- Checks: lint, typecheck, npm test, test:e2e (9 passed) all pass.
