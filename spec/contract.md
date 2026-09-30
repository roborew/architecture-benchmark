# Behavioral contract — screens, CRUD semantics, outcomes

Normative for every app variant. The rig's black-box Playwright correctness
suite tests exactly this contract — no implementation-specific action
selectors. Apps may differ in _how_ they satisfy it (Server Action, tRPC,
REST), never in observable behavior.

## Entities and rules

- `status` is one of `todo`, `in progress`, `done` (constrained text; no lookup
  table). These are the stored values — identical to the reference app's
  `TaskStatus` type, so no display mapping is required.
- `title`: 1–200 chars. `comment body`: 1–1000 chars. Validation failures are
  user-visible (see `error-message`) and change nothing.
- `assignee` is nullable: clearing the assignee sets `assignee_id = NULL`
  (exactly one way: an explicit "unassigned" choice in the update form).
- Deleting a task **cascades** its comments (FK `ON DELETE CASCADE`); the app
  then reports the task gone.
- Deleting a project is out of contract (FK `ON DELETE RESTRICT`); the UI need
  not offer it.

## Screens

### 1. Projects index — `/`

Lists all projects as links (`data-testid="project-link"`) with project name.

### 2. Project task board — `/projects/[id]`

- First page of up to **25 tasks**, newest first: `(created_at DESC, id DESC)`.
- Each task row (`data-testid="task-row"`) shows: `task-title`, `task-status`
  (raw status text), `task-assignee` (display name, or `Unassigned`).
- Optional status filter via `?status=todo|in progress|done`; filter tabs render as
  `data-testid="status-filter" data-status="<status>"` plus an "all" tab
  (`data-status="all"`).
- Keyset pagination: an "older" link (`data-testid="next-page"`) carrying an
  opaque cursor for `(created_at, id)`; it must be stable and repeatable
  (same cursor → same page).
- Create-task form (`data-testid="create-task-form"`): fields `title`
  (required), `description`, `assignee` (select of all users incl.
  `Unassigned`), `status` (default `todo`). On success the app shows the new
  task (redirect to its detail page) — a persisted id must have been allocated.
- Create-with-comment form (`data-testid="create-with-comment-form"`): the
  create-task fields plus `commentBody` and `commentAuthor`. Atomic: either
  the task _and_ its first comment both exist, or neither does (transaction;
  no partial state is ever visible).

### 3. Task detail — `/tasks/[id]`

- Shows `task-detail` with `task-title`, `task-status`, `task-description`,
  `task-assignee` (name or `Unassigned`), the parent `project-link`
  (name), and `task-updated-at` (the explicitly maintained `updated_at`).
- The **10 most recent** comments (`comment-row`), each with `comment-body`,
  `comment-author`, `comment-created-at`. Never more than 10, never unbounded.
- Unknown id renders a not-found page (HTTP 404) with `data-testid="not-found"`.
- Update form (`data-testid="update-task-form"`): `title`, `status`, `assignee`
  (incl. `Unassigned`), `description`. On success the page shows the committed
  result, including a new `task-updated-at`.
- Delete form/button (`data-testid="delete-task-button"`): on success the task
  is gone — redirect to the project board, where the task no longer appears;
  direct navigation to the detail URL shows not-found.

## Outcome and visibility semantics

- A mutation is complete only when the **persisted result is visible** in the
  UI (not merely when a transport request returned 200). The rig verifies DB
  postconditions independently through the app stack's Postgres.
- A user-facing mutation timing ("click-to-visible-committed") is a different
  metric from a k6/HTTP completion and is always labelled as such.
- Reload persistence: after any successful mutation, a full page reload must
  show the same committed state.
- No mutation silently targets a stale row: update/delete outcomes are verified
  against the intended row and value.

## Health

`GET /healthz` returns HTTP 200 with `{"ok":true}` (may check DB connectivity;
must not perform writes). Used by Compose readiness and the rig.
