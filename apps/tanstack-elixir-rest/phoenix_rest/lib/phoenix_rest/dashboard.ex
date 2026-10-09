defmodule PhoenixRest.Dashboard do
  # The dashboard context: the only place that knows the dashboard SQL. Mirrors
  # the reference variant's model (apps/tanstack-express-rest/express-rest/src/
  # dashboard/dashboard.model.ts) statement for statement.
  #
  # The dashboard's task rows use their own slimmer projection rather than the
  # shared task projection: the recent-tasks table shows no description, project
  # id or comment count, and pulling columns the card never renders would cost
  # the join for nothing.
  @moduledoc """
  Reads for the dashboard: the workspace totals, the most recently updated
  tasks, and the busiest projects.
  """

  alias PhoenixRest.Repo

  # How many rows each dashboard section shows.
  @recent_tasks 3
  @projects 2

  @doc "Workspace totals for the stat cards, in one statement."
  @spec stats() :: map()
  def stats do
    # One statement rather than three, because the cards are rendered together
    # and separate COUNT queries would each scan a different table for the same
    # row.
    [stats] =
      Repo.query_maps("""
      SELECT
        (SELECT COUNT(*) FROM projects)::int AS "projectCount",
        (SELECT COUNT(*) FROM tasks)::int AS "totalTasks",
        (SELECT COUNT(*) FROM tasks WHERE status <> 'done')::int AS "openTasks",
        (SELECT COUNT(*) FROM users)::int AS "peopleCount",
        (SELECT COUNT(*) FROM tasks WHERE status = 'todo')::int AS "todoTasks",
        (SELECT COUNT(*) FROM tasks WHERE status = 'in progress')::int AS "inProgressTasks",
        (SELECT COUNT(*) FROM tasks WHERE status = 'done')::int AS "doneTasks"
      """)

    stats
  end

  @doc """
  The most recently updated tasks, for the recent table.

  Ordered by `updated_at` rather than `created_at`: "recent activity" means when
  the work last moved, which is also what `update/2` advances.
  """
  @spec recent_tasks() :: [map()]
  def recent_tasks do
    Repo.query_maps("""
    SELECT
      t.id::int AS id,
      t.title,
      p.name AS "projectName",
      t.status,
      COALESCE(u.display_name, 'Unassigned') AS "assigneeName",
      to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN users u ON u.id = t.assignee_id
    ORDER BY t.updated_at DESC, t.id DESC
    LIMIT #{@recent_tasks}
    """)
  end

  @doc """
  The busiest projects, for the project cards.

  Ordered by task count so the cards answer "where is the work?" rather than
  repeating the newest-first ordering of every other list.
  """
  @spec projects() :: [map()]
  def projects do
    Repo.query_maps("""
    SELECT
      p.id::int AS id,
      p.name,
      p.description,
      COUNT(t.id)::int AS "taskCount",
      COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
      COUNT(DISTINCT t.assignee_id)::int AS "peopleCount"
    FROM projects p
    LEFT JOIN tasks t ON p.id = t.project_id
    GROUP BY p.id, p.name, p.description
    ORDER BY COUNT(t.id) DESC, p.id ASC
    LIMIT #{@projects}
    """)
  end
end
