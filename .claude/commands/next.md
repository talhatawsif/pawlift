---
description: Build the next PawLift checkpoint (or the one named, e.g. 2d)
argument-hint: [checkpoint, e.g. 2d]
---
Checkpoint requested: $ARGUMENTS (blank = next one in STATUS.md).

1. Read CLAUDE.md and docs/STATUS.md. Run only `git status` and `npm run typecheck` to verify the saved checkpoint. If either fails, stop and report.
2. Find the next checkpoint (or the one named) in STATUS.md and PLAN.md §12.
3. If it is 4a, 4b or 5b: stop. Say which checkpoint is next and that it must be started manually in plan mode with the full checkpoint prompt. Don't build it.
4. Otherwise: read only the PLAN/BRIEF sections and files that checkpoint needs. Implement and verify that one checkpoint only. At the end run build, lint, typecheck and tests, plus any gate tests PLAN.md lists for the checkpoint.
5. Commit and push, update docs/STATUS.md (replace stale details; keep ≤80 lines), report in ≤200 words with real check results and the exact next action, then stop.
