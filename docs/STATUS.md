# PawLift — status

Updated: 2026-11-08 · Batch 0 completed in the claude.ai planning chat (Opus).

## Current
- Batch 1, checkpoint **1a** DONE (scaffold + static map-first shell, repo pushed).
- Checkpoint **1b** DONE (migrations applied to pawlift-dev, types generated).
- Next: checkpoint **1c**.

## Done
- Revised product brief → `docs/BRIEF.md`
- Architecture, decisions, data model, access matrix, lifecycle, claim/relay/foster rules, matching, notifications, demo strategy, batch gates → `docs/PLAN.md`

## Environment (verified 2026-11-08)
- macOS; node v26.13.0, npm 11.20.0, git 2.50.1, gh 2.103.3 (logged in as talhatawsif).
- Next 16.4.5, React 19.3, Tailwind 4, maplibre-gl 6.16, vitest 5.1.
- Not yet created: Supabase project `pawlift-dev`, `.env.local`, openrouteservice key.

## Blockers
None.

## Exact next action
Batch 1, checkpoint 1c (PLAN.md §12): auth (sign up/in/out), profile trigger, role-aware shell, demo persona switcher (demo env only). Also add a read policy for `suburbs` when first needed.

Notes: Supabase CLI 3.x defaults to the local stack; use `--remote` for db push (CLAUDE.md commands updated mentally: `npx supabase db push --remote`). Docker not installed.

## Implemented / tested / unverified
- Implemented: Next.js app, design tokens (`src/app/globals.css`), static shell (`SearchCard`, `BottomSheet`, `MapView`), `.env.example`, README, Vitest config + 1 unit test.
- Tested: lint, typecheck, test, build all pass; map renders in the browser pane (OpenFreeMap, attribution shown).
- Unverified: mobile layout and keyboard navigation (placeholder controls are disabled); contrast not formally checked.
- Notes: MapLibre 6 worker is copied to `public/maplibre/` by `scripts/copy-maplibre-worker.mjs` (predev/prebuild; gitignored) because Turbopack can't bundle it. A single map `error` event currently shows the "couldn't load" alert; refine in 3a.

## Last session log
- 1a: scaffolded via create-next-app (in scratchpad, copied in), added maplibre-gl, lucide-react, vitest (D17). Ran lint/typecheck/test/build: all pass.
- 1b (partial): wrote `supabase/migrations/20261108000001_core_tables.sql` (all §3 tables + `suburbs`, RLS enabled and all grants revoked, no policies) and `...000002_public_requests_view.sql`. `db push --remote` clean; dry-run shows up to date; anon REST gets 42501 on profiles/location_private/audit_logs, `public_requests` returns []. typecheck/lint/test/build pass. Dated placeholders; `suburbs` table added (PLAN §3 references suburb_id but doesn't list it) — add to PLAN once confirmed.
