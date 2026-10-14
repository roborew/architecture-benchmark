defmodule PhoenixRest.Users do
  # The users context: the only place that knows the users SQL. Mirrors the
  # reference variant's model (apps/tanstack-express-rest/express-rest/src/users/
  # users.model.ts), which itself mirrors the reference app's reads (getUsers,
  # getUser, getUserTasks) and writes (createUser, updateUser, deleteUser)
  # statement for statement, so both apps return identical rows and make
  # identical changes for the same database.
  #
  # The counts are correlated subqueries, not LEFT JOIN aggregates: joining
  # tasks x comments multiplies rows, and a COUNT(DISTINCT) over that product
  # costs each member's tasks x comments — on the large fixture ~40M rows per
  # request, enough to stall every page that renders a member select. Each
  # subquery walks one index (tasks_assignee_id_idx, comments_author_id_idx),
  # so the cost stays linear in the members listed, not in the data.
  @moduledoc """
  Reads and writes for the workspace members.

  Reads return string-keyed maps straight from the SQL aliases (the wire shape);
  writes return typed result tuples the controller maps to envelopes.
  """

  alias PhoenixRest.{Repo, SQL, TaskProjection}

  # The aggregate projection, built once as a fragment. Every read that returns a
  # member row reuses it, so the list and a member's detail header cannot
  # disagree about the aggregate counts.
  @user_aggregates """
  SELECT
    u.id::int AS id,
    u.display_name AS name,
    u.email,
    (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id)::int AS "assignedTaskCount",
    (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status <> 'done')::int AS "openTaskCount",
    (SELECT COUNT(*) FROM comments c WHERE c.author_id = u.id)::int AS "commentCount"
  FROM users u
  """

  @order_by "ORDER BY u.display_name DESC, u.id DESC"

  @doc """
  The workspace members with their aggregate counts, ordered by
  `display_name DESC, id DESC`. An empty `term` returns every member.
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

        {"WHERE u.display_name ILIKE ? OR u.email ILIKE ?", [pattern, pattern]}
      end

    {sql, params} =
      SQL.compile([
        {@user_aggregates, []},
        where,
        {@order_by, []}
      ])

    Repo.query_maps(sql, params)
  end

  @doc """
  One member by id, or `nil` when no row matches. Returns the same shape `list`
  does so the list and the detail header cannot disagree about the aggregate
  counts.
  """
  @spec get(integer()) :: map() | nil
  def get(id) do
    {sql, params} =
      SQL.compile([
        {@user_aggregates, []},
        {"WHERE u.id = ?", [id]}
      ])

    case Repo.query_maps(sql, params) do
      [user | _] -> user
      [] -> nil
    end
  end

  @doc """
  The tasks assigned to one member, ordered `updated_at DESC, id DESC`, with the
  shared task projection.
  """
  @spec list_tasks(integer()) :: [map()]
  def list_tasks(assignee_id) do
    {sql, params} =
      SQL.compile([
        {"SELECT", []},
        {TaskProjection.fields(), []},
        {TaskProjection.from(), []},
        {"WHERE t.assignee_id = ?", [assignee_id]},
        {"GROUP BY t.id, p.name, u.display_name", []},
        {"ORDER BY t.updated_at DESC, t.id DESC", []}
      ])

    Repo.query_maps(sql, params)
  end

  @doc """
  Inserts one member and returns its id.

  `RETURNING id` so the client can go to the row that was just created (the
  contract redirects a create to the new member's page).
  """
  @spec create(%{name: String.t(), email: String.t()}) :: {:ok, %{id: integer()}}
  def create(%{name: name, email: email}) do
    {sql, params} =
      SQL.compile([
        {"INSERT INTO users (display_name, email) VALUES (?, ?) RETURNING id::int AS id",
         [name, email]}
      ])

    [%{"id" => id}] = Repo.query_maps(sql, params)
    {:ok, %{id: id}}
  end

  @doc """
  Updates one member by primary key, or `:missing` when the row is gone.

  `RETURNING id` distinguishes "no such row" from "row updated", so a stale form
  cannot report success for a member who is already gone.
  """
  @spec update(integer(), %{name: String.t(), email: String.t()}) :: :ok | :missing
  def update(id, %{name: name, email: email}) do
    {sql, params} =
      SQL.compile([
        {"UPDATE users SET display_name = ?, email = ? WHERE id = ? RETURNING id",
         [name, email, id]}
      ])

    case Repo.query_maps(sql, params) do
      [] -> :missing
      _ -> :ok
    end
  end

  @doc """
  Deletes one member, or refuses while they have authored comments.

  `{:error, {:restricted, message}}` carries the reference's guard message:
  comments.author_id is ON DELETE RESTRICT, so a member who has written anything
  cannot be removed. tasks.assignee_id is ON DELETE SET NULL, which unassigns
  rather than blocking, so only comments stop a delete (and the task count in the
  message is context, not a second blocker).
  """
  @spec remove(integer()) :: :ok | :missing | {:error, {:restricted, String.t()}}
  def remove(id) do
    case delete(id) do
      {:ok, [_ | _]} ->
        :ok

      {:ok, []} ->
        :missing

      # 23001 is restrict_violation; 23503 is what NO ACTION raises, and both mean
      # the same thing here.
      {:error, %Postgrex.Error{postgres: %{code: code}}}
      when code in [:restrict_violation, :foreign_key_violation] ->
        {:error, {:restricted, guard_message(id)}}
    end
  end

  # The DELETE runs inside a savepoint: the FK violation aborts the surrounding
  # transaction otherwise, and the sandbox wraps every test in one. Rolling back
  # to the savepoint leaves the connection usable for the counts that build the
  # guard message. `Repo.rollback/1` unwinds the savepoint and the transaction
  # returns `{:error, error}`.
  defp delete(id) do
    Repo.transaction(fn ->
      try do
        Repo.query_maps("DELETE FROM users WHERE id = $1 RETURNING id", [id])
      rescue
        error in Postgrex.Error -> Repo.rollback(error)
      end
    end)
  end

  defp guard_message(id) do
    comment_count = count("comments", "author_id", id)
    task_count = count("tasks", "assignee_id", id)

    "This person still has #{comment_count} #{plural(comment_count, "comment", "comments")} and " <>
      "#{task_count} #{plural(task_count, "task", "tasks")}. Remove " <>
      "#{if comment_count == 1, do: "the comment", else: "the comments"} before deleting."
  end

  # The table and column names are internal constants, never user input.
  defp count(table, column, id) do
    [%{"count" => count}] =
      Repo.query_maps("SELECT COUNT(*)::int AS count FROM #{table} WHERE #{column} = $1", [id])

    count
  end

  defp plural(1, singular, _plural), do: singular
  defp plural(_count, _singular, plural), do: plural
end
