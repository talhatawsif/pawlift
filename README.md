# PawLift

You're already going somewhere. You might be able to help an animal get there too.

PawLift coordinates animal rescue transport, starting in Western Melbourne. Rescue groups, pounds,
shelters and vets post animals that need a lift. Verified volunteers see the ones on or near a trip
they are already making, take one, and record pickup and delivery. The organisation confirms the
driver, can see where the animal is, and records completion. Approved foster carers can receive animals.

**Status:** demo-ready, not launch-approved. Everything runs on fictional DEMO data. See
[`docs/LAUNCH_REPORT.md`](docs/LAUNCH_REPORT.md) for what is verified and what must happen before launch.

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript (strict) · Tailwind CSS 4 · Supabase (Auth,
Postgres + PostGIS, Row Level Security, Storage, pg_cron) through `@supabase/ssr` · MapLibre GL with
OpenFreeMap tiles · openrouteservice through a server-side routing adapter, with a labelled DEMO
fallback · lucide-react icons · Vitest · Playwright with axe.

## How it is built

- **Every change of state is a Postgres function** (`security definer`, fixed `search_path`, explicit
  `auth.uid()` checks) that writes `audit_logs` in the same transaction. Clients cannot update status
  columns directly; every app table has RLS on and no direct client policies.
- **The app uses the signed-in user's session** with the public (anon) key. The service-role key is
  used only by `scripts/` and test setup, never from `src/` (a unit test enforces this).
- **Private data lives in separate tables.** Exact addresses, contacts, handover instructions and
  medical notes are read only through access functions: the confirmed driver while the trip is
  active, the organisation's coordinators, the receiving foster carer (driver first name and phone
  only), and platform admins with a logged reason. Public screens read the `public_requests` view,
  which shows suburbs only.
- **Roles and verification are re-checked on the server** at every action.
- **Route estimates are labelled.** Each one carries its source (`ors` or `demo`), and DEMO estimates
  say so on screen. DEMO rows carry `is_demo` and a visible DEMO badge; demo and real data never mix.

Decisions are logged in [`docs/PLAN.md`](docs/PLAN.md) §2; the product brief is [`docs/BRIEF.md`](docs/BRIEF.md).

## Setup

You need Node.js 20.12 or newer (22 LTS recommended; developed on 26) and a Supabase project (Sydney region recommended).

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` yourself (never commit it, never paste values into chats or issues):

| Variable | Used by | What it is |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | app | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | Supabase public (anon / publishable) key |
| `SUPABASE_SERVICE_ROLE_KEY` | scripts and tests only | Supabase secret key. Never on a server that runs the app |
| `APP_ENV` | app, scripts | `demo` turns on the DEMO persona switcher and allows `demo:reset` |
| `DEMO_PROJECT_REFS` | scripts and tests | Comma-separated Supabase project refs that may be reset or tested |
| `DEMO_PASSWORD` | app (demo), scripts | Password for the seeded demo personas |
| `ORS_API_KEY`, `ORS_BASE_URL` | app (server) | Optional openrouteservice key. Without them, routes use DEMO estimates only |

Apply the database and load the demo data:

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push --remote
```

```bash
npm run demo:reset
```

```bash
npm run dev
```

Open http://localhost:3000 and use the **DEMO** button (top right) to switch persona.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript |
| `npm test` | Unit tests (matching, routing, time, distance, no service role in `src/`) |
| `npm run test:db` | RLS and RPC tests against the Supabase project in `DEMO_PROJECT_REFS` (creates and removes its own test users) |
| `npm run test:e2e` | Playwright: reseeds DEMO data, runs the three demo stories, a keyboard test and an axe WCAG 2.1 A/AA scan at desktop and phone width. Uses the dev server on :3000 or starts one. First time: `npx playwright install chromium` |
| `npm run demo:reset` | Deletes only DEMO rows and `@demo.pawlift.invalid` users, then reseeds. Refuses unless `APP_ENV=demo` and the project ref is in `DEMO_PROJECT_REFS` |
| `npx supabase gen types typescript --remote > src/lib/database.types.ts` | Regenerate database types after a migration |

## The demo

All people, organisations, animals, addresses and approvals are fictional and marked DEMO.
Demo approvals are not real verification.

| Persona | Role |
|---|---|
| Demo Admin | Platform admin (verifies organisations and volunteers) |
| Sam | Coordinator, Western Paws Rescue (DEMO) |
| Priya | Volunteer, St Albans, has a cat carrier |
| Tom | Volunteer, Sunshine |
| Lee | Volunteer, Footscray |
| Jordan | Volunteer, waiting for verification |
| Mia | Foster carer and volunteer, Werribee |

The three stories the e2e tests click through:

1. **Volunteer:** Priya sets her start to St Albans, heads to Geelong, sees Biscuit "+8 min driving ·
   DEMO estimate", takes it; Sam confirms; Priya sees the exact addresses, starts, collects and
   delivers; the addresses disappear; Sam marks it complete.
2. **Organisation:** a new user registers an organisation; Demo Admin verifies it; the coordinator
   invites Lee, who joins; the coordinator adds a pickup point and a confirmed destination, creates and
   publishes a request; Lee takes it and delivers it; the coordinator completes it.
3. **Foster:** Sam sends a dog to Mia's foster home; Tom drives it; Mia sees it coming (driver's
   first name only), then confirms it arrived safely; Sam completes it.

Run `npm run demo:reset` to start fresh; pickup windows run for seven days from the reset.

## Deploying a preview (Vercel)

Do not deploy publicly without the project owner's explicit OK. A preview is prepared, not deployed.

1. In Vercel, import the GitHub repository `pawlift` (framework: Next.js; build command and output are
   the defaults; `npm run build` copies the MapLibre worker into `public/` first).
2. Keep **Deployment Protection** (Vercel Authentication) on for both Production and Preview deployments.
3. Add environment variables for **Production and Preview**: `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the only required ones). Optionally `ORS_API_KEY` and
   `ORS_BASE_URL` (without them routing uses the demo fallback). `APP_ENV=demo` and `DEMO_PASSWORD`
   stay optional, demo only (see the warning below). **Never add `SUPABASE_SERVICE_ROLE_KEY`** (the
   app doesn't use it).
4. With `APP_ENV=demo`, anyone who can open the site can sign in as Demo Admin, a real platform admin
   in that Supabase project. Only point a demo deployment at a demo-only Supabase project, and keep it
   protected.
5. In Supabase → Authentication → URL Configuration, set the Site URL (and allowed redirect URLs) to
   the preview address so sign-up confirmation links land there. New users confirm, then sign in.
6. Reminders and expiry sweeps run in the database (pg_cron), so no Vercel cron jobs are needed.
7. Keep-alive: `.github/workflows/keepalive.yml` runs daily (and on manual dispatch) and reads one row
   from `public_requests` via the Supabase REST API, so the free-tier project isn't auto-paused. It
   fails if the status isn't 200. Add two GitHub repository secrets: `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` (the anon key only).

## Layout

- `src/app/` — routes: map home, `requests/`, `assignments/`, `journey/`, `org/[id]/…` (dashboard,
  requests, members, locations, history, audit, settings), `foster/`, `notifications/`, `volunteer/`,
  `join/`, `admin/…`, and public pages (About, How it works, Transport safety, Terms, Privacy)
- `src/lib/` — `supabase/`, `routing/`, `matching/`, `geo/`, `time/`, `nav-links/`, shared types and labels
- `src/components/` — UI; `map/` holds the MapLibre view
- `supabase/migrations/` — versioned SQL · `scripts/` — demo reset, MapLibre worker copy
- `tests/unit`, `tests/db`, `tests/e2e`

Project rules for contributors and coding agents: [`CLAUDE.md`](CLAUDE.md).
