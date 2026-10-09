defmodule PhoenixRestWeb.TaskController do
  # The controller layer for tasks: validates the request, translates it into a
  # context call, and writes the result to the response. Ported from the
  # reference variant's tasks.controller.ts.
  #
  # Validation lives in PhoenixRest.Tasks.Validator (the pure list-query and body
  # validators) and PhoenixRest.QueryParams (the `:id`).
  @moduledoc false

  use PhoenixRestWeb, :controller

  alias PhoenixRest.Tasks
  alias PhoenixRest.Tasks.Validator
  alias PhoenixRestWeb.{ApiError, Params}

  action_fallback PhoenixRestWeb.FallbackController

  @doc "GET /api/tasks — the workspace-wide task list, one keyset page."
  def index(conn, _params) do
    case conn |> Params.query() |> Validator.parse_list_query() do
      {:ok, filters} -> json(conn, Tasks.list(filters))
      {:error, message} -> {:error, ApiError.bad_request(message)}
    end
  end

  @doc "GET /api/tasks/count — how many tasks match the list's filters."
  def count(conn, _params) do
    # The count shares the list's filters; cursor/limit are list-paging params
    # and are simply not part of a count, so they are ignored here rather than
    # rejected.
    case conn |> Params.query() |> Validator.parse_list_query() do
      {:ok, filters} -> json(conn, %{"count" => Tasks.count(filters)})
      {:error, message} -> {:error, ApiError.bad_request(message)}
    end
  end

  @doc "GET /api/tasks/:id — one task with its project and assignee names."
  def show(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw),
         %{} = task <- Tasks.get(id) do
      json(conn, task)
    else
      {:error, error} -> {:error, error}
      nil -> {:error, ApiError.not_found("Not found")}
    end
  end

  @doc "GET /api/tasks/:id/comments — the 10 most recent comments on one task."
  def comments(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw) do
      json(conn, Tasks.list_comments(id))
    end
  end

  @doc "POST /api/tasks — insert one task, redirect to its detail page."
  def create(conn, _params) do
    body = conn.body_params
    message = "Missing fields. Failed to create task."

    with {:ok, fields} <- parsed(Validator.parse_fields(body), message),
         {:ok, refs} <- parsed(Validator.parse_create_refs(body), message),
         :ok <- resolved(refs, message) do
      {:ok, %{id: id}} = Tasks.create(task_input(fields, refs))

      conn
      |> put_status(201)
      |> json(%{"ok" => true, "message" => "Task created.", "redirectTo" => "/tasks/#{id}"})
    end
  end

  @doc "POST /api/tasks/with-comment — one transaction: a task and its first comment."
  def create_with_comment(conn, _params) do
    body = conn.body_params
    message = "Missing fields. Failed to create the task."

    with {:ok, fields} <- parsed(Validator.parse_fields(body), message),
         {:ok, comment} <- parsed(Validator.parse_with_comment_fields(body), message),
         {:ok, refs} <- parsed(Validator.parse_create_refs(body), message),
         :ok <- resolved(refs, message) do
      input =
        task_input(fields, refs)
        |> Map.merge(%{
          comment_body: comment.comment_body,
          comment_author_id: comment.comment_author_id
        })

      case Tasks.create_with_comment(input) do
        {:ok, %{id: id}} ->
          conn
          |> put_status(201)
          |> json(%{"ok" => true, "message" => "Task created.", "redirectTo" => "/tasks/#{id}"})

        {:error, :author_missing} ->
          # Filed under assigneeId verbatim from the reference: its form has one
          # person select, so a bad author landed on the same field the assignee
          # errors land on. The message string is the contract; the key follows it.
          {:error,
           ApiError.validation(message, %{
             "assigneeId" => ["That comment author no longer exists."]
           })}
      end
    end
  end

  @doc "PATCH /api/tasks/:id — update one task by primary key."
  def update(conn, %{"id" => raw}) do
    body = conn.body_params
    message = "Missing fields. Failed to update task."

    with {:ok, id} <- Params.id(raw),
         {:ok, fields} <- parsed(Validator.parse_fields(body), message),
         {:ok, assignee} <- parsed(Validator.parse_update_assignee(body), message) do
      # The project is deliberately not updatable here: spec/contract.md lists the
      # update form's fields as title, status, assignee and description — a task
      # belongs to its project for its lifetime.
      case Tasks.update(id, %{
             title: fields.title,
             description: fields.description,
             status: fields.status,
             assignee_id: assignee.assignee_id
           }) do
        :ok ->
          json(conn, %{"ok" => true, "message" => "Task updated.", "redirectTo" => "/tasks/#{id}"})

        :missing ->
          {:error, ApiError.not_found("That task no longer exists.")}

        {:error, :assignee_missing} ->
          {:error,
           ApiError.validation(message, %{"assigneeId" => ["That assignee no longer exists."]})}
      end
    end
  end

  @doc "DELETE /api/tasks/:id — delete one task; its comments cascade with it."
  def delete(conn, %{"id" => raw}) do
    with {:ok, id} <- Params.id(raw) do
      case Tasks.remove(id) do
        {:ok, project_id} ->
          # Straight to the board: the detail page for this id is now not-found,
          # so redirecting there would land the user on a dead URL.
          json(conn, %{
            "ok" => true,
            "message" => "Task deleted.",
            "redirectTo" => "/projects/#{project_id}"
          })

        :missing ->
          {:error, ApiError.not_found("That task no longer exists.")}
      end
    end
  end

  @doc "POST /api/tasks/:id/comments — add one comment to an existing task."
  def add_comment(conn, %{"id" => raw}) do
    message = "Missing fields. Failed to add the comment."

    with {:ok, id} <- Params.id(raw),
         {:ok, comment} <- parsed(Validator.parse_comment_body(conn.body_params), message) do
      case Tasks.add_comment(id, comment) do
        :ok ->
          # No redirect, mirroring the reference's createComment: the user stays
          # on the task detail page, so `ok: true` is the whole reply.
          conn
          |> put_status(201)
          |> json(%{"ok" => true})

        :missing ->
          {:error, ApiError.not_found("That task no longer exists.")}

        {:error, :author_missing} ->
          {:error,
           ApiError.validation(message, %{"authorId" => ["That comment author no longer exists."]})}
      end
    end
  end

  defp task_input(fields, refs) do
    %{
      project_id: refs.project_id,
      assignee_id: refs.assignee_id,
      title: fields.title,
      description: fields.description,
      status: fields.status
    }
  end

  defp parsed({:ok, data}, _message), do: {:ok, data}
  defp parsed({:error, errors}, message), do: {:error, ApiError.validation(message, errors)}

  defp resolved(refs, message) do
    case Tasks.resolve_refs(refs.project_id, refs.assignee_id) do
      errors when map_size(errors) == 0 -> :ok
      errors -> {:error, ApiError.validation(message, errors)}
    end
  end
end
