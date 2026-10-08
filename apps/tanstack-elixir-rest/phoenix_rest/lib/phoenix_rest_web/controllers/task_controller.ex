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
end
