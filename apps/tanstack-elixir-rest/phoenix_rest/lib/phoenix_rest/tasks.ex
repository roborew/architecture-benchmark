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

  # spec/queries.md — the server sets created_at and updated_at explicitly and
  # equal at insert (now() is the transaction timestamp, so both calls in one
  # statement return the same instant).
  @create_task_sql """
  INSERT INTO tasks (
    project_id, assignee_id, title, description, status, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?, now(), now())
  RETURNING id::int AS id
  """

  # spec/queries.md — updated_at is set in the statement, not by a DB default or
  # an ORM side effect.
  @update_task_sql """
  UPDATE tasks
  SET title = ?, description = ?, status = ?, assignee_id = ?, updated_at = now()
  WHERE id = ?
  RETURNING id
  """

  @insert_comment_sql "INSERT INTO comments (task_id, author_id, body, created_at) VALUES ($1, $2, $3, now())"

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

  @doc """
  The database half of the reference's `resolve_refs`: whether the ids that
  passed shape validation name real rows.

  Returns field errors keyed by body field, so an unknown id lands on its field
  like any other validation failure. `assignee_id` is only checked when present
  (a null assignee is unassigned, always valid).
  """
  @spec resolve_refs(integer(), integer() | nil) :: %{optional(String.t()) => [String.t()]}
  def resolve_refs(project_id, assignee_id) do
    %{}
    |> put_ref_error(
      "projectId",
      not project_exists?(project_id),
      "That project no longer exists."
    )
    |> put_ref_error(
      "assigneeId",
      assignee_id != nil and not user_exists?(assignee_id),
      "That assignee no longer exists."
    )
  end

  @doc "Inserts one task (created_at/updated_at set equal) and returns its id."
  @spec create(map()) :: {:ok, %{id: integer()}}
  def create(input) do
    {sql, params} =
      SQL.compile([
        {@create_task_sql,
         [input.project_id, input.assignee_id, input.title, input.description, input.status]}
      ])

    [%{"id" => id}] = Repo.query_maps(sql, params)
    {:ok, %{id: id}}
  end

  @doc """
  Updates one task by primary key, explicitly advancing `updated_at`, or reports
  `:missing` / `{:error, :assignee_missing}`.

  The assignee is checked first, mirroring the reference: a bad assignee is a
  field error the client can fix, a missing task is a 404, and the field error is
  the more actionable of the two to report first.
  """
  @spec update(integer(), map()) :: :ok | :missing | {:error, :assignee_missing}
  def update(id, input) do
    with :ok <- check_assignee(input.assignee_id),
         :ok <- check_task_exists(id) do
      {sql, params} =
        SQL.compile([
          {@update_task_sql,
           [input.title, input.description, input.status, input.assignee_id, id]}
        ])

      case Repo.query_maps(sql, params) do
        [] -> :missing
        _ -> :ok
      end
    end
  end

  @doc """
  Deletes one task under the documented cascade and reports the project the
  contract redirects the client to, or `:missing` when no such row exists.
  """
  @spec remove(integer()) :: {:ok, integer()} | :missing
  def remove(id) do
    # Read the project first, because the contract redirects to its board after a
    # delete; a missing task is reported before anything is written.
    case Repo.query_maps("SELECT project_id::int AS \"projectId\" FROM tasks WHERE id = $1", [id]) do
      [%{"projectId" => project_id}] ->
        case Repo.query_maps("DELETE FROM tasks WHERE id = $1 RETURNING id", [id]) do
          [] -> :missing
          _ -> {:ok, project_id}
        end

      [] ->
        :missing
    end
  end

  @doc """
  spec/queries.md — "Create with initial comment": ONE transaction inserting the
  task then its comment, any failure rolling back both.

  The comment author is checked first so an unknown id is a field error rather
  than a thrown FK violation.
  """
  @spec create_with_comment(map()) :: {:ok, %{id: integer()}} | {:error, :author_missing}
  def create_with_comment(input) do
    if user_exists?(input.comment_author_id) do
      Repo.transaction(fn ->
        {:ok, %{id: id}} = create(input)
        insert_comment(id, input.comment_author_id, input.comment_body)
        %{id: id}
      end)
    else
      {:error, :author_missing}
    end
  end

  @doc "Adds one comment to an existing task."
  @spec add_comment(integer(), %{body: String.t(), author_id: integer()}) ::
          :ok | :missing | {:error, :author_missing}
  def add_comment(task_id, %{body: body, author_id: author_id}) do
    # The task and the author are both foreign keys; checking first turns an
    # unknown id into an outcome the client can act on rather than a thrown
    # Postgres error. Sequential, not concurrent: the sandbox checks out one
    # connection per test process.
    cond do
      not task_exists?(task_id) ->
        :missing

      not user_exists?(author_id) ->
        {:error, :author_missing}

      true ->
        insert_comment(task_id, author_id, body)
        :ok
    end
  end

  defp insert_comment(task_id, author_id, body) do
    Repo.query!(@insert_comment_sql, [task_id, author_id, body])
  end

  defp check_assignee(nil), do: :ok

  defp check_assignee(id) do
    if user_exists?(id), do: :ok, else: {:error, :assignee_missing}
  end

  defp check_task_exists(id) do
    if task_exists?(id), do: :ok, else: :missing
  end

  defp put_ref_error(errors, _field, false, _message), do: errors
  defp put_ref_error(errors, field, true, message), do: Map.put(errors, field, [message])

  defp project_exists?(id),
    do: Repo.query_maps("SELECT id FROM projects WHERE id = $1", [id]) != []

  defp user_exists?(id), do: Repo.query_maps("SELECT id FROM users WHERE id = $1", [id]) != []
  defp task_exists?(id), do: Repo.query_maps("SELECT id FROM tasks WHERE id = $1", [id]) != []

  # The `(updated_at|created_at, id)` cursor is derived here rather than in SQL
  # so packing has one implementation, shared with the decoder the next page is
  # read back with.
  defp with_cursor(row, raw_field) do
    Map.put(row, "cursorFor", Cursor.encode(row[raw_field], row["id"]))
  end
end
