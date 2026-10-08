defmodule PhoenixRest.TaskProjection do
  # The task row projection shared by every read that renders a task row —
  # ported from the reference variant's TASK_PROJECTION_FIELDS / FROM /
  # CURSOR_FIELD fragments (src/lib/task-projection.ts).
  #
  # The same task is rendered by three surfaces (the workspace list, a project
  # board, a member's tasks), and a projection that drifted between them would
  # show one task with two different statuses. This is the one place the
  # projection is spelled out, so the models that serve task rows cannot drift
  # apart.
  #
  # `COALESCE` covers the nullable `assignee_id`, and `commentCount` uses COUNT
  # over the LEFT JOIN rather than a subquery so it costs nothing extra on the
  # bounded page. COUNT(c.id) needs no DISTINCT here: comments is the only
  # one-to-many join in the chain, so the row count multiplies only by the
  # task's own comments.
  #
  # Timestamps are rendered in SQL (to_char, UTC) rather than left to the
  # driver: an unpinned projection would show a different instant per machine.
  @moduledoc false

  @doc "The task columns every task read returns."
  @spec fields() :: String.t()
  def fields do
    """
    t.id::int AS id,
    t.project_id::int AS "projectId",
    p.name AS "projectName",
    t.title,
    t.description,
    t.status,
    COALESCE(u.display_name, 'Unassigned') AS "assigneeName",
    COUNT(c.id)::int AS "commentCount",
    to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
    """
    |> String.trim()
  end

  @doc """
  The `FROM`/`JOIN` clause every task read shares, so the joins cannot drift.
  """
  @spec from() :: String.t()
  def from do
    """
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN comments c ON c.task_id = t.id
    """
    |> String.trim()
  end

  @doc """
  The raw `(updated_at, id)` components a keyset cursor is built from.

  Appended only by the paged reads. A single-row fetch by primary key has no
  cursor to build, so it must not carry this.
  """
  @spec updated_at_cursor_field() :: String.t()
  def updated_at_cursor_field do
    """
    to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS "updatedAtRaw"
    """
    |> String.trim()
  end

  @doc """
  The raw `(created_at, id)` components a project board's keyset cursor is built
  from — the project board pages over `created_at`, not `updated_at`.
  """
  @spec created_at_cursor_field() :: String.t()
  def created_at_cursor_field do
    """
    to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS "createdAtRaw"
    """
    |> String.trim()
  end
end
