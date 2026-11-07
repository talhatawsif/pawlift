# PawLift — status

Updated: 2026-11-08 · Batch 0 completed in the claude.ai planning chat (Opus).

## Current
- Batch 1, checkpoint **1a** DONE (scaffold + static map-first shell, repo pushed).
- Next: checkpoint **1b**.

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
Batch 1, checkpoint 1b (PLAN.md §12 and §3, §4): user must first create Supabase project `pawlift-dev` (Sydney) and fill `.env.local`. Then link project, write migrations for core tables with PostGIS and default-deny RLS, `db push`, generate types.

## Implemented / tested / unverified
- Implemented: Next.js app, design tokens (`src/app/globals.css`), static shell (`SearchCard`, `BottomSheet`, `MapView`), `.env.example`, README, Vitest config + 1 unit test.
- Tested: lint, typecheck, test, build all pass; map renders in the browser pane (OpenFreeMap, attribution shown).
- Unverified: mobile layout and keyboard navigation (placeholder controls are disabled); contrast not formally checked.
- Notes: MapLibre 6 worker is copied to `public/maplibre/` by `scripts/copy-maplibre-worker.mjs` (predev/prebuild; gitignored) because Turbopack can't bundle it. A single map `error` event currently shows the "couldn't load" alert; refine in 3a.

## Last session log
- 1a: scaffolded via create-next-app (in scratchpad, copied in), added maplibre-gl, lucide-react, vitest (D17). Ran lint/typecheck/test/build: all pass.
