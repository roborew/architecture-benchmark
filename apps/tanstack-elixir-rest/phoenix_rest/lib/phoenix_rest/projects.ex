defmodule PhoenixRest.Projects do
  # The projects context: the only place that knows the projects SQL. Mirrors the
  # reference variant's model (apps/tanstack-express-rest/express-rest/src/
  # projects/projects.model.ts) statement for statement.
  #
  # The project task board (list_tasks/2) is served here because it is this
  # surface's read: the rows share the task projection, so a board row cannot
  # drift from the workspace list's row for the same task.
  @moduledoc """
  Reads and writes for projects.

  Reads return string-keyed maps straight from the SQL aliases (the wire shape);
  writes return typed result tuples the controller maps to envelopes.
  """

  alias PhoenixRest.{Cursor, Repo, SQL, TaskProjection}

  # spec/queries.md — a board page carries at most 25 rows.
  @page_size 25

  @project_fields """
  p.id::int AS id,
  p.name,
  p.description,
  COUNT(t.id)::int AS "taskCount",
  COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS "openTaskCount",
  COUNT(DISTINCT t.assignee_id)::int AS "peopleCount",
  (p.created_at AT TIME ZONE 'UTC')::date::text AS "createdAt"
  """

  @project_from """
  FROM projects p
  LEFT JOIN tasks t ON p.id = t.project_id
  """

  @group_by "GROUP BY p.id, p.name, p.description, p.created_at"
  @order_by "ORDER BY p.created_at DESC, p.id DESC"

  @doc """
  Every project with its aggregate counts, ordered
  `created_at DESC, id DESC`. An empty `term` returns every project.
  """
  @spec list(String.t()) :: [map()]
  def list(term) do
    where =
      if term == "" do
        {"", []}
      else
        # ILIKE treats %, _ and \ as wildcards, so a search for "100%" must not
        # match every row — the term is escaped before it reaches the pattern.
        pattern = "%" <> SQL.escape_like(term) <> "%"

        {"WHERE p.name ILIKE ? OR p.description ILIKE ?", [pattern, pattern]}
      end

    {sql, params} =
      SQL.compile([
        {"SELECT", []},
        {@project_fields, []},
        {@project_from, []},
        where,
        {@group_by, []},
        {@order_by, []}
      ])

    Repo.query_maps(sql, params)
  end

  @doc """
  One project by id, with the same shape `list` returns, or `nil`.
  """
  @spec get(integer()) :: map() | nil
  def get(id) do
    {sql, params} =
      SQL.compile([
        {"SELECT", []},
        {@project_fields, []},
        {@project_from, []},
        {"WHERE p.id = ?", [id]},
        {@group_by, []}
      ])

    case Repo.query_maps(sql, params) do
      [project | _] -> project
      [] -> nil
    end
  end

  @doc """
  One page of a project's task board, newest first (`created_at DESC, id DESC`),
  keyset-paged over `(created_at, id)`, at most `limit` rows (clamped to
  `[1, 26]`, default 25).

  `filters` is the shape `PhoenixRest.Tasks.Validator.parse_project_list_query/1`
  returns: `%{status: _, cursor: _, limit: _}`.
  """
  @spec list_tasks(integer(), %{
          status: String.t(),
          cursor: String.t() | nil,
          limit: integer() | nil
        }) :: [map()]
  def list_tasks(project_id, filters) do
    status = Map.get(filters, :status) || ""
    cursor = Map.get(filters, :cursor)
    limit = Map.get(filters, :limit) || @page_size

    # Clamped so a caller cannot ask for an unbounded page. One row above the
    # page size is allowed deliberately: fetching PAGE + 1 and dropping the last
    # is how the caller learns whether an older page exists without a COUNT.
    bound = limit |> max(1) |> min(@page_size + 1)

    decoded = Cursor.decode(cursor)
    cursor_params = if decoded, do: [decoded.created_at, decoded.id], else: []

    {sql, params} =
      SQL.new()
      |> SQL.fragment("SELECT")
      |> SQL.fragment(TaskProjection.fields() <> ",")
      |> SQL.fragment(TaskProjection.created_at_cursor_field())
      |> SQL.fragment(TaskProjection.from())
      |> SQL.fragment("WHERE t.project_id = ?", [project_id])
      |> SQL.add(status != "", "AND t.status = ?", [status])
      # Keyset rather than OFFSET: OFFSET re-walks every skipped row. Bound as
      # text and cast in SQL rather than as a timestamptz so an unusable cursor
      # matches nothing instead of failing in the driver.
      |> SQL.add(
        decoded != nil,
        "AND (t.created_at, t.id) < (?::text::timestamptz, ?)",
        cursor_params
      )
      |> SQL.fragment("GROUP BY t.id, p.name, u.display_name, t.created_at")
      |> SQL.fragment("ORDER BY t.created_at DESC, t.id DESC")
      |> SQL.fragment("LIMIT #{bound}")
      |> SQL.compile()

    sql
    |> Repo.query_maps(params)
    |> Enum.map(fn row ->
      Map.put(row, "cursorFor", Cursor.encode(row["createdAtRaw"], row["id"]))
    end)
  end

  @doc """
  Inserts one project (`created_at` is server-set, since the column is NOT NULL
  with no default) and returns its id.
  """
  @spec create(%{name: String.t(), description: String.t()}) :: {:ok, %{id: integer()}}
  def create(%{name: name, description: description}) do
    {sql, params} =
      SQL.compile([
        {"INSERT INTO projects (name, description, created_at) " <>
           "VALUES (?, ?, now()) RETURNING id::int AS id", [name, description]}
      ])

    [%{"id" => id}] = Repo.query_maps(sql, params)
    {:ok, %{id: id}}
  end

  @doc """
  Updates one project by primary key, or `:missing` when the row is gone.
  """
  @spec update(integer(), %{name: String.t(), description: String.t()}) :: :ok | :missing
  def update(id, %{name: name, description: description}) do
    {sql, params} =
      SQL.compile([
        {"UPDATE projects SET name = ?, description = ? WHERE id = ? RETURNING id",
         [name, description, id]}
      ])

    case Repo.query_maps(sql, params) do
      [] -> :missing
      _ -> :ok
    end
  end

  @doc """
  Deletes one project, or refuses while it still has tasks.

  `{:error, {:restricted, message}}` carries the reference's guard message:
  tasks.project_id is ON DELETE RESTRICT, so a project that still has tasks
  cannot be removed.
  """
  @spec remove(integer()) :: :ok | :missing | {:error, {:restricted, String.t()}}
  def remove(id) do
    case delete(id) do
      {:ok, [_ | _]} ->
        :ok

      {:ok, []} ->
        :missing

      {:error, %Postgrex.Error{postgres: %{code: code}}}
      when code in [:restrict_violation, :foreign_key_violation] ->
        {:error, {:restricted, guard_message(id)}}
    end
  end

  # The DELETE runs inside a savepoint so the FK violation does not abort the
  # surrounding transaction (the sandbox wraps every test in one). See
  # PhoenixRest.Users.delete/1 for the same pattern.
  defp delete(id) do
    Repo.transaction(fn ->
      try do
        Repo.query_maps("DELETE FROM projects WHERE id = $1 RETURNING id", [id])
      rescue
        error in Postgrex.Error -> Repo.rollback(error)
      end
    end)
  end

  defp guard_message(id) do
    case count("tasks", "project_id", id) do
      1 ->
        "This project still has 1 task. Delete it before deleting the project."

      count ->
        "This project still has #{count} tasks. Delete them before deleting the project."
    end
  end

  # The table and column names are internal constants, never user input.
  defp count(table, column, id) do
    [%{"count" => count}] =
      Repo.query_maps("SELECT COUNT(*)::int AS count FROM #{table} WHERE #{column} = $1", [id])

    count
  end
end
