# PawLift — product brief

**Tagline:** Every journey can save a life.
**Message:** You're already going somewhere. You might be able to help an animal get there too.

Act as PawLift's technical lead, product designer, architect and full-stack engineer. Build a functional, polished animal rescue transport coordination platform for Western Melbourne, Victoria, designed to expand across Australia. Australian English. Display Australia/Melbourne time; store UTC.

This brief says **what** to build. `docs/PLAN.md` says **how** (architecture, permissions, state machine, rules, batches). Where they differ, PLAN.md records the approved decision.

---

## 0. Working protocol

- Planning (Batch 0, hard blockers, Batch 7 review): Opus. Implementation and debugging: Sonnet. The user switches models.
- Read `CLAUDE.md` and `docs/STATUS.md` every session; read only the PLAN/BRIEF sections the current checkpoint needs.
- One checkpoint per session: plan mode → implement → verify → commit and push → update STATUS.md → report (≤200 words) → stop. Use `/clear` between sessions.
- Make reasonable, reversible decisions and record them in PLAN.md §2. Ask only when blocked, when scope changes, or before an external or irreversible action. Never request secrets in chat.
- Build working vertical slices. No broad refactors, speculative abstractions, unnecessary dependencies or deferred features. Never silently drop a requirement; if something can't fit the MVP, say so and offer the best practical alternative.
- Tests proportionate to the change; always for permissions, state transitions, timing, claims and regressions.
- Failure: isolate the smallest reproduction. After two failed fixes for the same failure, stop, record evidence, propose the next diagnostic.
- Missing credentials → honest setup state or a clearly labelled DEMO adapter. Never fabricate tests, estimates or integrations.
- No MCP servers, plugins or subagents unless the user asks.

## 1. Product

PawLift connects rescue organisations, council pounds, shelters, existing transport volunteers, foster carers and ordinary people who can help move animals.

**Central idea — incidental journey matching.** Someone driving St Albans → Geelong is shown that a cat at a pound in Melton needs to reach a rescue facility in Geelong, and that it fits their trip with a small detour: "A little detour could help save a cat. About 8 extra minutes." They can accept or ignore it. (Illustrative only — real figures come from configured routing or labelled DEMO fixtures.)

PawLift also supports dedicated volunteers who make deliberate trips between pounds, shelters, rescues, vets and foster carers. One person can do any of these; never force exclusive driver categories.

**Principle:** find opportunities that fit people's journeys rather than requiring everyone to make special journeys.

PawLift is **not** an adoption site, social network, rideshare, pet-taxi marketplace, a body that releases animals from pounds, or a replacement for rescue organisations. Exclude adoption listings, feeds, payments, gamification, leaderboards and continuous tracking.

## 2. Market and operating model

- Launch: Western Melbourne. Later: Victoria, then Australia.
- Audience: rescue organisations, registered charities, independent groups, council pounds, shelters, transport coordinators, existing volunteers, foster carers, the public.
- **Must work for organisations that already have volunteer networks:** bring existing volunteers on, organise requests, fill gaps — while they keep their current messaging tools. Complement, don't replace.
- PawLift is a technology and coordination platform. It is not automatically a charity, rescue, shelter, pound or foster provider, and must not claim charitable or DGR status. It doesn't own or control partners' animals, volunteers, facilities or foster networks.
- Free for community volunteers. Supports nonprofit and appropriately authorised commercial partners. Don't assume any organisation is a charity or has DGR status.
- The organisation arranging a transfer is responsible for authorising release and confirming the destination. PawLift is not responsible for release, foster placement, medical decisions or rescue eligibility.
- No payments, donations, paid access or advertising in the MVP. Keep the architecture open to future subscriptions, council contracts, sponsorship, grants, premium reporting and industry partnerships.

## 3. Design and UX

### 3.1 Direction: map-first, like Google Maps
Looking strikingly similar to Google Maps is intended. Familiar beats novel.

- **Mobile home:** full-screen map. A floating rounded search card at the top: origin chip ("From: Current location", editable) and a destination field "Where are you heading?". Primary button: **Find opportunities along my route**. Date, departure time and maximum detour sit behind a small "Options" control.
- **Bottom sheet** with three snap points: peek ("6 animals need a lift nearby"), half, full. It holds the nearby list on open; after a search it shows **On your way** (route matches) above **Nearby** — two clearly separate sections.
- **Pins:** paw-shaped pickup pins in brand green; urgent in amber; selected pin enlarges and its card highlights (and vice versa). Route drawn as a solid line with A (pickup) and B (drop-off) markers.
- **Cards:** 56 px rounded photo (species icon if none), name + species, "Melton → Geelong", "about 6 km away", urgency/deadline chip, requirement icons (carrier, large dog, medical care). Route cards add a detour pill: "+8 min · DEMO estimate".
- **Detail view:** a sheet, not a new page, with one primary action ("I can take Biscuit").
- **Desktop / organisation screens:** Google-Maps-desktop layout — left panel list, map on the right — plus plain tables for coordinators. The dashboard leads with "Needs a driver".
- **Typography:** system font stack, 16 px base, generous line height. **Colours:** warm neutral background (#FAF8F5), white surfaces, near-black text (#1F2421), muted text (#5F6661), brand green (#2F7D55), amber for urgent (#B45309), red for errors (#B42318), border (#E7E2DA). Check WCAG AA contrast.
- **Voice:** short, warm, plain. Buttons are verbs. No jargon ("leg" is fine for coordinators; volunteers see "your part of the trip").
- Every screen has loading (skeleton), empty and error states. Keyboard navigable, labelled inputs, visible focus, responsive. Mobile-first for drivers; organisation screens work on desktop and mobile.

### 3.2 Never
Gradients, glassmorphism, glowing or coloured shadows, emoji as icons, purple/indigo palettes, marketing hero sections inside the app, three-column feature grids, testimonial carousels, confetti, badges/streaks/points/leaderboards, more than one primary button per view, placeholder lorem ipsum, decorative blob illustrations, animations over 200 ms (sheet drag excepted), onboarding carousels, unnecessary menus, a mode picker ("I'm travelling" vs "Animals need transport").

## 4. Home, journeys and results

- One primary journey flow; browsing and journey search on the same screen; nearby list visible on open without entering anything.
- Origin defaults to current location when permitted, always editable.
- **Location permission:** explain why before asking. If denied or unavailable: manual suburb/postcode selection, browsing still works, results labelled "Showing Western Melbourne" until a location is chosen. Never imply results are nearby when location is unknown. No continuous tracking.
- **Nearby list:** ordered by proximity when location is known. Card fields per §3.1, plus eligibility (e.g. "Needs a cat carrier", "Verified volunteers only"). No exact private addresses.
- **Route matches:** ordered by feasible timing, suitability, then extra travel. Always show estimated detour and its source. Make it obvious why each opportunity is suggested ("Pickup is 4 km off your route in Melton; drop-off is on your way in Geelong").
- **Navigation:** once confirmed, "Navigate to pickup" and "Navigate to drop-off" open the driver's chosen app (Google Maps, Apple Maps or Waze). PawLift does not read or integrate with live navigation sessions (a future partnership opportunity).

## 5. Roles, organisations and volunteers

- Participants: rescue organisations, council pounds and shelters, existing transport volunteers, community volunteers, foster carers, administrators. Anyone can hold several roles (e.g. foster carer and volunteer). Enforce membership and permissions server-side and with RLS.
- **Organisation registration:** name, type, applicable registration details, contact person, email, phone, operating area, optional website, short description. Admin approval required before publishing real requests. Never infer charity/DGR status from name or description.
- **Bringing volunteers on:** organisation invite links; individual email-bound invitations; registration through an invitation; membership requests; coordinator approval/removal; membership in several organisations; per-organisation volunteer directory with availability; dedicated assignment offers that the volunteer accepts or declines (an offer is confirmed only when accepted).
- **Volunteer profiles:** transport capabilities, availability, guideline acceptance, verification status: Pending verification, Verified, Rejected, Suspended. Admins approve or reject with recorded reasons and record exactly what was checked. Never imply police, licence, driving-history or background checks unless they actually happened. Rejected applicants get a reason and a resubmission path. Verification is rechecked when accepting assignments and when exercising operational permissions.

## 6. Foster carers

- Foster carers can be confirmed receiving destinations, authorised receiving contacts, transport volunteers, or several of these.
- An authorised coordinator invites or links a foster carer; the approving organisation is recorded. Approval is the organisation's — PawLift never implies it registers or certifies foster carers.
- Coordinators can designate an approved foster carer as a receiving contact or destination. The assigned volunteer receives delivery instructions. An approved foster carer with the receipt right, or the coordinator, confirms the animal arrived.
- Foster identities, addresses and contacts stay private; exact receiving address visible only to authorised coordinators and the confirmed volunteer for that leg. Never visible to unrelated organisations or volunteers.
- Foster carers may confirm receipt when the organisation permits. They cannot publish requests without separate coordinator permissions.

## 7. Organisation portal and requests

- Dashboard: register and submit for verification, invite and manage volunteers, view availability, create/edit requests, assign volunteers, monitor progress, manage cancellations, view completed history. Requests still needing drivers are the most obvious thing on screen.
- **Request form:** animal name or reference, type (cat, dog, other), optional photo, pickup location, destination, required date, pickup window, delivery deadline, urgency, special handling, carrier/restraint requirements, medical or mobility considerations, authorised contact instructions.
- **Publishing requires:** a confirmed, authorised destination (receiving facility, rescue, vet or approved foster home); the organisation's recorded authority to release and transport the animal; transport requirements; a verified organisation account.
- Exact private addresses are disclosed only to authorised people after assignment.

## 8. Lifecycle and assignment

- User-facing states: Draft, Open, Matched, Assigned, Confirmed, En route, Collected, Delivered, Completed, Cancelled, Needs assistance. (Transitions, actors, guards and timestamps: PLAN §5.)
- **Matched means a candidate exists. It never implies consent, reservation or assignment.** Matching suggestions are separate from assignment and progress.
- A volunteer's acceptance atomically reserves the request/leg pending coordinator confirmation. One active reservation or assignment per leg. Coordinator confirmation authorises it. Stale reservations expire. Retries are idempotent; concurrent claims are transactional. Verification, availability and eligibility are rechecked at mutation time.
- Volunteers: view assignments, confirm departure, pickup and delivery, report incidents, withdraw according to policy.
- Coordinators: monitor, confirm, reassign safely, cancel, confirm completion.
- Every important action is audited.

## 9. Relays: not in the MVP (PLAN D37)

- No volunteer-to-volunteer handovers and no multi-driver relays. Animals are handed over by professionals at pickup, driven by one volunteer, and received by a professional or an approved foster carer at the destination.
- Reason: animal welfare. A non-professional handover can strand an animal if a driver does not turn up.
- Every request has exactly one leg (enforced in the database). The leg table is kept as the unit of assignment and progress. Final-destination receipt: PLAN §7. Relays could return after the MVP only with a new product decision.

## 10. Matching and maps

Match active, unclaimed requests or legs against private journeys, considering: pickup-before-drop-off order; distance from route to pickup; destination compatibility; date and departure time; pickup window; delivery deadline; additional travel; maximum detour; animal requirements; driver capabilities; verification; availability; existing claims; waiting and handling time.

- Additional travel = route via pickup and drop-off − baseline route, with consistent assumptions.
- Map display: MapLibre + OpenFreeMap. Routing: openrouteservice through a server-side adapter (keys in env, cached, quota- and error-aware). Without credentials: deterministic fictional fixtures marked **DEMO estimate**.
- Estimates state their source and limitations (no live traffic). Never present the illustrative "8 minutes" as measured. Never disguise straight-line distance as travel time.
- Driver routes, origins and schedules are private. Matching only proposes; acceptance and coordinator confirmation stay explicit. Never auto-assign.

## 11. Notifications

- Persisted in-app notifications for: route matches, nearby requests, volunteer acceptance, assignment confirmation, upcoming assignments, pickup, delivery, cancellations, incidents. Triggers, deduplication and recipients: PLAN §10.
- Explicit location and notification preferences; the app explains what schedules reminders.
- Web push and email deferred.

## 12. Security, privacy and animal welfare

- Separate private addresses and contacts from public data; follow the access matrix (PLAN §4). Exact operational details only for authorised coordinators, admins with a logged operational reason, the confirmed volunteer for that leg, and explicitly authorised receivers. Revoke access on cancellation or reassignment.
- Protect storage objects as well as tables. No coordinates or sensitive metadata in APIs, logs, photos or public URLs.
- Server-side validation; RLS on sensitive tables; service-role key never exposed; never trust client roles or verification; unforgeable audit; no unauthorised assignment changes; duplicate-claim protection; narrow admin powers; organisation isolation.
- Required tests: cross-organisation access, unassigned access, suspended accounts, concurrent claims, foster privacy.
- **Welfare:** transport-guideline acceptance covering secure carriers/restraints, handling, medical/mobility needs, supervision, pickup and delivery procedures, incident reporting. Animals are never left unattended in vehicles.
- Provide safety guidance and Terms and Privacy drafts clearly marked for professional review. No safety, legal or insurance guarantees. Demo readiness is not launch approval.

## 13. Demo

- Isolated demo environment with fictional organisations, people, animals, contacts and non-sensitive locations. Every fictional request marked **DEMO**. Never seed production by default. Never present demo approvals as real verification. Repeatable setup and reset. (Data set: PLAN §11.)
- **Volunteer story:** open home → see nearby requests → enter a destination → see a route match → view extra travel time → accept → organisation confirms → confirm pickup → confirm delivery → completed request appears on the organisation dashboard.
- **Organisation story:** organisation registers → admin approves → organisation invites existing volunteers → volunteers join → coordinator creates a request → selects a confirmed destination → request visible to suitable volunteers → volunteer accepts → coordinator confirms → volunteer completes → organisation records completion.
- Also demonstrate an authorised foster carer receiving an animal.
- The demo must show PawLift organising existing volunteer networks while adding new transport capacity.

## 14. Pages (share screens where sensible; not all equally prominent)

- **Public:** Home, About, How it works, Transport safety, Sign in/registration, Terms and Privacy drafts.
- **Volunteer:** Home (map), Nearby, Journey planner, Route matches, Request detail, My assignments, History, Profile and verification.
- **Organisation:** Dashboard, Registration and verification, Create request, Manage requests, Request detail, Volunteer directory, Invitations, Assignments, Foster carers and receiving contacts, Completed history, Settings.
- **Admin:** Dashboard, Organisation verification, Volunteer verification, Request oversight, Incidents, Audit log.

## 15. Definition of success

A volunteer can register and join an organisation. An organisation can invite existing volunteers and create and manage requests. A volunteer sees nearby requests, enters a destination, gets a suitable route match with an estimated detour, and accepts. The organisation confirms assignments, and existing volunteers receive dedicated assignments. A foster carer is associated with an approving organisation and receives an animal through an approved handover. Pickup and delivery are recorded. Admins verify organisations and volunteers. Sensitive information is protected. The full demo runs without live rescue data. Never declare success with a broken core flow.

## 16. Delivery

- Code, migrations, seed and reset scripts, `.env.example` (placeholders), concise README, project memory files, setup/reset/testing instructions, deployment preparation.
- README covers: install, Supabase setup (Auth, RLS), mapping/routing credentials, dev server, demo seed and reset, checks and tests, deployment, known limitations.
- Production-path behaviour verified against a configured hosted Supabase project. Vercel preview prepared; **no public deployment without the user's explicit permission.**
- All code lives in the user's private GitHub repo `pawlift`.

## 17. Session commands (copy-paste into Claude Code)

**Start or continue a batch (Sonnet):**
"Execute PawLift Batch [N], checkpoint [X], using the approved plan. Read CLAUDE.md and docs/STATUS.md, then only the PLAN/BRIEF sections and files this checkpoint needs. Plan first, then implement and verify this checkpoint only. Commit and push, update STATUS.md, report in ≤200 words and stop."

**Resume after interruption:**
"Resume PawLift from docs/STATUS.md. Check git status and verify the saved checkpoint before changing anything. Continue the recorded next action only. Preserve existing edits and don't redo completed work."

**Escalate a blocker (Opus):**
"Review the PawLift blocker in docs/STATUS.md and only the relevant files. Find the likely cause and the smallest diagnostic or design correction. Update PLAN.md and write a bounded handoff for Sonnet in STATUS.md. Don't implement unrelated features."
