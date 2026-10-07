defmodule PhoenixRest.Tasks.Validator do
  # Input validation for the tasks surface, kept pure so it can be unit tested
  # without any Plug or database: the list query params (status/projectId/
  # assigneeId/cursor/limit), and the JSON bodies of every write. The
  # controller maps an error case onto the JSON 400 envelope; the context
  # never sees an invalid value.
  #
  # The zod rules and their message strings are ported verbatim from the
  # reference variant's actions.ts (TaskSchema / CommentSchema), so a client
  # that rendered the reference app's validation errors renders ours
  # unchanged. A JSON body's absent field is normalised to null before
  # parsing: the reference parses FormData, where a field the form did not
  # submit reads back as null, and zod's own messages ("received null") are
  # part of that contract.
  @moduledoc """
  Parses the tasks surface's query params and write bodies.

  Read side: `parse_status/1`, `parse_list_query/1` (the workspace list) and
  `parse_project_list_query/1` (a project board). Write side: `parse_fields/1`
  (title/description/status), `parse_create_refs/1` and
  `parse_update_assignee/1` (the row ids a create/update references),
  `parse_with_comment_fields/1` (the with-comment body) and
  `parse_comment_body/1` (a comment on an existing task).
  """

  import PhoenixRest.Validation, only: [expected_string: 1]
  alias PhoenixRest.QueryParams

  # The stored status values (spec/contract.md) — identical to the reference's.
  @task_statuses ["todo", "in progress", "done"]
  @title_max 200
  @comment_max 1000

  # ---------------------------------------------------------------------------
  # Read-side query params
  # ---------------------------------------------------------------------------

  @doc """
  Parses the `status` filter.

  `status` is constrained text in the schema, so the reference's query layer
  validates it against the stored values and throws `Unknown task status: …`;
  the same message is this API's 400 envelope. Absent, empty and whitespace
  values mean "every status". A repeated param arrives as a list and is
  rejected, like `q`.
  """
  @spec parse_status(term()) :: {:ok, String.t()} | {:error, String.t()}
  def parse_status(nil), do: {:ok, ""}

  def parse_status(raw) when is_binary(raw) do
    term = String.trim(raw)

    if term != "" and term not in @task_statuses do
      {:error, "Unknown task status: #{term}"}
    else
      {:ok, term}
    end
  end

  def parse_status(_repeated_or_non_string), do: {:error, "status must be a single value"}

  @doc """
  Parses the workspace list's query params: `q` searches title/description,
  `status`/`projectId`/`assigneeId` filter, `cursor`/`limit` page.

  Validation order is fixed (q, status, projectId, assigneeId, cursor, limit)
  so a request with several bad params always reports the same one.
  """
  @spec parse_list_query(%{optional(String.t()) => term()}) ::
          {:ok,
           %{
             search: String.t(),
             status: String.t(),
             project_id: integer() | nil,
             assignee_id: integer() | nil,
             cursor: String.t() | nil,
             limit: integer() | nil
           }}
          | {:error, String.t()}
  def parse_list_query(params) do
    with {:ok, search} <- QueryParams.parse_search_term(Map.get(params, "q")),
         {:ok, status} <- parse_status(Map.get(params, "status")),
         {:ok, project_id} <- parse_integer_param(Map.get(params, "projectId"), "projectId"),
         {:ok, assignee_id} <- parse_integer_param(Map.get(params, "assigneeId"), "assigneeId"),
         {:ok, cursor} <- parse_single_string(Map.get(params, "cursor"), "cursor"),
         {:ok, limit} <- parse_integer_param(Map.get(params, "limit"), "limit") do
      {:ok,
       %{
         search: search,
         status: status,
         project_id: project_id,
         assignee_id: assignee_id,
         # An absent cursor is the first page; an empty one decodes to nothing.
         cursor: cursor,
         limit: limit
       }}
    end
  end

  @doc """
  Parses a project board's query params: `status`, `cursor`, `limit` — the
  workspace list's filters minus the ones a board cannot vary (its project is
  the URL; its order is `created_at`, so no search).
  """
  @spec parse_project_list_query(%{optional(String.t()) => term()}) ::
          {:ok, %{status: String.t(), cursor: String.t() | nil, limit: integer() | nil}}
          | {:error, String.t()}
  def parse_project_list_query(params) do
    with {:ok, status} <- parse_status(Map.get(params, "status")),
         {:ok, cursor} <- parse_single_string(Map.get(params, "cursor"), "cursor"),
         {:ok, limit} <- parse_integer_param(Map.get(params, "limit"), "limit") do
      {:ok, %{status: status, cursor: cursor, limit: limit}}
    end
  end

  # A single-value string param; absent is fine, a repeated value is a client
  # bug this API reports rather than hides.
  defp parse_single_string(nil, _name), do: {:ok, nil}
  defp parse_single_string(raw, _name) when is_binary(raw), do: {:ok, raw}

  defp parse_single_string(_repeated, name), do: {:error, "#{name} must be a single value"}

  # An integer filter param (`projectId`/`assigneeId`/`limit`).
  defp parse_integer_param(nil, _name), do: {:ok, nil}

  defp parse_integer_param(raw, name) when is_binary(raw) do
    if Regex.match?(~r/^-?\d+$/, raw) do
      {:ok, String.to_integer(raw)}
    else
      {:error, "#{name} must be an integer"}
    end
  end

  defp parse_integer_param(_repeated, name), do: {:error, "#{name} must be a single value"}

  # ---------------------------------------------------------------------------
  # Write-side bodies (zod rules ported verbatim from the reference's actions.ts)
  # ---------------------------------------------------------------------------

  @doc """
  Parses the task fields a create or update body submits
  (title/description/status).

  An omitted description is legal (the column defaults to ''), so null —
  which is what a field the client did not send reads back as — is normalised
  here rather than reported as a validation failure.
  """
  @spec parse_fields(term()) ::
          {:ok, %{title: String.t(), description: String.t(), status: String.t()}}
          | {:error, %{optional(String.t()) => [String.t()]}}
  def parse_fields(raw) do
    params = if is_map(raw), do: raw, else: %{}

    title = Map.get(params, "title")
    description = Map.get(params, "description")
    status = Map.get(params, "status")

    errors =
      %{}
      |> put_errors("title", title_errors(title))
      |> put_errors("description", description_errors(description))
      |> put_errors("status", status_errors(status))

    if errors == %{} do
      {:ok,
       %{
         title: String.trim(title),
         description: if(is_nil(description), do: "", else: String.trim(description)),
         status: status
       }}
    else
      {:error, errors}
    end
  end

  defp title_errors(nil), do: [expected_string(nil)]

  defp title_errors(title) when is_binary(title) do
    title = String.trim(title)

    cond do
      title == "" -> ["Title is required."]
      String.length(title) > @title_max -> ["Title must be #{@title_max} characters or fewer."]
      true -> []
    end
  end

  defp title_errors(other), do: [expected_string(other)]

  # The preprocess: an unsubmitted field is "" (the reference's FormData
  # read-back), never a validation failure.
  defp description_errors(nil), do: []
  defp description_errors(description) when is_binary(description), do: []
  defp description_errors(other), do: [expected_string(other)]

  defp status_errors(nil), do: ["Choose a valid status."]
  defp status_errors(status) when status in @task_statuses, do: []
  defp status_errors(_invalid), do: ["Choose a valid status."]

  @doc """
  The pure half of the reference's `resolveRefs`: which ids could name a row.

  `assigneeId` is nullable, and spec/contract.md gives exactly one way to
  unassign — an explicit empty choice — so absent, null and "" all mean
  "unassigned" rather than invalid. Everything else must be an integer; the
  database half (does the row exist) is the context's, run only once the
  shape is known to be good.
  """
  @spec parse_create_refs(term()) ::
          {:ok, %{project_id: integer(), assignee_id: integer() | nil}}
          | {:error, %{optional(String.t()) => [String.t()]}}
  def parse_create_refs(raw) do
    params = if is_map(raw), do: raw, else: %{}

    project_id = js_number(Map.get(params, "projectId"))

    assignee_id =
      case Map.get(params, "assigneeId") do
        nil -> nil
        "" -> nil
        other -> js_number(other)
      end

    errors =
      %{}
      |> put_errors("projectId", id_errors(project_id, "Choose a project."))
      |> put_errors("assigneeId", maybe_assignee_errors(assignee_id))

    if errors == %{} do
      {:ok, %{project_id: project_id, assignee_id: assignee_id}}
    else
      {:error, errors}
    end
  end

  @doc """
  The update body's assignee: the same rule as `parse_create_refs/1`, alone.
  """
  @spec parse_update_assignee(term()) ::
          {:ok, %{assignee_id: integer() | nil}}
          | {:error, %{optional(String.t()) => [String.t()]}}
  def parse_update_assignee(raw) do
    params = if is_map(raw), do: raw, else: %{}

    assignee_id =
      case Map.get(params, "assigneeId") do
        nil -> nil
        "" -> nil
        other -> js_number(other)
      end

    if is_nil(assignee_id) or is_integer(assignee_id) do
      {:ok, %{assignee_id: assignee_id}}
    else
      {:error, %{"assigneeId" => ["Choose a valid assignee."]}}
    end
  end

  # A nullable id: nil passes (unassigned), anything that is not an integer
  # cannot name a row.
  defp maybe_assignee_errors(nil), do: []
  defp maybe_assignee_errors(id) when is_integer(id), do: []
  defp maybe_assignee_errors(_other), do: ["Choose a valid assignee."]

  defp id_errors(id, _message) when is_integer(id), do: []
  defp id_errors(_other, message), do: [message]

  @doc """
  The comment half of a create-with-comment body, keyed as the reference's
  CommentSchema keys it. The 1000-character bound matches the CHECK on
  comments.body in spec/schema.sql. The author is coerced because it arrives
  from a `<select>` as a string.
  """
  @spec parse_with_comment_fields(term()) ::
          {:ok, %{comment_body: String.t(), comment_author_id: integer()}}
          | {:error, %{optional(String.t()) => [String.t()]}}
  def parse_with_comment_fields(raw) do
    params = if is_map(raw), do: raw, else: %{}

    comment_body = Map.get(params, "commentBody")
    comment_author = coerce_author(Map.get(params, "commentAuthorId"))

    errors =
      %{}
      |> put_errors("commentBody", comment_body_errors(comment_body))
      |> put_errors("commentAuthorId", author_errors(comment_author))

    if errors == %{} do
      {:ok, %{comment_body: String.trim(comment_body), comment_author_id: comment_author}}
    else
      {:error, errors}
    end
  end

  @doc """
  The POST /api/tasks/:id/comments body (body/authorId).

  The same rules as the with-comment half, keyed by this endpoint's own body
  field names so an error lands on the field the client actually sent.
  """
  @spec parse_comment_body(term()) ::
          {:ok, %{body: String.t(), author_id: integer()}}
          | {:error, %{optional(String.t()) => [String.t()]}}
  def parse_comment_body(raw) do
    params = if is_map(raw), do: raw, else: %{}

    body = Map.get(params, "body")
    author = coerce_author(Map.get(params, "authorId"))

    errors =
      %{}
      |> put_errors("body", comment_body_errors(body))
      |> put_errors("authorId", author_errors(author))

    if errors == %{} do
      {:ok, %{body: String.trim(body), author_id: author}}
    else
      {:error, errors}
    end
  end

  defp comment_body_errors(nil), do: ["Comment is required."]

  defp comment_body_errors(body) when is_binary(body) do
    body = String.trim(body)

    cond do
      body == "" ->
        ["Comment is required."]

      String.length(body) > @comment_max ->
        ["Comment must be #{@comment_max} characters or fewer."]

      true ->
        []
    end
  end

  defp comment_body_errors(other), do: [expected_string(other)]

  # z.coerce.number().int().positive(): the coerce of an absent/null field is
  # 0, which fails the positive rule with zod's own message — pinned by the
  # reference's FormData parse of an unsubmitted <select>.
  defp coerce_author(nil), do: 0

  defp coerce_author(id) do
    case js_number(id) do
      # An integer-valued float is that integer, like JS's single number type
      # (JSON's 2.0 and 2 name the same row).
      n when is_float(n) and trunc(n) == n -> trunc(n)
      other -> other
    end
  end

  defp author_errors(:nan), do: ["Invalid input: expected number, received nan"]

  defp author_errors(n) when is_integer(n) and n > 0, do: []

  defp author_errors(n) when is_float(n),
    do: ["Invalid input: expected integer, received #{n}"]

  defp author_errors(_too_small), do: ["Too small: expected number to be >0"]

  # JS Number(): the coercion the reference's id checks rely on — a numeric
  # string parses (whitespace-trimmed), "" is 0, and anything else is NaN.
  defp js_number(nil), do: :nan
  defp js_number(value) when is_integer(value) or is_float(value), do: value
  defp js_number(true), do: 1
  defp js_number(false), do: 0

  defp js_number(value) when is_binary(value) do
    trimmed = String.trim(value)

    cond do
      trimmed == "" ->
        0

      match?({_, ""}, Integer.parse(trimmed)) ->
        {n, ""} = Integer.parse(trimmed)
        n

      match?({_, ""}, Float.parse(trimmed)) ->
        {n, ""} = Float.parse(trimmed)
        n

      true ->
        :nan
    end
  end

  defp js_number(_other), do: :nan

  defp put_errors(acc, _field, []), do: acc
  defp put_errors(acc, field, messages), do: Map.put(acc, field, messages)
end
