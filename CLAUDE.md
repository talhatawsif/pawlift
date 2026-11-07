# PawLift — Claude Code guide

Animal rescue transport coordination, Western Melbourne first. Australian English. Display Australia/Melbourne time; store UTC (timestamptz).
Message: "You're already going somewhere. You might be able to help an animal get there too."

## Read at the start of every session
1. This file.
2. `docs/STATUS.md` — current checkpoint and exact next action.
3. `docs/PLAN.md` — only the sections the current checkpoint needs.
`docs/BRIEF.md` is the full product brief. Open only the numbered section you need. Never read whole docs or large files "just in case".

## Working rules
- One checkpoint per session. Use plan mode first, then implement, run checks, commit, update STATUS.md, stop.
- Report in ≤200 words: outcome, checks run with real results, open issues, next action. Reference file paths; don't paste code or logs.
- Never fabricate test results, route estimates or integrations. Label anything unverified as unverified.
- Same failure after two fix attempts → stop, record evidence in STATUS.md, propose the smallest next diagnostic.
- No new dependency without a one-line reason added to PLAN.md §2 Decisions. Prefer built-in platform features.
- Never ask for secrets in chat. Never print `.env*` values. Never commit `.env.local`.
- No public deployment without the user's explicit OK. Pushing checkpoints to the user's private GitHub repo is approved.
- Ask only when blocked, when scope would change, or before an external/irreversible action.
- Don't add MCP servers, plugins or subagents unless the user asks.

## Stack
Next.js (App Router) · TypeScript strict · Tailwind CSS · Supabase (Auth, Postgres + PostGIS, RLS, Storage, pg_cron) via `@supabase/ssr` · MapLibre GL JS + OpenFreeMap tiles · openrouteservice through a server-side routing adapter with DEMO fixture fallback · lucide-react icons · Vitest · Playwright (Batch 7) · Vercel.
Check installed versions before writing code that depends on an API.

## Architecture rules (non-negotiable)
- Every state change goes through a Postgres RPC function (`security definer`, `set search_path = public`, explicit `auth.uid()` checks) that writes `audit_logs` in the same transaction. No client UPDATE policies on status columns.
- App code uses the signed-in user's session with the anon/publishable key. The service-role key is used only in `scripts/` (seed, reset, tests setup) and never imported from `src/`.
- Private data (exact addresses, contacts, handover instructions, medical notes) lives in separate tables, read only through access functions. Public screens read public views.
- Roles, verification and membership are never trusted from the client; RPCs re-check them at mutation time.
- Every route estimate carries `source` (`ors` | `demo`) and the UI labels it. Demo rows have `is_demo = true` and a visible DEMO badge.

## Commands (keep this list accurate)
- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`
- `npm run test:db` — RLS and RPC tests against the dev Supabase project
- `npm run test:e2e` — Playwright: reseeds DEMO data, then the volunteer, organisation and foster stories, keyboard and axe (WCAG A/AA) checks; uses the dev server on :3000 (starts one if none)
- `npm run demo:reset` — reseed DEMO data; refuses unless `APP_ENV=demo` and the project ref is in `DEMO_PROJECT_REFS`
- `npx supabase db push --remote` — apply migrations to the linked dev project
- `npx supabase gen types typescript --remote > src/lib/database.types.ts`

## Layout (update as created)
- `src/app/` — routes: `(public)`, `requests/[id]` (claim), `assignments/` (volunteer), `org/[id]/dashboard|audit`, `admin/`
- `src/lib/` — `supabase/`, `routing/`, `matching/`, `geo/`, `time/`, `nav-links/`
- `src/components/` — UI; `map/` for MapLibre pieces
- `supabase/migrations/` — versioned SQL; `scripts/` — seed/reset; `tests/` — unit, db, e2e

## Design
Map-first, deliberately like Google Maps. Read BRIEF §3 (including the "never" list) before any UI work.

## Git
Commit after each passing checkpoint: `b<N>.<checkpoint>: <summary>` (e.g. `b1.a: scaffold app shell`). Push to `origin` (user's private GitHub repo `pawlift`).

## Token and output rules
- When running checks, show only pass/fail and the first error, never full logs. Don't paste code back to me.
- Don't re-read files already read this session. Don't read whole docs.
- Low-risk UI checkpoints can be built in auto-accept mode. Anything touching the database, RLS, permissions, claims, assignments or handovers needs an approved plan first.
