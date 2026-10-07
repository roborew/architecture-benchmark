# app/lib/task_projection.py
#
# The task row projection shared by every read that renders a task row —
# ported from the reference variant's TASK_PROJECTION_FIELDS / FROM /
# CURSOR_FIELD fragments (apps/tanstack-start-react/src/lib/data.ts).
#
# The same task is rendered by three surfaces (the workspace list, a project
# board, a member's tasks), and a projection that drifted between them would
# show one task with two different statuses. The projection is spelled out
# here once — as plain SQL fragments every model interpolates — so the models
# that serve task rows cannot drift apart.
#
# `COALESCE` covers the nullable `assignee_id`, and `commentCount` uses COUNT
# over the LEFT JOIN rather than a subquery so it costs nothing extra on the
# bounded page. COUNT(c.id) needs no DISTINCT here: comments is the only
# one-to-many join in the chain, so the row count multiplies only by the
# task's own comments.
#
# Timestamps are rendered in SQL (to_char, UTC) rather than in Python: an
# unpinned projection would show a different instant per machine's zone.

# The task columns every task read returns.
TASK_PROJECTION_FIELDS = """\
t.id::int AS id,
t.project_id::int AS "projectId",
p.name AS "projectName",
t.title,
t.description,
t.status,
COALESCE(u.display_name, 'Unassigned') AS "assigneeName",
COUNT(c.id)::int AS "commentCount",
to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"\
"""

# The raw `(updated_at, id)` components a keyset cursor is built from.
#
# Appended only by the paged reads. A single-row fetch by primary key has no
# cursor to build, so it must not carry this.
TASK_UPDATED_AT_CURSOR_FIELD = """\
to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS "updatedAtRaw"\
"""

# The raw `(created_at, id)` components a project board's keyset cursor is
# built from — the project board pages over `created_at`, not `updated_at`.
TASK_CREATED_AT_CURSOR_FIELD = """\
to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS "createdAtRaw"\
"""

# The `FROM`/`JOIN` clause every task read shares, so the joins cannot drift.
TASK_PROJECTION_FROM = """\
FROM tasks t
JOIN projects p ON p.id = t.project_id
LEFT JOIN users u ON u.id = t.assignee_id
LEFT JOIN comments c ON c.task_id = t.id\
"""
