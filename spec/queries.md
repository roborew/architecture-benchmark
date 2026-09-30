# Query contract — exact result shapes and SQL expectations

Normative read/write paths (plan §2). All variants must produce identical
result semantics with indexed access; they may differ in internal function
structure. "SQL expectations" describe what the rig inspects in
`pg_stat_statements`/EXPLAIN for diagnostics — not identical internal calls.

## List project tasks

Returns up to 25 rows for a project, newest first, with assignee display names.

- Order: `created_at DESC, id DESC` (id is the stable tiebreaker; fixture
  timestamps are unique so ties are rare but must be handled).
- Optional filter: `status IN ('todo','in progress','done')` (single value).
- **Keyset pagination**: cursor encodes `(created_at, id)` of the last row of
  the previous page; the next page selects
  `(created_at, id) < (cursor.created_at, cursor.id)` under the same order.
  The initial list uses the first page; deep paging is not forced in every
  benchmark run.
- SQL shape: `tasks` driving with an index on `(project_id[, status], created_at DESC, id DESC)`,
  LEFT JOIN `users` on `assignee_id` (nullable) — one statement, bounded rows
  (`LIMIT 25`), no unbounded relation loading.

## Task detail

One task plus its project, assignee, and the 10 most recent comments with
author names.

- Task row: `tasks ⋈ projects` (project name) `LEFT JOIN users` (assignee name).
- Comments: `comments ⋈ users` for the task, `ORDER BY created_at DESC, id DESC LIMIT 10`.
- Both nested lists and the task row are bounded (never `SELECT *` on all comments).

## Create task

Insert one `tasks` row for an existing project. Server sets `created_at` and
`updated_at` explicitly (both equal at insert; UTC). Returns the persisted id
and shows the task. Constraint/validation failures produce a user-visible
error and insert nothing.

## Update task

Update `title` / `status` / `assignee_id` (nullable) / `description` by primary
key. The statement must **explicitly set `updated_at`** (not rely on a DB
default or ORM side effect). Shows the committed result. An update is
"successful" only if the intended row now holds the intended value.

## Delete task

`DELETE FROM tasks WHERE id = $1` under the documented cascade (comments are
removed by the FK). Shows absence: not in the list, not-found on direct
navigation.

## Create with initial comment

One transaction: insert the task, then insert a comment referencing it;
any failure rolls back both. No partial state is observable, including via a
concurrent read.

## Diagnostics

For each measured run the rig records: SQL statement counts per operation
(from `pg_stat_statements`) and plan inspection (index usage per the queries
above). These are diagnostics, not fairness criteria, except that a variant
losing the required indexes fails the schema conformance check.
