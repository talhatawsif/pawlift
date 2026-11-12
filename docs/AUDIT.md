# PawLift — whole-app audit (d2)

Started 2026-11-12. Evidence column says how each row was established: **read** = code read this session, **browser** = clicked in headless Chromium (375 px unless stated), **test** = automated check run this session, **unverified** = not checked.

Severity: **high** = security, data integrity or a broken core flow · **medium** = wrong or confusing behaviour a demo user would hit · **low** = polish, wording, consistency.

## Round 1

| # | Sev | Where | Finding | Evidence | Status |
|---|---|---|---|---|---|
| 1 | medium | `src/app/join/actions.ts` `requestMembership`, `src/app/org/[id]/members/actions.ts` `revokeInvitation` `decideMembership`, `src/app/org/[id]/locations/actions.ts` `confirmDestination` `setFosterStatus`, `src/app/volunteer/actions.ts` `resubmitVolunteer`, `src/app/notifications/actions.ts` | Plain form actions ignore the RPC error: on refusal (unverified org, suspended account, invalid state) the page just re-renders with no message. | read | fixed |
| 2 | medium | `src/app/auth/actions.ts` `signIn`, every page's `redirect("/sign-in")` | Signing in always lands on the map. A signed-out user following a deep link (lift detail, invitation, assignment) loses their place. | read | fixed |
| 3 | medium | all pages except `/` and `/org/[id]/*` | No shared header: only a text "Back to map" link and no Menu button, so volunteers, foster carers and admins cannot reach notifications or other sections without going back to the map first. | read | fixed |
| 4 | medium | `src/components/AddLift.tsx` | The "Add lift" button shows for coordinators of pending and suspended organisations and for suspended accounts; the single-org case links straight to a form that cannot publish. (Explanation dialog exists only in the multi-org branch when none is verified.) | read | fixed |
| 5 | medium | `src/components/RequestActions.tsx` `CancelForm`, dashboard `ReleaseButton` `WithdrawOfferButton` `ReassignForm` | Irreversible actions fire on one tap with no confirmation. | read | fixed |
| 6 | low | `src/components/AssignmentActions.tsx`, `src/components/ReminderToggle.tsx`, `src/app/notifications/page.tsx`, `src/app/org/[id]/page.tsx`, `src/app/org/[id]/history/page.tsx` | "transport(s)" still used in visible text: "Accept this transport", "Withdraw from this transport", "your transports and lifts", "a transport you've been confirmed for", "Transport history". | read | fixed |
| 7 | low | `src/components/DemoSwitcher.tsx` | Failed persona sign-in says "Demo data is seeded in a later step" (stale; seeding exists). | read | fixed |
| 8 | low | `src/app/join/page.tsx`, `src/app/org/[id]/members/page.tsx`, `src/app/org/[id]/locations/page.tsx`, `src/components/GeocodeButton.tsx`, `src/components/DashboardActions.tsx`, `src/components/InviteForm.tsx` | Buttons at 40–44 px (`h-10`, `h-11`) below the 48 px touch target in DESIGN.md. | read | fixed |
| 9 | low | `src/app/volunteer/page.tsx` | `?accepted=1` after accepting guidelines shows no confirmation message (param read, never rendered). | read | fixed |
| 10 | low | `src/app/org/[id]/members/page.tsx` | "Can confirm receipt" checkbox never reflects the saved value (member list has no such field), so toggling foster approval silently resets it. | read | open: needs a migration (member list lacks the field), awaiting approval |
| 11 | low | `src/app/requests/page.tsx`, `src/app/org/[id]/requests/page.tsx`, `/org/[id]/locations`, `/org/[id]/history`, admin lists | Cold empty states ("No lifts yet.", "No locations yet.", "Nothing here.") and no species avatar on the public list. | read | fixed |
| 12 | info | `src/lib/nav-links/index.ts` | Google (`/maps/dir/?api=1&origin&destination&waypoints&travelmode`), Apple (`maps.apple.com/?saddr&daddr=a+to:b&dirflg=d`) and Waze (`waze.com/ul?ll=lat,lng&navigate=yes`) URLs match the vendors' documented formats; coordinates are 5-decimal lat,lng. Not opened in the apps. | read | ok |
| 13 | info | `supabase/migrations` | Only four `create policy` rows exist, all on `storage.objects` and gated by definer functions; app tables have RLS with no client policies (reads and writes go through RPCs). Anon grants: `public_requests` select and `list_public_suburbs`. | read | ok |
| 14 | info | git | `.env.local`, `tests/e2e/.auth/` are ignored and untracked. Service-role key is read only in `tests/` and `scripts/`. | test (`git status --ignored`) | ok |

## Browser pass

(filled in below as pages are visited)
