# R5 — app changes to satisfy the testing contract

**Normative source:** `spec/contract.md` (unchanged). This document says exactly
what the apps must expose so one shared, black-box Playwright suite can drive all
14 variants. It does **not** rewrite the contract; it records the two mappings
agreed for R5 (below) and the precise DOM expectations.

## Two agreed mappings (where the real IA diverges from the contract prose)

- **Projects index.** The contract's "Projects index — `/`" is satisfied by the
  app's **`/projects`** route (the `/` dashboard stays). The suite navigates to
  `/projects`.
- **Create forms.** The contract lists the create forms under the project board;
  the apps serve them at **`/tasks/new`**. The suite navigates there directly.

The observable route set is common to every variant and is what the suite relies
on: `/projects`, `/projects/<id>`, `/tasks/<id>`, `/tasks/new`,
`/tasks/<id>/edit`.

## Required `data-testid` values

### Projects list (`/projects`)

| testid         | element                                                        |
| -------------- | -------------------------------------------------------------- |
| `project-link` | each project's link (the `<a>` whose text is the project name) |

### Project board (`/projects/<id>`)

| testid                          | element                                       | notes                                                                               |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `task-row`                      | each task row (`<tr>`)                        |                                                                                     |
| `task-title`                    | the task title (its link/text) within the row |                                                                                     |
| `task-status`                   | the status cell within the row                | text **exactly** the raw stored value: `todo`, `in progress`, or `done`             |
| `task-assignee`                 | the assignee cell within the row              | text is the display name, or exactly `Unassigned`                                   |
| `status-filter` + `data-status` | each filter control                           | one per status **plus** `all`; `data-status` ∈ `all`, `todo`, `in progress`, `done` |
| `next-page`                     | the "older" pagination link                   | already present in most apps                                                        |

### Task detail (`/tasks/<id>`)

| testid                                                 | element                                             | notes                                         |
| ------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------- |
| `task-detail`                                          | the detail root (any container wrapping the detail) |                                               |
| `task-title`                                           | the title                                           |                                               |
| `task-status`                                          | the status                                          | text is the raw stored value                  |
| `task-description`                                     | the description                                     |                                               |
| `task-assignee`                                        | the assignee                                        | name or `Unassigned`                          |
| `project-link`                                         | the link to the parent project                      |                                               |
| `task-updated-at`                                      | the updated-at                                      |                                               |
| `comment-row`                                          | each comment that is shown                          | at most the 10 most recent (already enforced) |
| `comment-body`, `comment-author`, `comment-created-at` | within a `comment-row`                              |                                               |
| `not-found`                                            | the not-found view for an unknown id                | already present                               |
| `delete-task-button`                                   | the delete control                                  |                                               |

### Create / update

| testid                     | element                                      | notes           |
| -------------------------- | -------------------------------------------- | --------------- |
| `create-task-form`         | the create-task form at `/tasks/new`         | already present |
| `create-with-comment-form` | the create-with-comment form at `/tasks/new` | already present |
| `update-task-form`         | the update form at `/tasks/<id>/edit`        |                 |

## Two behavioural changes

1. **Raw status text (contract + `spec/seed-spec.md`).** The element carrying
   `task-status` must contain the **raw stored value** as its text — `todo`,
   `in progress`, or `done` — not a JS-mapped label ("To do", "In progress",
   "Done"). Keep the visual label by applying **CSS** `text-transform: capitalize`
   to the badge. Remove the JS `labels` map.

2. **Status filter as tabs.** The project board's status control becomes the
   contract's tabs: a control per status plus an `all` control, each carrying
   `data-testid="status-filter"` and `data-status="all|todo|in progress|done"`.
   Selecting one filters the board to that status (a plain GET link/`<a href>` is
   fine — no client state required). `all` clears the filter. The applied value
   may be carried in `?status=` (URL-encode `in progress`); accepting the raw
   stored spelling in the query is preferred.

## Suite navigation (for reference)

1. `/projects` → click the first `project-link` → `/projects/<id>`.
2. Board → assert `task-row` ≤ 25; each row has raw `task-status`; click the
   `[data-status="done"]` tab → every `task-status` reads `done`; click `all`.
3. Click a `task-title` link → `/tasks/<id>`; assert detail testids; `comment-row`
   ≤ 10.
4. `/tasks/999999` (`not-found`) — unknown id.
5. `/tasks/new` → submit `create-task-form` → the new task is visible (detail),
   survives a reload.
6. `/tasks/new` → submit `create-with-comment-form` → task **and** its first
   comment both visible (atomic).
7. `/tasks/<id>/edit` → submit `update-task-form` → committed title visible, and
   `task-updated-at` changed.
8. On the detail page → click `delete-task-button` → the task is gone (its URL
   now shows `not-found`).

## Out of scope here

- DB-postcondition verification (the rig verifies data independently; wiring the
  suite's created/updated/deleted ids into a SQL check is a follow-up).
- Render-speed (R6) and load (R7) instrumentation.

## Findings from running the suite (all fixed)

Running `testing-rig/e2e/correctness.spec.ts` against all 14 stacks surfaced
several real defects, now fixed. Recorded here so the pattern is not repeated.

- **`task-status` text.** The contract wants the raw stored value; the apps had
  JS label maps ("To do"). Fixed by rendering `{status}` with CSS
  `text-transform: capitalize`. The suite reads **`textContent`**, not
  `innerText`, because `innerText` applies the CSS transform and would read
  "Done" instead of "done".
- **Create-with-comment omitted `status`.** The validator requires `status` with
  no default, so the atomic form silently created nothing. Fixed by adding a
  status control (default `todo`) to the form.
- **TanStack Router clobbers `data-status`.** Its `<Link>` sets its own
  `data-status="active|inactive"` on the anchor, so the filter tabs never
  exposed the raw value. Fixed by rendering the tabs as plain `<a href>` (a GET
  link is explicitly allowed above). Applies to the TanStack Start and SPA
  cohorts; the Next `<Link>` is unaffected.
- **Task-detail `not-found`.** The `data-testid="not-found"` existed only on the
  `*.edit` routes of the TanStack apps; the task-detail _index_ route needed it
  too, or `/tasks/999999` failed.
- **Bodyless DELETE declared a JSON content type.** The shared SPA's `send()`
  set `Content-Type: application/json` with no body; Fastify rejects that
  (`FST_ERR_CTP_EMPTY_JSON_BODY`), the other four APIs tolerated it. Fixed in
  `send()`: omit the header and body when there is no body.

### Suite navigation, precisely

- After a create, the suite locates the new task via **`/tasks`** (by its unique
  title) and opens it, rather than assuming a redirect target. The contract says
  create redirects to the task's detail page; some apps land on the list first.
  This mapping keeps the suite robust without forcing a redirect-target change.
- The suite waits for the form's redirect to settle before navigating, so it
  never races an in-flight server action.
