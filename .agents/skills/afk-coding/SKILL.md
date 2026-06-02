---
name: afk-coding
description: "Use when running an AFK coding pipeline from a spec/PRD: align spec, slice into vertical tickets, run Ralph-style TDD loops, refactor, QA, and prepare review. If the afk-pipeline Pi extension tools are available, keep the pipeline UI updated with afk_set_phase, afk_update_slice, afk_record_artifact, and afk_mark_blocked."
---

# AFK Coding Pipeline

Use this skill for hands-off coding work that starts from a spec/PRD and proceeds through a visible pipeline.

## Mandatory UI/state updates

If these Pi extension tools are available, use them deliberately:

- `afk_set_phase` when entering or completing a phase.
- `afk_update_slice` when creating, starting, completing, or blocking a vertical slice.
- `afk_record_artifact` when writing a spec, ticket, branch name, QA report, PR URL, or other deliverable.
- `afk_mark_blocked` before asking the user a blocking question.

Do not silently advance the pipeline. The user should always be able to run `/afk board` and see where the work is.

## Phases

1. **Spec** — read the PRD/spec; identify ambiguity; ask if blocked.
2. **Slice** — create small vertical tickets, usually under `docs/tickets/`.
3. **Ralph loops** — implement one slice at a time with fresh-context discipline.
4. **Refactor** — behavior-preserving cleanup pass.
5. **QA** — exercise the real user journey and write a QA report.
6. **Review** — summarize what changed and what a human should inspect.

## Vertical slicing rules

Each slice must be independently useful and end-to-end where possible:

- UI/form/command surface
- API/domain behavior
- automated test/backpressure
- acceptance criteria

Avoid horizontal tickets like “frontend only”, “backend only”, or “tests later”.

## Ralph loop rules

For each unchecked task in a slice ticket:

1. **Red** — write or update a failing test that captures the behavior.
2. **Green** — implement the smallest change that passes.
3. **Refactor** — clean up while tests remain green.
4. Run relevant tests/typecheck/lint.
5. Commit the completed task.
6. Tick the checkbox in the ticket.
7. Update the AFK UI state.

Never delete or weaken a failing test to make the suite pass. Fix the product code or mark the pipeline blocked.

## Refactor pass

Do not add features. Look for and fix:

- duplication
- long functions/files
- bad names
- dead code
- unsafe types
- inconsistent abstractions

Run checks after each meaningful cleanup and commit behavior-preserving changes.

## QA pass

Write a markdown QA report with:

- scenario
- steps taken
- expected result
- actual result
- pass/fail
- screenshots or logs if available

Record the report with `afk_record_artifact`.

## Blockers

If the spec is ambiguous, dependencies are missing, tests cannot be run, or a product decision is needed:

1. Call `afk_mark_blocked` with the exact reason.
2. Ask one clear question.
3. Do not guess past product ambiguity.
4. In Ralph worker mode, also write a structured blocker section to the prompt file you were given:

```md
## Blocked

Reason:
Needed human decision:
Files touched:
Suggested next step:
```
