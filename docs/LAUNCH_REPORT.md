# PawLift — launch report (Batch 7 gate)

Date: 2026-11-08 · Checkpoint 7c · Project: `pawlift-dev` (development and DEMO data only)

**Verdict: demo-ready, not launch-ready.** Every flow in the definition of success (BRIEF §15) works by
clicking, on fictional DEMO data, and is covered by automated tests. Launching with real animals and
people needs the prerequisites below; several are decisions or accounts only the project owner can
provide. Demo readiness is not launch approval.

## Gate results (run 2026-11-08)

| Check | Result |
|---|---|
| `npm run demo:reset` twice in a row | Pass, both runs (7 people, 4 organisations, 4 requests) |
| `npm run lint` · `npm run typecheck` | Pass · pass |
| `npm test` (unit) | 36/36 |
| `npm run test:db` (RLS and RPCs) | 223/223 |
| `npm run test:e2e` (3 stories, keyboard, axe at 2 widths) | 7/7 pass (6.3 min; reseeds first) |
| `npm run build` and `npm start` smoke test | Pass: public pages 200, unknown page 404, anonymous `/admin` shows not found, security headers present, map renders, no console errors |
| Supabase security advisor (re-run in 7a) | Two ERROR findings, both by design: `public_requests` is a definer view (the public listing, suburbs only) and PostGIS's `spatial_ref_sys` has no RLS (public reference data). WARN only: expected RPC execute grants, PostGIS in `public`, leaked-password protection off (launch item) |

## Definition of success (BRIEF §15) — what is verified and how

| Requirement | Evidence |
|---|---|
| A volunteer registers and joins an organisation | e2e organisation story (Lee joins by invitation); db tests for invitations and membership requests |
| An organisation invites existing volunteers and creates and manages requests | e2e organisation and foster stories (create, choose confirmed destination, publish); db tests for edit, cancel and publish guards |
| A volunteer sees nearby requests, enters a destination, gets a route match with an estimated detour, and accepts | e2e volunteer story ("+8 min driving · DEMO estimate"); unit tests for detour, order, windows, capability and maximum detour |
| The organisation confirms assignments; existing volunteers receive dedicated assignments | e2e (confirm); offers, accept and decline in db tests only |
| A foster carer is associated with an approving organisation and receives an animal through an approved handover | e2e foster story (Mia sees driver first name only, confirms arrival); db tests for foster isolation and receipt rights |
| Pickup and delivery are recorded | e2e (start, collected, delivered; exact details disappear after delivery); audit trail listed |
| Admins verify organisations and volunteers | e2e (organisation verified with a recorded check); db tests for checks, reasons, suspension, immutable records |
| Sensitive information is protected | db tests: cross-organisation access, unassigned access, suspended accounts, concurrent claims (one of five wins), foster privacy, revocation on withdraw, reassign, cancel and delivery, logged admin access; 7a security review |
| The full demo runs without live rescue data | All demo rows `is_demo`, DEMO badges, demo and real data isolated (including organisations registered by demo users, D43) |

Accessibility: axe WCAG 2.1 A/AA (serious and critical) passes on 41 page visits at 1280 px and 375 px
with no sideways scrolling; the map home works by keyboard (focus order, visible focus, modal dialog
keeps focus and returns it).

## Not verified

- **Live routing:** no openrouteservice key yet; request and response shapes have never run against the real service. All estimates in the demo are labelled DEMO.
- **pg_cron jobs** (reminders, expiry sweeps, journey deletion) are scheduled but have not been observed running; correctness does not depend on them (stale holds expire lazily), but reminders do.
- Offers, decline, withdraw (including late), reassign, turn down and incident forms: database tests only, not clicked in a browser.
- Real phones, real geolocation, and screen readers (only emulated 375 px and automated axe).
- Navigation deep links opening in Google Maps, Apple Maps and Waze.
- The production server was smoke-tested locally; no Vercel deployment exists yet.

## Blockers

None for the demo. For launch, the owner must supply or decide the items marked **Owner** below.

## Launch prerequisites

Accounts and configuration
- **Owner:** a separate production Supabase project (PLAN §1); apply all migrations; `APP_ENV` not `demo`; never seed demo data there.
- **Owner:** custom SMTP for auth emails, email confirmation on, Site URL and redirect URLs set to the production domain.
- **Owner:** turn on Supabase leaked-password protection; review backups and point-in-time recovery for the plan in use.
- **Owner:** openrouteservice key (`ORS_API_KEY`, `ORS_BASE_URL`); then check real routes and geocoding against the DEMO behaviour.
- **Owner:** Vercel project imported from GitHub, Deployment Protection on previews, environment variables per README (never the service-role key). Public deployment needs the owner's explicit OK.
- Confirm pg_cron jobs run (`cron.job_run_details`) in the production project.

Security
- Add a full Content-Security-Policy (MapLibre worker and OpenFreeMap tile hosts need a tested allow-list).
- A demo deployment must use a demo-only Supabase project and stay access-protected: the persona switcher signs anyone in as Demo Admin, a real platform admin.

Legal, safety and operations
- **Owner:** professional review of Terms, Privacy and Transport safety (all marked DRAFT); insurance position for volunteer drivers.
- **Owner:** a real verification process for organisations and volunteers (who checks what, records kept); first real platform admins.
- **Owner:** incident escalation contacts and response times for animal welfare and vehicle incidents.
- Accessibility check on real devices with a screen reader before launch.

## Known limits (accepted for the MVP)

- One leg per request; no relays or volunteer-to-volunteer handovers (D37).
- Notifications are in-app only (no email or push); saved journeys with route-match alerts are not built.
- Suburb centroids are approximate; public locations show suburbs only by design.
- Foster carers cannot edit their own home details (coordinators do).
- Signed-out invitation links need sign-in and then reopening the link; after confirming an email, new users sign in themselves.
- The account menu does not close with Escape (native disclosure; opens and works by keyboard).
- Anonymous visitors on a demo deployment see no animals until they choose a DEMO persona (demo rows are shown only to demo accounts).
