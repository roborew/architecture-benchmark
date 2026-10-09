# Contract / selector audit (R0)

**Date:** 9 October 2026. **Method:** literal-text search for each contract
`data-testid` value across `apps/**` (`.tsx`, `.ts`, `.heex`). Presence is
*indicative* — a match can be a coincidence of naming — but absence is reliable
and is the point of the audit.

`spec/contract.md` is normative for the black-box correctness suite (plan R5):
the suite addresses screens by these testids so it stays implementation-agnostic.
This audit records how far the apps currently are from that contract. The apps
were built against their own e2e suites, so several contract selectors have no
counterpart yet.

## Result

| Contract testid | Present in |
|---|---|
| `project-link` | **none** |
| `task-assignee` | **none** |
| `status-filter` | **none** |
| `task-updated-at` | **none** |
| `comment-row` | **none** |
| `comment-created-at` | **none** |
| `update-task-form` | **none** |
| `delete-task-button` | **none** |
| `task-row` | spa-api node cohorts only (express-rest, fastify, graphql, orpc) |
| `task-title` | all 14 |
| `task-status` | 13 (not next-trpc) |
| `task-detail`, `task-description`, `comment-body`, `comment-author`, `next-page`, `not-found`, `error-message` | all 14 |
| `create-task-form`, `create-with-comment-form` | all 14 |

`next-template` (excluded from DB runs) is included above only for reference.

## Consequences for R5

The black-box suite (plan R5) must be written against `spec/contract.md`.
Making it pass on all 14 requires adding the missing contract testids
(`project-link`, `task-assignee`, `status-filter`, `task-updated-at`,
`comment-row`, `comment-created-at`, `update-task-form`, `delete-task-button`),
and tightening the partial ones (`task-row`, `task-status`) — a deliberate,
reviewed change across the app cohort, not a mechanical find/replace. Two
options for the project owner:

1. **Add the testids to the apps** (recommended): the contract stays the naming
   authority (`live.md`: "the template app is the naming authority"), and the
   suite is written once against it.
2. **Rewrite `spec/contract.md`** to the selectors the apps already expose:
   cheaper, but abandons the single shared contract that makes cross-variant
   results comparable, and would need `live.md` updated.

Until either lands, R5's gate cannot pass and the decision matrix has no
correctness column for the affected surfaces.
