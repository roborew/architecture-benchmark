defmodule PhoenixRest.Tasks do
  # The tasks context: the only place that knows the tasks SQL. Mirrors the
  # reference variant's model (apps/tanstack-express-rest/express-rest/src/
  # tasks/tasks.model.ts) statement for statement.
  #
  # The task row is the shared projection every surface that renders a task uses,
  # so a listing needs no second query for the comment count and the project and
  # assignee joins cannot drift. Comments live in this domain: they are a
  # sub-resource of a task, and every comment read/write is scoped by one.
  @moduledoc """
  Reads and writes for tasks and their comments.

  Reads return string-keyed maps straight from the SQL aliases (the wire shape);
  writes return typed result tuples the controller maps to envelopes.
  """

  alias PhoenixRest.{Cursor, Repo, SQL, TaskProjection}

  # spec/queries.md — a task list page carries at most 25 rows.
  @page_size 25

  # spec/queries.md — a task detail shows the 10 most recent comments.
  @comments_per_task 10

  @doc """
  The workspace-wide task list, ordered by `updated_at DESC, id DESC`, one
  keyset page of at most `limit` rows (clamped to `[1, 26]`, default 25).

  `filters` is the shape `PhoenixRest.Tasks.Validator.parse_list_query/1`
  returns.
  """
  @spec list(map()) :: [map()]
  def list(filters) do
    search = Map.get(filters, :search) || ""
    status = Map.get(filters, :status) || ""
    project_id = Map.get(filters, :project_id)
    assignee_id = Map.get(filters, :assignee_id)
    cursor = Map.get(filters, :cursor)
    limit = Map.get(filters, :limit) || @page_size

    # Clamped so a caller cannot ask for an unbounded page. One row above the
    # page size is allowed deliberately: fetching PAGE + 1 and dropping the last
    # is how the caller learns whether an older page exists without a COUNT.
    bound = limit |> max(1) |> min(@page_size + 1)

    # LIKE wildcards in a search box are almost always a literal character the
    # user typed, not a pattern.
    pattern = "%" <> SQL.escape_like(search) <> "%"

    decoded = Cursor.decode(cursor)
    cursor_params = if decoded, do: [decoded.created_at, decoded.id], else: []

    {sql, params} =
      SQL.new()
      |> SQL.fragment("SELECT")
      |> SQL.fragment(TaskProjection.fields() <> ",")
      |> SQL.fragment(TaskProjection.updated_at_cursor_field())
      |> SQL.fragment(TaskProjection.from())
      |> SQL.fragment("WHERE 1 = 1")
      |> SQL.add(project_id != nil, "AND t.project_id = ?", [project_id])
      |> SQL.add(status != "", "AND t.status = ?", [status])
      |> SQL.add(assignee_id != nil, "AND t.assignee_id = ?", [assignee_id])
      |> SQL.add(
        search != "",
        "AND (t.title ILIKE ? OR t.description ILIKE ?)",
        [pattern, pattern]
      )
      # Keyset rather than OFFSET. The cursor is bound as text and cast in SQL:
      # the driver would otherwise parse it back into a timestamp, turning a
      # stale or hand-edited cursor into a driver-level error instead of simply
      # not matching a row.
      |> SQL.add(
        decoded != nil,
        "AND (t.updated_at, t.id) < (?::text::timestamptz, ?)",
        cursor_params
      )
      |> SQL.fragment("GROUP BY t.id, p.name, u.display_name, t.updated_at")
      |> SQL.fragment("ORDER BY t.updated_at DESC, t.id DESC")
      |> SQL.fragment("LIMIT #{bound}")
      |> SQL.compile()

    sql
    |> Repo.query_maps(params)
    |> Enum.map(&with_cursor(&1, "updatedAtRaw"))
  end

  @doc "One task by id with its project and assignee names, or `nil`."
  @spec get(integer()) :: map() | nil
  def get(id) do
    {sql, params} =
      SQL.compile([
        {"SELECT", []},
        {TaskProjection.fields(), []},
        {TaskProjection.from(), []},
        {"WHERE t.id = ?", [id]},
        {"GROUP BY t.id, p.name, u.display_name", []}
      ])

    case Repo.query_maps(sql, params) do
      [task | _] -> task
      [] -> nil
    end
  end

  @doc "The 10 most recent comments on one task, newest first."
  @spec list_comments(integer()) :: [map()]
  def list_comments(task_id) do
    Repo.query_maps(
      """
      SELECT
        c.id::int AS id,
        c.task_id::int AS "taskId",
        u.display_name AS "authorName",
        c.body,
        to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
      FROM comments c
      JOIN users u ON u.id = c.author_id
      WHERE c.task_id = $1
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT #{@comments_per_task}
      """,
      [task_id]
    )
  end

  @doc """
  Counts the tasks matching the workspace list's filters.

  A second statement rather than a window function, deliberately: the list is
  `LIMIT`ed, and `COUNT(*) OVER ()` would force Postgres to materialise every
  matching row before discarding all but the first page.
  """
  @spec count(map()) :: non_neg_integer()
  def count(filters) do
    search = Map.get(filters, :search) || ""
    status = Map.get(filters, :status) || ""
    project_id = Map.get(filters, :project_id)
    assignee_id = Map.get(filters, :assignee_id)
    pattern = "%" <> SQL.escape_like(search) <> "%"

    {sql, params} =
      SQL.new()
      |> SQL.fragment("SELECT COUNT(*)::int AS count FROM tasks t WHERE 1 = 1")
      |> SQL.add(project_id != nil, "AND t.project_id = ?", [project_id])
      |> SQL.add(status != "", "AND t.status = ?", [status])
      |> SQL.add(assignee_id != nil, "AND t.assignee_id = ?", [assignee_id])
      |> SQL.add(
        search != "",
        "AND (t.title ILIKE ? OR t.description ILIKE ?)",
        [pattern, pattern]
      )
      |> SQL.compile()

    [%{"count" => count}] = Repo.query_maps(sql, params)
    count
  end

  # The `(updated_at|created_at, id)` cursor is derived here rather than in SQL
  # so packing has one implementation, shared with the decoder the next page is
  # read back with.
  defp with_cursor(row, raw_field) do
    Map.put(row, "cursorFor", Cursor.encode(row[raw_field], row["id"]))
  end
end
